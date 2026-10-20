---
name: file-organizing
description: "Plan file organization in one selected folder, apply approved moves without overwrites and undo using a journal. No deletion."
metadata:
  version: 1.0.0
---

# Plan, review, move

Use `scripts/organize.py` relative to this file; Python 3 standard library only. For a capabilities question do not inspect folders. Establish the exact folder and whether the user requests a plan or execution. This helper handles immediate regular files only, by extension; it skips hidden files, links, folders and files above 64 MiB. It does not semantically read personal documents or find duplicates across the computer.

```text
<python> organize.py plan --source "selected-folder" --output plan.json
<python> organize.py apply --plan plan.json --journal moves.json
<python> organize.py undo --journal moves.json
```

Show the concrete source → destination list and skipped/collision reasons. Filenames will be visible to the model reading the plan. Do not apply until the user authorizes this plan. The helper checks content hashes, changed files, paths/links and target collisions before moving and writes an exclusive journal. A move copies to an exclusively created destination, verifies both hashes and only then removes the old location; it has no delete-only operation and never overwrites an existing file. It preserves contents, not all metadata/ACLs. If execution stops partway, inspect the journal and report completed/pending moves. Undo uses the same journal, refuses conflicts/changed content and restores moved files; it can leave empty category folders.

Do not route recursive reorganizations, source repositories, cloud placeholders, system folders, deletions or app uninstallations through this first helper. Similar names are not proof of duplicate content. Honor requested exclusions. Never promise that an undo journal covers edits made by other apps afterwards.

First test in a disposable folder: plan a mixture of PDF/CSV/JPG/TXT without moving; after permission apply; then undo and compare source names/content. A second test should refuse a stale plan after a file changes.
