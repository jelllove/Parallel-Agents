#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]

API_VERSION = "2025-04-01-preview"


def _read_user_env_windows(name: str) -> str | None:
    if os.name != "nt":
        return None
    try:
        import winreg  # type: ignore

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as key:
            value, _ = winreg.QueryValueEx(key, name)
            value = value.strip()
            return value or None
    except Exception:
        return None


def resolve_env(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return _read_user_env_windows(name)


def read_required_env() -> tuple[str, str, str]:
    endpoint = resolve_env("AZURE_OPENAI_ENDPOINT")
    deployment = resolve_env("AZURE_OPENAI_IMAGE_DEPLOYMENT")
    api_key = resolve_env("AZURE_OPENAI_API_KEY") or resolve_env("OPENAI_API_KEY")
    missing: list[str] = []
    if not endpoint:
        missing.append("AZURE_OPENAI_ENDPOINT")
    if not deployment:
        missing.append("AZURE_OPENAI_IMAGE_DEPLOYMENT")
    if not api_key:
        missing.append("AZURE_OPENAI_API_KEY|OPENAI_API_KEY")
    if missing:
        raise RuntimeError(f"Missing env vars: {', '.join(missing)}")
    return endpoint.rstrip("/"), deployment, api_key


def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if data.get("size") != "1536x1024":
        raise RuntimeError("Manifest size must be 1536x1024.")
    slides = data.get("slides")
    if not isinstance(slides, list) or len(slides) != 6:
        raise RuntimeError("Theme manifest must define exactly 6 slides.")
    return data


def azure_generate(
    endpoint: str,
    deployment: str,
    api_key: str,
    prompt: str,
    size: str,
    quality: str,
    retries: int = 2,
) -> bytes:
    url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version={API_VERSION}"
    payload = {
        "prompt": prompt,
        "size": size,
        "quality": quality,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    attempt = 0
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                raw = resp.read().decode("utf-8")
            parsed = json.loads(raw)
            b64 = parsed["data"][0]["b64_json"]
            return base64.b64decode(b64)
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if attempt > retries:
                raise RuntimeError(
                    f"Image API HTTP {e.code} after {attempt} attempts. "
                    f"Response excerpt: {err_body[:500]}"
                ) from e
            time.sleep(2.5 * attempt)
        except Exception as e:
            if attempt > retries:
                raise RuntimeError(f"Image API failed after {attempt} attempts: {e}") from e
            time.sleep(2.5 * attempt)


def save_png(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def _build_shadow(width: int, height: int) -> Image.Image:
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    inner = Image.new("RGBA", (width - 16, height - 16), (0, 0, 0, 160))
    shadow.paste(inner, (8, 8), inner)
    return shadow.filter(ImageFilter.GaussianBlur(10))


def overlay_screenshot(base_path: Path, screenshot_path: Path) -> None:
    if not screenshot_path.exists():
        raise FileNotFoundError(f"Screenshot not found: {screenshot_path}")
    base = Image.open(base_path).convert("RGBA")
    shot = Image.open(screenshot_path).convert("RGBA")
    shot = ImageOps.contain(shot, (690, 450))

    # Screenshot card with border.
    card = Image.new("RGBA", (shot.width + 22, shot.height + 22), (24, 28, 40, 238))
    card.paste(shot, (11, 11), shot)
    draw = ImageDraw.Draw(card)
    draw.rectangle((1, 1, card.width - 2, card.height - 2), outline=(66, 190, 255, 170), width=2)

    # Poster prompts reserve the upper-right product screen for the real UI.
    x = base.width - card.width - 68
    y = 130
    shadow = _build_shadow(card.width + 14, card.height + 14)
    base.paste(shadow, (x - 7, y - 5), shadow)
    base.paste(card, (x, y), card)
    base.save(base_path, "PNG")


def build_full_prompt(style_anchor: str, slide_prompt: str) -> str:
    return (
        f"{style_anchor}\n\n"
        f"Slide content request:\n{slide_prompt}\n\n"
        "Constraints: English text only; avoid gibberish glyphs; "
        "clean spacing; legible heading zones; polished keynote slide quality."
    )


def run(manifest_path: Path, output_dir: Path, dry_run: bool = False, force: bool = False) -> None:
    endpoint, deployment, api_key = read_required_env()
    manifest = load_manifest(manifest_path)
    size: str = manifest["size"]
    quality: str = manifest.get("quality", "high")
    style_anchor_prompt: str = manifest["style_anchor_prompt"]
    screenshot_raw = manifest.get("screenshot_path")
    screenshot = (ROOT / screenshot_raw) if isinstance(screenshot_raw, str) and screenshot_raw else None
    slides: list[dict[str, Any]] = manifest["slides"]
    prompt_export = output_dir / "prompts.json"
    style_anchor_file = output_dir / "00-style-anchor.png"
    output_dir.mkdir(parents=True, exist_ok=True)

    if dry_run:
        print("dry-run: env + manifest are valid")
        print(f"manifest={manifest_path}")
        print(f"theme={manifest.get('theme', 'unspecified')}")
        print(f"endpoint={endpoint}")
        print(f"deployment={deployment}")
        print(f"slides={len(slides)}")
        return

    used_prompts: list[dict[str, Any]] = []

    if style_anchor_file.exists() and not force:
        print(f"  skip existing {style_anchor_file}")
    else:
        print("Generating style anchor...")
        anchor_bytes = azure_generate(
            endpoint=endpoint,
            deployment=deployment,
            api_key=api_key,
            prompt=style_anchor_prompt,
            size=size,
            quality=quality,
        )
        save_png(style_anchor_file, anchor_bytes)
        print(f"  wrote {style_anchor_file}")

    total = len(slides)
    for i, slide in enumerate(slides, start=1):
        filename = slide["filename"]
        full_prompt = build_full_prompt(style_anchor_prompt, slide["prompt"])
        out_path = output_dir / filename
        if out_path.exists() and not force:
            print(f"[{i}/{total}] skip existing {out_path}")
        else:
            print(f"[{i}/{total}] generating {filename} ...")
            img_bytes = azure_generate(
                endpoint=endpoint,
                deployment=deployment,
                api_key=api_key,
                prompt=full_prompt,
                size=size,
                quality=quality,
            )
            save_png(out_path, img_bytes)
            if slide.get("overlay_screenshot", False):
                if screenshot is None:
                    raise RuntimeError(
                        f"Slide {filename} requires screenshot overlay but screenshot_path is not configured."
                    )
                overlay_screenshot(out_path, screenshot)
                print(f"  overlay screenshot -> {filename}")
            print(f"  wrote {out_path}")
        used_prompts.append(
            {
                "id": slide["id"],
                "filename": filename,
                "title": slide["title"],
                "overlay_screenshot": bool(slide.get("overlay_screenshot", False)),
                "prompt": full_prompt,
            }
        )

    prompt_export.write_text(
        json.dumps(
            {
                "size": size,
                "quality": quality,
                "style_anchor_prompt": style_anchor_prompt,
                "slides": used_prompts,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {prompt_export}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Hackathon image pack with Azure GPT Image.")
    parser.add_argument("--dry-run", action="store_true", help="Validate env+manifest only.")
    parser.add_argument("--manifest", required=True, help="Theme manifest JSON path")
    parser.add_argument("--output-dir", required=True, help="Theme output directory")
    parser.add_argument("--force", action="store_true", help="Regenerate files that already exist")
    args = parser.parse_args()
    try:
        run(
            manifest_path=Path(args.manifest),
            output_dir=Path(args.output_dir),
            dry_run=args.dry_run,
            force=args.force,
        )
        return 0
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
