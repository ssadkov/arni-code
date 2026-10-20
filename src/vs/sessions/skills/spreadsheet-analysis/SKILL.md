---
name: spreadsheet-analysis
description: "Inspect CSV/XLSX, merge compatible tables and reconcile records by an explicit key with duplicate and amount checks."
metadata:
  version: 1.0.0
---

# Tables with checkable totals

Use `scripts/tables.py` relative to this file for the first workflow. Python 3 is required; CSV/TSV reading uses the standard library and XLSX needs openpyxl. Probe availability before use; explain a missing dependency and proposed installation instead of installing silently. The helper never uploads input files. Rows read by the AI are still disclosed to the selected model; minimize samples for private data.

Commands:

```text
<python> tables.py inspect input.xlsx [--sheet Sales]
<python> tables.py merge first.csv second.csv --key id --output merged.csv
<python> tables.py reconcile statement.csv invoices.xlsx --key id --amount amount --output reconciliation.xlsx
```

`--delimiter ';'` handles semicolon CSV; TSV uses tabs. `--sheet` chooses an XLSX sheet; otherwise the first is used. Headers must be unique/nonempty. Keys are trimmed strings; preserve leading zeros from textual keys. Do not infer matching keys, currencies or units when ambiguous. Amounts use explicit decimal-point numbers; do not silently reinterpret locale-specific amounts.

The helper preserves duplicate rows and marks ambiguous keys; it does not guess pairings or remove data. Reconciliation reports matched, differing, left-only, right-only, ambiguous and invalid rows. Reconcile within one currency/unit only; prefilter or separate tables if needed. Formulas are not recalculated: merge/reconciliation refuse formula inputs and request a recalculated value export. Legacy XLS, macros and complex workbook round-tripping are outside this helper. Do not claim preservation of all original workbook formatting or cached formula results.

Write only a new output path. Inspect the output, reconcile input/output row counts and review totals/exceptions before declaring success. String cells are saved as literal text, not active spreadsheet formulas. For tasks beyond these operations, make a small auditable script on a copy and verify results rather than forcing them through the wrong command.

First test: reconcile small CSV/XLSX inputs with one match, one amount difference, missing records and a duplicate key. Ask for no source changes and explain each exception.
