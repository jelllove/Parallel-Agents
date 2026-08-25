# Hackathon Image Pack Design (Parallel Agents)

Date: 2026-08-25  
Scope: Generate a Microsoft Hackathon-ready visual deck using GPT Image 2 with the user's configured endpoint/key.

## 1) Objective

Produce an English-only image set for Hackathon storytelling:

- 1 primary overview poster
- 8 supporting story images
- Visual style aligned with examples in `Hackathon/example/`
- Real product screenshot integrated from `Hackathon/Screen captuer/chrome_rY8BNU67RP.png`
- Output size: 1536×1024 (16:9)

## 2) Narrative Storyboard

1. **Main Poster** — project overview and value proposition
2. **Problem 1** — fragmented CLI windows and tooling sprawl
3. **Problem 2** — context switching and lost session continuity
4. **Design Intent** — one-window multi-agent workflow concept
5. **Architecture** — Electron main/preload/renderer, project/session discovery, terminal orchestration
6. **Session Workflow** — project select → session select/resume behavior
7. **Benefits** — productivity, clarity, lower cognitive load, faster recovery
8. **Real Usage** — actual app screenshot embedded with product callouts
9. **Hackathon CTA** — summary slide and adoption-ready message

## 3) Visual Direction

Target style (matching `Hackathon/example/`):

- Dark cinematic gradient background
- Neon-accent highlights and soft glow framing
- Structured card-like sections and clear visual hierarchy
- Bold headline, concise subtitle, 3–5 short bullets
- English-only copy with concise product language
- Clean, modern, technical-product marketing aesthetic

## 4) Generation Approach

Chosen approach: **Style-lock two-pass**

1. Generate one internal **style anchor** image prompt/output to lock composition language and color mood.
2. Generate all 9 target images using:
   - Shared style constraints
   - Per-slide content prompts
   - Consistent typography and spacing guidance
3. Embed the real screenshot into relevant slides (architecture, real usage, benefits context).

## 5) Deliverables

Output folder: `Hackathon/generated/`

- `01-poster-overview.png`
- `02-problem-fragmentation.png`
- `03-problem-context-switching.png`
- `04-design-concept.png`
- `05-architecture.png`
- `06-session-workflow.png`
- `07-benefits.png`
- `08-real-usage.png`
- `09-hackathon-cta.png`
- `prompts.json` (full reusable prompt manifest)

## 6) Data Flow

1. Read style references and screenshot assets.
2. Resolve endpoint/deployment/key from environment variables (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_IMAGE_DEPLOYMENT`, and one of `AZURE_OPENAI_API_KEY` or `OPENAI_API_KEY`).
3. Run style-anchor generation call.
4. Run batch generation calls for 9 images.
5. Decode `b64_json` responses to PNG files.
6. Validate dimensions and file existence.
7. Emit prompt manifest and generation summary.

## 7) Error Handling

- Missing endpoint/deployment/key: fail fast with explicit variable names required (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_IMAGE_DEPLOYMENT`, plus API key var).
- API non-200 response: capture status and response body excerpt; continue with retries where safe.
- Partial batch failure: keep successful images, report failed items clearly for targeted rerun.
- Invalid image payload: fail that item and surface prompt/deployment context.

No silent fallback behavior will be used.

## 8) Validation

Minimum acceptance checks:

- Exactly 9 PNG outputs are produced.
- All files exist in `Hackathon/generated/`.
- Every image is 1536×1024.
- All textual overlays requested in prompts are English.
- Screenshot-informed slides visibly incorporate product UI context.

## 9) Out of Scope

- Video/animation generation
- Local GUI editing/post-processing tool workflows
- Automatic PDF deck creation
