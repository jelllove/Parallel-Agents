# Parallel Agents Dual-Theme Hackathon Images Design

Date: 2026-08-26

## Objective

Generate a Microsoft Hackathon-ready visual set for Parallel Agents with two coordinated themes:

- Light theme: 6 images
- Dark theme: 6 images
- Total: 12 images
- Output size: 1536×1024
- All visible text: English

The two themes must use the same narrative, layout system, and information hierarchy so they feel like one coherent product campaign.

## Product Truth Sources

The generated visuals must reflect the real Parallel Agents UI shown in:

- `Hackathon/Screen captuer/Parallel_Agents_6oUaeziP7i.png`
- `Hackathon/Screen captuer/Parallel_Agents_7Sprg7dMww.png`
- `Hackathon/Screen captuer/Parallel_Agents_DVnJVyzVIl.png`
- `Hackathon/Screen captuer/Parallel_Agents_Vk26skhqBu.png`

Product concepts represented in the visuals:

- Top CLI availability/status strip
- Left Projects and Recent Sessions navigation
- Center multi-agent terminal tabs
- Right Explorer and Git panels
- Project-aware and session-aware workflows

## Style Sources

Use `Hackathon/final/` as the primary visual storytelling reference:

- `hackathon-poster.png`: realistic product-marketing poster structure
- `1.png` through `10.png`: illustrated infographic language, rounded cards, clear arrows, approachable characters, and concise captions

Use Microsoft Fluent-inspired visual language and blue accents, but do not include Microsoft logos.

## Storyboard

Each theme contains the same six slides:

1. **Poster Overview**
   - Realistic product-marketing poster
   - Headline: Parallel Agents
   - Value proposition: one workspace for multi-agent coding workflows
   - Embed one real Parallel Agents screenshot

2. **Problem**
   - Illustrated infographic
   - Explain fragmented CLI windows, scattered sessions, context switching, and difficult comparison

3. **Design**
   - Illustrated infographic
   - Show one unified desktop application connecting Copilot, Codex, Claude, and Gemini

4. **Architecture**
   - Illustrated technical diagram
   - Electron Main, Preload IPC, Renderer UI, Project Discovery, Session Discovery, and PTY Runtime

5. **Session Workflow**
   - Illustrated flow diagram
   - Select Project → Load Sessions → Auto-resume one session or guide selection among multiple sessions → Resume matching CLI

6. **Benefits**
   - Illustrated benefit-card composition
   - Faster switching, clearer project visibility, session continuity, lower cognitive load, and better multi-agent productivity

## Light Theme

- Bright white and pale blue base
- Microsoft Fluent-style blue as primary accent
- Cyan, green, orange, and purple secondary accents for agents and states
- Rounded white cards, soft shadows, clean spacing
- Friendly illustrated developer/robot elements
- High-key, polished Hackathon presentation aesthetic

## Dark Theme

- Deep charcoal and navy base inspired by the real Parallel Agents application
- VS Code-like panel structure without copying the actual UI verbatim
- Fluent blue as the primary accent
- Agent-specific accents: Copilot green, Codex blue/green, Claude orange, Gemini blue
- Soft luminous borders and restrained glow
- Maintain the same friendly illustrated information-graphic style rather than using a heavy sci-fi look

## Layout Consistency

Light and Dark versions of each slide must share:

- The same headline and body copy
- The same major composition and panel positions
- The same information flow and arrows
- The same icon/character placement
- Equivalent visual prominence

Only the color system, lighting, background treatment, and card contrast change between themes.

## Screenshot Policy

- Embed one real screenshot only in each Poster Overview.
- Do not embed screenshots in Problem, Design, Architecture, Session Workflow, or Benefits.
- The remaining five images may abstract real UI concepts into cards, panels, arrows, and icons.

## Output Contract

Light folder:

`Hackathon/parallel-agents-light/`

- `01-poster-overview.png`
- `02-problem.png`
- `03-design.png`
- `04-architecture.png`
- `05-session-workflow.png`
- `06-benefits.png`
- `prompts.json`

Dark folder:

`Hackathon/parallel-agents-dark/`

- `01-poster-overview.png`
- `02-problem.png`
- `03-design.png`
- `04-architecture.png`
- `05-session-workflow.png`
- `06-benefits.png`
- `prompts.json`

## Generation Flow

1. Create one Light style anchor and one Dark style anchor.
2. Generate the six Light slides using the Light anchor language.
3. Generate the six Dark slides using the same storyboard and layout instructions.
4. Composite one real application screenshot into each generated poster.
5. Export effective prompts into each output directory.
6. Validate file names, dimensions, slide count, and screenshot-overlay policy.

## Failure Handling

- Missing Azure endpoint, deployment, or key: fail before generation with explicit variable names.
- API request failure: retry the failed image without regenerating successful images.
- Partial generation: preserve all completed files and report exact missing outputs.
- Invalid dimensions or unreadable image: mark the specific slide as failed and regenerate only that slide.
- Missing screenshot source: fail Poster composition explicitly while leaving non-Poster slides intact.

## Acceptance Criteria

- Exactly 12 final PNG images exist.
- Every image is 1536×1024.
- Light and Dark folders each contain the six contracted files and `prompts.json`.
- Only the two Poster images contain a real product screenshot.
- Visuals accurately reflect the actual product workflow.
- Light and Dark pairs share consistent structure and English copy.
- The set is suitable for a Microsoft Hackathon presentation without using Microsoft logos.

