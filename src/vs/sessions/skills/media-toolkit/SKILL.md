---
name: media-toolkit
description: Execute and verify local video edits from a JSON plan with FFmpeg. Shared engine for trimming, audio normalization, camera overlays, still inserts, reframing, subtitles and cached local transcription.
metadata:
  version: 1.0.0
---

# Local media toolkit

Use [scripts/media.py](scripts/media.py), resolved relative to this file, instead of generating shell/FFmpeg pipelines. Python standard library only; requires working Python 3, FFmpeg and ffprobe. First run `<python> "<toolkit>/scripts/media.py" doctor`. On missing dependencies follow the installation workflow in `greenscreen-preview/references/setup.md` (a sibling skill); obtain installation consent unless already authorized. Resolve existing tools before installing another copy. Explicit executable options go BEFORE the subcommand: `media.py --ffmpeg "<path>" --ffprobe "<path>" doctor`.

Read [the plan schema and commands](references/plan.md) only for the requested operation. Use absolute input paths. Start with a new five-second preview directory, preserve original orientation unless the user requests another format, and actually view the compact review sheet and listen to relevant audio. Technical validation does not certify appearance or lip synchronization. Finish with exact output path, helper version, measured render time, actual checks and remaining defects. Total agent time and API cost are separate measurements.

The helper never downloads dependencies, media, ASR models or calls an API. Local transcription uses an already installed whisper.cpp executable and model; if missing, propose installation and the model download separately. Normal chat models do not themselves transcribe an audio file. Images opened by the agent are sent to its selected vision provider; keep sheets compact and inspect only the relevant samples.

Default `edit` rejects outputs over 30 seconds. Use `--full` only when the user requested the full export. One targeted preview correction is normally enough before reporting a limitation. Do not repeatedly probe a running process: use its progress events and wait for completion. A nonzero exit is a failure; inspect the named log, correct the cause and choose a new output directory. Never delete another version or the only recovery copy.

Output includes a reproducible JSON plan, exact command, helper copy, source-to-output edit map, logs, report and JPEG review sheet. Relative plan paths resolve from the command's working directory, so write absolute paths. Retain these artifacts for follow-up requests. Reuse an existing transcript instead of analyzing unchanged audio again. A saved author preference is a proposal until the user asks to remember it.
