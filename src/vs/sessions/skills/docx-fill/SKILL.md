---
name: docx-fill
description: Fill a Word (.docx) template such as a contract, invoice, act or letter from given data, save DOCX and PDF, and render PDF pages to PNG for visual review. Use for filling blanks in a document template, contracts by company requisites, and checking how a generated PDF looks.
metadata:
  version: 1.0.1
---

# Fill a Word template

Use the bundled [Python helper](scripts/docx_fill.py) instead of unzipping the .docx, editing XML, or scrolling a PDF in the browser. Resolve the script relative to this SKILL.md, not to the workspace. Quote paths. On Windows use the available Python (`python` or `py -3`); do not use `&&` in Windows PowerShell 5.1. Every command prints one JSON object; read it instead of dumping files into chat.

1. Run `<python> "<skill-directory>/scripts/docx_fill.py" doctor`. It needs `python-docx`, `pymupdf` and a PDF converter (Microsoft Word on Windows, or LibreOffice). If something is missing, read [dependency setup](references/setup.md), say exactly what is missing and offer to install it. Existing authorization to install is sufficient; otherwise ask first. Rerun doctor afterwards.
2. Collect the data first: read the source pages or files the user named. Copy requisites character for character (IBAN/IIK, BIN, BIK, Kazakh letters such as «і»); never translate, correct or invent them. Data absent from the sources stays blank.
3. `inspect "<template.docx>"` lists every location with blanks: body paragraphs as `p<N>`, table cells as `t<T>.r<R>.c<C>`, with their text and blank count, plus each table's first column (field labels). This is the whole map of the document; do not read it again another way.
4. Write a spec JSON in a work folder outside the template folder, for example `work/spec.json`; create the folder first:
   ```json
   {"operations": [
     {"at": "p0", "replace": "2026-11/01", "find": "BLANK"},
     {"at": "p2", "replace": "ТОО «Пример»", "nth": 1},
     {"at": "p5", "set": "1.2. Срок оказания Услуг: до «30» ноября 2026 г."},
     {"at": "t0.r2.c1", "set": "221040013762"}
   ]}
   ```
   `replace` changes the `nth` blank (`find` defaults to `BLANK`, any run of `__`) or the given literal text, keeping the formatting of that place. `nth` always counts in the template as `inspect` showed it, so several replaces in one paragraph do not shift each other; a blank you do not replace stays as it is. `set` replaces the whole paragraph or cell text. Do not mix `set` and `replace` for the same location. Prefer `set` when one paragraph has several blanks of different meaning, such as a day and a month; it avoids counting mistakes. Keep the template's own wording, quotes and date style. Write amounts and their words exactly as requested.
5. `fill --template "<template.docx>" --spec "<spec.json>" --output "<output/name.docx>"`. The helper never writes over the template or an existing output. It reports applied operations, errors and `remaining_blanks`. Remaining blanks are expected only for data that is genuinely missing; fix any other in the spec and fill again to a new name or with `--overwrite`.
6. `pdf "<output/name.docx>"` converts through Word or LibreOffice and reports the page count.
7. `render "<output/name.pdf>"` saves `page-01.png`, `page-02.png`, … next to the PDF, with a short text preview of each page. Open the PNG of every page the user asked to check (for a contract, the page with the requisites table) with the image-viewing tool. Check that values are readable, nothing overlaps or breaks, and no blank field was left by mistake. If viewing images is unavailable, say the visual check was not performed. `text "<file>"` prints DOCX or PDF text when you need to compare values exactly.
8. Allow at most one correction round. Do not rewrite the helper or retry an unchanged command.

Finish in the user's language: skill `docx-fill` version 1.0.1, output paths, what was filled, which fields stay blank and why (missing from which source), and what the page images showed. Do not claim a visual check you did not perform.
