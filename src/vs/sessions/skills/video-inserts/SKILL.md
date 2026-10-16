---
name: video-inserts
description: Add timed still diagrams, title cards, logos or supplied illustrations over local video while speech continues. Use for explanatory graphics and presenter titles.
metadata:
  version: 1.0.0
---

# Titles and still inserts

Use `media-toolkit` plan `overlays`. Prefer user-supplied images; do not fetch assets or generate a replacement for an author's diagram without a reason. Number proposed inserts consistently with source time and purpose so the user can select them. Final plan times are OUTPUT times after cuts; use edit-map.json.

Render supplied PNG/JPEGs at chosen output coordinates/size without distortion, retaining speech underneath. For text-only captions/titles, use video-subtitles to export timed SRT and inspect a burn-in preview. Generated diagrams or photorealistic images require the available image/design tools as a separate step; this engine does not create them. Check factual names/dates and author approval before rendering new wording. Inspect a short preview for readability, Cyrillic, cropping and timing. This version supports still overlays; animated transitions are not implemented.
