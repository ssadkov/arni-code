#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root.
"""Fill a Word template from a JSON spec, convert it to PDF and render pages for visual review."""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VERSION = "1.0.1"
# Typical template blanks: «___», 20__ г., ______, …… and long dot leaders.
BLANK = re.compile(r"_{2,}|…{2,}|\.{6,}")


def import_pymupdf():
    """pymupdf 1.24+ prefers `import pymupdf`; older releases only provide `fitz`."""
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        try:
            import fitz
            return fitz
        except ImportError:
            return None


def out(data, code=0):
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False, indent=1))
    sys.exit(code)


def fail(message, **details):
    out({"ok": False, "error": message, **details}, 1)


def load_docx():
    try:
        import docx  # noqa: F401
        return docx
    except ImportError:
        fail("python-docx is not installed", install="python -m pip install --user python-docx")


def word_available():
    if platform.system() != "Windows":
        return False
    probe = "try { $w = New-Object -ComObject Word.Application; $w.Quit(); 'ok' } catch { 'no' }"
    result = subprocess.run(["powershell", "-NoProfile", "-Command", probe], capture_output=True, text=True, timeout=60)
    return result.stdout.strip() == "ok"


def soffice():
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in ("C:/Program Files/LibreOffice/program/soffice.exe", "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if Path(candidate).exists():
            return candidate
    return None


def doctor(_args):
    """Read-only dependency report; never installs anything."""
    report = {"skill": "docx-fill", "version": VERSION, "python": sys.version.split()[0], "platform": platform.system()}
    try:
        import docx  # noqa: F401
        report["python-docx"] = True
    except ImportError:
        report["python-docx"] = False
    report["pymupdf"] = import_pymupdf() is not None
    report["word"] = word_available()
    report["libreoffice"] = soffice()
    report["pdf_converter"] = "word" if report["word"] else "libreoffice" if report["libreoffice"] else None
    missing = [name for name in ("python-docx", "pymupdf") if not report[name]]
    if not report["pdf_converter"]:
        missing.append("Microsoft Word or LibreOffice")
    report["missing"] = missing
    report["ok"] = not missing
    out(report, 0 if report["ok"] else 1)


def locations(document):
    """Yield (location, paragraph) for body paragraphs and table cell paragraphs, in document order."""
    for index, paragraph in enumerate(document.paragraphs):
        yield f"p{index}", paragraph
    for t, table in enumerate(document.tables):
        for r, row in enumerate(table.rows):
            for c, cell in enumerate(row.cells):
                for k, paragraph in enumerate(cell.paragraphs):
                    yield f"t{t}.r{r}.c{c}" + (f".p{k}" if k else ""), paragraph


def inspect(args):
    docx = load_docx()
    document = docx.Document(args.docx)
    items, blanks = [], 0
    for location, paragraph in locations(document):
        text = paragraph.text
        found = len(BLANK.findall(text))
        blanks += found
        # Table labels are already listed per table in first_column.
        if text.strip() and (args.all or found):
            items.append({"at": location, "blanks": found, "text": text if len(text) <= args.width else text[:args.width] + "…"})
    tables = [{"table": t, "rows": len(table.rows), "cols": len(table.columns),
               "first_column": [row.cells[0].text for row in table.rows]} for t, table in enumerate(document.tables)]
    out({"ok": True, "docx": str(Path(args.docx).resolve()), "paragraphs": len(document.paragraphs), "tables": tables,
         "blank_count": blanks, "items": items})


def resolve(document, location):
    for name, paragraph in locations(document):
        if name == location:
            return paragraph
    fail("Unknown location", at=location, hint="Use an 'at' value printed by inspect, e.g. p2 or t0.r3.c1")


def replace_in_paragraph(paragraph, find, value, nth):
    """Replace the nth match while keeping the formatting of the run where the match starts."""
    runs = paragraph.runs
    text = "".join(run.text for run in runs)
    if isinstance(find, str) and find == "BLANK":
        matches = list(BLANK.finditer(text))
    else:
        matches = [m for m in re.finditer(re.escape(find), text)]
    if len(matches) < nth:
        return False
    start, end = matches[nth - 1].span()
    position = 0
    placed = False
    for run in runs:
        run_start, run_end = position, position + len(run.text)
        position = run_end
        if run_end <= start or run_start >= end:
            continue
        keep_before = run.text[:max(0, start - run_start)]
        keep_after = run.text[max(0, end - run_start):] if run_end > end else ""
        run.text = keep_before + (value if not placed else "") + keep_after
        placed = True
    if not placed:
        paragraph.add_run(value)
    return True


def set_text(paragraph, value):
    runs = paragraph.runs
    if not runs:
        paragraph.add_run(value)
        return
    runs[0].text = value
    for run in runs[1:]:
        run.text = ""


def fill(args):
    docx = load_docx()
    template, output = Path(args.template).resolve(), Path(args.output).resolve()
    if output == template:
        fail("Output must differ from the template; templates are never modified")
    if output.exists() and not args.overwrite:
        fail("Output already exists; choose a new name or pass --overwrite", output=str(output))
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8-sig"))  # PowerShell 5.1 writes a BOM
    operations = spec.get("operations", spec) if isinstance(spec, dict) else spec
    if not isinstance(operations, list) or not operations:
        fail("Spec must be a non-empty list of operations or {\"operations\": [...]}")
    document = docx.Document(str(template))
    applied, errors = 0, []
    targets = {}
    for operation in operations:
        targets.setdefault(operation.get("at", ""), set()).add("set" if "set" in operation else "replace")
    mixed = sorted(at for at, kinds in targets.items() if len(kinds) > 1)
    if mixed:
        fail("Do not mix 'set' and 'replace' for one location", at=mixed)
    # `nth` counts matches in the template as written: replacing the last ones first keeps earlier indexes valid.
    ordered = sorted(enumerate(operations, 1), key=lambda item: (item[1].get("at", ""), str(item[1].get("find", "BLANK")), -int(item[1].get("nth", 1)))
                     if "replace" in item[1] else ("", "", 0))
    for number, operation in ordered:
        paragraph = resolve(document, operation.get("at", ""))
        if "set" in operation:
            set_text(paragraph, str(operation["set"]))
            applied += 1
        elif "replace" in operation:
            if replace_in_paragraph(paragraph, operation.get("find", "BLANK"), str(operation["replace"]), int(operation.get("nth", 1))):
                applied += 1
            else:
                errors.append({"operation": number, "at": operation["at"], "error": "match not found", "text": paragraph.text[:200]})
        else:
            errors.append({"operation": number, "error": "use 'set' or 'replace'"})
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(output))
    remaining = [{"at": location, "text": paragraph.text[:160]} for location, paragraph in locations(docx.Document(str(output)))
                 if BLANK.search(paragraph.text)]
    out({"ok": not errors, "output": str(output), "applied": applied, "errors": errors, "remaining_blanks": remaining},
        0 if not errors else 1)


def to_pdf(args):
    source = Path(args.docx).resolve()
    target = Path(args.output).resolve() if args.output else source.with_suffix(".pdf")
    if target.exists() and not args.overwrite:
        fail("PDF already exists; pass --overwrite to replace it", output=str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    if word_available():
        script = ("$w = New-Object -ComObject Word.Application; $w.Visible = $false; "
                  "try { $d = $w.Documents.Open($env:DOCX_FILL_SRC, $false, $true); $d.ExportAsFixedFormat($env:DOCX_FILL_DST, 17); $d.Close($false) } "
                  "finally { $w.Quit() }")
        env = {**os.environ, "DOCX_FILL_SRC": str(source), "DOCX_FILL_DST": str(target)}
        result = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, timeout=180, env=env)
        converter = "word"
    elif soffice():
        with tempfile.TemporaryDirectory() as work:
            result = subprocess.run([soffice(), "--headless", "--convert-to", "pdf", "--outdir", work, str(source)],
                                    capture_output=True, text=True, timeout=180)
            produced = Path(work) / (source.stem + ".pdf")
            if produced.exists():
                shutil.move(str(produced), str(target))
        converter = "libreoffice"
    else:
        fail("No PDF converter: install Microsoft Word or LibreOffice", hint="Run doctor")
    if not target.exists():
        fail("PDF conversion failed", converter=converter, stderr=(result.stderr or result.stdout)[-800:])
    pages = None
    pymupdf = import_pymupdf()
    if pymupdf:
        with pymupdf.open(str(target)) as pdf:
            pages = pdf.page_count
    out({"ok": True, "pdf": str(target), "converter": converter, "pages": pages})


def render(args):
    pymupdf = import_pymupdf() or fail("pymupdf is not installed", install="python -m pip install --user pymupdf")
    source = Path(args.pdf).resolve()
    directory = Path(args.output_dir).resolve() if args.output_dir else source.parent / (source.stem + "-pages")
    directory.mkdir(parents=True, exist_ok=True)
    images = []
    with pymupdf.open(str(source)) as pdf:
        wanted = [int(p) for p in args.pages.split(",")] if args.pages else range(1, pdf.page_count + 1)
        for number in wanted:
            if not 1 <= number <= pdf.page_count:
                fail("Page out of range", page=number, pages=pdf.page_count)
            target = directory / f"page-{number:02d}.png"
            pdf[number - 1].get_pixmap(dpi=args.dpi).save(str(target))
            images.append({"page": number, "png": str(target), "text_preview": pdf[number - 1].get_text()[:240]})
    out({"ok": True, "pages": images, "next": "Open the PNG of each page you must verify with the image-viewing tool."})


def text(args):
    path = Path(args.file).resolve()
    if path.suffix.lower() == ".pdf":
        pymupdf = import_pymupdf() or fail("pymupdf is not installed", install="python -m pip install --user pymupdf")
        with pymupdf.open(str(path)) as pdf:
            content = "\n".join(page.get_text() for page in pdf)
    else:
        docx = load_docx()
        content = "\n".join(f"[{location}] {paragraph.text}" for location, paragraph in locations(docx.Document(str(path))) if paragraph.text.strip())
    out({"ok": True, "file": str(path), "text": content[:args.limit], "truncated": len(content) > args.limit})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor").set_defaults(run=doctor)
    command = commands.add_parser("inspect")
    command.add_argument("docx")
    command.add_argument("--all", action="store_true", help="also list body paragraphs without blanks")
    command.add_argument("--width", type=int, default=1500, help="truncate longer paragraphs")
    command.set_defaults(run=inspect)
    command = commands.add_parser("fill")
    command.add_argument("--template", required=True)
    command.add_argument("--spec", required=True)
    command.add_argument("--output", required=True)
    command.add_argument("--overwrite", action="store_true")
    command.set_defaults(run=fill)
    command = commands.add_parser("pdf")
    command.add_argument("docx")
    command.add_argument("--output")
    command.add_argument("--overwrite", action="store_true")
    command.set_defaults(run=to_pdf)
    command = commands.add_parser("render")
    command.add_argument("pdf")
    command.add_argument("--output-dir")
    command.add_argument("--pages", help="comma-separated 1-based pages, default all")
    command.add_argument("--dpi", type=int, default=110)
    command.set_defaults(run=render)
    command = commands.add_parser("text")
    command.add_argument("file")
    command.add_argument("--limit", type=int, default=20000)
    command.set_defaults(run=text)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
