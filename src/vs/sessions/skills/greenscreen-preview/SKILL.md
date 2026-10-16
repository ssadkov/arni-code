---
name: greenscreen-preview
description: Replace a green screen behind a single presenter with a still background using installed FFmpeg. Prepare candidate frames, then render and verify a short video preview. Use for chroma key, green screen, and replacing a video's green background.
metadata:
  version: 1.0.1
---

# Green-screen preview

Use the bundled [Python helper](scripts/greenscreen.py) instead of writing a new shell/FFmpeg pipeline. Requires Python 3, FFmpeg and ffprobe already installed. Resolve this script relative to this SKILL.md, not to the workspace. Quote paths. On Windows use the available Python executable; do not use `&&` in Windows PowerShell 5.1. Missing dependencies are a limitation to report, not permission to install software.

This first version targets one presenter against a mostly green background. Border-based color sampling and central foreground checks are heuristics, not person segmentation. Multiple people, green clothing, a moving camera, and uneven light can require another method.

1. Honor the user's source, background, output dimensions, audio and duration. Default to a five-second preview and preserve originals. Pick a new output directory; the helper refuses to overwrite existing results. For portrait output pass `--width 1080 --height 1920`; landscape defaults to 1920x1080. A background is fitted to cover; the presenter is fitted without cropping.
2. Prepare source frames and six candidate composites (no video rendering yet):
   `python "<skill-directory>/scripts/greenscreen.py" prepare --source "<source.mp4>" --background "<background.jpg>" --output "<new-output-directory>"`
   Use `--ffmpeg` and `--ffprobe` for explicit executable paths if needed. Optional `--start`, `--duration`, `--width`, `--height` honor the requested segment. Read the concise JSON summary and `manifest.json`; do not dump full logs or the helper implementation into chat.
3. Actually open `source-sheet.jpg` and `candidates.jpg` with the image-viewing tool. Candidate numbers are row-major: 1,2,3 across the first row; 4,5,6 across the second. Use the report's background-removal and foreground-opacity checks to reject obvious failures, then inspect hair, shoulders and retained green. Prefer an opaque presenter and complete replacement over blurred/translucent edges. Lower `similarity` removes fewer colors; larger `blend` can make the presenter translucent. Do not confuse remaining green background with holes in the body.
4. Render the chosen candidate, using the saved copy of the helper for reproducibility:
   `python "<output>/reproduce.py" render --output "<output>" --candidate <1-6>`
   The helper loops the still, scales before keying, applies green despill, preserves available source audio, sets square pixels, checks duration/frame count/aspect/audio, decodes the output, and saves three evaluation frames plus `result-sheet.jpg`, `report.json`, logs and measured elapsed time. Progress is printed as short JSON events. A nonzero exit means failure; read the named log's tail and stop or make one targeted correction.
5. Open `result-sheet.jpg` and `detail-sheet.jpg`. The result sheet's first row is source frames and its second row is the corresponding results, at the times listed in `report.json`. The detail sheet compares the central head/shoulder region, source left and result right; if the presenter is elsewhere, inspect the individual full frames instead. If transparency is ambiguous, view `masks.jpg`: white retains foreground, black removes background, gray is partial transparency. Review actual images; a technical pass does not certify visual quality. The helper reports `visual_review_required`, never a self-declared visual pass. If viewing is unavailable, say visual review was not performed. Record specific defects and uncertainty, not generic praise.
6. Allow at most one new preview unless the user requests more. A correction uses another candidate and `--name preview_v2` (or explicit `--similarity` and `--blend`); do not rewrite the helper or repeat a failed command unchanged. If one correction still fails, report the best artifact and the limitation. Never render the full video without the user's request.

Finish in the user's language with skill `greenscreen-preview` version 1.0.1, actual output path, technical checks, measured render time, observed visual defects, and whether the preview is usable. Keep full logs in files. Do not claim model prices, API cost, or total agent time from local render timing.
