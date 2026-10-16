---
name: video-audio
description: Normalize spoken audio in a video or use a separate synchronized microphone track. Use for uneven voice loudness, microphone replacement and click-free joins.
metadata:
  version: 1.0.1
---

# Voice audio

If this session has no actual audio-understanding tool/model, explicitly say that the audio was not heard and ask the user to listen to the preview. Do not turn stream metadata, loudness values or a transcript into a claim of listening or verified lip synchronization.

Use `media-toolkit`; inspect available audio streams and the user's selected microphone. In the edit plan set `audio.normalize` to true for two-pass normalization, or `audio_source` to the separate already synchronized microphone WAV. The engine applies identical cuts and short edge fades. It never mixes camera audio or adds music.

Start with a short representative voice excerpt. Listen before and after, checking clipped consonants, noise amplification and lip synchronization. -16 LUFS / -1.5 dBTP is this helper's normalization target, not proof of subjective quality or a universal platform requirement. Silent measurements fail. Noise reduction, music ducking, echo removal and voice cloning are not implemented by this helper; do not claim they ran. Preserve the original audio and disclose any re-encoding.
