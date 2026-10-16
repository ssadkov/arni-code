---
name: video-subtitles
description: Prepare SRT/VTT subtitles, correct transcript captions against spoken audio, or burn output-timed SRT into a local video. No CapCut integration.
metadata:
  version: 1.0.0
---

# Subtitles

Use `media-toolkit` for cached local transcription if no transcript is available; otherwise reuse existing TXT/SRT. Correct clear recognition mistakes and punctuation. Listen to disputed names, facts or phrases; a supplied script does not prove what was spoken. Preserve unresolved uncertainty and ask which wording to retain for substantive disagreements.

Prepare ordered UTF-8 cue JSON with start/end/text; toolkit `captions` exports SRT and VTT. Cue times must match the edited OUTPUT timeline. Use edit-map.json when constructing edited cues; cues crossing a removed passage require resegmentation against the audio. The helper does not automatically remap them or align individual words.

For burn-in, set plan `captions` to the SRT; requires FFmpeg subtitles/libass support. Render a short preview containing Cyrillic and long lines, inspect line breaks, face overlap and safe zones. Word-by-word animation and CapCut project editing are outside this skill. Original caption files and media remain recoverable.
