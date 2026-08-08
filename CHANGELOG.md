# Changelog

All notable user-visible changes to Refrain Sheet are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (see README
§ "Versioning policy").

## Maintaining this file

Add an entry under **Unreleased** as part of any pull request that changes
user-visible behavior (bug fixes, features, performance, or other changes a
user would notice). When a release is cut with `npm run release`, retitle
`Unreleased` to the new version and date, and start a fresh `Unreleased`
section above it. Purely internal changes (CI, tests, refactors with no
user-visible effect) do not need an entry.

CI enforces the first half of that convention: a pull request that changes
`src/` or `wasm/src/` fails unless it also changes this file. Because "touched
`src/`" is only an approximation of "a user would notice", the gate can be
waived — put `Changelog: not-needed` in the pull request description when the
change really is internal, rather than inventing an entry to satisfy it. The
release-time half (retitling `Unreleased`) is still done by hand.

## [Unreleased]

### Fixed

- The Conditional Formatting dialog's numeric "Cell value" conditions
  (Greater than, Less than, Between, etc.) now keep "Apply Rule" disabled
  and show the existing "incomplete" notice when the Value field is left
  blank or whitespace-only, instead of silently applying a rule compared
  against `0`. ([#339](https://github.com/0x0da160/refrain-sheet/issues/339))
- The Data Validation dialog's list rule now shows a notice when more than
  500 allowed values are entered and only the first 500 are kept, instead of
  silently dropping the rest with no indication. The Filter dialog now flags
  a condition with a missing or invalid value inline and disables Apply until
  it is fixed or reset, instead of silently dropping that condition from the
  applied filter. ([#296](https://github.com/0x0da160/refrain-sheet/issues/296))
- The grid's right-click formatting toolbar now uses distinct icons for
  Background Color and Borders, instead of two nearly identical hatch-square
  glyphs (`▨`/`▦`) that were easy to mis-click at toolbar size.
  ([#294](https://github.com/0x0da160/refrain-sheet/issues/294))
- The status bar's "Sum" stat for a multi-cell selection no longer shows a
  misleading "Sum 0" when the selection has no numeric cells — it now hides
  alongside Average/Min/Max in that case, instead of only those three doing
  so. ([#299](https://github.com/0x0da160/refrain-sheet/issues/299))
- The Delete Rows / Delete Columns confirmation and the "open a non-CSV file"
  prompt now default focus to Cancel instead of the affirmative button, so a
  reflexive Enter press no longer deletes data or opens an unintended file.
  The "unrepresentable characters" save warning also now matches its sibling
  "undecodable characters" edit warning, instead of the two dialogs using
  opposite button placement and focus for the same kind of risk.
  ([#295](https://github.com/0x0da160/refrain-sheet/issues/295))

### Changed

- The Format menu's items (Bold, Italic, Underline, Text Color, Background
  Color, Borders, Number Format, Clear Formatting) now show a tooltip
  explaining that formatting requires an RSF spreadsheet while they are
  greyed out on a plain CSV tab, instead of giving no reason. The same
  tooltip now appears on the equivalent quick-access formatting toolbar in
  the right-click menu. ([#293](https://github.com/0x0da160/refrain-sheet/issues/293))

### Fixed

- Closing a modal dialog (Format Cells, Sort, Data Validation, Settings, SQL,
  Diff, and every other menu-driven dialog) now returns keyboard focus to
  whatever was focused before it opened, instead of dropping focus to the
  top of the page. ([#298](https://github.com/0x0da160/refrain-sheet/issues/298))

### Added

- A new **Edit > Copy Screenshot** command (also on the right-click menu)
  copies the selected range to the clipboard as a PNG that matches its
  actual on-screen appearance — the active color theme, the current sheet
  font and zoom level, and any per-cell bold/italic/underline, text/
  background color, and border (including conditional formatting) —
  alongside the existing **Copy as Image**, which stays a plain,
  theme-independent table by design.
  ([#331](https://github.com/0x0da160/refrain-sheet/issues/331))
- The grid's drag gestures — range selection, column resize, the fill
  handle, and the range-move handle — now work with touch and pen input, not
  just a mouse. Dragging the resize/fill/move handles works immediately on
  touch, same as with a mouse; dragging to extend a cell-range selection or a
  row/column header selection needs a brief press-and-hold first, so a quick
  tap and ordinary scrolling keep working unchanged. The resize handle and
  the fill/move handles also have a larger (invisible) touch target on
  touch/pen input, and the resize handle is now faintly visible without
  hovering so it can be found without a mouse.
  ([#290](https://github.com/0x0da160/refrain-sheet/issues/290))
- A new **Format > Conditional Formatting…** dialog colors a range's cells
  automatically from their computed value: highlight values that satisfy a
  comparison (greater/less than, between, equal to, or text contains),
  highlight duplicate values, or shade a range with a two-color scale by
  relative magnitude. Like data validation, a rule applies to a session-only
  view — it is never saved to the file, never affects the underlying value,
  formula results, or CSV/XLSX export, and (like other cell formatting) is
  RSF-only, with a message explaining the required conversion on a plain CSV
  tab. ([#234](https://github.com/0x0da160/refrain-sheet/issues/234))
- On narrow (mobile-width) viewports, the top-level menu bar (File / Edit /
  Search / …) is now reached through a menu icon in the top-right of the
  logo row instead of a horizontally scrolling strip: tapping it expands the
  menu names on their own row below the logo, wrapping instead of scrolling.
  ([#267](https://github.com/0x0da160/refrain-sheet/issues/267))
- A new **Search > Go to Cell…** command jumps the selection straight to any
  cell reference you type (e.g. `B12`), like Excel's Name Box or Ctrl+G. It
  works on both CSV and RSF tabs, since it only moves the selection.
  ([#236](https://github.com/0x0da160/refrain-sheet/issues/236))
- A new **Data > Cell Comment…** dialog (also on the right-click menu) lets
  you attach a short free-text note to the active cell, independent of its
  value — the noted cell shows a small corner marker, and hovering it shows
  the note. Comments never affect a cell's value, formula results, sort,
  filter, or CSV export. Like Sort and Data Validation, a comment is
  RSF-only, session-only view state: not saved to the `.rsf` container and
  not undoable. ([#235](https://github.com/0x0da160/refrain-sheet/issues/235))
- A new **Data > Compare / Diff…** dialog compares the active tab against
  another already-open tab by one or more key columns you pick, and
  classifies every row as added, modified, deleted, unchanged, or a key
  issue (blank or duplicate key) — with changed rows shown first and
  changed cells highlighted. It never writes back to either source
  document, works fully offline with no new dependency (see
  `docs/csv-diff-review-proposal.md`), and can export the shown rows as a
  diff CSV. ([#255](https://github.com/0x0da160/refrain-sheet/issues/255))
- The marketing landing page (refrain-sheet.com) now shows a cookie-consent
  banner and, only if a visitor clicks "Accept", loads Google Analytics to
  measure page visits; declining or ignoring the banner loads nothing, and
  the choice can be changed anytime from "Cookie settings" in the footer.
  This applies to the landing page only — the CSV editor app itself
  (app.refrain-sheet.com) is unaffected and continues to make no network
  connections at runtime. ([#254](https://github.com/0x0da160/refrain-sheet/issues/254))
- Right-clicking a cell, row, or column header now shows a small formatting
  toolbar (Bold, Italic, Underline, Text Color, Background Color, Borders)
  above the existing right-click menu, so common cell formatting is reachable
  without opening the Format menu. Like the rest of cell formatting, it is
  RSF-only — disabled (not hidden) on a plain CSV tab.
  ([#240](https://github.com/0x0da160/refrain-sheet/issues/240))
- The **Data > Run SQL Query…** dialog now offers a **Format** button that
  auto-formats the query (keyword casing, one line per SELECT item and
  clause), a live syntax-check message as you type, and prefix-match
  suggestions for keywords, functions, and the source's column names. It
  also keeps a local run history (reload or delete a past query) and lets
  you save/load named queries — both stored only in this browser's local
  storage, never in the exported CSV or RSF file.
  ([#239](https://github.com/0x0da160/refrain-sheet/issues/239))
- A new **Data > Data Validation…** dialog restricts which values a cell in
  the selected range accepts — a fixed list of choices (shown as a
  keyboard-accessible dropdown while editing a covered cell) or a numeric
  range. An edit that violates the rule covering its cell is refused with an
  explanation; clearing a cell is always allowed. Like Sort and Filter, a
  rule is RSF-only, session-only view state — not saved to the `.rsf`
  container and not undoable. ([#215](https://github.com/0x0da160/refrain-sheet/issues/215))
- A new **Data > Run SQL Query…** dialog runs a local, read-only SQL query
  (a single `SELECT`, with `WHERE`/`GROUP BY`/`ORDER BY`/`LIMIT`, joins,
  subqueries, and SQLite's comparison, aggregate, and scalar functions)
  against the active worksheet or the open CSV, and shows the result in a
  keyboard-navigable table. It never writes back to the source document and
  never runs anything but `SELECT`; the query is executed locally by
  [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to
  WebAssembly), embedded as Base64 at build time so the app keeps working
  fully offline from a single `file://` document with zero runtime network
  access (see `docs/architecture.md` "The SQL query engine").
  ([#228](https://github.com/0x0da160/refrain-sheet/issues/228),
  [#277](https://github.com/0x0da160/refrain-sheet/issues/277))
- **Format > Number Format…** applies a numeric display format (Number,
  Percent, or Currency, with configurable decimal places, an optional
  thousands separator, and a currency symbol) to the selected cell or range
  on RSF spreadsheets. Like other cell formatting, it is purely
  presentational (it never affects the cell's value, formula results,
  sort/filter, or CSV export), is undoable, and is saved in the `.rsf` file.
  ([#214](https://github.com/0x0da160/refrain-sheet/issues/214))
- A new **Format** menu applies cell/range visual formatting on RSF
  spreadsheets: Bold, Italic, Underline (also Ctrl+B / Ctrl+I / Ctrl+U),
  Text Color…, Background Color…, Borders…, and Clear Formatting.
  Formatting is purely presentational (it never affects cell values, formula
  results, sort/filter, or CSV export), is undoable, and is saved in the
  `.rsf` file. ([#212](https://github.com/0x0da160/refrain-sheet/issues/212))
- A new **View > Sticky First Column** option pins the first data column
  beside the row headers while scrolling horizontally, mirroring the
  existing **Sticky First Row** option. Both can be combined so header row
  and header column stay visible together on large sheets.
  ([#216](https://github.com/0x0da160/refrain-sheet/issues/216))

### Changed

- A worksheet tab's hover tooltip now hints that double-click or F2 renames
  it (e.g. "Sheet2 — double-click or F2 to rename") instead of repeating the
  visible sheet name, since the right-click context menu was previously the
  only way to discover that action.
  ([#303](https://github.com/0x0da160/refrain-sheet/issues/303))
- The right-click context menu on the grid now shows the same keyboard
  shortcut hints (e.g. Ctrl+C, Ctrl+V, Ctrl+A) as the matching Edit menu
  entries, so shortcuts are discoverable from either surface.
  ([#292](https://github.com/0x0da160/refrain-sheet/issues/292))
- Dragging past the visible edge of the grid now auto-scrolls the viewport
  toward the pointer until it re-enters the grid, for all four drag
  gestures that previously just stopped updating at the edge: range
  selection, the fill handle, column resize, and range-move.
  ([#285](https://github.com/0x0da160/refrain-sheet/issues/285))
- The **Sheet**, **Edit**, and **View** menus, which had grown long as
  features were added, are reorganized into grouped submenus: **Sheet** now
  opens with **Worksheet**, **Rows & Columns**, and **Filter & Sort**
  submenus instead of a flat list of ~20 worksheet/row/column/filter/sort
  commands; **Edit** groups the three "insert copied" commands (Cells, Rows,
  Columns) under a new **Insert Copied** submenu; and **View** turns
  **Spreadsheet Font**, **Theme**, and tab movement (Move Tab Left/Right/…)
  into submenus alongside the existing **Spreadsheet Zoom** submenu. Every
  command keeps its existing shortcut, name, and behavior — only its menu
  location changed. ([#280](https://github.com/0x0da160/refrain-sheet/issues/280))
- On narrow (mobile-width) layouts, the top-level menu bar (File / Edit / …)
  no longer collapses behind a hamburger toggle button; the menu names are
  now always visible in a single row that scrolls horizontally, matching how
  the document tab strip and worksheet strip already behave on mobile. The
  menu names also no longer wrap onto multiple lines as the row narrows —
  each name keeps its full width and the row scrolls instead.
  ([#246](https://github.com/0x0da160/refrain-sheet/issues/246))
- Several previously text-only or hand-drawn controls now show a small icon
  from the [Lucide](https://lucide.dev/) icon set: the checkmark on a checked
  menu item, the tab and worksheet close/add buttons, Find bar's
  Previous/Next/Close buttons, the Welcome screen's Open/New actions, and the
  status bar's problem-count button. Every icon is purely decorative (an
  adjacent label or `aria-label` already names the control) and bundled
  locally at build time like the rest of the app — no icon font or CDN is
  involved. ([#248](https://github.com/0x0da160/refrain-sheet/issues/248))
- **Format > Borders…** now lets you choose a border's line style (Solid,
  Dashed, Dotted, or Double) and width (Thin, Medium, or Thick), not just its
  color, and where two adjacent cells each set a border on their shared edge,
  the grid now paints it once as a single line instead of two lines side by
  side. The new style/width is saved in the `.rsf` file like border color
  already was; files saved with only color-and-default-style borders are
  unaffected and remain readable by older releases.
  ([#241](https://github.com/0x0da160/refrain-sheet/issues/241))
- The landing page's spreadsheet section now has its own navigation link and
  is reorganized into six feature cards (formulas, workbooks, filter & sort,
  cell formatting, export, and the no-`eval` formula engine), adding the
  cell-formatting and sorting capabilities that were missing from its copy.
  Its SEO metadata (meta description and structured-data feature list, in
  both languages) was refreshed to mention them too, and a new FAQ entry
  clarifies that cell formatting never changes CSV bytes.
  ([#224](https://github.com/0x0da160/refrain-sheet/issues/224))
- The landing page's spreadsheet section now lists six more capabilities that
  had shipped since the last refresh — Data Validation, Conditional
  Formatting, Number Format, SQL Query, Compare / Diff, and Cell Comment —
  as new feature cards, and the structured-data feature list was updated to
  match. The "1 dependency" stat and its mention in the security section were
  also corrected to "2 dependencies" (still zero transitive dependencies),
  reflecting the `lucide` icon package added earlier in this changelog.
  ([#273](https://github.com/0x0da160/refrain-sheet/issues/273))
- The app icon, the app favicon, and the marketing site favicon now share one
  brand mark (a rounded frame with a grid divider and a small flourish). The
  favicon also follows the OS/browser dark-mode preference.
  ([#205](https://github.com/0x0da160/refrain-sheet/issues/205))
- The "Web App" link (About dialog, README, and landing page) now points to
  `https://app.refrain-sheet.com/` instead of the GitHub Pages URL.
  ([#204](https://github.com/0x0da160/refrain-sheet/issues/204))
- The landing page no longer loads Google Fonts from an external CDN (it now
  falls back to local/system fonts, like the app itself), and its footer no
  longer misdescribes the page as an "unofficial" introduction page.
  ([#209](https://github.com/0x0da160/refrain-sheet/issues/209))
- The landing page's hero and feature screenshots now load a smaller image on
  narrow viewports (via `srcset`), cutting mobile data transfer for those
  images by roughly two-thirds and improving Largest Contentful Paint;
  desktop viewports still receive the full-resolution image.
  ([#218](https://github.com/0x0da160/refrain-sheet/issues/218))
- The landing page's stylesheet is now minified during the build (comments
  and whitespace stripped), shrinking it by about 22% for a slightly faster
  first paint. ([#219](https://github.com/0x0da160/refrain-sheet/issues/219))
- The landing page's hero screenshot and the CSV-validation-dialog feature
  screenshot now have an additional, smaller `srcset` variant (400w), so
  narrow (mobile) viewports are no longer served the 800w/750w image when
  the picture is displayed well under that width — roughly 39 KiB less
  transfer on a mobile viewport of the Japanese page.
  ([#269](https://github.com/0x0da160/refrain-sheet/issues/269))
- `VLOOKUP`, `MATCH`, and `XLOOKUP`'s exact-match lookup (the common,
  non-approximate, non-wildcard case) is now backed by a cached index instead
  of re-scanning the lookup range for every formula cell: a worksheet with
  many formulas that all search the same range (a table copied down a
  column, a shared lookup key) now recalculates dramatically faster —
  measured at roughly 30× on a 2,000-formula/50,000-row benchmark
  (`npm run bench`, "VLOOKUP table shared by 2,000 formula cells"). Results
  are unchanged: approximate lookups and wildcard searches (`*`, `?`, `~`)
  still use the previous linear scan, and every edit still invalidates the
  cache immediately, so a formula never sees a stale match.
  ([#281](https://github.com/0x0da160/refrain-sheet/issues/281))

### Fixed

- Pressing Escape now cancels an in-progress fill-handle drag or
  column-resize drag without applying it, matching the existing Escape
  behavior for a range-move drag. Previously, releasing the mouse always
  applied whatever fill destination or column width was under the pointer,
  so an accidental fill or resize could only be corrected afterward with
  Undo. ([#288](https://github.com/0x0da160/refrain-sheet/issues/288))
- The document tab strip (open files, at the top) now supports the same
  keyboard navigation as the worksheet strip (sheets inside a workbook, at
  the bottom): ArrowLeft/ArrowRight/Home/End move focus and switch the
  active tab, and Alt+ArrowLeft/ArrowRight/Home/End reorder the active tab
  without a pointer — a keyboard/touch-reachable equivalent of the existing
  drag-and-drop reordering, matching the worksheet strip's existing
  behavior. ([#302](https://github.com/0x0da160/refrain-sheet/issues/302))
- Find & Replace: clicking **Replace** while the selection is not on a
  recorded match no longer moves the selection to the next match silently
  and indistinguishably from a successful replace. The status line now says
  the selection was not on a match and nothing was changed.
  ([#300](https://github.com/0x0da160/refrain-sheet/issues/300))
- Pressing Enter now confirms the **Format > Number Format…** dialog (from
  the decimals or currency symbol field), the **Format > Conditional
  Formatting…** dialog (from a comparison value field), and the **Settings**
  dialog (from the max file size field) — matching the Enter-to-confirm
  behavior the rename/move/go-to-cell dialogs already had, so Enter now
  behaves consistently across every single-line dialog input.
  ([#297](https://github.com/0x0da160/refrain-sheet/issues/297))
- Starting a cell edit with a double-click or F2 no longer selects the
  entire cell value. Double-click now places the caret at the clicked
  position; F2 places it at the end of the text. Typing to replace a cell's
  value (starting to type without double-clicking or pressing F2 first)
  still opens an empty editor, unchanged.
  ([#286](https://github.com/0x0da160/refrain-sheet/issues/286))
- On iOS Safari, tapping a top-level menu bar button (File / Edit / Search /
  …) after horizontally scrolling the menu row could open a different menu
  than the one tapped. The mobile menu row no longer scrolls horizontally
  (see the Added entry above), which removes the interaction that caused
  this. ([#267](https://github.com/0x0da160/refrain-sheet/issues/267))
- On narrow (mobile-width) viewports, tapping a top-level menu bar button
  (File / Edit / Search / …) no longer resets the menu bar's horizontal
  scroll position, which used to be able to land the tap on a different
  menu than the one intended.
  ([#261](https://github.com/0x0da160/refrain-sheet/issues/261))
- On narrow (≤700px) mobile viewports, focusing the **Data > Run SQL Query…**
  editor or the **Data > Data Validation…** list-values field no longer
  triggers iOS Safari's automatic zoom; both textareas now get the same
  16px minimum font size that other dialog fields already had.
  ([#247](https://github.com/0x0da160/refrain-sheet/issues/247))
- Column-header and row-header cells now report `aria-colindex` using the
  same virtualization-aware offset as data cells, so a screen reader
  navigating a horizontally scrolled sheet announces a header aligned with
  the data cell's actual column, instead of the header's raw DOM position.
  ([#289](https://github.com/0x0da160/refrain-sheet/issues/289))
- The busy indicator's progress bar no longer stays stuck in its
  indeterminate (spinning) state during large Duplicate Worksheet, Filter,
  Flash Fill, Paste, Insert Copied Rows/Columns, and Replace All operations
  even though the label text already showed an exact percentage; it now
  shows the same determinate progress bar as CSV export and column
  auto-fit already did. ([#301](https://github.com/0x0da160/refrain-sheet/issues/301))
- A malformed CSV field (red wavy underline: unclosed quote, text after a
  closing quote, or a stray quote in an unquoted field) now shows a text
  tooltip explaining the specific parsing problem when hovered, even before
  the cell is edited. Previously this explanation was only available for
  cells that had also been edited, or in the one-time dialog shown when the
  file was opened. ([#287](https://github.com/0x0da160/refrain-sheet/issues/287))
- The status bar's screen-reader live region (`role="status"`) is now scoped
  to the selected-cell reference and selection statistics only, instead of
  the whole status bar. Moving the selection (arrow keys, clicking a cell)
  used to re-announce unrelated document metadata — encoding, delimiter,
  file size, filter/sort state — every time; now only the part that actually
  changed is announced.
  ([#304](https://github.com/0x0da160/refrain-sheet/issues/304))

### Removed

- The on-device "AI Assistant" feature (side panel, menu entry, in-browser
  language model engines and bundled model weights, and the related build
  step) has been removed. ([#190](https://github.com/0x0da160/refrain-sheet/issues/190))

### Scope note

This file starts tracking changes as of `v0.6.1` (2026-08-01). Refrain Sheet
had 30 earlier tagged releases (`v0.1.0` through `v0.6.0`); their content is
not reconstructed here; this project's GitHub Release notes are a fixed
description of the app, not a per-version summary of what changed, and the
earliest tagged commits predate descriptive commit messages, so there is no
reliable source to summarize those versions from without risking inaccurate,
invented history. The full commit and tag history remains available via
`git log`/`git tag` and the
[GitHub Releases page](https://github.com/0x0da160/refrain-sheet/releases).
A human wanting that historical backfill written up can file a follow-up
Issue scoping which versions and what level of detail are wanted.
