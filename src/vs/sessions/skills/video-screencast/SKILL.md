---
name: video-screencast
description: Compose synchronized screen, webcam and microphone recordings with a circular or square picture-in-picture camera. Use for tutorials, screen recordings and product demos.
metadata:
  version: 1.0.0
---

# Screen and camera

Use `media-toolkit`. Inspect source streams, duration and time zero. First prepare a continuous short synchronization preview from screen, camera and selected microphone. Check lips/voice near the beginning and at a later sample. Correlation between microphones alone does not prove camera synchronization. If sources need offsets, stop and establish them; this engine assumes a shared zero and does not infer offsets.

Use plan `source`, `audio_source` and `webcam` with size, position and circle/square shape. Choose position from actual screen images so the camera does not cover controls, numbers or forms. Inspect the circular edge and readability. Apply approved cuts identically to all tracks. Constant camera position is supported; moving/hiding by interval is not implemented. Do not turn a user-specific recording style into every author's default. Preserve original orientation and avoid extra motion/music unless requested.
