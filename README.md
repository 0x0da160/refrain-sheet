# Refrain CSV HTML

A format-preserving CSV editor that runs directly from a local HTML file.

Refrain CSV HTML is an offline CSV editor distributed as static files.
Open `index.html` directly in a browser; no installation, server, account,
or network connection is required.

“Refrain” means refraining from touching your file unnecessarily.
Edit field values while preserving everything else as faithfully as possible:
delimiters, quoting, surrounding whitespace, line endings, encodings, byte
order marks, undecodable bytes, and malformed regions.

ローカルHTMLをブラウザで直接開いて使える、オフライン対応の書式保持CSVエディタです。
CSVのフィールド値だけを編集し、区切り文字、引用符、空白、改行コード、文字コード、
BOM、不正なCSV領域などを可能な限り保持します。

> **Note on the name**: despite “CSV HTML”, this is **not** a CSV-to-HTML
> converter. It is _a CSV editor that runs directly from a local HTML file._

## The Refrain principle

This tool is not a spreadsheet application that normalizes CSV files. You
edit CSV field **values**; everything else stays unchanged wherever possible.
A normal save never:

- unifies line-ending styles or delimiters,
- alters the header layout,
- adds or removes whitespace,
- adds or removes quotes unnecessarily,
- adds or removes BOMs,
- repairs malformed CSV,
- removes or replaces undecodable bytes in unmodified fields.

## The preservation guarantee

### Byte-identical unedited saves

When a file is opened and saved normally (Ctrl+S / Cmd+S) without any edits,
the saved output is **byte-for-byte identical** to the original input. The
application saves the originally loaded bytes directly; it never reserializes
an unedited document. This covers:

- UTF-8, UTF-8 with BOM, Shift_JIS / CP932, and EUC-JP
- CRLF, LF, CR, and mixed line endings
- files with no final newline
- whitespace around delimiters, and inside/outside quoted fields
- escaped quotes (`""`), empty fields, header-only and empty files
- unclosed quotes, bare quotes, invalid text after a closing quote
- inconsistent field counts across rows
- undecodable bytes

### Minimal-diff edits

When you edit a field, only the byte range of that field is reserialized:

- Unmodified fields, delimiters, record terminators, surrounding whitespace,
  and malformed regions keep their original raw bytes.
- A field that was quoted stays quoted; its whitespace outside the quotes is
  preserved.
- An unquoted field gains quotes only when the new value contains the
  delimiter, a quote, or a newline; any `"` inside the value is escaped
  as `""`.

### Where exceptions apply

Full byte preservation applies to a **normal save with no options changed**.
It does not apply when you explicitly ask for a transformation:

- **Encoding conversion** (Save with Options) re-encodes the whole document.
  Quoting, whitespace, delimiters, and record structure are still preserved,
  but undecodable bytes cannot survive re-encoding (they become replacement
  characters).
- **Line-ending conversion** rewrites record terminators only; a missing
  final newline is never added.
- **BOM include/omit** adds or removes exactly the three UTF-8 BOM bytes.
- **Editing a field** replaces that field's bytes, including any malformed
  trailing text that was part of its displayed value. If an edited field
  originally contained undecodable bytes, a warning is shown before saving.
- **Unrepresentable characters**: if the output encoding cannot represent a
  new character (e.g. emoji in CP932), the save is cancelled by default. You
  may explicitly continue, in which case those characters are written as
  numeric character references such as `&#128512;` and a report tells you
  which cells were affected and how many replacements were made.

## Encodings

Supported: **UTF-8** (with or without BOM), **Shift_JIS / CP932**, **EUC-JP**.

Not supported in this release: UTF-16 and ISO-2022-JP. If a file looks like
one of these, a warning explains the supported range; the file still opens
with a best-effort interpretation and its bytes remain untouched.

Encoding is detected automatically (strict UTF-8 validation plus Japanese
encoding heuristics via the locally bundled `encoding-japanese` library).
When detection is uncertain, CP932 is presented as the candidate. Use
**File > Reopen with Encoding…** to change the encoding or delimiter
interpretation at any time — reinterpreting never alters the original bytes.
Undecodable bytes display as replacement characters (�) but are preserved on
save unless their field is edited.

The status bar always shows the current encoding interpretation, BOM state,
delimiter, line-ending style, file size, and undecodable-byte warnings.

## Opening structurally invalid CSV

When a file is opened, its structure is parsed at the byte level and
problems are listed in a **CSV Validation Results** dialog with row, column,
problem type, and a short explanation:

- unclosed quotes
- invalid text immediately after a closing quote
- bare quotes inside unquoted fields
- inconsistent field counts across rows
- structurally ambiguous content (line breaks inside an unclosed quote)

Nothing is ever repaired or normalized. You choose **Open Anyway** (malformed
regions are preserved byte-for-byte as long as you don't edit them) or
**Cancel**.

## Using the editor

### Opening files

- **File > Open** or **Ctrl+O / Cmd+O**.
- Drag & drop files anywhere in the window (the whole window highlights as a
  drop target). Each dropped file opens in its own tab. Files without a
  CSV-like extension (`.csv`, `.tsv`, `.txt`) prompt before opening.
- Files over the configured size limit (**512 MiB** by default) are refused
  before their bytes are read into memory. The limit is adjustable in
  **File > Settings…** (see Settings).
- If the same file is already open, its existing tab is activated instead.
  Strict file identity is not always detectable through browser file APIs;
  the app compares writable file handles when available and otherwise falls
  back to matching the name and content, so two different files that happen
  to be byte-identical with the same name are treated as the same.

### Editing cells

- Click a cell to select it; double-click, press **F2**, or just start
  typing to edit inline. Inline editing never shifts the table layout.
- The **formula bar** above the grid edits the selected cell and supports
  multi-line values: **Enter** applies and moves down, **Alt+Enter** inserts
  a newline, **Esc** restores the value the cell had when selected.
- **Enter** moves to the next row; **Esc** cancels the in-progress edit.
- Edited cells are tinted yellow; hovering one shows the original value as a
  plain-text tooltip.
- Right-click a cell for **Revert Cell to Original**; **Edit > Revert All
  Edits** discards every edit (undoable in one step).
- Selected rows are highlighted while unselected rows keep their alternating
  (zebra) background colors.

### Undo / Redo

- **Ctrl+Z / Cmd+Z** undoes; **Ctrl+Y**, **Ctrl+Shift+Z**, or
  **Cmd+Shift+Z** redoes.
- Typing within one cell edit is grouped into a single undo step (one step
  per commit).
- **Replace All** and **Revert All Edits** are atomic: one Undo reverses the
  whole operation.
- After a successful save, the saved bytes become the new baseline and
  history is cleared.

### Find and Replace

- **Ctrl+F / Cmd+F** opens Find; **Ctrl+H / Cmd+H** opens Replace.
- Next / Previous with wrap-around; match counts (occurrences and matching
  cells) update as you type. Search operates on current cell values.
- **Match case** option; case-insensitive search safely folds at least ASCII.
- **Regular expression** mode uses JavaScript regex syntax. Replacement
  supports `$1`–`$9`, `${name}`, `$&`, and `$$`. Invalid patterns show the
  compile error inline instead of crashing. As a safeguard against
  catastrophic backtracking, patterns are limited to 1024 characters and
  searches stop with a warning if they exceed a time budget.
- **Replace** replaces the occurrences in the currently selected matching
  cell, then advances; **Replace All** replaces everywhere as one undoable
  operation.

### Tabs

- Multiple files open as tabs; a newly opened file always becomes active.
- Unsaved tabs show a `●` dirty indicator.
- **Ctrl+W / Cmd+W** closes the active tab (browsers may reserve this
  shortcut for closing the browser tab; the menu and the × button always
  work). **Ctrl+Tab** or **Ctrl+PageDown / PageUp** switch tabs (Ctrl+Tab is
  also reserved by some browsers).
- Closing a modified tab asks **Save / Discard / Cancel**. When leaving the
  page with modified tabs, browsers do not allow custom dialogs, so the
  browser's standard leave-page confirmation appears instead.

### Saving

- **Normal save (Ctrl+S / Cmd+S)** is fully byte-preserving: unedited
  documents are written as the exact original bytes; edited documents change
  only the edited field ranges.
- **Save with Options (Ctrl+Shift+S)** lets you choose:
  - Encoding: Keep original / UTF-8 / Shift_JIS (CP932) / EUC-JP
  - UTF-8 BOM: Keep original / include / omit
  - Line endings: Keep original / CRLF / LF / CR

  Choosing a different encoding re-encodes the entire document (the dialog
  warns about this). The other options are surgical byte-range edits.

#### Overwrite saves vs. download saves

- Where the **File System Access API** is available (Chromium-based
  browsers, including many `file://` contexts), saving writes directly back
  to the original file after the browser's permission prompt.
- Otherwise — Firefox, Safari, denied permission, or restricted contexts —
  saving falls back to a **download**: the browser manages the save location
  (typically the Downloads folder) and generates a file with the tab's
  filename. **The original file is not overwritten**, and the app never
  pretends it was: a notification tells you which kind of save happened,
  and errors (denied permission, failed download) are reported clearly.
- Files opened via drag & drop get a writable handle only in browsers that
  support `getAsFileSystemHandle`; otherwise they save as downloads.

### Settings

**File > Settings…** opens a dialog for local preferences. Currently it holds
the **maximum file size** accepted when opening a file. The default is
512 MiB; you may choose any value from **16 MiB to 2 GiB**. The limit is
enforced _before_ a file's bytes are read into memory.

Raising the limit does **not** guarantee that a large file will open: browser
memory, device resources, and file complexity still impose practical limits,
and files of hundreds of megabytes may be slow to render and edit. The
setting is stored only in `localStorage` and is never transmitted anywhere.

### Language

Japanese and English are both first-class UI languages. The initial language
follows the browser (Japanese environments start in Japanese); switch at any
time via the **Language / 言語** menu. The preference is stored only in
`localStorage` and is never transmitted anywhere.

### Accessibility

Core operations work with the keyboard alone (menus, grid navigation and
editing, find/replace, dialogs). Dialogs use the native `<dialog>` element
with focus trapping, ARIA labels are provided throughout, and the UI uses a
high-contrast system font stack that renders Japanese text clearly — no
external fonts are loaded.

## Running via `file://`

The build output is completely static and self-contained:

1. Get `dist/` (build it yourself or download a release ZIP).
2. Open `dist/index.html` (or `index.html` inside the extracted ZIP)
   directly in a browser — double-click it or press Ctrl+O in the browser.

There is no dev server requirement, no backend, no browser extension, no
CDN, and no network access of any kind. The bundle is a classic (non-module)
script specifically so it works under `file://` in Chromium, and a
restrictive Content Security Policy (`connect-src 'none'`, no external
sources) blocks external connections.

### Browser differences and known limitations

| Capability                              | Chrome / Edge (Chromium)        | Firefox           | Safari            |
| --------------------------------------- | ------------------------------- | ----------------- | ----------------- |
| Run from `file://`                      | ✔                               | ✔                 | ✔                 |
| Overwrite save (File System Access API) | ✔ (with permission prompt)      | ✘ → download save | ✘ → download save |
| Writable handle from drag & drop        | ✔                               | ✘                 | ✘                 |
| Ctrl+W / Ctrl+Tab shortcuts             | usually reserved by the browser | usually reserved  | usually reserved  |

- `localStorage` may be unavailable in some `file://` configurations; the
  language preference then simply isn't persisted.
- The browser's standard leave-page dialog (not a custom one) appears when
  closing the page with unsaved changes.

## Development

Requirements: Node.js ≥ 20 and npm, or Docker.

```sh
npm ci                 # install exact locked dependencies
npm run dev            # Vite dev server (development only; the product itself needs no server)
npm run build          # type-check + production build into dist/
npm run test           # vitest (unit, property-based/fuzz, jsdom UI tests)
npm run lint           # eslint
npm run format         # prettier --write
npm run format:check   # prettier --check
```

### Docker

A reproducible environment is provided via `Dockerfile` + `compose.yaml`
(dependencies live in a named volume, never in the host tree):

```sh
docker compose run --rm app npm ci
docker compose run --rm app npm run format:check
docker compose run --rm app npm run lint
docker compose run --rm app npm run test
docker compose run --rm app npm run build   # writes dist/ to the host
docker compose up dev                       # dev server on http://localhost:5173
```

### Project layout

```text
src/
  core/   lossless document model, byte-level CSV parser, serializer,
          encoding, validation, history, search — DOM-independent, unit-tested
  app/    tabs & app state, command layer, file access, i18n
  ui/     menu bar, toolbar, tabs, grid, formula bar, find bar, dialogs, status bar
  locales/en.json, ja.json
tests/    identity, fuzz/property-based, editing, encodings, save options,
          validation, history, search, i18n, commands, UI (jsdom)
```

Menu actions, toolbar buttons, keyboard shortcuts, and drag & drop all pass
through the single command layer in `src/app/commands.ts`.

### Tests

`npm run test` covers, among other things: byte-identical unedited saves
across encodings/line endings/malformed inputs, fuzzed identity over
arbitrary byte sequences (fast-check), byte preservation of unmodified
regions under edits, quoting/escaping rules, unrepresentable-character
cancellation and NCR replacement, save options, validation diagnostics,
tabs/dirty state, undo/redo atomicity, search/replace/regex/capture groups,
invalid-regex handling, locale-key parity, XSS-safe rendering, and the save
fallback logic.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to
  `main`: `npm ci`, format check, lint, tests, build, and uploads `dist/` as
  an artifact. It never creates releases and needs no write permissions.
- **Releases** (`.github/workflows/release.yml`) run only when a tag
  matching `v<major>.<minor>.<patch>` is pushed (the tag is validated with a
  regex):

  ```sh
  git tag v1.2.3
  git push origin v1.2.3
  ```

  The workflow re-runs all checks, builds, and publishes a GitHub Release
  with two assets:

  ```text
  refrain-csv-html-v1.2.3-<short-hash>.zip
  refrain-csv-html-v1.2.3-<short-hash>.zip.sha256
  ```

  The ZIP contains the full `dist/` output plus `README.md`, `LICENSE`, and
  `THIRD-PARTY-NOTICES.md`. Verify a download with:

  ```sh
  sha256sum -c refrain-csv-html-v1.2.3-<short-hash>.zip.sha256
  ```

## Security policy

- All input is treated as untrusted: CSV content, filenames, search terms,
  regular expressions, replacement strings, and `localStorage` data.
- Cell content is never interpreted as HTML — the UI renders exclusively via
  `textContent`; there is no `innerHTML`, `eval`, `new Function`, or dynamic
  script execution anywhere, and the CSP forbids inline scripts.
- Malformed CSV, huge inputs, undecodable bytes, and invalid regexes are
  handled without crashing; regex execution is bounded (pattern length limit
  and a time budget) to avoid catastrophic backtracking.
- The application makes **no network connections at runtime**: no CDN,
  external scripts/styles/fonts/images, APIs, analytics, or telemetry. The
  CSP sets `connect-src 'none'` and `default-src 'none'`.
- The repository and build output contain no secrets or credentials.

### CSV injection warning

Values beginning with `=`, `+`, `-`, or `@` may be interpreted as **formulas**
by spreadsheet software (Excel, LibreOffice, Google Sheets) when the saved
CSV is opened there. In keeping with the Refrain principle, this application
**never silently modifies, escapes, or prefixes your values** as a
mitigation — be careful when opening CSV files from untrusted sources in
spreadsheet software. The Save with Options dialog carries the same warning.

## Limitations

- No row/column insertion or deletion, sorting, or filtering in this
  version — only editing existing field values.
- The whole file is kept in memory, with a configurable safety limit
  (**512 MiB** by default, adjustable from 16 MiB to 2 GiB in Settings); larger
  files are refused with an explanation. Files in the hundreds of megabytes
  may be slow to render and edit (rows render incrementally as you scroll).
- UTF-16 and ISO-2022-JP are not supported.
- Full byte preservation applies to normal saves; explicit encoding /
  line-ending / BOM conversions and edited fields are transformed as
  described above.

## License

MIT License, Copyright (c) 2026 0x0da160 — see [LICENSE](LICENSE).
Bundled third-party software is documented in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
