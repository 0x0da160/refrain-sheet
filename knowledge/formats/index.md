# Formats

File-format specifications Refrain Sheet reads or writes.

- [RSF](rsf/index.md) — the `.rsf` spreadsheet file (Zstandard-compressed
  JSON): design goals, the container, the JSON document, cross-sheet
  formulas, the value model, and versioning/compatibility.

Only RSF has a dedicated format specification long enough to warrant its own
concepts. CSV handling (the byte-preserving `LosslessDocument` model) and the
other worksheet content kinds (XLSX import, JSON/YAML/Markdown/text
worksheets) are currently covered within
[architecture/system-overview.md](../architecture/system-overview.md)'s
document-kinds section rather than as separate format concepts here — they
do not yet have enough distinct, durable specification content to justify
splitting out, and creating an empty placeholder concept for them would
violate this bundle's own "no placeholders" rule.
