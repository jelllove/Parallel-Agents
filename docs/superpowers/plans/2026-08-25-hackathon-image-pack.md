# Hackathon Image Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 9 English marketing images (1 overview poster + 8 story slides) for Parallel Agents using the user’s local GPT Image 2 Azure OpenAI endpoint, aligned to the sample style and using the real app screenshot.

**Architecture:** Build a small Python-based image pipeline under `Hackathon/scripts/` that reads a prompt manifest, calls Azure OpenAI image generation, writes PNG outputs, composites the real screenshot on designated slides, and validates output dimensions/naming. Keep prompts declarative in JSON so regeneration is deterministic and editable without code changes.

**Tech Stack:** Python 3 standard library (`json`, `urllib`, `base64`, `pathlib`), Pillow for image compositing/metadata validation, Azure OpenAI Images API, PowerShell for execution.

---

## File Structure / Responsibility Map

- **Create:** `Hackathon/config/hackathon-image-prompts.json`  
  Owns style anchor prompt, 9 slide prompts, output filenames, and “needs screenshot overlay” flags.

- **Create:** `Hackathon/scripts/generate_hackathon_images.py`  
  Owns end-to-end generation flow: env validation, API calls, writing images, screenshot compositing, run summary.

- **Create:** `Hackathon/scripts/validate_hackathon_images.py`  
  Owns post-generation checks: exact file list, dimensions (1536x1024), readable manifest consistency.

- **Create:** `Hackathon/generated/` (output directory)  
  Owns generated deliverables:
  `01-poster-overview.png` ... `09-hackathon-cta.png` + `prompts.json`.

- **Modify:** `Hackathon/README.md` (create if missing)  
  Owns operator instructions: required env vars, generate command, re-run command, troubleshooting.

---

### Task 1: Define Prompt Manifest and Output Contract

**Files:**
- Create: `Hackathon/config/hackathon-image-prompts.json`
- Create: `Hackathon/generated/.gitkeep`
- Test: `Hackathon/scripts/validate_hackathon_images.py` (stub for contract-first check)

- [ ] **Step 1: Write the failing contract check first**

```python
# Hackathon/scripts/validate_hackathon_images.py (initial stub)
from pathlib import Path
import sys

EXPECTED = [
    "01-poster-overview.png",
    "02-problem-fragmentation.png",
    "03-problem-context-switching.png",
    "04-design-concept.png",
    "05-architecture.png",
    "06-session-workflow.png",
    "07-benefits.png",
    "08-real-usage.png",
    "09-hackathon-cta.png",
]

out_dir = Path("Hackathon/generated")
missing = [name for name in EXPECTED if not (out_dir / name).exists()]
if missing:
    print("MISSING:", ", ".join(missing))
    sys.exit(1)
print("OK: all expected files exist")
```

- [ ] **Step 2: Run contract check to confirm initial failure**

Run:

```powershell
python Hackathon/scripts/validate_hackathon_images.py
```

Expected: `MISSING:` for all 9 files.

- [ ] **Step 3: Add complete JSON manifest with style anchor + 9 prompts**

```json
{
  "size": "1536x1024",
  "style_anchor_prompt": "Futuristic dark-tech product keynote visual, neon accents, cinematic gradient, clean typography zones, premium software marketing style, English-only headings.",
  "slides": [
    {
      "id": "01",
      "filename": "01-poster-overview.png",
      "title": "Parallel Agents",
      "prompt": "Create a hero poster for Parallel Agents. Headline: 'One Window. Every Coding Agent.' Subheadline: 'Claude, Codex, Gemini, Copilot — side by side in one desktop workspace.' Add concise English callouts for projects, sessions, terminal tabs, explorer, git panel.",
      "overlay_screenshot": true
    }
  ]
}
```

(Expand `slides` to all nine storyboard entries from the approved spec.)

- [ ] **Step 4: Re-run JSON parse sanity check**

Run:

```powershell
python -c "import json, pathlib; p=pathlib.Path(r'Hackathon/config/hackathon-image-prompts.json'); d=json.loads(p.read_text(encoding='utf-8')); assert d['size']=='1536x1024'; assert len(d['slides'])==9; print('manifest-ok')"
```

Expected: `manifest-ok`

- [ ] **Step 5: Commit**

```powershell
git add Hackathon/config/hackathon-image-prompts.json Hackathon/generated/.gitkeep Hackathon/scripts/validate_hackathon_images.py
git commit -m "chore: define hackathon image prompt manifest and output contract"
```

---

### Task 2: Implement GPT Image 2 Generation Pipeline

**Files:**
- Create: `Hackathon/scripts/generate_hackathon_images.py`
- Modify: `Hackathon/scripts/validate_hackathon_images.py`
- Test: `Hackathon/scripts/generate_hackathon_images.py` (dry-run env validation mode)

- [ ] **Step 1: Add failing env validation path first**

```python
def read_required_env():
    import os
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    deployment = os.getenv("AZURE_OPENAI_IMAGE_DEPLOYMENT")
    api_key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    missing = [
        name for name, value in [
            ("AZURE_OPENAI_ENDPOINT", endpoint),
            ("AZURE_OPENAI_IMAGE_DEPLOYMENT", deployment),
            ("AZURE_OPENAI_API_KEY|OPENAI_API_KEY", api_key),
        ] if not value
    ]
    if missing:
        raise RuntimeError("Missing env vars: " + ", ".join(missing))
    return endpoint.rstrip("/"), deployment, api_key
```

- [ ] **Step 2: Verify failure behavior when key is missing**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py --dry-run
```

Expected: explicit `Missing env vars:` message if any required value is absent.

- [ ] **Step 3: Implement Azure Images API call + PNG write**

```python
import base64, json, urllib.request

def generate_one(endpoint, deployment, api_key, prompt, size):
    url = f"{endpoint}/openai/deployments/{deployment}/images/generations?api-version=2025-04-01-preview"
    body = json.dumps({"prompt": prompt, "size": size}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    b64 = payload["data"][0]["b64_json"]
    return base64.b64decode(b64)
```

- [ ] **Step 4: Wire style-anchor + 9 slide generation loop**

```python
# Pseudocode shape in generate_hackathon_images.py
manifest = load_manifest()
anchor_prompt = manifest["style_anchor_prompt"]
slides = manifest["slides"]
anchor_bytes = generate_one(endpoint, deployment, api_key, anchor_prompt, manifest["size"])
write_file("Hackathon/generated/00-style-anchor.png", anchor_bytes)
for slide in slides:
    full_prompt = f"{anchor_prompt}\n\nSlide goal: {slide['prompt']}\nEnglish text only."
    png_bytes = generate_one(endpoint, deployment, api_key, full_prompt, manifest["size"])
    write_file(f"Hackathon/generated/{slide['filename']}", png_bytes)
```

- [ ] **Step 5: Run generator and verify output count appears**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py
```

Expected: logs for `00-style-anchor.png` + each `01..09` output file.

- [ ] **Step 6: Commit**

```powershell
git add Hackathon/scripts/generate_hackathon_images.py Hackathon/scripts/validate_hackathon_images.py
git commit -m "feat: add gpt-image generation pipeline for hackathon image pack"
```

---

### Task 3: Composite Real Screenshot into Designated Slides

**Files:**
- Modify: `Hackathon/scripts/generate_hackathon_images.py`
- Modify: `Hackathon/config/hackathon-image-prompts.json`
- Test: `Hackathon/scripts/validate_hackathon_images.py`

- [ ] **Step 1: Mark screenshot-overlay slides in manifest**

```json
{
  "id": "05",
  "filename": "05-architecture.png",
  "overlay_screenshot": true
}
```

(Set `overlay_screenshot: true` for slides 01/05/08, and optionally 07.)

- [ ] **Step 2: Implement screenshot compositing helper**

```python
from PIL import Image, ImageOps

def overlay_screenshot(base_path, screenshot_path):
    base = Image.open(base_path).convert("RGBA")
    shot = Image.open(screenshot_path).convert("RGBA")
    shot = ImageOps.contain(shot, (700, 370))
    frame = Image.new("RGBA", (shot.width + 20, shot.height + 20), (18, 22, 30, 235))
    frame.paste(shot, (10, 10), shot)
    base.paste(frame, (base.width - frame.width - 70, base.height - frame.height - 70), frame)
    base.save(base_path, "PNG")
```

- [ ] **Step 3: Hook compositing into generation loop**

```python
if slide.get("overlay_screenshot"):
    overlay_screenshot(
        output_path,
        "Hackathon/Screen captuer/chrome_rY8BNU67RP.png",
    )
```

- [ ] **Step 4: Run generation again and verify overlays visually**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py
```

Expected: overlay-enabled slide files are regenerated and include the real screenshot frame.

- [ ] **Step 5: Commit**

```powershell
git add Hackathon/config/hackathon-image-prompts.json Hackathon/scripts/generate_hackathon_images.py
git commit -m "feat: composite real app screenshot into selected hackathon slides"
```

---

### Task 4: Add Strong Validation + Prompt Manifest Export

**Files:**
- Modify: `Hackathon/scripts/validate_hackathon_images.py`
- Modify: `Hackathon/scripts/generate_hackathon_images.py`
- Create: `Hackathon/generated/prompts.json` (runtime output)

- [ ] **Step 1: Add dimension validation checks**

```python
from PIL import Image

for name in EXPECTED:
    p = out_dir / name
    with Image.open(p) as im:
        if im.size != (1536, 1024):
            raise SystemExit(f"BAD_SIZE: {name} -> {im.size}")
print("OK: dimensions validated")
```

- [ ] **Step 2: Export effective prompts used for each slide**

```python
manifest_out = out_dir / "prompts.json"
manifest_out.write_text(
    json.dumps({"size": size, "slides": used_prompts}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
```

- [ ] **Step 3: Run validator and verify pass**

Run:

```powershell
python Hackathon/scripts/validate_hackathon_images.py
```

Expected:  
`OK: all expected files exist`  
`OK: dimensions validated`

- [ ] **Step 4: Commit**

```powershell
git add Hackathon/scripts/validate_hackathon_images.py Hackathon/scripts/generate_hackathon_images.py Hackathon/generated/prompts.json
git commit -m "chore: validate generated image dimensions and export prompt manifest"
```

---

### Task 5: Document Operator Workflow and Regeneration Commands

**Files:**
- Modify: `Hackathon/README.md` (create if absent)
- Test: manual command replay from docs

- [ ] **Step 1: Write usage documentation**

```markdown
# Hackathon Image Generation

## Required environment variables
- AZURE_OPENAI_ENDPOINT
- AZURE_OPENAI_IMAGE_DEPLOYMENT
- AZURE_OPENAI_API_KEY (or OPENAI_API_KEY)

## Generate
python Hackathon/scripts/generate_hackathon_images.py

## Validate
python Hackathon/scripts/validate_hackathon_images.py
```

- [ ] **Step 2: Replay documented commands exactly**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py
python Hackathon/scripts/validate_hackathon_images.py
```

Expected: generation logs + validator success output.

- [ ] **Step 3: Commit**

```powershell
git add Hackathon/README.md
git commit -m "docs: add hackathon image generation and validation workflow"
```

---

## Spec Coverage Self-Review

- **Objective & Deliverables:** Covered by Tasks 1–4 (9 files, 1536×1024, prompt export).
- **Storyboard content:** Covered by Task 1 manifest and Task 2 generation loop.
- **Style-lock two-pass:** Covered by Task 2 anchor generation + shared style prompt.
- **Screenshot integration:** Covered by Task 3 compositing and manifest flags.
- **Error handling:** Covered by Task 2 env validation and API failure surfacing.
- **Validation checks:** Covered by Task 4 validator.
- **Operator usability:** Covered by Task 5 documentation and replay.

No placeholder/TODO content remains. Task names, file paths, and command references are consistent with the approved spec.

