# XLSX attachments and one-time setup

XLSX attachments are copied byte-for-byte into the chat's `agentSessionData` directory under a SHA-256 filename. The model receives a local reference in the user message's reminder context, and local tools read the workbook. XLSX binaries are not sent as native `input_file` blocks. The same path is used for resource and pasted binary attachments and for messages sent during an active turn. Copies live with the chat's data; deleting that data removes them. Original workbook files are preserved. Text and image attachment handling is unchanged.

The spreadsheet-analysis helper supports `prepare`, which returns `python_executable` as JSON. On first XLSX use it creates a private virtual environment in `~/.arni-code/runtimes/`, installs pinned pure-Python wheels with SHA-256 verification, and verifies the imports. It prints setup progress to stderr and keeps stdout machine-readable. Later calls reuse the verified environment without pip or downloads. A lock serializes setup across chats. Failed setup releases the lock and gives a recoverable error. CSV/TSV do not require this setup.

Python 3.8+ with venv/pip and initial network access to PyPI are required. Python itself is not bundled by this change. No administrator privileges, Homebrew, system pip changes, or shell activation are used. Arbitrary analysis scripts must use the Python executable returned by `prepare`. Standard XLSX setup is announced by the Analyst instead of asking users to install openpyxl manually. Additional dependencies still require explanation.

The existing skill packaging/export includes the new Python helper automatically; pinned requirements are embedded in it. An updated client is needed for the attachment transport fix. Existing SDK histories that already contain binary `input_file` blocks are not rewritten: retry in a fresh chat after updating. macOS system folder consent remains controlled by macOS.

Validation:

- `python scripts/test-xlsx-runtime.py`: cached setup, private installation, failure recovery, CSV without setup.
- `python scripts/test-xlsx-runtime.py --live`: real venv and hash-checked installation, Unicode filename, XLSX read/write and source preservation, repeat without installation.
- `node test/unit/node/index.js --run src/vs/platform/agentHost/test/node/spreadsheetAttachments.test.ts`: file/pasted inputs, exact bytes, names and limits, images/text regression and read failures.
- `node scripts/test-sdk-xlsx-attachments.mjs`: actual pinned SDK/runtime against a local HTTP fixture; reads a synthetic XLSX using the helper and retains the reference on a subsequent turn, without account credentials or paid model calls.

The Windows and macOS build workflows run the runtime regressions and SDK fixture. These checks do not constitute a real user test of the final signed macOS installer.

## Local verification, 23 October 2026

Windows: 4 runtime tests, 7 attachment-suite checks and 41 selected session/sandbox regressions passed. Real first-use installation and XLSX read/write passed, including a repeated call without installation. The real SDK/CLI fixture passed file and embedded inputs, local workbook inspection and the following chat turn. The skill-library export includes the new helper. Targeted TypeScript checking of the five changed modules/test files and their imported graph returned no diagnostics. Workflow YAML parsed successfully.

The broader existing history suites fail on the terminal title `Run Shell Command` versus `Команда в терминале`. Running the history suite with the unmodified HEAD implementation reproduced the same two failures; they are unrelated to spreadsheet attachments. macOS CI, a signed installer and an actual Mac user flow have not yet been run for this change.
