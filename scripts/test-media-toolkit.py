# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Native FFmpeg tests for media operations, invalid plans and transcript reuse."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "src/vs/sessions/skills/media-toolkit/scripts/media.py"
spec = importlib.util.spec_from_file_location("media", HELPER)
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)
FFMPEG = os.environ.get("ARNI_TEST_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("ARNI_TEST_FFPROBE", "ffprobe")


class MediaToolkitTest(unittest.TestCase):
    def test_native_edits(self):
        with tempfile.TemporaryDirectory(prefix="media-tools-", dir=ROOT / ".build") as directory:
            root = Path(directory)
            source, camera, overlay = root / "source with spaces.mp4", root / "camera.mp4", root / "insert.png"
            def create(arguments):
                subprocess.run([FFMPEG, "-v", "error", "-nostdin", *arguments], check=True, timeout=30)
            create(["-f", "lavfi", "-i", "color=red:s=320x180:r=25:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source)])
            create(["-f", "lavfi", "-i", "color=blue:s=128x128:r=25:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(camera)])
            create(["-f", "lavfi", "-i", "color=0x00ff00:s=80x40", "-frames:v", "1", str(overlay)])
            before = source.read_bytes()
            cues = root / "cues.json"
            cues.write_text(json.dumps([{"start": .1, "end": 1.8, "text": "Привет, монтаж"}]), encoding="utf-8")
            media.captions(type("Args", (), {"cues": cues, "output": root / "captions"})())
            plan = {"source": str(source), "segments": [[0, .8], [2, 3.2]], "width": 180, "height": 320, "fit": "cover",
                    "audio": {"normalize": True}, "webcam": {"source": str(camera), "size": 64, "x": 8, "y": 8, "shape": "circle"},
                    "overlays": [{"source": str(overlay), "start": .2, "end": .7, "width": 80, "height": 40, "x": 90, "y": 80}],
                    "captions": str(root / "captions/captions.srt")}
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            args = type("Args", (), {"plan": plan_path, "output": root / "edited", "ffmpeg": FFMPEG, "ffprobe": FFPROBE, "full": False, "timeout": 60})()
            media.edit(args)
            report = media.load(root / "edited/report.json")
            self.assertTrue(all(report["checks"].values()), report)
            self.assertEqual([report["width"], report["height"]], [180, 320])
            self.assertAlmostEqual(report["duration"], 2, delta=.12)
            self.assertEqual(report["status"], "technical_pass_visual_review_required")
            self.assertEqual(source.read_bytes(), before)
            self.assertLess((root / "edited/review-sheet.jpg").stat().st_size, 300_000)
            raw = subprocess.check_output([FFMPEG, "-v", "error", "-ss", "0.4", "-i", str(root / "edited/preview.mp4"),
                                           "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], timeout=30)
            def pixel(x, y):
                return raw[(y * 180 + x) * 3:(y * 180 + x + 1) * 3]
            self.assertGreater(pixel(120, 90)[1], 180, "Actual inserted image must be visible")
            self.assertGreater(pixel(40, 40)[2], 150, "Camera centre must be blue")
            self.assertGreater(pixel(9, 9)[0], 150, "Circular camera corners must retain the red source")
            self.assertTrue(report["loudness_measurement"])
            with self.assertRaisesRegex(ValueError, "new empty"):
                media.edit(args)
            # No-audio sources are valid, but must not gain an invented audio stream.
            plan_path.write_text(json.dumps({"source": str(camera), "segments": [[1, 2]]}))
            args.output = root / "silent"
            media.edit(args)
            self.assertIsNone(media.load(root / "silent/report.json")["audio_codec"])
            # Invalid source intervals/unsupported requests fail before producing a preview.
            for index, change in enumerate(({"segments": [[1, 2], [1.5, 3]]}, {"segments": [[0, 99]]}, {"imaginary_effect": "remove noise"})):
                plan_path.write_text(json.dumps({"source": str(source), **change}))
                args.output = root / ("invalid%d" % index)
                with self.assertRaises(ValueError):
                    media.edit(args)
                self.assertFalse((args.output / "preview.mp4").exists())

    def test_transcript_cache(self):
        with tempfile.TemporaryDirectory(prefix="media-cache-", dir=ROOT / ".build") as directory:
            root = Path(directory)
            source, model = root / "video.mp4", root / "model.bin"
            source.write_bytes(b"fixture source")
            model.write_bytes(b"fixture model")
            args = type("Args", (), {"source": source, "model": model, "whisper": FFMPEG, "ffmpeg": FFMPEG,
                                      "language": "ru", "cache": root / "cache", "timeout": 30})()
            def process(command, log, **options):
                if "-of" in command:
                    prefix = Path(command[command.index("-of") + 1])
                    for suffix in ("txt", "srt", "json"):
                        prefix.with_suffix("." + suffix).write_text("fixture transcript", encoding="utf-8")
                else:
                    Path(command[-1]).write_bytes(b"fixture audio")
            with patch.object(media, "execute", side_effect=process) as execute:
                media.transcribe(args)
                self.assertEqual(execute.call_count, 2)
                media.transcribe(args)
                self.assertEqual(execute.call_count, 2, "Unchanged input must not be transcribed again")
                next((root / "cache").glob("*/transcript.txt")).write_text("corrupt")
                media.transcribe(args)
                self.assertEqual(execute.call_count, 4, "Corrupt cached transcript must be regenerated")


if __name__ == "__main__":
    (ROOT / ".build").mkdir(exist_ok=True)
    unittest.main()
