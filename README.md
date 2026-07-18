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

This is release **v0.1.1**. The version is defined once in `package.json` and
surfaced through the app (**Help > About / Keyboard Shortcuts** shows it), the
metadata written into saved `.rcsv` files, and the release artifact name.

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

The command surface is **menu-first**: a desktop-style menu bar is the single
visible set of commands (there is no separate toolbar duplicating it). Every
command is also reachable by keyboard shortcut, context menu, or direct grid
interaction.

### New documents

- **File > New** or **Ctrl+N / Cmd+N** creates a blank document in a new active
  tab. New documents are **RCSV spreadsheet** documents (a blank spreadsheet may
  gain formulas, structural edits, metadata, and user-defined dimensions that
  plain CSV cannot hold), starting at a small usable grid of **100 rows × 26
  columns**.
- A new document is **unsaved** until you save it; the first save prompts for a
  filename and location (subject to browser support, otherwise a download) and
  writes an `.rcsv` file. Creating a new tab never modifies any other open
  document.

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
with focus trapping, and ARIA labels are provided throughout (including the
busy/loading indicator and the formula autocomplete listbox).

### Fonts

Two CSS variables define the type roles:

- `--font-ui` — `"Yu Gothic UI", "Yu Gothic", "Meiryo UI", sans-serif` — the
  menu bar, menus, dialogs, buttons, labels, forms, notifications, and general
  application chrome.
- `--font-sheet` — `"BIZ UDゴシック", "BIZ UDGothic", "ＭＳ ゴシック", "MS Gothic", monospace`
  — the grid, row/column headers, cell values, the formula bar, and the inline
  cell editor.

No fonts are loaded from a CDN, remote URL, or bundled file; the app relies on
the local/system fallback stack. Actual rendering therefore depends on the
fonts installed on your system, and the final `sans-serif` / `monospace`
fallbacks keep the UI usable when the preferred families are absent.

## Spreadsheet mode (RCSV)

Plain CSV cannot hold formulas, structural editing intent, or per-document
metadata without breaking the byte-preservation guarantee. So those features
live in a separate **spreadsheet document** saved as `.rcsv`. Converting a CSV
is always explicit and never touches the original `.csv` on disk.

### Converting a CSV to a spreadsheet

There are two ways to convert, both explicit and confirmed:

- **File > Convert to Spreadsheet (RCSV)…** converts up front. It uses the CSV's
  current (including unsaved) contents and opens the result in a **new** `.rcsv`
  tab; the source CSV tab and the file on disk stay open and unchanged. The
  command is enabled only for a CSV document that has not already been
  converted, and it shows a loading indicator while the sheet is built.
- **Implicit conversion** happens when an edit needs it — entering a formula,
  pasting a block that must grow the grid, inserting or deleting rows/columns,
  or filling. After a confirmation, the current tab is converted in place:
  renamed to `.rcsv` and detached from the original file handle, so the source
  `.csv` can never be silently overwritten.

**File > Export as CSV…** writes the computed values back out to CSV (a lossy
export: formulas become their results).

### Formulas

- A cell whose input begins with `=` is a formula. The grid shows the computed
  value; the formula bar shows the underlying expression.
- Supported functions: **SUM, AVERAGE, MIN, MAX, COUNT, IF**. Operators
  `+ - * / ^`, parentheses, comparisons, and numeric/string/boolean literals
  are supported. The engine is a hand-written parser/evaluator — there is no
  `eval` or `new Function`, and loading a document never executes anything.
- References may be single cells (`A1`), rectangular ranges (`A1:B3`), and
  **whole columns or rows** (`A:A`, `A:C`, `1:1`, `2:10`), bounded to the used
  grid. Circular references resolve to `#CYCLE!` rather than hanging;
  `#REF!`, `#DIV/0!`, `#NAME?`, and `#ERROR!` are reported per cell.
- Inserting or deleting rows/columns rewrites references in the whole sheet as
  one atomic, undoable operation.

### Formula autocomplete and pointer references

Both formula-input surfaces — the **formula bar** and the **inline cell editor**
— behave identically:

- While typing a formula (text beginning with `=`), a function-name
  **autocomplete popup** lists matching functions with their signatures and
  localized descriptions. Arrow keys move the highlight; **Enter** or **Tab**
  inserts the function; **Esc** dismisses. Ordinary (non-formula) cell editing
  shows no suggestions.
- While editing a formula, **clicking or dragging cells in the grid** inserts
  their reference (`A1` or `A1:B3`) at the caret instead of moving the selection
  — the reference updates live as you drag.
- Parsing is entirely string-based; there is no `eval`, `new Function`, or
  dynamic code execution.

### Fill handle, drag-copy, and Fill Down

- The selection's bottom-right corner has a **fill handle**; drag it down or
  right to copy the selected block, tiling its pattern and adjusting relative
  references. **Ctrl+D / Cmd+D** (Fill Down) fills the selection from its top
  row. Each fill is one atomic undo step.

### Resizable columns and auto-fit

- Drag a column-header boundary to resize; **double-click** it to auto-fit to
  the visible content. Widths are per-document for the session; plain CSV bytes
  are never mutated by resizing, and spreadsheet documents persist widths in
  their container.

### Selection statistics

- Selecting more than one cell shows **count, non-empty, numeric, sum,
  average, min, and max** in the status bar. A cell contributes to the numeric
  aggregates only when its displayed value trims to a finite number; blanks,
  text, booleans, error codes, and non-finite values are ignored.

### The `.rcsv` file format

`.rcsv` is a compact, versioned **binary container**: magic bytes, a header
with an uncompressed-length field and a CRC-32 checksum, and a
DEFLATE-compressed body. It holds inert data only (no code, macros, external
references, or URLs); loading validates magic, version, checksum, shape, and
size bounds, and enforces a decompression ceiling so a crafted file cannot
exhaust memory. The full specification is in
[docs/rcsv-format.md](docs/rcsv-format.md).

## Performance and responsiveness

Perceived responsiveness is treated as a feature: the goal is immediate
visual feedback and an interactive UI even while large documents are being
processed, not just raw throughput.

- **Rust/WASM data core.** The performance-critical byte-level work — CSV
  parsing, validation, delimiter sniffing, indexing, serialization planning,
  `.rcsv` DEFLATE compression and CRC-32, selection-statistic reduction, and
  long literal searches — is implemented in **Rust compiled to WebAssembly**.
  The WASM binary is embedded in the bundle as Base64 and instantiated
  locally; it is **never fetched**, so the app still runs from `file://`. A
  TypeScript fallback with byte-exact, parity-tested semantics runs where
  WebAssembly is unavailable. The engine initializes **in the background at
  startup** — the UI builds and paints without waiting for it, and the first
  file open awaits the same idempotent initialization, so it still parses
  with the fast engine.
- **Virtualized grid, in-place repaint.** Only the visible rows and columns
  (plus a small overscan) exist in the DOM, so files with hundreds of
  thousands of rows never materialize millions of cells. A single-cell edit,
  a formula recalculation result, or a selection change **repaints the
  existing cells in place** — the visible window is only torn down and
  rebuilt when a layout input actually changes (document, dimensions, row
  height, sticky row, locale).
- **Frame-coalesced interactions.** Scrolling re-renders are scheduled with
  `requestAnimationFrame` (the scroll listener is passive); drag selection,
  column resizing, and the fill-handle preview apply their first event
  immediately and coalesce the rest to at most one update per frame. Range
  drags render a lightweight preview and commit the real operation on
  release.
- **Deferred selection statistics.** Selecting a range updates the visible
  selection immediately. Statistics for selections up to 20,000 cells compute
  synchronously (imperceptible); larger selections show a localized
  **"Calculating…"** state in the status bar (announced politely via its
  `role="status"` region) while a time-sliced background scan fills the
  numbers in. A newer selection, edit, or tab switch cancels the stale scan.
- **Time-sliced long scans with progress.** Replace All scans the document in
  ~12 ms slices, yielding to the browser between slices so input and painting
  stay live, and reports percentage progress in the loading indicator. The
  mutation itself is then applied **synchronously and atomically** as one
  undoable operation — a cancelled or superseded scan never leaves a
  partially-replaced document. Match-count updates in the find bar are
  debounced, and full-document search is bounded by a wall-clock budget with
  partial results rather than a freeze.
- **Lazy, memoized formula evaluation.** Formula cells evaluate on demand
  with memoization; only the cells actually displayed (visible window, status
  bar) are computed, so a simple edit never triggers a full-sheet
  recalculation pass.
- **Accessible busy states.** Data-volume-dependent operations show a
  non-blocking loading indicator (`role="status"`, `aria-live="polite"`,
  `aria-busy`) with a localized operation label: opening/parsing a file,
  converting a CSV to RCSV, saving/compressing an `.rcsv`, exporting to CSV,
  and Replace All. The indicator is painted before the work begins and always
  cleared afterward (even on error).

**Measurements.** Reproducible benchmarks live in `bench/` (`npm run bench`,
deterministic in-code fixtures — 200,000-row CSVs, million-cell selections,
100,000-cell containers, formula dependency chains). Results for the current
revision, the reference environment, and manual browser-profiling steps are
documented in [docs/performance.md](docs/performance.md). Responsiveness
_structure_ (bounded DOM, in-place repaint, deferred statistics, sliced scans,
prompt busy feedback) is locked in by deterministic tests
(`tests/perf.test.ts`, `tests/virtual-grid.test.ts`).

**Limits.** The responsiveness targets are engineering goals for the
documented reference environment, not guarantees for every browser or device.
Practical ceilings come from browser memory (documents are held in memory;
the configurable open limit defaults to guarding against accidental huge
opens), single-threaded JavaScript for DOM work, and file complexity (very
wide sheets, extremely long cell values, or dense formula graphs cost
proportionally more). The `.rcsv` decompression ceiling is 512 MiB.

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
npm run bench          # performance benchmarks (see docs/performance.md)
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
  core/     lossless document model, byte-level CSV parser, serializer,
            encoding, validation, history, search, formula engine, stats,
            RCSV spreadsheet document + binary codec — DOM-independent, unit-tested
  app/      tabs & app state, command layer, file access, settings, i18n,
            version (single authoritative app name/version source)
  ui/       menu bar, tabs, grid, formula bar + shared formula autocomplete,
            find bar, dialogs, status bar, loading overlay
  wasm-gen/ generated: embedded WASM (Base64) + wasm-bindgen glue
  locales/  en.json, ja.json
wasm/       Rust crate compiled to WebAssembly (CSV core, DEFLATE + CRC-32,
            stats/search primitives)
docs/       rcsv-format.md (binary .rcsv container specification),
            performance.md (benchmark results + profiling guide)
bench/      reproducible performance benchmarks (npm run bench)
tests/      identity, fuzz/property-based, editing, encodings, save options,
            validation, history, search, formulas, stats, spreadsheet,
            RCSV binary codec, WASM/JS parity, i18n, commands, UI (jsdom),
            responsiveness regression tests (perf)
```

Menu actions, keyboard shortcuts, context menus, and drag & drop all pass
through the single command layer in `src/app/commands.ts`.

### Tests

`npm run test` covers, among other things: byte-identical unedited saves
across encodings/line endings/malformed inputs, fuzzed identity over
arbitrary byte sequences (fast-check), byte preservation of unmodified
regions under edits, quoting/escaping rules, unrepresentable-character
cancellation and NCR replacement, save options, validation diagnostics,
tabs/dirty state, undo/redo atomicity, search/replace/regex/capture groups,
invalid-regex handling, locale-key parity, XSS-safe rendering, and the save
fallback logic. Spreadsheet coverage adds: the formula engine (functions,
operators, whole-column/row ranges, cycle detection, error codes), function
autocomplete and pointer-entered references in **both** the formula bar and the
inline cell editor, the fill handle / Fill Down, selection statistics, blank
new-document creation, the explicit CSV→RCSV convert-to-new-tab command, the
binary `.rcsv` container (round-trip, magic/version, checksum, decompression
bounds, store and DEFLATE paths, and application-version metadata), and
byte-exact WASM/JS parity for parsing, serialization planning, stats reduction,
and literal search. Responsiveness regressions are guarded by deterministic
structural tests: bounded DOM for 100,000-row files, in-place repaint for
single-cell edits, deferred large-selection statistics with a "Calculating…"
state, and time-sliced atomic Replace All with progress and cancellation.

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to
  `main`: `npm ci`, format check, lint, tests, build, and uploads `dist/` as
  an artifact. It never creates releases and needs no write permissions.
- **Releases** (`.github/workflows/release.yml`) run only when a tag
  matching `v<major>.<minor>.<patch>` is pushed (the tag is validated with a
  regex, and must match the `version` in `package.json` — the single
  authoritative version source, currently **`0.1.1`**):

  ```sh
  git tag v0.1.1
  git push origin v0.1.1
  ```

  The workflow re-runs all checks, builds, and publishes a GitHub Release
  with two assets:

  ```text
  refrain-csv-html-v0.1.1-<short-hash>.zip
  refrain-csv-html-v0.1.1-<short-hash>.zip.sha256
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
- `.rcsv` files hold inert data only — cell inputs plus small descriptive
  metadata (the creating/updating application name and version). Loading
  validates the magic bytes, version, CRC-32 checksum, structure, and size
  bounds, and enforces a decompression ceiling so a crafted (bomb) payload
  cannot exhaust memory. Formulas are parsed and evaluated by a sandboxed
  engine, never executed.
- The Rust/WebAssembly core is embedded in the bundle as Base64 and
  instantiated from those bytes locally — it is never fetched from a URL,
  server, or CDN.
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

- Plain CSV editing preserves bytes and offers no formulas or structural
  changes; those require an explicit conversion to a `.rcsv` **spreadsheet
  document** (see Spreadsheet mode). Sorting and filtering are not available in
  this version.
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
