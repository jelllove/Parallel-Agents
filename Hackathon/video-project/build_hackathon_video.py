#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = ROOT / "Hackathon" / "video-project"
WORK_DIR = PROJECT_DIR / "work"
TIMELINE_PATH = PROJECT_DIR / "timeline.json"


def resolve_command(name: str) -> Path:
    direct = shutil.which(name)
    if direct:
        return Path(direct)
    if sys.platform == "win32":
        packages = Path.home() / "AppData" / "Local" / "Microsoft" / "WinGet" / "Packages"
        matches = sorted(packages.glob(f"Gyan.FFmpeg_*/*/bin/{name}.exe"))
        if matches:
            return matches[-1]
    raise RuntimeError(f"Required command not found: {name}")


def run(command: list[str], cwd: Path | None = None) -> None:
    print("+", subprocess.list2cmdline(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def require_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing source asset: {path}")


def absolute(path: str) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else ROOT / candidate


def load_timeline() -> dict[str, Any]:
    require_file(TIMELINE_PATH)
    data = json.loads(TIMELINE_PATH.read_text(encoding="utf-8"))
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or len(scenes) != 8:
        raise RuntimeError("timeline.json must define exactly 8 scenes.")
    if sum(float(scene["duration"]) for scene in scenes) != float(data["target_duration"]):
        raise RuntimeError("Scene durations must sum to target_duration.")
    for scene in scenes:
        require_file(absolute(scene["source"]))
    for source in data["audio"].values():
        require_file(absolute(source))
    return data


def render_image_scene(
    ffmpeg: Path,
    source: Path,
    output: Path,
    duration: float,
    fps: int,
    force: bool,
) -> None:
    if output.exists() and not force:
        print(f"skip existing {output}", flush=True)
        return
    frames = round(duration * fps)
    filter_graph = (
        "[0:v]split=2[bg][fg];"
        "[bg]scale=1920:1080:force_original_aspect_ratio=increase,"
        "crop=1920:1080,boxblur=24:6[blur];"
        "[fg]scale=1920:1080:force_original_aspect_ratio=decrease[front];"
        "[blur][front]overlay=(W-w)/2:(H-h)/2,"
        "zoompan=z='min(zoom+0.00006,1.018)':"
        "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d=1:s=1920x1080:fps={fps},format=yuv420p[v]"
    )
    run([
        str(ffmpeg), "-y", "-loop", "1", "-i", str(source),
        "-filter_complex", filter_graph,
        "-map", "[v]", "-frames:v", str(frames),
        "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-r", str(fps), "-pix_fmt", "yuv420p", str(output),
    ])


def render_operation_scene(
    ffmpeg: Path,
    source: Path,
    output: Path,
    source_duration: float,
    output_duration: float,
    fps: int,
    force: bool,
) -> None:
    if output.exists() and not force:
        print(f"skip existing {output}", flush=True)
        return
    setpts_factor = output_duration / source_duration
    filter_graph = (
        f"[0:v]trim=start=0:end={source_duration},"
        f"setpts={setpts_factor:.9f}*PTS,"
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x07111f,"
        f"fps={fps},format=yuv420p[v]"
    )
    run([
        str(ffmpeg), "-y", "-i", str(source),
        "-filter_complex", filter_graph,
        "-map", "[v]", "-an", "-t", f"{output_duration:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-r", str(fps), "-pix_fmt", "yuv420p", str(output),
    ])


def assemble_visual_master(
    ffmpeg: Path,
    scenes: list[Path],
    durations: list[float],
    transition: float,
    target_duration: float,
    output: Path,
) -> None:
    command = [str(ffmpeg), "-y"]
    for scene in scenes:
        command.extend(["-i", str(scene)])

    filters: list[str] = []
    for idx in range(len(scenes)):
        filters.append(f"[{idx}:v]settb=AVTB,setpts=PTS-STARTPTS[v{idx}]")

    cumulative = durations[0]
    previous = "v0"
    for idx in range(1, len(scenes)):
        offset = cumulative
        output_label = f"x{idx}"
        filters.append(
            f"[{previous}][v{idx}]xfade=transition=fade:"
            f"duration={transition:.3f}:offset={offset:.3f}[{output_label}]"
        )
        previous = output_label
        cumulative += durations[idx]

    filters.append(f"[{previous}]trim=duration={target_duration},setpts=PTS-STARTPTS[master]")
    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", "[master]", "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "17",
        "-r", "30", "-pix_fmt", "yuv420p", str(output),
    ])
    run(command)


def render_final(
    ffmpeg: Path,
    visual: Path,
    narration: Path,
    music: Path,
    output: Path,
    duration: float,
) -> None:
    filter_graph = (
        "[1:a]adelay=300|300,loudnorm=I=-16:TP=-1.5:LRA=11,"
        f"apad,atrim=0:{duration},asplit=2[voice_sc][voice_mix];"
        f"[2:a]atrim=0:{duration},"
        "afade=t=in:st=0:d=1.5,"
        f"afade=t=out:st={duration - 2}:d=2,volume=0.14[music];"
        "[music][voice_sc]sidechaincompress="
        "threshold=0.025:ratio=8:attack=20:release=500[ducked];"
        "[ducked][voice_mix]amix=inputs=2:duration=longest:normalize=0,"
        "alimiter=limit=0.95[a]"
    )
    run([
        str(ffmpeg), "-y",
        "-i", str(visual),
        "-i", str(narration),
        "-stream_loop", "-1", "-i", str(music),
        "-filter_complex", filter_graph,
        "-map", "0:v:0", "-map", "[a]", "-t", f"{duration:.3f}",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
        str(output),
    ])


def render_preview(ffmpeg: Path, source: Path, output: Path) -> None:
    run([
        str(ffmpeg), "-y", "-i", str(source),
        "-vf", "scale=1280:720",
        "-c:v", "libx264", "-preset", "fast", "-crf", "27",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        str(output),
    ])


def probe_and_validate(ffprobe: Path, final_path: Path) -> None:
    completed = subprocess.run([
        str(ffprobe), "-v", "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
        "-of", "json", str(final_path),
    ], capture_output=True, text=True, check=True)
    data = json.loads(completed.stdout)
    duration = float(data["format"]["duration"])
    if not 108 <= duration <= 120:
        raise RuntimeError(f"Final duration outside allowed range: {duration:.3f}s")
    video = next(stream for stream in data["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in data["streams"] if stream["codec_type"] == "audio")
    if (video["codec_name"], video["width"], video["height"], video["r_frame_rate"]) != (
        "h264", 1920, 1080, "30/1"
    ):
        raise RuntimeError(f"Unexpected final video stream: {video}")
    if audio["codec_name"] != "aac":
        raise RuntimeError(f"Unexpected final audio stream: {audio}")
    print(f"validated final video: {duration:.3f}s, H.264 1920x1080 30fps, AAC", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Parallel Agents Hackathon video.")
    parser.add_argument("--force-scenes", action="store_true", help="Re-render intermediate scenes.")
    args = parser.parse_args()

    try:
        ffmpeg = resolve_command("ffmpeg")
        ffprobe = resolve_command("ffprobe")
        timeline = load_timeline()
        WORK_DIR.mkdir(parents=True, exist_ok=True)

        transition = float(timeline["transition_seconds"])
        fps = int(timeline["fps"])
        scene_paths: list[Path] = []
        nominal_durations: list[float] = []

        for idx, scene in enumerate(timeline["scenes"]):
            nominal = float(scene["duration"])
            rendered_duration = nominal + transition if idx < len(timeline["scenes"]) - 1 else nominal
            output = WORK_DIR / f"scene-{idx + 1:02d}-{scene['id']}.mp4"
            if scene["type"] == "image":
                render_image_scene(
                    ffmpeg, absolute(scene["source"]), output,
                    rendered_duration, fps, args.force_scenes,
                )
            elif scene["type"] == "video":
                render_operation_scene(
                    ffmpeg, absolute(scene["source"]), output,
                    float(scene["source_duration"]), rendered_duration,
                    fps, args.force_scenes,
                )
            else:
                raise RuntimeError(f"Unsupported scene type: {scene['type']}")
            scene_paths.append(output)
            nominal_durations.append(nominal)

        visual_master = WORK_DIR / "visual-master.mp4"
        assemble_visual_master(
            ffmpeg, scene_paths, nominal_durations, transition,
            float(timeline["target_duration"]), visual_master,
        )

        final_path = absolute(timeline["outputs"]["final"])
        preview_path = absolute(timeline["outputs"]["preview"])
        final_path.parent.mkdir(parents=True, exist_ok=True)
        render_final(
            ffmpeg,
            visual_master,
            absolute(timeline["audio"]["voice"]),
            absolute(timeline["audio"]["music"]),
            final_path,
            float(timeline["target_duration"]),
        )
        render_preview(ffmpeg, final_path, preview_path)
        probe_and_validate(ffprobe, final_path)
        print(f"final: {final_path}", flush=True)
        print(f"preview: {preview_path}", flush=True)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
