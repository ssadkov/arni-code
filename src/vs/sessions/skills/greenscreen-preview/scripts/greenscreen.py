#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Local FFmpeg green-screen preview workflow; Python standard library only."""

import argparse
import json
import math
import re
import shutil
import statistics
import struct
import subprocess
import sys
import threading
import time
import zlib
from pathlib import Path

VERSION = "1.0.2"
SAMPLE_WIDTH, SAMPLE_HEIGHT = 960, 540


def event(stage, **values):
    print(json.dumps({"stage": stage, **values}, ensure_ascii=True), flush=True)


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def executable(value):
    resolved = shutil.which(value)
    if not resolved:
        raise ValueError("Executable not found: " + value)
    return str(Path(resolved).resolve())


def doctor(args):
    """Read-only dependency checks; never install packages or touch media."""
    checks, tools, problems = {}, {}, []
    for name in ("ffmpeg", "ffprobe"):
        try:
            path = executable(getattr(args, name))
            result = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=15)
            if result.returncode or not result.stdout.startswith(name + " version"):
                raise ValueError("Not a working " + name + " executable")
            tools[name] = {"path": path, "version": result.stdout.splitlines()[0]}
            checks[name] = True
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            checks[name] = False
            problems.append(str(error))
    if checks["ffmpeg"]:
        for option, required in (("-filters", ("scale", "crop", "pad", "setsar", "format", "chromakey", "despill", "overlay")),
                                 ("-encoders", ("libx264", "mjpeg", "png", "rawvideo"))):
            try:
                result = subprocess.run([tools["ffmpeg"]["path"], "-hide_banner", option],
                                        capture_output=True, text=True, timeout=15)
                available = set(re.findall(r"^\s*[A-Z.]{2,6}\s+(\w+)\s", result.stdout, re.MULTILINE))
                missing = sorted(set(required) - available)
                checks[option[1:]] = result.returncode == 0 and not missing
                if not checks[option[1:]]:
                    problems.append("FFmpeg %s unavailable: %s" % (option[1:], ", ".join(missing) or "command failed"))
            except (OSError, subprocess.SubprocessError) as error:
                checks[option[1:]] = False
                problems.append(str(error))
    return {"stage": "dependencies_ready" if all(checks.values()) else "dependencies_unavailable",
            "skill": "greenscreen-preview", "version": VERSION,
            "python": {"path": sys.executable, "version": sys.version.split()[0]},
            "tools": tools, "checks": checks, "problems": problems}


def run(args, log, capture=False, timeout=90):
    with log.open("ab") as errors:
        result = subprocess.run(args, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                stderr=errors, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("Process failed (exit %s). See %s" % (result.returncode, log))
    return result.stdout if capture else None


def probe(tool, path, log):
    return json.loads(run([tool, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], log, True))


def stream(info, kind):
    return next((s for s in info.get("streams", []) if s.get("codec_type") == kind), None)


def fit(width, height, background=False):
    if background:
        return "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1" % (width, height, width, height)
    return "scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1" % (width, height, width, height)


def raw_frame(tool, path, timestamp, log, background=False):
    args = [tool, "-v", "error", "-nostdin"]
    if timestamp is not None:
        args += ["-ss", str(timestamp)]
    args += ["-i", str(path), "-frames:v", "1", "-vf", fit(SAMPLE_WIDTH, SAMPLE_HEIGHT, background),
             "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    data = run(args, log, True)
    if len(data) != SAMPLE_WIDTH * SAMPLE_HEIGHT * 3:
        raise ValueError("Could not decode a complete frame: " + str(path))
    return data


def png(path, width, height, rgb):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    scanlines = b"".join(b"\0" + rgb[y * width * 3:(y + 1) * width * 3] for y in range(height))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(scanlines, 4)) + chunk(b"IEND", b""))


def jpeg(path, width, height, rgb, tool, log):
    # Photos in PNG accumulate across tool turns and can exceed the API body
    # limit. Keep full frames locally; send compact, high-quality review sheets.
    with log.open("ab") as errors:
        result = subprocess.run([tool, "-v", "error", "-nostdin", "-n", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                 "-s", "%dx%d" % (width, height), "-i", "pipe:0", "-frames:v", "1", "-q:v", "3", str(path)],
                                input=rgb, stdout=subprocess.DEVNULL, stderr=errors, timeout=30)
    if result.returncode:
        raise RuntimeError("Review-sheet encoding failed; see " + str(log))


def sheet(path, frames, tool, log, columns=3):
    width, height = SAMPLE_WIDTH // 2, SAMPLE_HEIGHT // 2
    rows = math.ceil(len(frames) / columns)
    board = bytearray(width * columns * height * rows * 3)
    for index, frame in enumerate(frames):
        for y in range(height):
            row = frame[y * 2 * SAMPLE_WIDTH * 3:(y * 2 + 1) * SAMPLE_WIDTH * 3]
            thumbnail = b"".join(row[x:x + 3] for x in range(0, len(row), 6))
            offset = (((index // columns) * height + y) * width * columns + (index % columns) * width) * 3
            board[offset:offset + width * 3] = thumbnail
    jpeg(path, width * columns, height * rows, board, tool, log)


def detail_sheet(path, source, result, tool, log):
    width, height = SAMPLE_WIDTH // 3, SAMPLE_HEIGHT * 3 // 5
    rgb = bytearray(width * 2 * height * 3)
    for column, frame in enumerate((source, result)):
        for y in range(height):
            start = (y * SAMPLE_WIDTH + SAMPLE_WIDTH // 3) * 3
            dest = (y * width * 2 + column * width) * 3
            rgb[dest:dest + width * 3] = frame[start:start + width * 3]
    jpeg(path, width * 2, height, rgb, tool, log)


def green(r, g, b):
    return g > r + 20 and g > b + 8


def sample_color(frames):
    colors = []
    for frame in frames:
        for y in range(20, SAMPLE_HEIGHT - 20, 8):
            for x in range(20, SAMPLE_WIDTH - 20, 8):
                if SAMPLE_WIDTH * .25 < x < SAMPLE_WIDTH * .75:
                    continue
                i = (y * SAMPLE_WIDTH + x) * 3
                rgb = frame[i:i + 3]
                if green(*rgb):
                    colors.append(rgb)
    if len(colors) < 100:
        raise ValueError("Not enough green background at the frame borders; automatic key sampling is unsuitable")
    return "0x" + "".join("%02x" % int(statistics.median(c[channel] for c in colors)) for channel in range(3))


def key_filter(color, similarity, blend, width, height):
    # Scale first. 4:4:4 avoids losing alpha/chroma resolution before keying.
    return ("scale=%d:%d:force_original_aspect_ratio=decrease,setsar=1,format=yuv444p,chromakey=%s:%.5f:%.5f,format=rgba,"
            "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black@0") % (width, height, color, similarity, blend, width, height)


def candidate(tool, frame_path, source, background, color, similarity, blend, log):
    rgba = run([tool, "-v", "error", "-nostdin", "-i", str(frame_path), "-frames:v", "1", "-vf",
                key_filter(color, similarity, blend, SAMPLE_WIDTH, SAMPLE_HEIGHT),
                "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], log, True)
    if len(rgba) != SAMPLE_WIDTH * SAMPLE_HEIGHT * 4:
        raise ValueError("Incomplete alpha candidate")
    result, mask = bytearray(len(source)), bytearray(len(source))
    removed, bg_count, opaque, fg_count = 0, 0, 0, 0
    for pixel in range(SAMPLE_WIDTH * SAMPLE_HEIGHT):
        a = rgba[pixel * 4 + 3]
        mask[pixel * 3:pixel * 3 + 3] = bytes((a, a, a))
        for channel in range(3):
            result[pixel * 3 + channel] = (rgba[pixel * 4 + channel] * a + background[pixel * 3 + channel] * (255 - a) + 127) // 255
        if pixel % 4:
            continue
        r, g, b = source[pixel * 3:pixel * 3 + 3]
        x, y = pixel % SAMPLE_WIDTH, pixel // SAMPLE_WIDTH
        if green(r, g, b):
            bg_count += 1
            removed += a <= 16
        elif SAMPLE_WIDTH * .35 < x < SAMPLE_WIDTH * .65 and SAMPLE_HEIGHT * .3 < y < SAMPLE_HEIGHT * .85:
            fg_count += 1
            opaque += a >= 245
    return bytes(result), bytes(mask), {"green_background_removed": round(removed / max(1, bg_count), 4),
                           "central_foreground_opaque": round(opaque / max(1, fg_count), 4),
                           "background_samples": bg_count, "foreground_samples": fg_count}


def prepare(args):
    source, background, output = Path(args.source).resolve(), Path(args.background).resolve(), Path(args.output).resolve()
    for file in (source, background):
        if not file.is_file():
            raise ValueError("Input file missing: " + str(file))
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory is not empty; choose a new directory")
    tools = {"ffmpeg": executable(args.ffmpeg), "ffprobe": executable(args.ffprobe)}
    output.mkdir(parents=True, exist_ok=True)
    log = output / "prepare.log"
    info = probe(tools["ffprobe"], source, log)
    video = stream(info, "video")
    if not video:
        raise ValueError("Input has no video stream")
    length = float(video.get("duration") or info["format"]["duration"])
    if not all(math.isfinite(value) for value in (args.start, args.duration)) or args.start < 0 or args.duration <= 0 or args.duration > 10 or args.start + args.duration > length + .05:
        raise ValueError("Choose an available preview segment of at most 10 seconds")
    if args.width < 64 or args.height < 64 or args.width > 3840 or args.height > 3840 or args.width % 2 or args.height % 2:
        raise ValueError("Output dimensions must be even, between 64 and 3840")
    times = [args.start + args.duration * fraction for fraction in (.1, .5, .9)]
    event("prepare", skill="greenscreen-preview", version=VERSION, output=str(output))
    originals = [raw_frame(tools["ffmpeg"], source, t, log) for t in times]
    bg = raw_frame(tools["ffmpeg"], background, None, log, True)
    for i, frame in enumerate(originals):
        png(output / ("source_%d.png" % i), SAMPLE_WIDTH, SAMPLE_HEIGHT, frame)
    sheet(output / "source-sheet.jpg", originals + [bg], tools["ffmpeg"], log, 2)
    color = sample_color(originals)
    candidates, frames, masks = [], [], []
    for number, similarity in enumerate((.06, .08, .10, .12, .14, .16), 1):
        frame, mask, metrics = candidate(tools["ffmpeg"], output / "source_1.png", originals[1], bg, color, similarity, .01, log)
        png(output / ("candidate_%d.png" % number), SAMPLE_WIDTH, SAMPLE_HEIGHT, frame)
        row = {"number": number, "similarity": similarity, "blend": .01, **metrics}
        candidates.append(row)
        frames.append(frame)
        masks.append(mask)
        event("candidate", **row)
    sheet(output / "candidates.jpg", frames, tools["ffmpeg"], log)
    sheet(output / "masks.jpg", masks, tools["ffmpeg"], log)
    eligible = [row for row in candidates if row["central_foreground_opaque"] >= .995 and row["foreground_samples"] > 100]
    recommendation = max(eligible, key=lambda row: row["green_background_removed"], default=None)
    manifest = {"skill": "greenscreen-preview", "version": VERSION, "source": str(source), "background": str(background),
                "source_size": source.stat().st_size, "source_mtime_ns": source.stat().st_mtime_ns,
                "tools": tools, "start": args.start, "duration": args.duration, "width": args.width, "height": args.height,
                "sample_times": times, "key_color": color, "source_probe": info, "candidates": candidates,
                "recommended_candidate": recommendation["number"] if recommendation else None,
                "status": "prepared_visual_review_required"}
    save_json(output / "manifest.json", manifest)
    if Path(__file__).resolve() != output / "reproduce.py":
        shutil.copyfile(__file__, output / "reproduce.py")
    event("prepared", key_color=color, recommended_candidate=manifest["recommended_candidate"],
          manifest=str(output / "manifest.json"), source_sheet=str(output / "source-sheet.jpg"), candidates=str(output / "candidates.jpg"))


def render(args):
    output = Path(args.output).resolve()
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    if args.name not in ("preview", "preview_v2"):
        raise ValueError("Preview name must be preview or preview_v2")
    target = output / (args.name + ".mp4")
    if target.exists():
        raise ValueError("Result already exists; do not overwrite a previous preview")
    row = next((c for c in manifest["candidates"] if c["number"] == args.candidate), None)
    if not row:
        raise ValueError("Candidate must be between 1 and 6")
    similarity = row["similarity"] if args.similarity is None else args.similarity
    blend = row["blend"] if args.blend is None else args.blend
    if not all(math.isfinite(value) for value in (similarity, blend)) or not .01 <= similarity <= 1 or not 0 <= blend <= 1:
        raise ValueError("Invalid chromakey parameters")
    source = Path(manifest["source"])
    if source.stat().st_size != manifest["source_size"] or source.stat().st_mtime_ns != manifest["source_mtime_ns"]:
        raise ValueError("Source changed after preparation; prepare again")
    ffmpeg, ffprobe = manifest["tools"]["ffmpeg"], manifest["tools"]["ffprobe"]
    width, height, duration = manifest["width"], manifest["height"], manifest["duration"]
    graph = "[0:v]%s,despill=type=green[key];[1:v]%s,format=rgba[bg];[bg][key]overlay=shortest=1,setsar=1,format=yuv420p[out]" % (
        key_filter(manifest["key_color"], similarity, blend, width, height), fit(width, height, True))
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-ss", str(manifest["start"]), "-t", str(duration),
               "-i", str(source), "-loop", "1", "-t", str(duration), "-i", manifest["background"], "-filter_complex", graph,
               "-map", "[out]", "-map", "0:a:0?", "-t", str(duration), "-c:v", "libx264", "-preset", "fast", "-crf", "20",
               "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(target)]
    log = output / (args.name + ".log")
    save_json(output / (args.name + "-command.json"), command)
    started = time.monotonic()
    event("render", percent=0, output=str(target))
    expired = threading.Event()
    with log.open("ab") as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True)
        def timeout():
            expired.set()
            process.kill()
        timer = threading.Timer(120, timeout)
        timer.start()
        try:
            last_percent = 0
            for line in process.stdout:
                if line.startswith("out_time_us="):
                    try:
                        percent = min(100, max(0, int(int(line.split("=", 1)[1]) / (duration * 10000))))
                        if percent >= last_percent + 20:
                            event("render", percent=percent)
                            last_percent = percent
                    except ValueError:
                        pass
            code = process.wait()
        finally:
            timer.cancel()
            process.stdout.close()
    render_seconds = round(time.monotonic() - started, 3)
    if expired.is_set() or code:
        raise RuntimeError("Render failed (exit %s, timeout=%s). See %s" % (code, expired.is_set(), log))
    info = probe(ffprobe, target, log)
    video, audio = stream(info, "video"), stream(info, "audio")
    source_video = stream(manifest["source_probe"], "video")
    fps = source_video.get("avg_frame_rate", "0/1").split("/")
    expected = duration * float(fps[0]) / max(1, float(fps[1]))
    checks = {"dimensions": (video["width"], video["height"]) == (width, height),
              "square_pixels": video.get("sample_aspect_ratio") == "1:1",
              "video_duration": abs(float(video.get("duration", 0)) - duration) <= .1,
              "frame_count": abs(int(video.get("nb_frames", 0)) - expected) <= 2,
              "audio_preserved": not stream(manifest["source_probe"], "audio") or bool(audio) and abs(float(audio.get("duration", 0)) - duration) <= .15}
    run([ffmpeg, "-v", "error", "-nostdin", "-i", str(target), "-f", "null", "-"], log)
    frames = [raw_frame(ffmpeg, target, duration * fraction, log) for fraction in (.1, .5, .9)]
    originals = [raw_frame(ffmpeg, source, t, log) for t in manifest["sample_times"]]
    for index, frame in enumerate(frames):
        png(output / (args.name + "-frame-%d.png" % index), SAMPLE_WIDTH, SAMPLE_HEIGHT, frame)
    sheet_path = output / ("result-sheet.jpg" if args.name == "preview" else "result-sheet-v2.jpg")
    sheet(sheet_path, originals + frames, ffmpeg, log)
    detail_path = output / ("detail-sheet.jpg" if args.name == "preview" else "detail-sheet-v2.jpg")
    detail_sheet(detail_path, originals[1], frames[1], ffmpeg, log)
    report = {"skill": "greenscreen-preview", "version": VERSION, "output": str(target), "exit_code": code,
              "render_seconds": render_seconds, "total_helper_seconds": round(time.monotonic() - started, 3),
              "parameters": {"key_color": manifest["key_color"], "similarity": similarity, "blend": blend, "despill": "green"},
              "checks": checks, "probe": info, "source_sample_times": manifest["sample_times"],
              "result_sample_times": [duration * fraction for fraction in (.1, .5, .9)], "result_sheet": str(sheet_path), "detail_sheet": str(detail_path),
              "status": "technical_pass_visual_review_required" if all(checks.values()) else "failed_technical_checks"}
    report_path = output / ("report.json" if args.name == "preview" else "report-v2.json")
    save_json(report_path, report)
    event(report["status"], output=str(target), checks=checks, render_seconds=render_seconds, report=str(report_path), result_sheet=str(sheet_path))
    if not all(checks.values()):
        raise RuntimeError("Preview failed technical checks; see " + str(report_path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="mode", required=True)
    preflight = commands.add_parser("doctor", help="Check dependencies without installing anything")
    preflight.add_argument("--ffmpeg", default="ffmpeg")
    preflight.add_argument("--ffprobe", default="ffprobe")
    first = commands.add_parser("prepare")
    for name in ("source", "background", "output"):
        first.add_argument("--" + name, required=True)
    first.add_argument("--ffmpeg", default="ffmpeg")
    first.add_argument("--ffprobe", default="ffprobe")
    first.add_argument("--start", type=float, default=0)
    first.add_argument("--duration", type=float, default=5)
    first.add_argument("--width", type=int, default=1920)
    first.add_argument("--height", type=int, default=1080)
    second = commands.add_parser("render")
    second.add_argument("--output", required=True)
    second.add_argument("--candidate", type=int, required=True)
    second.add_argument("--name", default="preview")
    second.add_argument("--similarity", type=float)
    second.add_argument("--blend", type=float)
    args = parser.parse_args()
    try:
        if args.mode == "doctor":
            report = doctor(args)
            print(json.dumps(report, ensure_ascii=True), flush=True)
            return 0 if report["stage"] == "dependencies_ready" else 1
        (prepare if args.mode == "prepare" else render)(args)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        event("failed", error=str(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
