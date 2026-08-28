#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "Hackathon" / "config" / "hackathon-image-prompts.json"
DEFAULT_OUTPUT = ROOT / "Hackathon" / "generated"


def fail(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated Hackathon images.")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="Prompt manifest JSON path")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT), help="Generated images directory")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    output_dir = Path(args.output_dir)
    if not manifest_path.exists():
        return fail(f"MISSING_MANIFEST: {manifest_path}")
    if not output_dir.exists():
        return fail(f"MISSING_OUTPUT_DIR: {output_dir}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    size = manifest.get("size")
    if not isinstance(size, str) or "x" not in size:
        return fail(f"BAD_SIZE_DECLARATION: {size}")
    try:
        width, height = [int(v) for v in size.split("x", 1)]
    except Exception:
        return fail(f"BAD_SIZE_DECLARATION: {size}")

    slides = manifest.get("slides")
    if not isinstance(slides, list) or not slides:
        return fail("BAD_SLIDES: manifest has no slides")
    expected = []
    for slide in slides:
        if not isinstance(slide, dict) or "filename" not in slide:
            return fail("BAD_SLIDE_ENTRY: each slide must have filename")
        expected.append(str(slide["filename"]))

    missing = [name for name in expected if not (output_dir / name).exists()]
    if missing:
        return fail("MISSING: " + ", ".join(missing))
    print("OK: all expected files exist")

    for name in expected:
        with Image.open(output_dir / name) as img:
            if img.size != (width, height):
                return fail(f"BAD_SIZE: {name} -> {img.size}, expected {(width, height)}")
    print(f"OK: dimensions validated ({width}x{height})")

    prompts_file = output_dir / "prompts.json"
    if not prompts_file.exists():
        return fail(f"MISSING: {prompts_file}")
    payload = json.loads(prompts_file.read_text(encoding="utf-8"))
    prompt_slides = payload.get("slides")
    if not isinstance(prompt_slides, list) or len(prompt_slides) != len(expected):
        return fail(
            "BAD_PROMPTS_SLIDES_COUNT: "
            f"{0 if not isinstance(prompt_slides, list) else len(prompt_slides)} "
            f"(expected {len(expected)})"
        )
    print("OK: prompts manifest validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
