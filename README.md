# Refrain Sheet

A local-first, format-preserving CSV and spreadsheet editor.

**[Web App](https://0x0da160.github.io/refrain-sheet/)** · **[Releases](https://github.com/0x0da160/refrain-sheet/releases/)**

Refrain Sheet is a local-first, offline CSV and spreadsheet editor that runs
directly from a local HTML file. It preserves CSV files as faithfully as
possible while supporting lightweight spreadsheet editing through RSF.
Open `index.html` directly in a browser; no installation, server, account,
or network connection is required.

“Refrain” means refraining from touching your original CSV unnecessarily.
Edit field values while preserving everything else as faithfully as possible:
delimiters, quoting, surrounding whitespace, line endings, encodings, byte
order marks, undecodable bytes, and malformed regions. Spreadsheet-only
features (formulas, structural edits, per-document metadata) are provided
through **RSF (Refrain Sheet Format)**.

ローカルで動く、書式保持CSV・スプレッドシートエディタです。
CSVのフィールド値だけを編集し、区切り文字、引用符、空白、改行コード、文字コード、
BOM、不正なCSV領域などを可能な限り保持します。

The version is defined in `package.json` and surfaced through the app
(**Help > About / Keyboard Shortcuts** shows it), the metadata written into
saved `.rsf` files, and the release artifact name.

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

### The initial screen

With no document open — on first launch, and again **whenever the last tab is
closed** — the app shows its initial **welcome screen** instead of an empty tab
strip or a blank grid. It offers the localized entry points: **Open CSV / RSF
File…**, **New RSF Spreadsheet**, a drag-and-drop hint (dropping files
anywhere in the window always works), and a short note on offline/local-file
usage. Closing the final tab first completes the ordinary
**Save / Discard / Cancel** flow for unsaved changes; only when the tab
actually closes does the welcome screen return. All document-specific UI state
is cleared with it — selection statistics, formula-bar content, dirty
indicators, encoding/delimiter/file information, and document-dependent menu
items — while **application-level preferences persist** (language, spreadsheet
font, and the configured file-size limit live outside the tab lifecycle).

### New documents

- **File > New** or **Ctrl+N / Cmd+N** creates a blank document in a new active
  tab. New documents are **RSF spreadsheet** documents (a blank spreadsheet may
  gain formulas, structural edits, metadata, and user-defined dimensions that
  plain CSV cannot hold), starting at a small usable grid of **100 rows × 26
  columns**.
- A new document is **unsaved** until you save it; the first save prompts for a
  filename and location (subject to browser support, otherwise a download) and
  writes an `.rsf` file. Creating a new tab never modifies any other open
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
- **Japanese / CJK IME input is safe from the first keystroke.** The grid's
  keyboard target is a permanently mounted, hidden text field (a "sink") that
  keeps focus while you navigate, so an IME composition begun on a selected cell
  starts **inside an already-editable element**. Typing promotes that same
  element in place into the cell editor — never re-parented, never re-focused
  mid-composition — so the first Romaji character joins the composition instead
  of leaking as a literal Latin letter. The initiating key is never synthesized
  from `keydown`/`keypress` or consumed. While a composition is active the
  editor stays mounted and focused, and Enter/Esc/arrows/autocomplete belong to
  the IME (Enter confirms a candidate, never the cell) until composition
  completes. The same guards apply to the formula bar. Editing is driven by
  standard `beforeinput` / `input` / `composition*` events and `isComposing`,
  never by keystroke synthesis.
- Both the inline editor and the formula bar are multi-line: **Alt+Enter**
  inserts a line break at the caret (replacing any selection) without
  committing, navigating, or opening a menu. Multi-line values round-trip
  through CSV (the edited field is quoted per the minimal-diff rules), RSF,
  undo/redo, copy/paste, and Wrap Long Rows (the row grows to fit).
- The **formula bar** above the grid edits the selected cell: **Enter** applies
  and moves down, **Alt+Enter** inserts a newline, **Esc** restores the value
  the cell had when selected.
- **Enter** moves to the next row; **Esc** cancels the in-progress edit.
- Edited cells are tinted yellow; hovering one shows the original value as a
  plain-text tooltip.
- Right-click a cell for **Revert Cell to Original**; **Edit > Revert All
  Edits** discards every edit (undoable in one step).
- Selected rows are highlighted while unselected rows keep their alternating
  (zebra) background colors.

### Copy, paste, and Insert Copied Cells

- **Copy (Ctrl+C)** of any rectangular selection — including many rows × many
  columns — produces tab-separated, newline-separated text (displayed values,
  so formulas contribute their results), pasteable into spreadsheet software.
  An internal clipboard additionally keeps the raw inputs and the copy origin,
  so pasting **within the app** preserves formulas and adjusts their relative
  references.
- **Paste (Ctrl+V)** pastes a rectangular block starting at the active cell,
  preserving its shape. **Pattern repeat:** when a larger destination range is
  selected and each of its dimensions is an exact multiple of the copied
  block's, the block tiles to fill the whole selection (references adjust per
  tile); otherwise the block is pasted once. In an RSF spreadsheet a paste
  that reaches past the grid **grows it** (undoably, after nothing more than
  the paste itself); a byte-preserving CSV never gains rows or columns
  silently — such pastes require the explicit RSF conversion.
- **Edit > Insert Copied Cells…** (also on the cell context menu) inserts the
  most recently copied block at the selection by **shifting existing cells
  right or down**. Shifting down inserts whole rows across the sheet; shifting
  right inserts whole columns — this keeps every formula consistent: existing
  references adjust exactly like Insert Rows/Columns, and relative references
  inside the inserted formulas shift by their offset from the copied location.
  The insertion (structure + formula rewrites + values) is **one atomic undo
  step**. Structural insertion is spreadsheet-only, so on a CSV document the
  command explains and offers the explicit RSF conversion first. Large pastes
  and insertions run behind the loading indicator with percentage progress.
- **Edit > Insert Copied Rows** and **Edit > Insert Copied Columns** (also on
  the cell context menu) insert the copied block as whole rows or columns. The
  documented placement rule — also stated by the completion notification:
  copied **rows are inserted above the selection's top row**; copied **columns
  are inserted to the left of the selection's left column**. Copied cells keep
  the columns (rows) they were copied from when the copy origin is known
  (in-app copies); a system-clipboard block of unknown origin starts at column
  A (row 1). The copied row/column count and rectangular structure are
  preserved, existing rows/columns shift without losing data, and formulas
  stay consistent: existing references adjust exactly like Insert
  Rows/Columns, while relative references inside the inserted formulas shift
  by their offset from the copied location. Each insertion is **one atomic
  undo/redo step**; on a CSV document the commands require the explicit RSF
  conversion (declining leaves the document untouched), and large insertions
  report percentage progress. If nothing has been copied yet, running a
  command says so instead of doing nothing.
- **Edit > Select All Cells** selects the used range of the active document
  (the whole logical grid of a new RSF document; an empty CSV reports a clear
  no-data message). **Ctrl+A / Cmd+A** triggers it **only while the grid
  itself has focus** — inside text fields, dialogs, or anywhere else on the
  page the browser's own Select All is never intercepted. Whole-sheet
  selection renders through the virtualized window (no DOM is created for
  off-screen cells), statistics for huge selections show the "Calculating…"
  state while a background scan fills them in, and the selection feeds copy,
  fill, auto-fit of the selected columns, and the row/column commands like any
  other range.
- **Top-left corner control.** The cell at the intersection of the row and
  column headers is an interactive **“Select all cells” button** (localized
  _Select all cells_ / _すべてのセルを選択_). Click or tap it — or focus it with
  the keyboard and press **Enter/Space** — to run the same Select All command.
  While the whole sheet is selected the corner reads as pressed
  (`aria-pressed`), a state kept visually distinct from the active cell, an
  ordinary range, whole-row/whole-column selections, and formula-reference
  highlighting.

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

- **Ctrl+Shift+F / Cmd+Shift+F** opens Find; **Ctrl+Shift+H / Cmd+Shift+H**
  opens Replace. (Plain Ctrl+F and Ctrl+H are left to the browser — see
  [Keyboard shortcuts](#keyboard-shortcuts).) Both are also on the Search menu.
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
- **F8** closes the active tab (the menu and the × button always work too).
  Ctrl+W and Ctrl+Tab are intentionally left to the browser, so switch tabs by
  clicking them in the tab bar.
- **Reorder tabs** by dragging them (an accent bar shows the drop position),
  via **View > Move Tab Left / Right / to Start / to End**, or from a tab's
  right-click context menu. No shortcut is assigned by design: the remaining
  Ctrl/Alt+arrow-style combinations conflict with browser/OS tab and history
  shortcuts, and the commands are fully keyboard-reachable through the menu.
  Moving a tab changes only its position — the document, dirty state,
  selection, undo history, and file association travel with it, the active tab
  stays active, and moves are announced to assistive technologies. Tab order
  lasts only for the session; it is not persisted.
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

### Spreadsheet zoom

**View > Spreadsheet Zoom** scales the spreadsheet area — grid cells, row and
column headers, the formula bar, the inline editor, selection overlays, and
the fill handle — **without changing the application chrome** and without
touching the browser's own page zoom (whose shortcuts are never intercepted).
Levels: 50 / 75 / 90 / 100 / 110 / 125 / 150 / 200 %, plus **Reset Zoom**.

- Zoom is **per tab** and purely visual: it never changes document content,
  never modifies CSV bytes, and never marks a document dirty. Virtualization,
  scrolling, sticky rows, wrapping, column resizing, auto-fit, selection,
  drag operations, and keyboard navigation all work identically at every
  level.
- Column widths are stored **zoom-independently** (px at 100%), so a resized
  or auto-fitted column means the same thing at every zoom level.
- **Persistence.** RSF documents store their zoom (and overridden column
  widths) in the container's display metadata and restore them on reopen; a
  document's stored value takes precedence. The most recently chosen zoom is
  also kept as a local application preference and applies to documents that
  store none (including plain CSV files, which never carry display settings
  in their bytes). See [docs/rsf-format.md](docs/rsf-format.md) for the
  format, bounds, and validation rules.
- **Shortcuts and mouse wheel.** Step through the presets with **Zoom In**
  (**Ctrl+Shift+.**) and **Zoom Out** (**Ctrl+Shift+,**), or **Reset**
  (**Ctrl+Shift+0**); the browser's own zoom keys (**Ctrl +/-/0**) are never
  intercepted. Over the grid, **Ctrl + mouse wheel** (Windows/Linux) or
  **Cmd + mouse wheel** (macOS) zooms around the pointer, keeping the cell
  under the cursor in place; the gesture is consumed only when the grid owns
  the pointer — never in dialogs, text fields, during IME composition, or
  mid-drag, and never as a plain scroll. Every zoom change is announced to
  assistive technology ("Spreadsheet zoom: 125%") and applies instantly with
  no animation (respecting reduced-motion preferences).
- **Alignment.** Text stays vertically centered in every cell at every zoom
  level — the row height, line box, editor, and selection overlays all derive
  from one zoom-scaled sizing model, so nothing drifts at 50 %, 90 %, 125 %,
  200 %, or any other level, for any sheet font or wrapped/multiline content.

### Filtering (RSF)

**Sheet > Filter…** (also the ▼ button in each column header of a filtered
range, and the grid context menu) hides rows that do not match your criteria —
**visually only**. Filtering never deletes, reorders, or rewrites cell data;
row identity, formulas, references, widths, heights, and undo/redo are all
preserved, and formula calculations always use the normal sheet model.

- **RSF only.** Filtering is a spreadsheet feature; on a plain CSV document the
  app explains that filtering requires converting to RSF and changes nothing.
- **Range and header.** The filter covers the selected rectangle, or the
  detected data block around the active cell. The first row is treated as a
  **header** (never hidden) by default; the dialog shows this assumption and
  lets you change it before applying.
- **Criteria.** Text (contains / does not contain / equals / does not equal /
  begins with / ends with / blank / not blank), numeric (=, ≠, >, ≥, <, ≤,
  between), and a searchable, bounded list of the column's distinct displayed
  values. Conditions in one column combine with a documented **AND/OR** choice
  (plus the value list as an extra AND clause); different columns always
  combine with **AND**. The status bar shows the visible-row / total-row count
  while filtered.
- **Hidden-row safety.** Copy, fill, clear, Flash Fill, and selection
  statistics operate on **visible rows only** (a copy of a filtered selection
  is a contiguous block); keyboard navigation skips hidden rows. Row/column
  insertion or deletion clears the active filter as one atomic, undoable step
  (its stored range would otherwise drift). You are told whenever hidden rows
  were skipped or the filter was cleared.
- **Deterministic and offline.** Predicates are plain string/number
  comparisons — no `eval`, `new Function`, regular expressions, or network
  access. Value enumeration and predicate evaluation run in cooperative time
  slices with truthful progress and cancellation for large ranges, and the
  virtualized grid never materializes DOM for hidden rows.
- **Persistence.** The filter is saved in the RSF container (body version 4)
  and restored — fully validated — on reopen. Malformed or unsupported filter
  metadata is ignored with a localized warning rather than corrupting or
  rejecting the document, and older readers safely reject a version-4 body.
  See [docs/rsf-format.md](docs/rsf-format.md).

### Editing help tooltips

The inline-editor / formula-bar usage guidance (Enter commits and moves down,
Alt+Enter inserts a newline, Esc cancels, `=` starts a formula in RSF) is not
persistent screen chrome: it is provided as a **tooltip** on the formula bar
and the inline cell editor, plus an equivalent **ARIA description** announced
to keyboard and screen-reader users on focus. **View > Editing Help Tooltips**
toggles it; the default is **enabled** (sensible for new users). The
preference is stored only locally in `localStorage`, never in any document,
and the tooltips never obscure the active cell, the caret, the autocomplete
list, or IME composition UI.

### Language

Japanese and English are both first-class UI languages. The initial language
follows the browser (Japanese environments start in Japanese); switch at any
time via **View > Language / 表示 > 言語** (a submenu of View — there is no
separate top-level Language menu). The preference is stored only in
`localStorage` and is never transmitted anywhere.

### Accessibility

Core operations work with the keyboard alone (menus, grid navigation and
editing, find/replace, dialogs). Dialogs use the native `<dialog>` element
with focus trapping, and ARIA labels are provided throughout (including the
busy/loading indicator and the formula autocomplete listbox).

### Keyboard shortcuts

Shortcuts are **optional accelerators**: every command is also on the menus (and
most on context menus), so nothing depends on a shortcut. They are chosen to
avoid conflicts with the browser, OS, and assistive technology. Commands are
handled with `KeyboardEvent.key` and modifier state (never the deprecated
`keyCode`), only when the application owns the context, never during IME
composition or ordinary text entry, and `preventDefault()` is called only for a
recognized application command on a cancelable event.

The app **does not** intercept browser-reserved or commonly essential keys,
including new window/tab (Ctrl+N, Ctrl+T), close tab/window (Ctrl+W), reload
(Ctrl+R, F5), history/back-forward (Ctrl+H, Alt+←/→), the address bar (Ctrl+L),
browser find (Ctrl+F, F3), print (Ctrl+P), zoom (Ctrl +/−/0), dev tools (F12),
and browser tab switching (Ctrl+Tab, Ctrl+PageUp/Down). Commands that would
otherwise collide use safe alternatives.

| Command              | Shortcut                               |
| -------------------- | -------------------------------------- |
| New spreadsheet      | **F4**                                 |
| Open file            | Ctrl+O / Cmd+O                         |
| Save                 | Ctrl+S / Cmd+S                         |
| Save with Options    | Ctrl+Shift+S / Cmd+Shift+S             |
| Close tab            | **F8**                                 |
| Next worksheet       | **F7**                                 |
| Previous worksheet   | **Shift+F7**                           |
| Undo / Redo          | Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)      |
| Copy / Paste         | Ctrl+C / Ctrl+V                        |
| Select All Cells     | Ctrl+A / Cmd+A (grid focus only)       |
| Fill Down (grid)     | Ctrl+D / Cmd+D                         |
| Find / Replace       | **Ctrl+Shift+F** / **Ctrl+Shift+H**    |
| Zoom in / out        | **Ctrl+Shift+.** / **Ctrl+Shift+,**    |
| Reset zoom           | **Ctrl+Shift+0**                       |
| Zoom (mouse)         | Ctrl / Cmd + mouse wheel over the grid |
| Find next / previous | Enter / Shift+Enter (in the Find bar)  |
| Edit cell            | F2 (or start typing)                   |
| Extend selection     | Shift+Arrows                           |
| Cancel edit          | Esc                                    |

The same table is shown in **Help > About / Keyboard Shortcuts**. Grid-editing
accelerators (Undo/Redo/Fill Down) are suppressed while a text field or the cell
editor has focus, so ordinary text editing keeps its own behavior; Save and Open
still work from anywhere. **Ctrl+A** is owned only while the grid itself has
focus — everywhere else (text fields, dialogs, the rest of the page) the
browser's own Select All runs untouched. On macOS, Cmd substitutes for Ctrl.

### Fonts

Two CSS variables define the type roles:

- `--font-ui` — `"Yu Gothic UI", "Yu Gothic", "Meiryo UI", sans-serif` — the
  menu bar, menus, dialogs, buttons, labels, forms, notifications, and general
  application chrome.
- `--font-sheet` — the grid, row/column headers, cell values, the formula bar,
  the inline cell editor, and selection overlays. This is the **spreadsheet
  font**, chosen in **View > Spreadsheet Font** (see below).

No fonts are loaded from a CDN, remote URL, or bundled file; the app relies on
the local/system fallback stack. Actual rendering therefore depends on the
fonts installed on your system, and the final `sans-serif` / `monospace`
fallbacks keep the UI usable when the preferred families are absent.

#### Spreadsheet font

**View > Spreadsheet Font** chooses one font family for the whole spreadsheet UI
(grid, headers, numeric and formula values, formula bar, inline editor, and
selection overlays). Choosing a font updates a single document-level CSS
variable (`--font-sheet`); the current choice is shown with a checkmark. Three
local Windows/Office families are offered, each with a monospace fallback chain:

- **BIZ UD Gothic** / **BIZ UDゴシック** (`--sheet-font-biz-ud`) — the default.
- **MS Gothic** / **ＭＳ ゴシック** (`--sheet-font-ms`).
- **MS UI Gothic** (`--sheet-font-ms-ui`).

There is no per-cell font selection in this version. The choice is an
**application-level preference** stored in `localStorage`; RSF documents do not
carry a per-document sheet-font override, so the application preference always
applies and there is no document-vs-application precedence conflict to resolve.
Changing the sheet font is pure display state: it never alters plain CSV bytes
and never converts a CSV to RSF. When a preferred font is not installed, the
declared fallbacks (and finally `monospace`) are used. No font is fetched from a
CDN/remote URL or bundled.

#### Theme (light / dark)

**View > Theme** offers **System default**, **Light**, and **Dark**. New users
start on **System default**, which follows the OS/browser `prefers-color-scheme`
setting and updates **live** when the system theme changes (a `matchMedia`
listener re-applies it). The choice is persisted in `localStorage` and never
transmitted anywhere; the selected spreadsheet font applies unchanged in either
theme, and switching theme is pure display state — it never alters CSV bytes,
RSF data, formulas, calculations, or document semantics.

The theme is a **semantic CSS custom-property system**: `styles.css` defines one
light palette in `:root` and one dark palette under `:root[data-theme="dark"]`,
and every surface (app background, menus, dialogs and overlays, buttons and form
controls, grid background, alternating rows, grid lines, row/column headers,
cell and muted text, the active cell and selected range, formula-reference
highlights, dirty/edited indicators, errors/warnings/success, loading and
progress UI, tooltips, context menus, and scrollbars via `color-scheme`) reads
its colors from those tokens — no scattered hard-coded colors remain.
`src/app/theme.ts` resolves the choice (the `"system"` choice via
`prefers-color-scheme`) and applies it by setting `data-theme` plus
`color-scheme` on the document root before first paint, so there is no flash of
the wrong theme. Selection, formula errors, dirty state, and warnings are never
signalled by **color alone** — they always pair a non-color cue (outline
pattern, corner marker, bold error text, wavy underline), which also keeps them
legible in forced-colors / high-contrast modes.

#### Vertical text centering

Cell text is **vertically centered** by a single explicit typography model, not
by browser baseline behavior: every grid row is exactly `--grid-row-height`
(26 px, kept in sync with the virtualization constant), cells use border-box
sizing with horizontal padding only, and the single-line `line-height` equals
the cell's content height — so the line box itself centers the glyphs. Because
this depends on the line box rather than any font's baseline or half-leading
metrics, it holds identically for BIZ UD Gothic, MS Gothic, MS UI Gothic, and
their fallback stacks, and for Japanese, Latin, numeric, formula-result,
error, and mixed-script values. Row/column headers, the pinned first row, and
formula-result cells share the same model; the inline cell editor is a native
input (vertically centered by the browser) laid over the same box, and
selection outlines, fill handles, and formula-reference highlights attach to
the unchanged cell box. Wrapped rows (see below) opt into a multi-line box that
is **still vertically centered** (via flex), so centering holds whatever a
row's height becomes. The adjustment is pure CSS — no CSV/RSF content,
formulas, stored values, or row structure change because of it.

#### Conditional row-height wrapping

**View > Wrap Long Cell Text** wraps long content — but it grows **only the
rows that actually need more than one visual line**; a row whose cells all fit
their current column widths keeps the normal single-line height. Whether a row
wraps is decided from the **rendered display value** measured under the active
sheet font and the live column width (a formula cell is measured from its
_calculated result_, never its source), honoring explicit newlines
(`\n`), normal word-break opportunities, and long unbroken text that must break
to avoid overflow. Only affected row heights are recomputed after a cell edit,
formula recalculation, column-width change or auto-fit, sheet-font change,
locale change, wrap toggle, row/column insertion or deletion, and large
paste/fill/conversion operations.

For virtualized documents the visible rows are measured immediately and the
off-screen rows are filled in **incrementally in cooperative time slices**
(with a percentage progress label if the pass is long-running), so the grid
never blocks on a synchronous full-document loop. A **row-height index**
(sparse prefix-sum of the rows that grew) keeps scroll offsets, the
virtualization window, keyboard navigation, and the pinned sticky row correct
as heights vary; the pinned first row itself stays single-line so the pinned
area keeps a stable height. Turning wrapping off restores every row to the
single-line height. Row heights are **derived view state** recomputed from
content, column widths, and font — they are never persisted into CSV bytes or
the RSF container, and a value containing explicit newlines is preserved
unchanged when wrapping is off (it simply displays clipped to the first line,
with the full value visible in the formula bar).

## Spreadsheet mode (RSF)

Plain CSV cannot hold formulas, structural editing intent, or per-document
metadata without breaking the byte-preservation guarantee. So those features
live in a separate **spreadsheet document** saved as `.rsf` — **RSF (Refrain
CSV Format)**, the dedicated spreadsheet format used by Refrain Sheet. RSF is
a versioned, compressed binary container (not a JSON document and not a CSV
file); it is **not** a byte-identical representation of an imported CSV.
Converting a CSV is always explicit and never touches the original `.csv` on
disk — plain CSV files keep the byte-preserving, minimal-diff guarantees until
you convert them. See [`docs/rsf-format.md`](docs/rsf-format.md) for the
container specification.

### Workbooks and worksheets

An `.rsf` file is a **workbook** (ブック) that can hold several **worksheets**
(ワークシート / シート). Each worksheet keeps its own grid, formulas,
row/column structure, filter, zoom, column widths, and selection — switching
worksheets restores exactly where you were on that sheet. A new workbook starts
with one worksheet named `Sheet1` (`シート1` in Japanese), and a workbook always
keeps **at least one** worksheet: the last one cannot be deleted.

Worksheets appear in their own strip **below the grid**. That strip is separate
from the document tab strip above it: the top strip lists the open _files_, the
bottom strip lists the _worksheets inside the current workbook_. Reordering one
never affects the other.

Everything is available from the **Sheet** menu, the worksheet strip's context
menu (right-click a worksheet tab), and the keyboard:

| Action              | How                                                            |
| ------------------- | -------------------------------------------------------------- |
| Switch worksheet    | Click a tab, `←` / `→`, `Home` / `End`, or `F7` / `Shift+F7`   |
| Add worksheet       | The `+` button, or Sheet > Add Worksheet                       |
| Rename worksheet    | Double-click a tab, `F2`, or Sheet > Rename Worksheet…         |
| Duplicate worksheet | Sheet > Duplicate Worksheet…                                   |
| Delete worksheet    | Sheet > Delete Worksheet                                       |
| Reorder worksheet   | Drag a tab, `Alt`+`←` / `→`, `Alt`+`Home` / `End`, or the menu |

Drag-and-drop reordering is a convenience only — every reorder has a keyboard
and menu equivalent, and the strip announces the result to assistive
technologies. Worksheet tabs use a roving tabindex, so the whole strip is a
single tab stop.

**Worksheet names** are trimmed, at most 100 characters, unique within the
workbook (ignoring case), and may not contain `:` `\` `/` `?` `*` `[` `]` or
control characters — the characters that would clash with formula-reference
syntax. The rename dialog validates as you type, reports the problem inline in
your language, and is IME-safe (pressing Enter to commit a Japanese candidate
never submits the dialog).

Adding, renaming, duplicating, deleting, and reordering a worksheet are each
**one atomic operation** that Undo reverses completely — including a deleted
worksheet's data and the formula rewrites the change implied. Deleting a
worksheet that holds content, a filter, or non-default display settings asks
for confirmation first, and the confirmation states how many formulas elsewhere
in the workbook will become `#REF!`.

Duplicating a very large worksheet runs in cooperative time slices behind a
percentage progress indicator; the copy is built to the side and inserted only
once complete, so cancelling (or switching documents) leaves the workbook
exactly as it was.

Plain CSV documents are single-sheet by definition. Their worksheet strip shows
a short explanation instead of tabs, and the worksheet commands are disabled —
converting to RSF is what unlocks multiple worksheets.

### Converting a CSV to a spreadsheet

There are two ways to convert, both explicit and confirmed. Either way the
result is a workbook with **one** worksheet populated from the CSV:

- **File > Convert to Spreadsheet (RSF)…** converts up front. It uses the CSV's
  current (including unsaved) contents and opens the result in a **new** `.rsf`
  tab; the source CSV tab and the file on disk stay open and unchanged. The
  command is enabled only for a CSV document that has not already been
  converted, and it shows a loading indicator while the sheet is built.
- **Implicit conversion** happens when an edit needs it — entering a formula,
  pasting a block that must grow the grid, inserting or deleting rows/columns,
  or filling. After a confirmation, the current tab is converted in place:
  renamed to `.rsf` and detached from the original file handle, so the source
  `.csv` can never be silently overwritten.

### Exporting a spreadsheet as CSV

**File > Export as CSV…** writes the computed values back out to plain CSV.

A CSV file holds exactly **one** sheet. So when the workbook has more than one
worksheet, a dialog asks **which worksheet to export** before anything else —
the export never silently takes the active worksheet. The dialog states that
only the chosen worksheet is written and that formulas become their calculated
values, and the exported file name includes the worksheet name so several
exports from one workbook do not collide. A single-worksheet workbook skips
this step (there is nothing to choose) and follows the normal flow, with the
worksheet it will export named in the dialog.

The export options dialog appears next and doubles as the explicit
confirmation — nothing is written until you press **Export CSV**:

- **Encoding:** UTF-8, Shift_JIS / CP932, or EUC-JP.
- **BOM:** include or omit. A byte order mark applies only to UTF-8 (choose
  UTF-8 + include for "UTF-8 with BOM"); the control is disabled — with an
  explanation — for the other encodings.
- **Line endings:** CRLF, LF, or CR, applied exactly to every record.

The dialog states clearly that CSV export is a **lossy conversion**: formulas
are exported as their calculated display values, not expressions, and
RSF-only data — formulas and dependency information, **the other worksheets**,
structure beyond the exported grid, column widths, filters, document metadata,
and font preferences — is not preserved.

Every exported value is **validated against the chosen encoding** in a
time-sliced scan behind the progress indicator. If characters cannot be
represented, a dialog lists the affected cells and the export is **cancelled
by default**; only after explicit confirmation does it continue with the
documented numeric-character-reference replacement (e.g. `&#128512;`), which is
then reported per cell. The export flow never mutates the source `.rsf`
document and never marks it saved; cancellation and errors leave everything
untouched. The file is written through the File System Access API save picker
where available (with the download fallback otherwise), under a suggested
name that replaces `.rsf` with `.csv`.

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
- **Absolute and mixed references** are supported in all four A1-style forms:
  `A1` (relative), `$A$1` (absolute), `$A1` (absolute column), and `A$1`
  (absolute row) — including as range endpoints (`$A$1:B10`, `SUM($A$1:$A10)`)
  and on whole-column/row spans (`$A:C`, `$1:10`). The `$` markers are
  preserved exactly as written when formulas are displayed, stored, and
  rewritten. Copying, pasting, filling, and Insert Copied Cells/Rows/Columns
  shift only the **relative** components; absolute components stay fixed.
  Row/column insertion and deletion adjust absolute and relative references
  alike (both keep pointing at the same data), preserving the markers.
- **Cross-sheet references** address another worksheet of the same workbook:
  `Sheet1!A1`, `Sheet1!A1:B10`, `Sheet1!$A$1`, `SUM(Sheet1!A1:A10)`. Wrap the
  name in single quotes when it is not a plain identifier —
  `'Quarter 1'!A1`, `'Quarter 1'!$A$1:$B10` — and double a literal single
  quote inside it (`'O''Brien'!A1`). An unqualified reference always means the
  current worksheet, and worksheet names match case-insensitively. Circular
  references are detected **across** worksheets. Ranges spanning two
  worksheets (`Sheet1!A1:Sheet2!B2`, "3D" ranges) are deliberately not
  supported and report `#ERROR!` rather than guessing.
- Renaming a worksheet rewrites every reference to it across the workbook
  (re-quoting as needed) without changing any result. Deleting a worksheet
  turns references to it into `#REF!` — never silently redirected to another
  worksheet. Duplicating a worksheet copies formulas verbatim: qualified
  references still point at the worksheets they name, while unqualified ones
  stay relative to the copy.
- Inserting or deleting rows/columns rewrites references in the whole worksheet
  — **and** `Name!`-qualified references to it from every other worksheet — as
  one atomic, undoable operation. A formula's own unqualified references are
  never moved by an edit on a different worksheet.
- Formula cells are shown **upright, never italic** (italic hurts CJK
  legibility). They are differentiated by a subtle green tint and a small
  non-italic corner marker; error cells show the literal error code (e.g.
  `#DIV/0!`) in bold, so the state is clear without relying on color or italic.

### Formula and function help

**Help > Formula and Function Help** opens a searchable, keyboard-accessible
panel documenting the formula language entirely offline: syntax, cell
references (`A1`), ranges (`A1:B10`), whole-column/row ranges (`A:A`, `A:C`,
`1:1`, `2:10`), operators, every supported function (signature, description, and
a worked example), and the error codes (including circular references →
`#CYCLE!`). The function list, the autocomplete metadata, and the evaluator all
read one shared source of truth (`FUNCTION_INFOS` / `SUPPORTED_FUNCTIONS`), so
documented functions cannot drift from implemented ones — a test enforces this.

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

### Formula-reference highlighting

While a formula is being edited (in either surface), every range it references
is **highlighted live in the grid**: single cells (`A1`), rectangular ranges
(`A1:C10`), whole columns (`A:A`, `A:C`), whole rows (`1:1`, `2:10`), and any
mix of them in one formula. Highlights update as you type, accept an
autocomplete suggestion, or insert a reference by clicking/dragging cells.

- Distinct references cycle through four **color + pattern pairs** (solid,
  dashed, dotted, double borders with different background patterns), so they
  are distinguishable without relying on color alone; the referenced ranges
  are also exposed to assistive technologies as an accessible description of
  the formula field.
- Highlighting is a tolerant text scan, fully separate from the ordinary
  selection/active-cell rendering: incomplete or invalid reference syntax
  mid-edit simply highlights fewer ranges (never crashes, never leaves stale
  highlights — clearing the edit clears the highlight).
- It is virtualization-aware: only the rendered cells are touched, whole-row/
  column references clamp to the used grid, and a floating status note (also
  announced politely) appears when a referenced range extends beyond the
  visible viewport.

### Fill handle, drag-copy, Fill Down, and numeric series

- The selection's bottom-right corner has a **fill handle**; drag it down or
  right to copy the selected block, tiling its pattern and adjusting relative
  references. **Ctrl+D / Cmd+D** (Fill Down) fills the selection from its top
  row. Each fill is one atomic undo step.
- **Numeric series (AutoFill).** A purely vertical or purely horizontal fill
  whose seed lane holds **two or more** numbers forming an arithmetic
  progression continues the series instead of merely repeating it:
  `1, 2, 3` → `4, 5, 6`; `2, 4` → `6, 8`; `10, 7` → `4, 1`. The step is
  inferred per column (or per row) independently and continuation values keep
  the seeds' own decimal precision (`0.1, 0.2` → `0.3`, never float noise).
  Documented fallbacks — never a guess: a **single** numeric seed copies its
  value; **formulas** keep relative-reference translation (never series
  inference); and **non-numeric, mixed, or non-linear** seeds keep the plain
  copy/tile behavior. As with every structural fill, this applies in RSF mode
  only (a CSV document is offered the explicit conversion first).

### Flash Fill

**Edit > Flash Fill…** (also on the cell context menu) fills a column by
inferring a pattern from examples you already typed — entirely **offline and
deterministic**: no cloud service, no AI model, no telemetry, no dynamic code.

- Type one or more example results at the top of a target column (e.g. the
  full name built from a first-name and last-name column), select a cell in
  that column, and run Flash Fill.
- The engine searches a fixed set of **safe text transformations** of the
  row's other columns: copying a column, joining columns with constant literal
  separators, taking a part of a delimiter-separated value (split), constant
  prefixes/suffixes, and simple casing normalization when the examples
  demonstrate it.
- A transformation is proposed **only** when it reproduces every example
  exactly _and_ every matching candidate agrees on every cell to be filled.
  Ambiguous examples (two patterns that would fill differently) change
  nothing — a localized explanation shows the conflicting outputs and asks for
  one more example instead of guessing.
- Before anything is applied you get an **accessible preview**: the inferred
  operation in plain words, the affected range, the number of cells, a
  bounded before/after sample, and — when any non-empty cell would be
  overwritten — an explicit, counted overwrite warning. Applying requires
  pressing the confirm button; cancelling (or Escape) leaves the document
  untouched.
- Applying is **one atomic, undoable operation** (a single Ctrl+Z restores
  every cell). Large blocks are analyzed in cooperative time slices with an
  honest percentage, and the operation aborts cleanly — changing nothing — if
  the document changes meanwhile.
- Flash Fill is **RSF-only**. On a plain CSV document it explains that
  structural multi-cell operations require the explicit conversion to RSF
  (Sheet > Convert to Spreadsheet (RSF)…) and changes nothing. No keyboard
  shortcut is claimed (the conventional Ctrl+E is a browser-reserved key);
  the command is fully keyboard-accessible through the menu and context menu.

### Selecting rows, columns, and ranges

- **Drag** across cells to select any rectangular range (many rows × many
  columns). **Shift+Click** extends the range from the anchor; **Shift+Arrows**
  extends by cells.
- Click a **row header** to select the whole row, or a **column header** for the
  whole column. Drag across row/column headers to select several, and
  **Shift+Click** a header to extend the row/column selection.
- The roles are rendered distinctly: the **active cell** has a solid outline,
  the **anchor** (opposite corner) a dashed outline, the **range** a tinted
  fill, and whole-row/whole-column selections additionally highlight their
  headers. Selection rendering is virtualization-correct — the selected
  rectangle is tracked in state, so it stays correct when it extends beyond the
  rendered viewport.
- The selected rectangle feeds copy, paste, the fill handle, formula-reference
  insertion, selection statistics, and the row/column commands unchanged.
  Structural row/column operations still require an explicit conversion to RSF
  for a byte-preserving CSV document.
- The **cell-reference box** (top-left of the formula bar) shows the whole
  current selection, not just the active cell: a single address (`A1`), the
  normalized range regardless of drag direction (`A1:B2`), whole-row (`1:3`)
  and whole-column (`A:C`) forms, and the concrete used range for Select All
  (`A1:Z100`). The display is presentation only — the active cell, anchor, and
  range semantics are unchanged — and it updates immediately after pointer
  drags, Shift+Click / Shift+Arrow, header selection, Select All, filter
  changes, tab changes, undo/redo, and programmatic selection restoration.

### Resizable columns and auto-fit

- Drag a column-header boundary to resize; **double-click** it to auto-fit.
  Auto-fit recalculates the width from current content and **can make a column
  narrower or wider** — it is not grow-only, and nothing is cached between
  invocations, so a stale historic maximum can never prevent narrowing.
- **Auto-fit applies to every selected column.** When whole columns are
  selected (column headers, header dragging, Shift+Click, or any selection
  spanning every row — including Select All) and you double-click a boundary
  inside the selection, **all selected columns fit**; the
  **Sheet > Auto-Fit Column Width** command (also on the context menu) fits
  every column intersecting the current selection. Each column is measured
  **independently** with its own header and values, so columns shrink and grow
  on their own. The selection model is contiguous, so the target is always a
  contiguous column span — there is no non-adjacent multi-selection to
  support. Fitting many columns of a large sheet runs column by column with
  yields to the browser and a **"N of M columns measured" + percentage** busy
  label; if the document changes mid-run the operation aborts and applies
  **no width at all** (all-or-nothing). Column widths are per-tab **view
  state**, not document content: auto-fit never modifies plain CSV bytes and
  is deliberately outside the document undo history (undo remains reserved
  for data changes).
- Auto-fit **measures real rendered pixel widths**, never character counts or
  average-width guesses: `CanvasRenderingContext2D.measureText` is configured
  from the _computed style_ of an actual cell (the active sheet font family,
  size, weight, upright style, and letter spacing), and cell padding/borders
  are read from the computed style and added separately. The **column header
  is included**, and formula cells contribute their **displayed calculated
  values**, never their hidden formula source. Because everything is
  recomputed on demand, edits, recalculation, sheet-font changes, and locale
  changes are reflected on the next auto-fit automatically.
- Virtualized large sheets never render or measure the whole column
  synchronously. The documented strategy: every currently materialized row is
  measured, plus a deterministic, **evenly spaced sample of up to 1000
  off-screen rows** whose display values are read straight from the document
  (no DOM work). When the fit is based on a sample, a notification says so
  honestly. The result is clamped to the configured minimum/maximum widths.
- Manual drag-resizing still works exactly as before. Widths are per-document
  for the session; plain CSV bytes are never mutated by resizing or auto-fit,
  and spreadsheet documents persist widths in their container.

### Selection statistics

- Selecting more than one cell shows **count, non-empty, numeric, sum,
  average, min, and max** in the status bar. A cell contributes to the numeric
  aggregates only when its displayed value trims to a finite number; blanks,
  text, booleans, error codes, and non-finite values are ignored.

### The `.rsf` file format

`.rsf` (**Refrain Sheet Format**) is a compact, versioned **binary container**:
magic bytes (`RSF1`), a header with an uncompressed-length field, a CRC-32
checksum, and a per-file compression method, followed by the compressed body.
It holds inert data only (no code, macros, external references, or URLs);
loading validates magic, version, checksum, shape, and size bounds, and
enforces a decompression ceiling so a crafted file cannot exhaust memory.
Alongside the sheet, the container carries small **non-executable display
metadata** — the spreadsheet zoom and overridden column widths — which is
validated and clamped on load and restored when the document reopens. The
full specification is in [docs/rsf-format.md](docs/rsf-format.md).

> **Legacy `.rcsv` files.** This format was previously named _Refrain CSV
> Format (RCSV)_ with the `.rcsv` extension and magic `RCSV`. Existing `.rcsv`
> files are **read transparently** as a legacy import: opening one migrates the
> in-memory document to `.rsf`, detaches the original file handle (so the
> `.rcsv` on disk is never overwritten), and marks it unsaved. The next save
> writes a new `.rsf` file. Only the name, extension, magic bytes, and
> container version changed — the on-disk structure is otherwise identical.

> **CSV → RSF is lossy, by design.** Converting a byte-preserving CSV document
> to RSF moves to the spreadsheet model (cell _values_ only). It is an explicit
> lossy conversion — never a byte-identical copy of the CSV — and the original
> `.csv` on disk is never modified.

#### Compression

Each `.rsf` file records which codec packed its body, so any supported method
round-trips and unknown methods are rejected safely. All codecs are **pure
Rust** in the embedded WASM core — no C toolchain, no network, fully offline:

| Method                   | Codec         | When to use                                           |
| ------------------------ | ------------- | ----------------------------------------------------- |
| **Zstandard** (default)  | `ruzstd`      | Balanced ratio and speed — the default for new files. |
| **LZ4 Frame** (fast)     | `lz4_flex`    | Fastest saving/opening; files may be larger.          |
| **DEFLATE** (compatible) | `miniz_oxide` | Compatibility fallback when Zstandard is unavailable. |
| **None** (uncompressed)  | —             | Debugging or interoperability only.                   |

New documents and CSV→RSF conversions default to **Zstandard**. Choose a
different method any time via **File → Save with Options…**, which opens the
RSF Save dialog (localized in English and Japanese). A normal <kbd>Ctrl</kbd>+<kbd>S</kbd>
save **preserves the file's existing method** — the method never changes
silently. The status bar shows the method the next save will write. Switching
methods rewrites the container but never changes cell values, formulas,
structure, or metadata.

## Performance and responsiveness

Perceived responsiveness is treated as a feature: the goal is immediate
visual feedback and an interactive UI even while large documents are being
processed, not just raw throughput.

- **Rust/WASM data core.** The performance-critical byte-level work — CSV
  parsing, validation, delimiter sniffing, indexing, serialization planning,
  `.rsf` compression (Zstandard, LZ4 Frame, DEFLATE) and CRC-32,
  selection-statistic reduction, and long literal searches — is implemented in
  **Rust compiled to WebAssembly**.
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
- **Time-sliced long scans with progress.** No large document processing runs
  as one long, unbroken CPU-bound loop on the main thread. Every heavy
  read/prepare phase — Replace All scanning, CSV export validation,
  **CSV→RSF conversion** (both the explicit command and the implicit
  conversion an edit triggers), the cell-collection phase of an **`.rsf`
  save**, and the change-list preparation of **large pastes and Insert
  Copied … operations** (above 20,000 cells) — runs in ~12 ms cooperative
  slices, yielding a macrotask between slices so input handling, rendering,
  and the progress display stay live. The mutation itself is then applied
  **synchronously and atomically** as one undoable operation — a cancelled or
  superseded scan (e.g. the tab's document changed while yielding) aborts and
  leaves the document untouched, never partially modified. Match-count updates
  in the find bar are debounced, and full-document search is bounded by a
  wall-clock budget with partial results rather than a freeze.
- **Percentage progress, honestly reported.** Long-running loading UI shows a
  numeric percentage plus secondary detail wherever a reliable total exists —
  `Converting big.csv to RSF… (37% — 1,850 of 5,000 rows)`,
  `Pasting — 18,000 of 50,000 cells (36%)`,
  `Auto-fitting columns — 3 of 12 columns measured (25%)`. Multi-phase work
  labels its phases: an `.rsf` save shows the sliced
  `preparing data (…%)` phase and then a distinct `compressing…` phase (the
  codec offers no honest percentage, so none is invented). Progress updates
  are naturally rate-limited to one per slice (~12 ms), so reporting never
  becomes its own bottleneck; percentages are floored so **100% never appears
  while work remains**; and on cancellation or failure the indicator is
  dismissed rather than pretending completion. The heavy byte-level kernels
  (parsing, DEFLATE, CRC-32, statistics reduction) run inside the Rust/WASM
  core between yield points, keeping each slice short.
- **Lazy, memoized formula evaluation.** Formula cells evaluate on demand
  with memoization; only the cells actually displayed (visible window, status
  bar) are computed, so a simple edit never triggers a full-sheet
  recalculation pass.
- **Accessible busy states.** Data-volume-dependent operations show a
  non-blocking loading indicator (`role="status"`, `aria-live="polite"`,
  `aria-busy`) with a localized operation label: opening/parsing a file,
  converting a CSV to RSF, saving/compressing an `.rsf`, exporting to CSV,
  and Replace All. The indicator is painted before the work begins and always
  cleared afterward (even on error).

**Measurements.** Reproducible benchmarks live in `bench/` (`npm run bench`,
deterministic in-code fixtures — 200,000-row CSV parsing, identity and
minimal-diff save paths, CSV→RSF conversion, `.rsf` encode/decode for every
compression method, million-cell selection statistics, Replace-All scans,
structural edits with formula-reference rewriting, large bulk-edit applies,
and formula dependency chains). Results for the current revision, the
reference environment, and manual browser-profiling steps are documented in
[docs/performance.md](docs/performance.md). Responsiveness
_structure_ (bounded DOM, in-place repaint, deferred statistics, sliced scans,
prompt busy feedback) is locked in by deterministic tests
(`tests/perf.test.ts`, `tests/virtual-grid.test.ts`).

**Limits.** The responsiveness targets are engineering goals for the
documented reference environment, not guarantees for every browser or device.
Practical ceilings come from browser memory (documents are held in memory;
the configurable open limit defaults to guarding against accidental huge
opens), single-threaded JavaScript for DOM work, and file complexity (very
wide sheets, extremely long cell values, or dense formula graphs cost
proportionally more). The `.rsf` decompression ceiling is 512 MiB.

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

| Capability                              | Chrome / Edge (Chromium)       | Firefox           | Safari            |
| --------------------------------------- | ------------------------------ | ----------------- | ----------------- |
| Run from `file://`                      | ✔                              | ✔                 | ✔                 |
| Overwrite save (File System Access API) | ✔ (with permission prompt)     | ✘ → download save | ✘ → download save |
| Writable handle from drag & drop        | ✔                              | ✘                 | ✘                 |
| Browser-reserved keys (Ctrl+W/Tab/F/…)  | left to the browser (not used) | left to browser   | left to browser   |

- `localStorage` may be unavailable in some `file://` configurations; the
  language preference then simply isn't persisted.
- The browser's standard leave-page dialog (not a custom one) appears when
  closing the page with unsaved changes.

## Development

Requirements: Node.js ≥ 20 and npm, or Docker.

```sh
npm ci --ignore-scripts  # install exact locked deps, no lifecycle scripts
npm run dev            # Vite dev server (development only; the product itself needs no server)
npm run build          # type-check + production build into dist/
npm run test           # vitest (unit, property-based/fuzz, jsdom UI tests)
npm run test:rust      # cargo test (Rust/WASM core)
npm run bench          # performance benchmarks (see docs/performance.md)
npm run lint           # eslint
npm run format         # prettier --write
npm run format:check   # prettier --check
npm run check:versions # package.json ⇄ package-lock.json consistency
npm run check:dist     # assert dist/ is self-contained (embedded WASM, no network)
npm run audit:ci       # production-dependency vulnerability gate
npm run release -- patch   # one-command release (see "Cutting a release")
```

The committed `.npmrc` sets `ignore-scripts=true`, so `npm ci` alone already
skips dependency lifecycle scripts; the explicit flag above documents the
intent for environments without the repo `.npmrc`.

### Docker

A reproducible environment is provided via `Dockerfile` + `compose.yaml`
(dependencies live in a named volume, never in the host tree):

```sh
docker compose run --rm app npm ci --ignore-scripts
docker compose run --rm app npm run format:check
docker compose run --rm app npm run lint
docker compose run --rm app npm run test
docker compose run --rm app npm run build   # writes dist/ to the host
docker compose up dev                       # dev server on http://localhost:5173
```

### Architecture

The code is organized in strict layers — core/domain (`src/core/`, fully
DOM-independent), application (`src/app/`), UI (`src/ui/`), and
infrastructure (the WASM bridge, generated bindings, and build scripts) —
with dependencies flowing inward only, and every user command dispatching
through the single typed command layer. The full engineering map (layer
diagram, command/data flow, the WASM boundary, long-running-operation rules,
and the invariants every change must preserve) is documented in
[docs/architecture.md](docs/architecture.md).

### Project layout

```text
src/
  core/     lossless document model, byte-level CSV parser, serializer,
            encoding, validation, history, search, formula engine, stats,
            RSF workbook + worksheet model + binary codec — DOM-independent,
            unit-tested
  app/      tabs & app state, command layer, file access, settings, i18n,
            keyboard-shortcut routing, spreadsheet-font preference,
            version (single authoritative app name/version source)
  ui/       menu bar, document tabs, worksheet tabs, grid, formula bar +
            shared formula autocomplete, find bar, dialogs (incl. formula &
            function help), status bar, loading overlay
  wasm-gen/ generated: embedded WASM (Base64) + wasm-bindgen glue
  locales/  en.json, ja.json
wasm/       Rust crate compiled to WebAssembly (CSV core, DEFLATE + CRC-32,
            stats/search primitives)
docs/       architecture.md (layers, data flow, invariants),
            rsf-format.md (binary .rsf container specification),
            security.md (threat model + supply-chain policy),
            performance.md (benchmark results + profiling guide)
bench/      reproducible performance benchmarks (npm run bench)
tests/      identity, fuzz/property-based, editing, encodings, save options,
            validation, history, search, formulas, cross-sheet formulas,
            stats, spreadsheet, workbooks/worksheets, RSF binary codec,
            WASM/JS parity, i18n, commands, UI (jsdom),
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
new-document creation, the explicit CSV→RSF convert-to-new-tab command, the
binary `.rsf` container (round-trip, magic/version, checksum, decompression
bounds, store and DEFLATE paths, and application-version metadata), and
byte-exact WASM/JS parity for parsing, serialization planning, stats reduction,
and literal search. Responsiveness regressions are guarded by deterministic
structural tests: bounded DOM for 100,000-row files, in-place repaint for
single-cell edits, deferred large-selection statistics with a "Calculating…"
state, and time-sliced atomic Replace All with progress and cancellation.
This release also covers: browser-safe keyboard-shortcut routing (recognized
accelerators, reserved-key non-interception, IME/text-field safeguards), the
spreadsheet-font preference (default, persistence, clamping, CSS-variable
application), multi-row/column selection (header click/drag, Shift+Click
extension, distinct active/anchor/range/header rendering), column auto-fit
grow-and-shrink with min/max clamping, the formula/autocomplete/evaluator
single-source-of-truth check, and a CSS assertion that formula cells are never
italicized. Newest additions: the CSV export options pipeline (exact
line-ending/BOM output, per-cell unrepresentable-character reporting with
cancel-by-default and NCR continuation, formulas exported as display values,
untouched source document), measured auto-fit planning (variable-width
Japanese/Latin/numeric/formula values, expand and shrink, header inclusion,
font-change sensitivity, bounded evenly spread sampling with honest
indication), paste pattern-repeat tiling and Insert Copied Cells…
(shift-right/shift-down, formula-reference adjustment, CSV conversion gating,
atomic undo/redo, loading UI for large ranges), formula-reference extraction
and live grid highlighting (multiple ranges, whole-row/column clamping,
invalid/incomplete input safety, viewport-overflow indication, independence
from ordinary selection), and tab reordering (state preservation, active-tab
behavior, drag drop-indicator, context menu, live-region announcements). This
release additionally covers: the welcome screen (shown at launch, restored
after closing the final clean tab, the dirty-tab Save/Discard/Cancel close
flows, cleared document-specific UI, entry-point commands), the grid
typography model (row-height/line-height synchronization with the
virtualization constant, font-independent centering, DOM geometry for Japanese
and Latin content, wrap-mode opt-out), multi-column auto-fit (independent
per-column widths, non-adjacent column lists, "N of M columns" progress,
cancellation without partial application, no document/undo mutation), Insert
Copied Rows/Columns (placement rule, source-column preservation,
formula-range expansion and reference shifting, atomic undo/redo, CSV
conversion gating, percentage progress for large insertions), Select All
(grid-focus-only Ctrl+A routing, used-range selection, empty-document
messaging, virtualized whole-sheet rendering, pending statistics, guarded
structural commands), and the non-blocking progress pipeline (sliced CSV→RSF
conversion — explicit and implicit — with percentages, the two-phase `.rsf`
save with a labeled compression phase, large paste/insertion percentages, and
the "never 100% while work remains" rule). Most recent additions: conditional
row-height wrapping (pure visual-line counting from measured width — word
wrap, explicit newlines, long-word breaking, `maxLines` cap; the row-height
index's offset/inverse/total math; grid integration for short rows staying
single-line, one long value growing a row, explicit-newline rows, a formula
row measured from its result not its source, returning to single-line height
when a column is widened, font-change re-measurement, wrap toggle-off restore,
mixed heights under virtualization, single-line pinned sticky row, and
selection/keyboard-navigation/copy across variable heights) and the top-left
corner Select All control (localized accessible name in English and Japanese,
pointer and keyboard/`click` activation, `aria-pressed` whole-sheet state,
blank-RSF logical extent, empty-CSV no-data path, virtualized whole-sheet
selection, copy coverage, and coexistence with formula-reference highlighting).
The latest additions cover IME-safe editing (composition detection from
`isComposing` / `keyCode` 229 / a tracked flag; typing opening an empty editor
without synthesizing the key or calling `preventDefault`; Enter/Esc belonging to
the IME while composing and committing only after; the editor surviving a
rerender mid-composition; the formula bar's composition guard), Alt+Enter
multi-line editing (newline insertion at the caret and over a selection in both
the inline editor and the formula bar without committing; CSV minimal-diff
quoting of an edited multi-line field; an RSF multi-line save/load round trip;
atomic undo/redo; and a row growing via Wrap Long Rows after a multi-line value
is entered), and the color theme (system default, `prefers-color-scheme`
resolution, explicit light/dark application to the document root, local
persistence, live tracking of runtime system-theme changes while on system
default, and no tracking once an explicit theme is chosen).

## CI and releases

- **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to
  `main`: `npm ci --ignore-scripts`, version-consistency, format check, lint,
  tests, build, `check:dist`, a production-dependency `npm audit` gate, and a
  clean-tree assertion. It is entirely read-only, creates no releases, and needs
  no secrets, so fork PRs run safely.
- **Dependency review** (`.github/workflows/dependency-review.yml`) runs on pull
  requests and fails a PR that introduces a high/critical-severity or
  disallowed-license dependency. It is read-only and uses the plain
  `pull_request` trigger, so fork PRs never gain secrets or write access.
- **Releases and deployment** (`.github/workflows/release.yml`) run only when a
  strict semantic-version tag `v<major>.<minor>.<patch>` (for example
  `v0.2.4`) is pushed. The tag filter is numeric, and the tag is re-validated
  with a regex; it must also match the `version` in `package.json` — the single
  authoritative version source (currently **`0.2.4`**). Pushing a valid version
  tag publishes **both** the GitHub Release and the GitHub Pages site.

  Pushes to `main`, pull requests, non-version tags (e.g. `nightly`), and
  malformed tags (e.g. `v1.2`, `v1.2.3.4`) never release or deploy.

  The `release` job re-runs all checks (version consistency, format, lint,
  tests, `check:dist`, audit) and the production build, then publishes a GitHub
  Release with these assets:

  ```text
  refrain-sheet-v0.2.4-<short-hash>.zip
  refrain-sheet-v0.2.4-<short-hash>.zip.sha256
  refrain-sheet-v0.2.4.sbom.cdx.json          # CycloneDX SBOM
  ```

  plus a signed **build-provenance attestation** for the ZIP (via
  `actions/attest-build-provenance`, OIDC — no secrets). The ZIP contains the
  full `dist/` output plus `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, and
  the SBOM. Verify a download with:

  ```sh
  sha256sum -c refrain-sheet-v0.2.4-<short-hash>.zip.sha256
  gh attestation verify refrain-sheet-v0.2.4-<short-hash>.zip --repo <owner>/<repo>
  ```

### Versioning policy

The application version follows **Semantic Versioning** and is defined in
exactly one place, `package.json`; `src/app/version.ts` imports it, so no
app-visible string hard-codes a number. `npm run check:versions` fails if
`package.json` and `package-lock.json` drift apart, and CI runs it on every
push. The internal Rust/WASM core crate (`wasm/Cargo.toml`) has its own
independent version and is intentionally not tied to the app version. After a
user-requested change lands, bump the patch version once (`npm run release --
patch` does this as part of a release).

### Cutting a release (`npm run release`)

A single checked-in Node script, [`scripts/release.mjs`](scripts/release.mjs),
performs the whole release safely. It requires no globally installed tools
beyond Node + git (both present in the Docker image):

```sh
# From an environment with Node, git, and push credentials (or the Docker
# image, which bundles git):
npm run release -- patch        # 0.2.4 -> 0.2.5
npm run release -- minor        # 0.2.4 -> 0.3.0
npm run release -- major        # 0.2.4 -> 1.0.0
npm run release -- v1.4.0       # an explicit target version
npm run release -- patch --yes  # skip the confirmation prompt (CI/non-interactive)
npm run release -- patch --dry-run   # run every check, change nothing
```

In order, the script:

1. validates the repository state and branch (`main` only),
2. refuses to run with an unexpected dirty tree,
3. runs the **full** required checks — version consistency, format, lint,
   TypeScript tests, **Rust tests**, security audit, production build, and
   `check:dist`,
4. computes and validates the new SemVer version,
5. synchronizes `package.json` + `package-lock.json` (the lockfile is
   regenerated only via `npm install --package-lock-only --ignore-scripts`),
6. stages exactly `package.json` and `package-lock.json`,
7. creates a `Release vX.Y.Z` commit,
8. creates an annotated `vX.Y.Z` tag,
9. pushes the commit and then the tag to the upstream remote.

Before staging, committing, tagging, or pushing it **prints the exact version,
branch, remote, commit message, and tag, then requires you to type `yes`** —
unless `--yes` is passed. It **refuses** to run from a detached HEAD, an invalid
remote, a dirty tree with unrelated changes, a branch behind its upstream, or if
the target tag already exists locally or remotely; and it never force-pushes,
overwrites or deletes tags, or bypasses hooks. If a failure happens after the
local commit or tag but before the push completes, it prints exact recovery
commands. Pushing the validated tag is what triggers the GitHub Actions release
workflow (Release + SBOM + provenance + Pages).

### GitHub Pages deployment

Only after every check and the production build succeed does the `deploy-pages`
job publish the same `dist/` to GitHub Pages, using the official
`actions/configure-pages`, `actions/upload-pages-artifact`, and
`actions/deploy-pages` actions. A broken or unchecked build is never deployed.
No repository secrets are required — the Pages actions authenticate with the
workflow's `GITHUB_TOKEN` and OpenID Connect.

The site is published at the project-pages URL:

```text
https://<owner>.github.io/<repository>/
```

The build is fully static and self-contained — WebAssembly is embedded in the
JS bundle, all asset paths are relative (`base: './'` in `vite.config.ts`), and
there are no CDNs, external `.wasm` files, or runtime network access. Because
the paths are relative, the **same** `dist/index.html` works whether it is
served from the project-pages sub-path above or opened directly via `file://`.

**One-time repository setting (cannot be set from the workflow):** in
**Settings → Pages → Build and deployment → Source**, choose **GitHub
Actions**. This selects the Actions-based publishing source that the
`deploy-pages` job targets; without it the deployment step has no Pages site to
publish to. Once selected, every future version tag redeploys automatically.
The deployed URL is also recorded on the run's `github-pages` environment.

## Security policy

- All input is treated as untrusted: CSV content, filenames, search terms,
  regular expressions, replacement strings, and `localStorage` data.
- Cell content is never interpreted as HTML — the UI renders exclusively via
  `textContent`; there is no `innerHTML`, `eval`, `new Function`, or dynamic
  script execution anywhere, and the CSP forbids inline scripts.
- Malformed CSV, huge inputs, undecodable bytes, and invalid regexes are
  handled without crashing; regex execution is bounded (pattern length limit
  and a time budget) to avoid catastrophic backtracking.
- `.rsf` files hold inert data only — cell inputs plus small descriptive
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

### Supply-chain security

The full threat model, dependency policy, lockfile policy, CI permission model,
release controls, and local-developer expectations are documented in
[docs/security.md](docs/security.md). In brief:

- **Minimal dependencies.** The production runtime has a single dependency
  (`encoding-japanese`, for Shift_JIS/EUC-JP encoding) with **zero transitive
  dependencies**; everything else is dev-only tooling. Rust crates are few and
  exactly pinned (`=x.y.z`).
- **Lockfiles enforced.** `package-lock.json` and `wasm/Cargo.lock` are
  committed; CI, Docker, and release instructions use `npm ci` (never
  `npm install`), which installs strictly from the lockfile.
- **No install scripts.** A committed `.npmrc` (`ignore-scripts=true`) plus
  explicit `--ignore-scripts` in CI, Docker, and the release path block
  dependency lifecycle scripts — the main npm supply-chain attack surface
  (e.g. "Shai-Hulud"-style postinstall worms).
- **Least-privilege CI.** Workflows default to read-only; write scopes are
  granted only to the specific release/deploy job that needs them; every
  workflow uses `pull_request` (never `pull_request_target`), so fork PRs get
  no secrets or write access. Only official GitHub-maintained `actions/*` are
  used (major-tag pinned); any third-party action must be pinned to a full
  commit SHA.
- **Vulnerability gates.** `npm audit` (production deps, high severity) runs in
  CI and on release, and a PR **dependency-review** workflow blocks vulnerable
  or disallowed-license additions.
- **Verifiable releases.** Each release ships a SHA-256 checksum, a CycloneDX
  **SBOM**, and a signed SLSA-style **build-provenance attestation**.
- **No committed secrets.** `.gitignore` blocks env files and key material; the
  committed `.npmrc` holds configuration only, never an auth token.

### CSV injection warning

Values beginning with `=`, `+`, `-`, or `@` may be interpreted as **formulas**
by spreadsheet software (Excel, LibreOffice, Google Sheets) when the saved
CSV is opened there. In keeping with the Refrain principle, this application
**never silently modifies, escapes, or prefixes your values** as a
mitigation — be careful when opening CSV files from untrusted sources in
spreadsheet software. The Save with Options dialog carries the same warning.

## Limitations

- Plain CSV editing preserves bytes and offers no formulas or structural
  changes; those require an explicit conversion to a `.rsf` **spreadsheet
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
