---
name: video-reframe
description: Resize or crop local video into a requested landscape, square or portrait format, preserving important subjects and screen content. Use for platform adaptations and lightweight preview copies.
metadata:
  version: 1.0.0
---

# Reframe and resize

Use `media-toolkit`. Inspect actual source frames before choosing framing. Preserve the original aspect/orientation by default. Ask or follow an explicit request before producing a portrait version; social publication alone does not establish a requested crop.

Set output width/height and `fit`: contain keeps the whole image with padding; cover fills by cropping. Optional source-pixel `crop` gives a deliberate region before scaling. Use representative frames with motion/gestures and check face, hands, captions and screen controls. The helper does not implement face tracking or automatic smart crops. A smaller preview/proxy is another explicit edit plan; save it separately and do not replace the source or master. Start with a short sample, then produce a full adaptation only when requested.
