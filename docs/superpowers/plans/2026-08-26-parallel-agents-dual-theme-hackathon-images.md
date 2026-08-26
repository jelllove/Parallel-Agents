# Parallel Agents Dual-Theme Hackathon Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a coordinated Light and Dark Microsoft Hackathon visual set for Parallel Agents, with six English slides per theme and a real product screenshot embedded only in each Poster.

**Architecture:** Extend the existing manifest-driven Python image pipeline to accept paired theme manifests, skip already completed outputs, generate one style anchor per theme, and composite a real screenshot only when a slide explicitly requests it. Validate each theme independently and then validate the 12-image pair contract.

**Tech Stack:** Python 3, Pillow, Azure OpenAI GPT Image 2 API, JSON manifests, PowerShell.

---

## File Structure

- **Create:** `Hackathon/config/parallel-agents-light.json` — Light theme style and six-slide prompts.
- **Create:** `Hackathon/config/parallel-agents-dark.json` — Dark theme style and the same six-slide prompts/layout constraints.
- **Modify:** `Hackathon/scripts/generate_hackathon_images.py` — manifest selection, resume/skip support, Poster-only screenshot compositing.
- **Modify:** `Hackathon/scripts/validate_hackathon_images.py` — per-theme validation and screenshot-overlay policy checks.
- **Create:** `Hackathon/scripts/validate_dual_theme_pack.py` — verifies matching Light/Dark file contracts and total 12 outputs.
- **Create:** `Hackathon/parallel-agents-light/` — Light outputs and effective prompt manifest.
- **Create:** `Hackathon/parallel-agents-dark/` — Dark outputs and effective prompt manifest.

---

### Task 1: Define Paired Theme Manifests

**Files:**
- Create: `Hackathon/config/parallel-agents-light.json`
- Create: `Hackathon/config/parallel-agents-dark.json`

- [ ] **Step 1: Create the Light manifest with exact six-slide contract**

Use this shape:

```json
{
  "theme": "light",
  "size": "1536x1024",
  "quality": "high",
  "screenshot_path": "Hackathon/Screen captuer/Parallel_Agents_Vk26skhqBu.png",
  "style_anchor_prompt": "Microsoft Fluent-inspired bright product illustration...",
  "slides": [
    {
      "id": "01",
      "filename": "01-poster-overview.png",
      "title": "Parallel Agents",
      "overlay_screenshot": true,
      "visual_mode": "realistic-product-poster",
      "prompt": "Headline: Parallel Agents..."
    },
    {
      "id": "02",
      "filename": "02-problem.png",
      "title": "Problem",
      "overlay_screenshot": false,
      "visual_mode": "illustrated-infographic",
      "prompt": "Explain fragmented CLI windows..."
    }
  ]
}
```

Add the remaining exact filenames: `03-design.png`, `04-architecture.png`, `05-session-workflow.png`, and `06-benefits.png`.

- [ ] **Step 2: Create the Dark manifest with identical storyboard and layout directives**

The Dark manifest must keep the same six filenames, titles, visual modes, and English copy while changing only its style anchor:

```json
{
  "theme": "dark",
  "style_anchor_prompt": "Microsoft Fluent-inspired dark product illustration; deep charcoal and navy surfaces; VS Code-like panel rhythm; restrained blue glow; friendly characters; no heavy sci-fi treatment..."
}
```

- [ ] **Step 3: Verify paired manifest contracts**

Run:

```powershell
python -c "import json,pathlib; a=json.loads(pathlib.Path(r'Hackathon/config/parallel-agents-light.json').read_text()); b=json.loads(pathlib.Path(r'Hackathon/config/parallel-agents-dark.json').read_text()); assert len(a['slides'])==len(b['slides'])==6; assert [x['filename'] for x in a['slides']]==[x['filename'] for x in b['slides']]; assert sum(bool(x['overlay_screenshot']) for x in a['slides'])==1; assert sum(bool(x['overlay_screenshot']) for x in b['slides'])==1; print('paired-manifests-ok')"
```

Expected: `paired-manifests-ok`

- [ ] **Step 4: Commit**

```powershell
git add Hackathon/config/parallel-agents-light.json Hackathon/config/parallel-agents-dark.json
git commit -m "chore: define paired light and dark hackathon image manifests"
```

---

### Task 2: Add Manifest Selection and Resume Support

**Files:**
- Modify: `Hackathon/scripts/generate_hackathon_images.py`

- [ ] **Step 1: Add CLI arguments**

```python
parser.add_argument("--manifest", required=True, help="Theme manifest JSON path")
parser.add_argument("--output-dir", required=True, help="Theme output directory")
parser.add_argument("--force", action="store_true", help="Regenerate files that already exist")
```

- [ ] **Step 2: Replace fixed manifest loading with an explicit path**

```python
def load_manifest(manifest_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if data.get("size") != "1536x1024":
        raise RuntimeError("Manifest size must be 1536x1024.")
    if not isinstance(data.get("slides"), list) or len(data["slides"]) != 6:
        raise RuntimeError("Theme manifest must define exactly 6 slides.")
    return data
```

- [ ] **Step 3: Add skip/resume logic**

```python
if out_path.exists() and not force:
    print(f"  skip existing {out_path}")
else:
    img_bytes = azure_generate(...)
    save_png(out_path, img_bytes)
    if slide.get("overlay_screenshot"):
        overlay_screenshot(out_path, screenshot)
```

- [ ] **Step 4: Verify dry runs for both manifests**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py --dry-run --manifest Hackathon/config/parallel-agents-light.json --output-dir Hackathon/parallel-agents-light
python Hackathon/scripts/generate_hackathon_images.py --dry-run --manifest Hackathon/config/parallel-agents-dark.json --output-dir Hackathon/parallel-agents-dark
```

Expected: both report `slides=6`, correct theme manifest, endpoint, and deployment.

- [ ] **Step 5: Commit**

```powershell
git add Hackathon/scripts/generate_hackathon_images.py
git commit -m "feat: support themed manifests and resumable image generation"
```

---

### Task 3: Generate Light Theme Pack

**Files:**
- Create: `Hackathon/parallel-agents-light/00-style-anchor.png`
- Create: `Hackathon/parallel-agents-light/01-poster-overview.png`
- Create: `Hackathon/parallel-agents-light/02-problem.png`
- Create: `Hackathon/parallel-agents-light/03-design.png`
- Create: `Hackathon/parallel-agents-light/04-architecture.png`
- Create: `Hackathon/parallel-agents-light/05-session-workflow.png`
- Create: `Hackathon/parallel-agents-light/06-benefits.png`
- Create: `Hackathon/parallel-agents-light/prompts.json`

- [ ] **Step 1: Generate the Light pack**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py --manifest Hackathon/config/parallel-agents-light.json --output-dir Hackathon/parallel-agents-light
```

Expected: one style anchor, six slides, and `prompts.json`.

- [ ] **Step 2: Verify that only the Poster was composited**

Check generation logs: exactly one `overlay screenshot -> 01-poster-overview.png` message and no overlay messages for slides 02–06.

- [ ] **Step 3: Validate dimensions and output contract**

Run:

```powershell
python Hackathon/scripts/validate_hackathon_images.py --manifest Hackathon/config/parallel-agents-light.json --output-dir Hackathon/parallel-agents-light
```

Expected:

```text
OK: all expected files exist
OK: dimensions validated (1536x1024)
OK: prompts manifest validated
```

---

### Task 4: Generate Dark Theme Pack

**Files:**
- Create: `Hackathon/parallel-agents-dark/00-style-anchor.png`
- Create: `Hackathon/parallel-agents-dark/01-poster-overview.png`
- Create: `Hackathon/parallel-agents-dark/02-problem.png`
- Create: `Hackathon/parallel-agents-dark/03-design.png`
- Create: `Hackathon/parallel-agents-dark/04-architecture.png`
- Create: `Hackathon/parallel-agents-dark/05-session-workflow.png`
- Create: `Hackathon/parallel-agents-dark/06-benefits.png`
- Create: `Hackathon/parallel-agents-dark/prompts.json`

- [ ] **Step 1: Generate the Dark pack**

Run:

```powershell
python Hackathon/scripts/generate_hackathon_images.py --manifest Hackathon/config/parallel-agents-dark.json --output-dir Hackathon/parallel-agents-dark
```

Expected: one style anchor, six slides, and `prompts.json`.

- [ ] **Step 2: Verify that only the Poster was composited**

Check generation logs: exactly one `overlay screenshot -> 01-poster-overview.png` message and no overlay messages for slides 02–06.

- [ ] **Step 3: Validate dimensions and output contract**

Run:

```powershell
python Hackathon/scripts/validate_hackathon_images.py --manifest Hackathon/config/parallel-agents-dark.json --output-dir Hackathon/parallel-agents-dark
```

Expected: all three validation success lines.

---

### Task 5: Validate Paired Theme Consistency

**Files:**
- Create: `Hackathon/scripts/validate_dual_theme_pack.py`

- [ ] **Step 1: Implement paired-contract validator**

```python
from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[2]
light_manifest = json.loads((ROOT / "Hackathon/config/parallel-agents-light.json").read_text())
dark_manifest = json.loads((ROOT / "Hackathon/config/parallel-agents-dark.json").read_text())

light_names = [slide["filename"] for slide in light_manifest["slides"]]
dark_names = [slide["filename"] for slide in dark_manifest["slides"]]
if light_names != dark_names:
    raise SystemExit("PAIR_MISMATCH: filenames differ")

for folder in ["parallel-agents-light", "parallel-agents-dark"]:
    for name in light_names:
        path = ROOT / "Hackathon" / folder / name
        if not path.exists():
            raise SystemExit(f"MISSING: {path}")
        with Image.open(path) as image:
            if image.size != (1536, 1024):
                raise SystemExit(f"BAD_SIZE: {path} -> {image.size}")

print("OK: 12 paired theme images validated")
```

- [ ] **Step 2: Run paired validation**

Run:

```powershell
python Hackathon/scripts/validate_dual_theme_pack.py
```

Expected: `OK: 12 paired theme images validated`

- [ ] **Step 3: Review file list**

Run:

```powershell
Get-ChildItem Hackathon\parallel-agents-light,Hackathon\parallel-agents-dark -File |
  Where-Object { $_.Name -match '^0[1-6]-.*\.png$' } |
  Select-Object DirectoryName,Name,Length
```

Expected: exactly 12 PNG rows.

- [ ] **Step 4: Commit pipeline and generated deliverables**

```powershell
git add Hackathon/config/parallel-agents-light.json Hackathon/config/parallel-agents-dark.json Hackathon/scripts/generate_hackathon_images.py Hackathon/scripts/validate_hackathon_images.py Hackathon/scripts/validate_dual_theme_pack.py Hackathon/parallel-agents-light Hackathon/parallel-agents-dark
git commit -m "feat: generate dual-theme Parallel Agents hackathon image pack"
```

---

## Self-Review

- **12-image output:** Tasks 3–5.
- **Six contracted topics:** Task 1.
- **Light and Dark same layout/copy:** Task 1 paired-manifest assertion.
- **Poster-only screenshots:** Tasks 1, 3, and 4.
- **Real UI concepts:** Prompt requirements in Task 1.
- **Fluent-inspired, no Microsoft logo:** Light/Dark style anchors in Task 1.
- **Retry/partial preservation:** Task 2 skip/resume behavior.
- **Dimensions and exact filenames:** Tasks 3–5.

The plan has no deferred placeholders; all file paths, commands, and expected outputs are explicit.

