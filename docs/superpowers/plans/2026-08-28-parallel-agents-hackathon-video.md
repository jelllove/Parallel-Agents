# Parallel Agents Hackathon Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an editable, narrated Parallel Agents Hackathon video at 1920×1080, approximately 110 seconds long and never longer than two minutes.

**Architecture:** Use FFmpeg for deterministic image motion, operation-video trimming, transitions, audio mixing, caption burn-in, encoding, and validation. Use Microsoft Edge Neural TTS for narration and a Python build script driven by `timeline.json` so timing, copy, and selected operation segments remain easy to modify.

**Tech Stack:** Python 3, FFmpeg/FFprobe, edge-tts, Microsoft Edge Neural Voice (`en-US-GuyNeural`), SRT captions, H.264/AAC MP4.

---

## File Structure

- **Create:** `Hackathon/video-project/timeline.json` — scene sources, durations, transitions, operation-video segments.
- **Create:** `Hackathon/video-project/narration.txt` — approved English voice script.
- **Create:** `Hackathon/video-project/captions.srt` — timed English captions.
- **Create:** `Hackathon/video-project/build_hackathon_video.py` — build orchestration and validation.
- **Create:** `Hackathon/video-project/work/` — generated voice, contact sheet, intermediate scenes, trimmed operation segments.
- **Create:** `Hackathon/video-output/Parallel_Agents_Hackathon_110s.mp4` — final submission.
- **Create:** `Hackathon/video-output/Parallel_Agents_Hackathon_preview.mp4` — smaller review file.

---

### Task 1: Prepare and Verify Video Toolchain

**Files:**
- No repository files changed.

- [ ] **Step 1: Verify FFmpeg availability**

Run:

```powershell
Get-Command ffmpeg -ErrorAction SilentlyContinue
Get-Command ffprobe -ErrorAction SilentlyContinue
```

Expected: both commands resolve. If missing, install the existing Windows FFmpeg package:

```powershell
winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
```

- [ ] **Step 2: Install Edge TTS only if import fails**

Run:

```powershell
python -c "import edge_tts; print(edge_tts.__version__)"
```

If missing:

```powershell
python -m pip install edge-tts
```

- [ ] **Step 3: Inspect source media**

Run:

```powershell
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json "Hackathon\parallel-agents-dark\Parallel_Agent_operation.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,sample_rate,channels -of json "Hackathon\parallel-agents-dark\Future-Technology(chosic.com).mp3"
```

Expected: operation recording is approximately 67 seconds and music has an audio stream.

---

### Task 2: Analyze and Select Operation Footage

**Files:**
- Create: `Hackathon/video-project/work/contact-sheet.jpg`
- Create: `Hackathon/video-project/timeline.json`

- [ ] **Step 1: Create a contact sheet at five-second intervals**

Run:

```powershell
ffmpeg -i "Hackathon\parallel-agents-dark\Parallel_Agent_operation.mp4" -vf "fps=1/5,scale=480:-2,tile=4x4:padding=8:margin=8" -frames:v 1 "Hackathon\video-project\work\contact-sheet.jpg"
```

Expected: a readable contact sheet covering the 67-second recording.

- [ ] **Step 2: Create the timeline with exact 110-second scene contract**

```json
{
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "target_duration": 110,
  "transition_seconds": 0.4,
  "scenes": [
    {"id":"poster-open","type":"image","source":"Hackathon/parallel-agents-dark/01-poster-overview.png","start":0,"duration":9},
    {"id":"problem","type":"image","source":"Hackathon/parallel-agents-dark/02-problem.png","start":9,"duration":11},
    {"id":"design","type":"image","source":"Hackathon/parallel-agents-dark/03-design.png","start":20,"duration":11},
    {"id":"architecture","type":"image","source":"Hackathon/parallel-agents-dark/04-architecture.png","start":31,"duration":12},
    {"id":"workflow","type":"image","source":"Hackathon/parallel-agents-dark/05-session-workflow.png","start":43,"duration":12},
    {"id":"benefits","type":"image","source":"Hackathon/parallel-agents-dark/06-benefits.png","start":55,"duration":11},
    {"id":"operation","type":"video","source":"Hackathon/parallel-agents-dark/Parallel_Agent_operation.mp4","start":66,"duration":38,"segments":[{"source_start":0,"duration":38}]},
    {"id":"poster-close","type":"image","source":"Hackathon/parallel-agents-dark/01-poster-overview.png","start":104,"duration":6}
  ]
}
```

Replace only `operation.segments` after reviewing the contact sheet; segment durations must sum to 38 seconds and prioritize Projects, Sessions, tabs, Explorer, and Git.

- [ ] **Step 3: Validate timeline arithmetic**

Run:

```powershell
python -c "import json,pathlib; d=json.loads(pathlib.Path(r'Hackathon/video-project/timeline.json').read_text()); assert d['target_duration']==110; assert d['scenes'][-1]['start']+d['scenes'][-1]['duration']==110; assert sum(x['duration'] for x in d['scenes'] if x['id']=='operation')==38; print('timeline-ok')"
```

Expected: `timeline-ok`

---

### Task 3: Create Narration and Captions

**Files:**
- Create: `Hackathon/video-project/narration.txt`
- Create: `Hackathon/video-project/captions.srt`
- Create: `Hackathon/video-project/work/narration.mp3`

- [ ] **Step 1: Save the approved narration verbatim**

Write the exact approved script from the design spec to `narration.txt`, preserving eight paragraphs as eight narration sections.

- [ ] **Step 2: Generate professional male neural narration**

Run:

```powershell
edge-tts --voice en-US-GuyNeural --rate="-8%" --pitch="-2Hz" --file "Hackathon\video-project\narration.txt" --write-media "Hackathon\video-project\work\narration.mp3"
```

Expected: `narration.mp3` is created.

- [ ] **Step 3: Measure narration duration**

Run:

```powershell
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "Hackathon\video-project\work\narration.mp3"
```

Expected: narration fits inside 108 seconds. If longer, increase rate incrementally to `-4%`, then `0%`.

- [ ] **Step 4: Create timed SRT captions**

Create eight caption blocks aligned to the scene groups:

```srt
1
00:00:00,500 --> 00:00:09,000
Modern developers work with more than one AI coding agent.
But every CLI has its own projects, sessions, and workflow.

2
00:00:09,000 --> 00:00:20,000
Fragmentation creates too many windows, scattered history,
constant context switching, and difficult comparisons.
```

Continue with blocks 3–8 using the remaining approved narration and scene boundaries through `00:01:50,000`.

- [ ] **Step 5: Validate subtitle timing**

Run:

```powershell
python -c "from pathlib import Path; s=Path(r'Hackathon/video-project/captions.srt').read_text(encoding='utf-8'); assert '00:01:50,000' in s; assert s.count('-->')==8; print('captions-ok')"
```

Expected: `captions-ok`

---

### Task 4: Implement Deterministic Video Build

**Files:**
- Create: `Hackathon/video-project/build_hackathon_video.py`

- [ ] **Step 1: Add prerequisite and asset validation**

```python
def require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing source asset: {path}")

def require_command(name: str) -> str:
    resolved = shutil.which(name)
    if not resolved:
        raise RuntimeError(f"Required command not found: {name}")
    return resolved
```

- [ ] **Step 2: Add image scene rendering**

For each image scene, run FFmpeg with:

```text
scale=1920:1080:force_original_aspect_ratio=decrease,
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x07111f,
zoompan=z='min(zoom+0.00025,1.035)':d=1:s=1920x1080:fps=30,
format=yuv420p
```

Encode each intermediate scene as H.264, 30 fps, without audio.

- [ ] **Step 3: Add operation segment rendering**

For every selected segment:

```text
-ss <source_start> -t <duration> -an
-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2
-r 30 -c:v libx264 -pix_fmt yuv420p
```

Concatenate normalized operation segments into a 38-second intermediate.

- [ ] **Step 4: Assemble visuals with crossfades**

Use FFmpeg `xfade=transition=fade:duration=0.4` between adjacent scenes. Compute each offset as cumulative scene duration minus accumulated transition duration, then trim the visual master to exactly 110 seconds.

- [ ] **Step 5: Mix narration and music**

Use:

```text
[music]aloop=loop=-1:size=2e+09,atrim=0:110,afade=t=in:st=0:d=1.5,afade=t=out:st=108:d=2,volume=0.14[m];
[voice]loudnorm=I=-16:TP=-1.5:LRA=11[v];
[m][v]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[ducked];
[ducked][v]amix=inputs=2:duration=longest:normalize=0[a]
```

The operation recording audio must not enter the mix.

- [ ] **Step 6: Burn captions and render final**

Render with:

```text
subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=22,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=3,Outline=1,MarginV=42,Alignment=2'
```

Encode:

```text
-c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p
-c:a aac -b:a 192k -movflags +faststart
```

Output: `Hackathon/video-output/Parallel_Agents_Hackathon_110s.mp4`.

- [ ] **Step 7: Render preview**

Run:

```powershell
ffmpeg -i "Hackathon\video-output\Parallel_Agents_Hackathon_110s.mp4" -vf "scale=1280:720" -c:v libx264 -preset fast -crf 27 -c:a aac -b:a 128k -movflags +faststart "Hackathon\video-output\Parallel_Agents_Hackathon_preview.mp4"
```

---

### Task 5: Validate Final Deliverables

**Files:**
- Final: `Hackathon/video-output/Parallel_Agents_Hackathon_110s.mp4`
- Preview: `Hackathon/video-output/Parallel_Agents_Hackathon_preview.mp4`

- [ ] **Step 1: Probe final media**

Run:

```powershell
ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json "Hackathon\video-output\Parallel_Agents_Hackathon_110s.mp4"
```

Expected:

- Duration between 108 and 110.5 seconds
- Video: H.264, 1920×1080, 30 fps
- Audio: AAC

- [ ] **Step 2: Validate duration hard limit**

Run:

```powershell
python -c "import json,subprocess; p=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','json',r'Hackathon/video-output/Parallel_Agents_Hackathon_110s.mp4'],capture_output=True,text=True,check=True); d=float(json.loads(p.stdout)['format']['duration']); assert 108<=d<=120, d; print(f'duration-ok: {d:.3f}s')"
```

Expected: `duration-ok`.

- [ ] **Step 3: Check audio loudness**

Run:

```powershell
ffmpeg -i "Hackathon\video-output\Parallel_Agents_Hackathon_110s.mp4" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=summary -f null NUL
```

Expected: no clipping above -1.5 dB true peak and narration remains intelligible.

- [ ] **Step 4: Confirm editable sources exist**

Run:

```powershell
Get-Item Hackathon\video-project\timeline.json,Hackathon\video-project\narration.txt,Hackathon\video-project\captions.srt,Hackathon\video-project\build_hackathon_video.py,Hackathon\video-output\Parallel_Agents_Hackathon_110s.mp4,Hackathon\video-output\Parallel_Agents_Hackathon_preview.mp4
```

Expected: all six paths exist.

- [ ] **Step 5: Commit editable project files**

```powershell
git add Hackathon/video-project/timeline.json Hackathon/video-project/narration.txt Hackathon/video-project/captions.srt Hackathon/video-project/build_hackathon_video.py
git commit -m "feat: add editable Parallel Agents hackathon video project"
```

Generated intermediates and final media should only be committed if the repository’s existing asset policy permits large binary files.

---

## Self-Review

- Six dark images: Tasks 2 and 4.
- Real operation footage: Tasks 2 and 4.
- AI voice, music, muted source audio: Tasks 3 and 4.
- English narration and captions: Task 3.
- Approximately 110 seconds and hard limit ≤120 seconds: Tasks 2 and 5.
- Editable scripts and timeline: Tasks 2–4.
- 1920×1080 H.264/AAC: Tasks 4 and 5.
- Preview and validation: Tasks 4 and 5.

All paths, codecs, timings, output names, commands, and expected results are explicit and consistent with the approved design.

