#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
LIGHT_MANIFEST = ROOT / "Hackathon" / "config" / "parallel-agents-light.json"
DARK_MANIFEST = ROOT / "Hackathon" / "config" / "parallel-agents-dark.json"


def read_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    light = read_manifest(LIGHT_MANIFEST)
    dark = read_manifest(DARK_MANIFEST)

    light_names = [slide["filename"] for slide in light["slides"]]
    dark_names = [slide["filename"] for slide in dark["slides"]]
    if light_names != dark_names:
        raise SystemExit("PAIR_MISMATCH: Light and Dark filenames differ")
    if len(light_names) != 6:
        raise SystemExit(f"BAD_SLIDE_COUNT: expected 6 per theme, found {len(light_names)}")

    for manifest in (light, dark):
        overlays = [slide["filename"] for slide in manifest["slides"] if slide.get("overlay_screenshot")]
        if overlays != ["01-poster-overview.png"]:
            raise SystemExit(
                f"BAD_OVERLAY_POLICY ({manifest.get('theme')}): expected Poster only, found {overlays}"
            )

    total = 0
    for folder in ("parallel-agents-light", "parallel-agents-dark"):
        output_dir = ROOT / "Hackathon" / folder
        for name in light_names:
            path = output_dir / name
            if not path.exists():
                raise SystemExit(f"MISSING: {path}")
            with Image.open(path) as image:
                if image.size != (1536, 1024):
                    raise SystemExit(f"BAD_SIZE: {path} -> {image.size}")
            total += 1
        prompt_path = output_dir / "prompts.json"
        if not prompt_path.exists():
            raise SystemExit(f"MISSING: {prompt_path}")

    if total != 12:
        raise SystemExit(f"BAD_TOTAL: expected 12, found {total}")
    print("OK: 12 paired theme images validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
