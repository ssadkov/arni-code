# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Real FFmpeg fixture: key removal, foreground retention, streams and failures."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "src/vs/sessions/skills/greenscreen-preview/scripts/greenscreen.py"
spec = importlib.util.spec_from_file_location("greenscreen", HELPER)
skill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skill)


class GreenScreenTest(unittest.TestCase):
    def test_real_ffmpeg(self):
        ffmpeg = os.environ.get("ARNI_TEST_FFMPEG", "ffmpeg")
        ffprobe = os.environ.get("ARNI_TEST_FFPROBE", "ffprobe")
        scratch = ROOT / ".build"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="arni-media-test-", dir=scratch) as directory:
            root = Path(directory)
            source, background, output = root / "input with spaces.mp4", root / "background.png", root / "output"
            def create(arguments):
                subprocess.run([ffmpeg, "-v", "error", "-nostdin", *arguments], check=True, timeout=30)
            create(["-f", "lavfi", "-i", "color=c=0x49b3a0:s=320x180:r=25:d=5,drawbox=x=120:y=40:w=80:h=130:color=black:t=fill",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source)])
            create(["-f", "lavfi", "-i", "color=c=0x204080:s=320x180", "-frames:v", "1", str(background)])
            before = source.read_bytes()
            args = type("Args", (), {"source": str(source), "background": str(background), "output": str(output),
                                      "ffmpeg": ffmpeg, "ffprobe": ffprobe, "start": 0, "duration": 5, "width": 320, "height": 180})()
            skill.prepare(args)
            manifest = json.loads((output / "manifest.json").read_text())
            best = next(row for row in manifest["candidates"] if row["number"] == manifest["recommended_candidate"])
            self.assertGreater(best["green_background_removed"], .99)
            self.assertGreater(best["central_foreground_opaque"], .99)
            render_args = type("Args", (), {"output": str(output), "candidate": best["number"], "similarity": None, "blend": None, "name": "preview"})()
            skill.render(render_args)
            report = json.loads((output / "report.json").read_text())
            self.assertTrue(all(report["checks"].values()), report)
            self.assertEqual(report["status"], "technical_pass_visual_review_required")
            self.assertEqual(before, source.read_bytes(), "Source must remain unchanged")
            self.assertTrue((output / "result-sheet.jpg").stat().st_size > 100)
            review_files = ["source-sheet.jpg", "candidates.jpg", "result-sheet.jpg", "detail-sheet.jpg"]
            self.assertLess(sum((output / name).stat().st_size for name in review_files), 750_000,
                            "Review images must fit comfortably in a conversation's API body")
            with self.assertRaisesRegex(ValueError, "already exists"):
                skill.render(render_args)
            with self.assertRaisesRegex(ValueError, "not empty"):
                skill.prepare(args)
            render_args.name = "preview_v2"
            manifest["tools"]["ffmpeg"] = ffprobe  # Deliberately fails on FFmpeg-only arguments.
            (output / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "Render failed"):
                skill.render(render_args)
            self.assertFalse((output / "report-v2.json").exists(), "Failed process must not produce a success report")


if __name__ == "__main__":
    unittest.main()
