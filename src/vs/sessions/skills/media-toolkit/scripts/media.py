#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Deterministic local media operations. No network or Python packages required."""

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import threading
import time
from fractions import Fraction
from pathlib import Path

VERSION = "1.0.0"


def emit(stage, **data):
    print(json.dumps({"stage": stage, **data}, ensure_ascii=True), flush=True)


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def tool(value):
    found = shutil.which(str(value))
    if not found:
        raise ValueError("Program missing: " + str(value))
    return str(Path(found).resolve())


def number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError("Invalid " + label)
    return value


def integer(value, low, high, label):
    number(value, low, high, label)
    if int(value) != value:
        raise ValueError(label + " must be an integer")
    return int(value)


def file(value):
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError("File missing: " + str(path))
    return path


def fresh(value):
    path = Path(value).expanduser().resolve()
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError("Choose a new empty output directory")
    path.mkdir(parents=True, exist_ok=True)
    return path


def execute(command, log, timeout=300, capture=False, cwd=None):
    with log.open("ab") as errors:
        result = subprocess.run(command, stdout=subprocess.PIPE if capture else errors,
                                stderr=errors, timeout=timeout, cwd=cwd, check=False)
    if result.returncode:
        raise RuntimeError("Process exited %s; see %s" % (result.returncode, log))
    return result.stdout if capture else None


def probe(path, ffprobe, log):
    return json.loads(execute([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], log, capture=True))


def stream(info, kind):
    return next((row for row in info.get("streams", []) if row.get("codec_type") == kind), None)


def duration(info):
    return float(info.get("format", {}).get("duration") or (stream(info, "video") or stream(info, "audio") or {})["duration"])


def fingerprint(path):
    stat = path.stat()
    return {"path": str(path), "bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def sha(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def render(command, log, seconds, timeout, cwd):
    started = time.monotonic()
    with log.open("ab") as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True, cwd=cwd)
        timer = threading.Timer(timeout, process.kill)
        timer.start()
        try:
            previous = -10
            for line in process.stdout:
                if line.startswith("out_time_us="):
                    try:
                        percent = min(99, int(int(line.split("=", 1)[1]) / 1_000_000 / seconds * 100))
                    except ValueError:
                        continue
                    if percent >= previous + 5:
                        emit("render", percent=max(0, percent))
                        previous = percent
            process.wait()
        finally:
            timer.cancel()
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait()
    elapsed = time.monotonic() - started
    if process.returncode:
        raise RuntimeError("Render failed (exit %s, %.1f seconds); see %s" % (process.returncode, elapsed, log))
    return round(elapsed, 3)


def doctor(args):
    checks, programs, problems = {}, {}, []
    for name in ("ffmpeg", "ffprobe"):
        try:
            executable = tool(getattr(args, name))
            result = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=15)
            checks[name] = result.returncode == 0 and result.stdout.startswith(name + " version")
            if not checks[name]:
                raise ValueError("Not a working " + name)
            programs[name] = {"path": executable, "version": result.stdout.splitlines()[0]}
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            checks[name] = False
            problems.append(str(error))
    if checks["ffmpeg"]:
        for option, required in (("filters", ("scale", "crop", "pad", "fps", "trim", "atrim", "concat", "overlay", "loudnorm", "afade", "xstack")),
                                 ("encoders", ("libx264", "aac", "mjpeg", "pcm_s16le"))):
            result = subprocess.run([programs["ffmpeg"]["path"], "-hide_banner", "-" + option], capture_output=True, text=True, timeout=15)
            available = set(re.findall(r"^\s*[A-Z.]{2,6}\s+(\w+)\s", result.stdout, re.MULTILINE))
            missing = sorted(set(required) - available)
            checks[option] = result.returncode == 0 and not missing
            if not checks[option]:
                problems.append("Missing FFmpeg %s: %s" % (option, ", ".join(missing)))
    report = {"skill": "media-toolkit", "version": VERSION, "python": sys.version.split()[0],
              "checks": checks, "programs": programs, "problems": problems}
    emit("dependencies_ready" if all(checks.values()) else "dependencies_unavailable", **report)
    return all(checks.values())


def review(source, output, ffmpeg, ffprobe, expected=None, dimensions=None, audio=None, timeout=300):
    info = probe(source, ffprobe, output / "verify.log")
    video, sound = stream(info, "video"), stream(info, "audio")
    seconds = duration(info)
    if not video or seconds <= 0 or source.stat().st_size == 0:
        raise ValueError("Output is not a nonempty video")
    checks = {"nonempty": True, "dimensions": not dimensions or [video["width"], video["height"]] == dimensions,
              "duration": expected is None or abs(seconds - expected) <= .12,
              "audio": audio is None or bool(sound) == audio,
              "square_pixels": video.get("sample_aspect_ratio", "1:1") in ("1:1", "N/A")}
    frame_count = int(video["nb_frames"]) if str(video.get("nb_frames", "")).isdigit() else None
    if frame_count is not None and expected is not None:
        rate = Fraction(video.get("avg_frame_rate") or "0/1")
        checks["frame_count"] = abs(frame_count - round(expected * float(rate))) <= 1
    if audio is True and sound:
        checks["audio_duration"] = abs(float(sound.get("duration") or seconds) - seconds) <= .15
    execute([ffmpeg, "-v", "error", "-nostdin", "-i", str(source), "-f", "null", "-"], output / "verify.log", timeout=timeout)
    checks["decode"] = True
    samples = [seconds * fraction for fraction in (.1, .5, .9)]
    arguments = [ffmpeg, "-v", "error", "-nostdin", "-n"]
    for index, timestamp in enumerate(samples):
        frame = output / ("review_%d.jpg" % index)
        execute([ffmpeg, "-v", "error", "-nostdin", "-n", "-ss", str(timestamp), "-i", str(source),
                 "-frames:v", "1", "-vf", "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1",
                 "-q:v", "3", str(frame)], output / "verify.log")
        if frame.stat().st_size < 100:
            raise ValueError("Review image is empty")
        arguments += ["-i", str(frame)]
    sheet = output / "review-sheet.jpg"
    execute(arguments + ["-filter_complex", "[0:v][1:v][2:v]xstack=inputs=3:layout=0_0|640_0|1280_0[out]",
                         "-map", "[out]", "-frames:v", "1", "-q:v", "3", str(sheet)], output / "verify.log")
    return {"status": "technical_pass_visual_review_required" if all(checks.values()) else "technical_failure",
            "file": str(source), "bytes": source.stat().st_size, "duration": seconds, "checks": checks,
            "width": video["width"], "height": video["height"], "frames": frame_count, "audio_codec": sound.get("codec_name") if sound else None,
            "sample_seconds": samples, "review_sheet": str(sheet)}


def segments(plan, seconds, fps):
    requested = plan.get("segments", [[0, seconds]])
    if not isinstance(requested, list) or not 1 <= len(requested) <= 50:
        raise ValueError("Provide between 1 and 50 retained intervals")
    rows, previous, offset = [], 0, 0
    for pair in requested:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError("Each retained interval is [start, end] in source seconds")
        begin, end = (number(value, 0, seconds + .05, "segment time") for value in pair)
        if begin < previous or end <= begin or end - begin < 1 / fps:
            raise ValueError("Retained intervals must be ordered, nonoverlapping and at least one frame")
        begin, end = round(begin * fps) / fps, min(round(end * fps) / fps, math.floor(seconds * fps + .01) / fps)
        if end <= begin:
            raise ValueError("Interval contains no complete frames")
        rows.append({"source_start": begin, "source_end": end, "output_start": offset, "output_end": offset + end - begin})
        offset += end - begin
        previous = end
    return rows, offset


def fit(width, height, mode="contain"):
    if mode not in ("contain", "cover"):
        raise ValueError("fit must be contain or cover")
    if mode == "cover":
        return "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1" % (width, height, width, height)
    return "scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1" % (width, height, width, height)


def edit(args):
    plan = load(args.plan)
    if not isinstance(plan, dict) or set(plan) - {"source", "segments", "width", "height", "fit", "crop", "audio", "audio_source", "webcam", "overlays", "captions"}:
        raise ValueError("Plan has unsupported fields; read the plan reference")
    source = file(plan["source"])
    output = fresh(args.output)
    ffmpeg, ffprobe = tool(args.ffmpeg), tool(args.ffprobe)
    before = {str(source): fingerprint(source)}
    info = probe(source, ffprobe, output / "prepare.log")
    video = stream(info, "video")
    if not video:
        raise ValueError("Source has no video")
    rate = Fraction(video.get("avg_frame_rate") if video.get("avg_frame_rate") not in (None, "0/0") else "30/1")
    fps = float(rate) if rate else 30
    number(fps, 1, 120, "source frame rate")
    rows, seconds = segments(plan, duration(info), fps)
    if seconds > 30 and not args.full:
        raise ValueError("Preview is limited to 30 seconds; use --full only for a requested full export")
    width = integer(plan.get("width", int(video["width"])), 64, 3840, "width")
    height = integer(plan.get("height", int(video["height"])), 64, 3840, "height")
    if width % 2 or height % 2:
        raise ValueError("Output dimensions must be even")
    graph, inputs = [], ["-i", str(source)]
    def add_input(path, still=False):
        actual = file(path)
        before[str(actual)] = fingerprint(actual)
        index = sum(1 for value in inputs if value == "-i")
        inputs.extend((["-loop", "1"] if still else []) + ["-i", str(actual)])
        return index
    def trim_track(index, media, prefix, preprocess=""):
        count = len(rows)
        split = "asplit" if media == "a" else "split"
        graph.append("[%d:%s]%s%s=%d%s" % (index, media, preprocess, split, count, "".join("[%sin%d]" % (prefix, i) for i in range(count))))
        for i, row in enumerate(rows):
            length = row["source_end"] - row["source_start"]
            filters = "atrim=start=%.9f:end=%.9f,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=%.9f:d=0.005" % (row["source_start"], row["source_end"], max(0, length - .005)) if media == "a" else "trim=start=%.9f:end=%.9f,setpts=PTS-STARTPTS" % (row["source_start"], row["source_end"])
            graph.append("[%sin%d]%s[%s%d]" % (prefix, i, filters, prefix, i))
        graph.append("%sconcat=n=%d:v=%d:a=%d[%sout]" % ("".join("[%s%d]" % (prefix, i) for i in range(count)), count, int(media == "v"), int(media == "a"), prefix))
    crop = plan.get("crop")
    crop_filter = ""
    if crop:
        if not isinstance(crop, dict) or set(crop) != {"x", "y", "width", "height"}:
            raise ValueError("crop must contain x, y, width and height")
        x = integer(crop["x"], 0, video["width"] - 2, "crop x")
        y = integer(crop["y"], 0, video["height"] - 2, "crop y")
        cw = integer(crop["width"], 2, video["width"] - x, "crop width")
        ch = integer(crop["height"], 2, video["height"] - y, "crop height")
        crop_filter = "crop=%d:%d:%d:%d," % (cw, ch, x, y)
    trim_track(0, "v", "main", "fps=%.9f,%s%s," % (fps, crop_filter, fit(width, height, plan.get("fit", "contain"))))
    visual = "mainout"
    audio_index = add_input(plan["audio_source"]) if plan.get("audio_source") else 0
    audio_info = probe(file(plan["audio_source"]), ffprobe, output / "prepare.log") if plan.get("audio_source") else info
    has_audio = bool(stream(audio_info, "audio"))
    if has_audio:
        if float(stream(audio_info, "audio").get("duration") or duration(audio_info)) + .05 < rows[-1]["source_end"]:
            raise ValueError("Audio ends before the retained source interval")
        trim_track(audio_index, "a", "voice")
    webcam = plan.get("webcam")
    if webcam:
        if not isinstance(webcam, dict) or set(webcam) - {"source", "size", "x", "y", "shape"}:
            raise ValueError("Unsupported webcam option; only a synchronized, fixed-position camera is supported")
        camera_index = add_input(webcam["source"])
        camera_info = probe(file(webcam["source"]), ffprobe, output / "prepare.log")
        if not stream(camera_info, "video") or duration(camera_info) + .05 < rows[-1]["source_end"]:
            raise ValueError("Camera has no video or ends too early; synchronize sources before editing")
        size = integer(webcam.get("size", 300), 32, min(width, height), "camera size")
        x = integer(webcam.get("x", width - size - 24), 0, width - size, "camera x")
        y = integer(webcam.get("y", height - size - 24), 0, height - size, "camera y")
        trim_track(camera_index, "v", "cam", "fps=%.9f,%s," % (fps, fit(size, size, "cover")))
        shape = webcam.get("shape", "circle")
        if shape not in ("circle", "square"):
            raise ValueError("Camera shape must be circle or square")
        if shape == "circle":
            graph.append("[camout]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip((W/2-hypot(X-W/2,Y-H/2))/1.5,0,1)'[camera]")
            camera = "camera"
        else:
            camera = "camout"
        graph.append("[%s][%s]overlay=x=%d:y=%d:eof_action=pass[cameraout]" % (visual, camera, x, y))
        visual = "cameraout"
    overlays = plan.get("overlays", [])
    if not isinstance(overlays, list) or len(overlays) > 20:
        raise ValueError("At most 20 still overlays are supported")
    for i, row in enumerate(overlays):
        if not isinstance(row, dict) or set(row) - {"source", "start", "end", "width", "height", "x", "y"}:
            raise ValueError("Unsupported still overlay option")
        index = add_input(row["source"], still=True)
        start = number(row["start"], 0, seconds, "overlay start")
        end = number(row["end"], start + .01, seconds, "overlay end")
        ow = integer(row.get("width", width), 2, width, "overlay width")
        oh = integer(row.get("height", height), 2, height, "overlay height")
        x = integer(row.get("x", (width - ow) // 2), 0, width - ow, "overlay x")
        y = integer(row.get("y", (height - oh) // 2), 0, height - oh, "overlay y")
        graph.append("[%d:v]scale=%d:%d:force_original_aspect_ratio=decrease,format=rgba[graphic%d]" % (index, ow, oh, i))
        graph.append("[%s][graphic%d]overlay=x=%d:y=%d:enable='between(t,%.9f,%.9f)':eof_action=pass[overlay%d]" % (visual, i, x, y, start, end, i))
        visual = "overlay%d" % i
    if plan.get("captions"):
        captions = file(plan["captions"])
        before[str(captions)] = fingerprint(captions)
        if captions.suffix.lower() != ".srt":
            raise ValueError("Burn-in captions must be SRT")
        shutil.copyfile(captions, output / "captions.srt")
        graph.append("[%s]subtitles=filename=captions.srt[subtitled]" % visual)
        visual = "subtitled"
    graph.append("[%s]format=yuv420p,setsar=1[video]" % visual)
    normalization = None
    audio_filters = plan.get("audio", {})
    if not isinstance(audio_filters, dict) or set(audio_filters) - {"normalize"} or not isinstance(audio_filters.get("normalize", False), bool):
        raise ValueError("audio.normalize must be boolean")
    if audio_filters.get("normalize"):
        if not has_audio:
            raise ValueError("Cannot normalize a missing audio stream")
        voice_graph = ";".join(row for row in graph if "[voice" in row)
        measure_log = output / "loudness-measure.log"
        execute([ffmpeg, "-hide_banner", "-nostdin", *inputs, "-filter_complex", voice_graph + ";[voiceout]loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json[measure]",
                 "-map", "[measure]", "-f", "null", "-"], measure_log, timeout=args.timeout, cwd=output)
        text = measure_log.read_text(errors="replace")
        blocks = re.findall(r'\{\s*"input_i".*?\}', text, re.DOTALL)
        if not blocks:
            raise ValueError("FFmpeg did not return loudness measurements")
        normalization = json.loads(blocks[-1])
        values = [float(normalization[key]) for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")]
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Cannot normalize silent or invalid audio")
        graph.append("[voiceout]loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=false[audio]" % tuple(values))
    elif has_audio:
        graph.append("[voiceout]anull[audio]")
    graph_path = output / "filter.txt"
    graph_path.write_text(";\n".join(graph), encoding="utf-8")
    target = output / "preview.mp4"
    command = [ffmpeg, "-hide_banner", "-nostdin", "-n", "-filter_complex_threads", "2", *inputs,
               "-filter_complex_script", str(graph_path), "-map", "[video]"]
    if has_audio:
        command += ["-map", "[audio]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    command += ["-t", "%.9f" % seconds, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(target)]
    save(output / "plan.json", plan)
    shutil.copyfile(Path(__file__), output / "reproduce.py")
    save(output / "command.json", command)
    save(output / "edit-map.json", {"version": VERSION, "segments": rows, "duration": seconds, "inputs": before})
    emit("render", output=str(target), duration=seconds)
    elapsed = render(command, output / "render.log", seconds, args.timeout, output)
    report = review(target, output, ffmpeg, ffprobe, seconds, [width, height], has_audio, args.timeout)
    report.update({"skill": "media-toolkit", "version": VERSION, "render_seconds": elapsed,
                   "loudness_measurement": normalization, "loudness_measurement_stage": "first_pass",
                   "edit_map": str(output / "edit-map.json")})
    report["checks"]["inputs_unchanged"] = all(fingerprint(Path(path)) == stamp for path, stamp in before.items())
    if not all(report["checks"].values()):
        report["status"] = "technical_failure"
    save(output / "report.json", report)
    emit(report["status"], file=str(target), report=str(output / "report.json"), review_sheet=report["review_sheet"], render_seconds=elapsed)
    if report["status"] == "technical_failure":
        raise RuntimeError("Technical validation failed; see report.json")


def transcribe(args):
    source, model = file(args.source), file(args.model)
    ffmpeg, whisper = tool(args.ffmpeg), tool(args.whisper)
    identity = {"source": fingerprint(source), "model": fingerprint(model), "language": args.language, "version": VERSION}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    cache = Path(args.cache).resolve() / key
    manifest_path = cache / "cache.json"
    if manifest_path.is_file():
        manifest = load(manifest_path)
        if manifest["identity"] == identity and all((cache / name).is_file() and sha(cache / name) == digest for name, digest in manifest["files"].items()):
            emit("transcript_cached", cache=str(cache), srt=str(cache / "transcript.srt"), text=str(cache / "transcript.txt"))
            return
    cache.mkdir(parents=True, exist_ok=True)
    # A failed attempt is recoverable in its dedicated cache directory. No media source is overwritten.
    audio = cache / "analysis.wav"
    if audio.exists():
        audio.unlink()
    execute([ffmpeg, "-v", "error", "-nostdin", "-n", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)], cache / "extract.log", timeout=args.timeout)
    started = time.monotonic()
    execute([whisper, "-m", str(model), "-f", str(audio), "-l", args.language, "-otxt", "-osrt", "-ojf", "-of", str(cache / "transcript")], cache / "transcribe.log", timeout=args.timeout)
    files = {}
    for suffix in ("txt", "srt", "json"):
        path = cache / ("transcript." + suffix)
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError("Transcriber did not produce a nonempty " + suffix)
        files[path.name] = sha(path)
    save(manifest_path, {"identity": identity, "files": files, "seconds": round(time.monotonic() - started, 3)})
    emit("transcribed", cache=str(cache), srt=str(cache / "transcript.srt"), text=str(cache / "transcript.txt"))


def captions(args):
    rows = load(args.cues)
    if not isinstance(rows, list) or not rows or len(rows) > 10000:
        raise ValueError("Provide a nonempty list of caption cues")
    output = fresh(args.output)
    def stamp(value, separator):
        milliseconds = round(value * 1000)
        seconds, ms = divmod(milliseconds, 1000)
        minutes, sec = divmod(seconds, 60)
        hours, minute = divmod(minutes, 60)
        return "%02d:%02d:%02d%s%03d" % (hours, minute, sec, separator, ms)
    srt, vtt, previous = [], ["WEBVTT\n"], 0
    for i, row in enumerate(rows):
        begin = number(row["start"], previous, 86400, "caption start")
        end = number(row["end"], begin + .001, 86400, "caption end")
        text = row["text"]
        if not isinstance(text, str) or not text.strip() or "-->" in text or "\x00" in text:
            raise ValueError("Invalid caption text")
        srt.append("%d\n%s --> %s\n%s\n" % (i + 1, stamp(begin, ","), stamp(end, ","), text.strip()))
        vtt.append("%s --> %s\n%s\n" % (stamp(begin, "."), stamp(end, "."), text.strip()))
        previous = end
    (output / "captions.srt").write_text("\n".join(srt), encoding="utf-8")
    (output / "captions.vtt").write_text("\n".join(vtt), encoding="utf-8")
    emit("captions_exported", srt=str(output / "captions.srt"), vtt=str(output / "captions.vtt"), cues=len(rows))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    commands = parser.add_subparsers(dest="mode", required=True)
    commands.add_parser("doctor")
    edit_parser = commands.add_parser("edit")
    edit_parser.add_argument("--plan", required=True)
    edit_parser.add_argument("--output", required=True)
    edit_parser.add_argument("--full", action="store_true")
    edit_parser.add_argument("--timeout", type=int, default=300)
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("--source", required=True)
    verify_parser.add_argument("--output", required=True)
    verify_parser.add_argument("--expected-duration", type=float)
    verify_parser.add_argument("--timeout", type=int, default=300)
    transcript_parser = commands.add_parser("transcribe")
    transcript_parser.add_argument("--source", required=True)
    transcript_parser.add_argument("--model", required=True)
    transcript_parser.add_argument("--whisper", default="whisper-cli")
    transcript_parser.add_argument("--language", default="ru")
    transcript_parser.add_argument("--cache", required=True)
    transcript_parser.add_argument("--timeout", type=int, default=1800)
    caption_parser = commands.add_parser("captions")
    caption_parser.add_argument("--cues", required=True)
    caption_parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.mode == "doctor":
            return 0 if doctor(args) else 1
        if args.mode == "verify":
            out = fresh(args.output)
            report = review(file(args.source), out, tool(args.ffmpeg), tool(args.ffprobe), args.expected_duration, timeout=args.timeout)
            save(out / "report.json", report)
            emit(report["status"], report=str(out / "report.json"), review_sheet=report["review_sheet"])
            return 0 if all(report["checks"].values()) else 1
        {"edit": edit, "transcribe": transcribe, "captions": captions}[args.mode](args)
        return 0
    except (OSError, KeyError, TypeError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        emit("failed", error=str(error))
        return 1


if __name__ == "__main__":
    sys.exit(main())
