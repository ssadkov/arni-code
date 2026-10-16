---
name: video-export-check
description: Verify a rendered local video against the requested duration, dimensions, sound and edit decisions. Use before claiming an export is finished or diagnosing a broken MP4.
metadata:
  version: 1.0.0
---

# Export verification

Use `media-toolkit verify` for an existing file, or read the report already produced by its edit command. Check requested duration, actual dimensions/aspect, nonzero size, audio presence, full decode and nonempty review images. For expected duration pass --expected-duration. Do not repeat a full decode when a fresh report already covers the unchanged file; match path, timestamp and task.

Inspect actual frames and listen to important speech/cuts. The three-frame sheet does not certify every join, subtitles, lips or the final phrase. Review those intervals using edit-map.json and any explicit user concerns. The helper's technical pass remains visual_review_required. A missing/zero-byte file or failing process is not a completed render. Report measured facts separately from observations and tests not performed. Retain original media and logs; never repair an export by overwriting its only copy.
