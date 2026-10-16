---
name: video-trim
description: Trim a local video by timecodes and join retained intervals while keeping audio synchronized. Use for removing setup, endings or approved failed takes.
metadata:
  version: 1.0.0
---

# Trim and join

Use the sibling `media-toolkit` skill and its checked helper. Prepare a JSON plan with absolute source path and `segments` containing retained source intervals. Preserve source orientation/dimensions and selected original audio unless requested otherwise. Read the toolkit's plan reference before invoking it.

For explicit timecodes, validate ranges and render a short representative preview. For requests such as “remove the repetition”, use video-story-edit to prepare a transcript-based plan first; do not invent cut boundaries from file duration. Apply the same retained intervals to screen, camera and microphone. The engine records source/output mapping and adds short audio edge fades. It does not estimate synchronization offsets.

Inspect each join in the preview and listen around it; check the last completed phrase. A frame sheet cannot certify the audio. Full export needs the user's request and `--full`; retain the edit map and original media. Report actual duration, output file and any cut that was not reviewed.
