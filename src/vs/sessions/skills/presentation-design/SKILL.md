---
name: presentation-design
description: "Create editable PPTX from a sourced outline or make a precise text edit on a copy, then check structure and visual export."
metadata:
  version: 1.0.0
---

# Slides that can be reviewed

Start with audience, purpose, source material, desired slide count and any template. For a capabilities question do not create files. Draft a short outline, using only supported facts; ask about missing essential data rather than inventing it. Keep the selected model. Use `scripts/slides.py` relative to this file for simple first-pass PPTX and narrow edits. It needs Python 3 and python-pptx; explain missing dependencies before installation.

```text
<python> slides.py create --plan outline.json --output presentation.pptx
<python> slides.py inspect presentation.pptx
<python> slides.py replace-text original.pptx --old "Exact title" --new "New title" --output revised.pptx
```

Plan format: `{"slides":[{"title":"...","bullets":["..."],"source":"file/section or URL"}]}`. A simple 16:9 layout supports up to six brief bullets per slide and a source footer. It is a baseline layout, not an implementation of arbitrary brand templates. For an existing deck inspect first; the narrow edit accepts a unique single-run paragraph to preserve its formatting. It refuses ambiguous or rich-text replacements; broader edits require a deliberate copy-based editing approach, preserving unrelated slides and styles.

Always reopen the resulting PPTX and check slide count/text. For visual verification use an available PowerPoint/LibreOffice renderer to PDF/images, then inspect each slide for overlaps, cropping, contrast and readability. Do not silently install or launch a cloud conversion service. If rendering is unavailable, state “PPTX created, structure checked; visual export not checked” and offer a user-exported PDF. A successful save is not a visual check. Do not claim an unrendered slide is presentation-ready.

Preserve originals. Deliver the editable PPTX, source/outline, preview when available and verification limits. First tests: six slides from a local report; then change one title in the produced deck and confirm that other slides are unchanged.
