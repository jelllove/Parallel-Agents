# Parallel Agents Hackathon Video Design

Date: 2026-08-28

## Objective

Produce an editable Microsoft Hackathon submission video for Parallel Agents.

- Target duration: 108–110 seconds
- Hard duration limit: 120 seconds
- Output: 1920×1080, 30 fps, H.264 video, AAC audio, MP4
- Language: English
- Narration: professional, calm male AI voice
- Music: `Future-Technology(chosic.com).mp3` at low volume
- Source operation recording audio: muted

## Source Assets

Images:

- `Hackathon/parallel-agents-dark/01-poster-overview.png`
- `Hackathon/parallel-agents-dark/02-problem.png`
- `Hackathon/parallel-agents-dark/03-design.png`
- `Hackathon/parallel-agents-dark/04-architecture.png`
- `Hackathon/parallel-agents-dark/05-session-workflow.png`
- `Hackathon/parallel-agents-dark/06-benefits.png`

Video:

- `Hackathon/parallel-agents-dark/Parallel_Agent_operation.mp4`
- Source duration: approximately 67 seconds

Music:

- `Hackathon/parallel-agents-dark/Future-Technology(chosic.com).mp3`

## Timeline

| Time | Visual | Purpose |
|---|---|---|
| 0–9s | Poster Overview | Establish product and value proposition |
| 9–20s | Problem | Explain fragmented CLI workflows |
| 20–31s | Design | Introduce one unified workspace |
| 31–43s | Architecture | Explain Electron, IPC, discovery, and PTY |
| 43–55s | Session Workflow | Explain single-session and multi-session behavior |
| 55–66s | Benefits | Summarize developer value |
| 66–104s | Operation recording | Demonstrate the real application |
| 104–110s | Poster Overview | Close with the product message |

Transitions use approximately 0.4-second crossfades. Static images use restrained Ken Burns motion (slow scale and pan) without obscuring text.

## Operation Recording Edit

The 67-second source recording will be reduced to approximately 38 seconds.

Selection priorities:

1. Projects grouped by agent in the left sidebar
2. Recent Sessions behavior
3. Multiple agent terminal tabs
4. Explorer panel
5. Git panel
6. Actual session resume or terminal interaction

The edit will remove pauses, repeated states, cursor idle time, and sections that do not communicate product value.

## Narration Script

> Modern developers work with more than one AI coding agent. But each CLI lives in its own terminal, with separate projects, sessions, and workflows.
>
> That fragmentation creates too many windows, scattered history, constant context switching, and no simple way to compare results.
>
> Parallel Agents brings those workflows into one focused desktop experience. Copilot, Codex, Claude, Gemini, and other agents can be managed from a consistent project-first interface.
>
> The application uses Electron with an isolated preload bridge. The renderer presents projects, terminal tabs, sessions, Explorer, and Git, while the main process handles project discovery, session history, and PTY-based agent runtimes.
>
> The workflow is session-aware. Select a project, load its history, automatically resume when only one session exists, or clearly guide the user to choose when multiple sessions are available.
>
> The result is faster task switching, clearer project visibility, reliable session continuity, lower cognitive load, and more productive multi-agent development.
>
> In real use, the left panel organizes projects by agent and surfaces recent sessions. The center workspace runs agents in dedicated tabs. Explorer and Git remain visible on the right, so developers can inspect files, review changes, and stay in flow without rebuilding context.
>
> Parallel Agents turns fragmented terminals into one reliable workspace — built for the way developers actually use AI today.

## Voice and Audio

Narration:

- Microsoft Edge Neural Voice: `en-US-GuyNeural`
- Delivery: calm, professional, technical
- Target integrated loudness: approximately -16 LUFS
- Narration remains the dominant audio source

Music:

- Use the supplied Future Technology track
- Trim or loop to match the final timeline
- Fade in over approximately 1.5 seconds
- Fade out over approximately 2 seconds
- Keep at approximately 12–18% of narration level
- Apply ducking beneath narration

Source video audio is fully muted.

## Captions

- Generate an English `.srt` subtitle file aligned to narration sections
- Burn captions into the final MP4
- White text on a dark semi-transparent background
- Position within the lower safe area
- Avoid covering significant application controls
- Keep captions concise and readable at 1080p

## Editable Production Artifacts

Create:

- `timeline.json` — scene order, durations, source files, transitions, and operation-video segments
- `narration.txt` — approved English narration
- `captions.srt` — editable captions
- `build_hackathon_video.py` — deterministic build orchestration
- FFmpeg intermediate files for selected operation segments
- Low-bitrate preview MP4
- Final Hackathon MP4

Changing text or scene duration in source files must allow the video to be rebuilt without manually recreating the project.

## Tooling

- FFmpeg: trimming, motion, transitions, audio mixing, subtitle burn-in, encoding, and media validation
- Microsoft Edge Neural TTS: AI voice generation
- Python: timeline orchestration and deterministic command construction

## Failure Handling

- Missing source asset: fail before rendering and list the exact missing path
- Missing FFmpeg: install or surface an explicit setup command before rendering
- Voice generation failure: preserve all other build artifacts and retry narration only
- Operation segment failure: preserve generated image scenes and audio
- Final duration over 120 seconds: fail validation and shorten the operation section
- Subtitle-rendering failure: keep the uncaptioned intermediate and retry subtitle composition

## Validation

The final render must satisfy:

- Duration no longer than 120 seconds
- Target duration between 108 and 110 seconds
- Resolution exactly 1920×1080
- Frame rate 30 fps
- H.264 video stream
- AAC audio stream
- English narration audible and dominant
- Background music audible at low volume
- Source operation audio absent
- Burned-in captions visible and `.srt` file present
- File opens and seeks successfully
- Preview file present

## Deliverables

Output folder:

`Hackathon/video-output/`

Primary deliverables:

- `Parallel_Agents_Hackathon_110s.mp4`
- `Parallel_Agents_Hackathon_preview.mp4`
- `captions.srt`
- `narration.txt`
- `timeline.json`
- `build_hackathon_video.py`

