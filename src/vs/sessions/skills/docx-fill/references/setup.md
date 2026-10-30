# Dependency setup

The helper needs Python 3.8+, the `python-docx` and `pymupdf` packages, and a PDF converter. Installing changes the computer: explain what is missing and get consent unless the user already authorized it. Never enter administrator passwords for the user.

## Python packages

Install only what doctor reports missing, for the same interpreter that runs the helper:

- `<python> -m pip install --user python-docx`
- `<python> -m pip install --user pymupdf`

If pip is absent, use `<python> -m ensurepip --user` first. A Windows Store alias that opens the Store is not a working Python; see the official [Python downloads](https://www.python.org/downloads/).

## PDF converter

- Windows: Microsoft Word, if installed, is used through its automation interface; nothing else is needed.
- macOS or Windows without Word: install [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/). On macOS with Homebrew: `brew install --cask libreoffice`.

After installing, rerun doctor and continue the original task. If installation is declined or fails, report the missing component and stop before claiming a PDF or a visual check. Filling the DOCX alone still works without a converter.
