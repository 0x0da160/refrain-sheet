# Changelog

All notable user-visible changes to Refrain Sheet are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (see README
§ "Versioning policy").

## Maintaining this file

Add an entry under **Unreleased** as part of any pull request that changes
user-visible behavior (bug fixes, features, performance, or other changes a
user would notice). Purely internal changes (CI, tests, refactors, tooling,
repository-meta issues with no user-visible effect) do not need an entry.

Releases file those entries automatically: `npm run release` (and therefore
the **Manual release recovery** workflow, which runs it) moves everything
under `Unreleased` into a new `## [X.Y.Z] - date` section inside the release
commit itself, leaving a fresh, empty `Unreleased` above it
(`scripts/release/changelog.mjs`). A release that only contained internal changes
has nothing to file and gets no section. If a release was ever cut without
that step, run the **Release docs** workflow by hand: it files the pending
entries under the current, already-tagged version and opens a pull request.

This file keeps only the current minor series. When a new minor series
starts, `node scripts/release/changelog.mjs archive` moves the previous
series' sections, unchanged, into `docs/changelog/<MAJOR.MINOR>.md` (see
"Older versions" at the end). The archived sections from 0.7.30 to 0.8.7
were cut after the fact, from the `Unreleased` section as it stood at each
release tag, and earlier ones were reconstructed from the merged pull
request and tag history — a best-effort backfill rather than something
written at release time.

CI enforces the per-pull-request half: a pull request that changes `src/` or
`wasm/src/` fails unless it also changes this file. Because "touched `src/`"
is only an approximation of "a user would notice", the gate can be waived —
put `Changelog: not-needed` in the pull request description when the change
really is internal, rather than inventing an entry to satisfy it.

## [Unreleased]

## [0.9.9] - 2026-09-26

### Added

- **Syntax check for JSON and YAML sheets.** A line under the editor says
  whether the text has syntax errors and, if it does, shows the first one
  with its line and column (and how many more there are). Go to Error puts
  the cursor on it. YAML duplicate keys and tab indentation count as errors.

### Changed

- **Text editors follow the OS colours in the hybrid theme.** The Markdown,
  JSON, YAML and text sheet editors now go dark when the OS is dark, like the
  rest of the window; only the spreadsheet grid stays light.
- View › Full Screen shows the whole app full screen; choose it again, or
  press Esc, to leave. F11 still gives the browser's own full screen.
- Esc now clears the cell selection when nothing else is in progress (no
  cell being edited, no copy outline, no drag). The next arrow key carries
  on from the cell that was selected.

### Fixed

- Unprotecting a file or unlocking a sheet from the warning that appears
  when you try to edit it now completes the edit you were making (typing,
  deleting, pasting, inserting rows, and so on), instead of dropping it so
  you had to do it again.

### Changed

- **Row 1 follows the scroll only when it has values.** With nothing
  frozen, an empty first row now scrolls away like any other row; once
  any cell in it has a value, it stays at the top again. Sticky First Row
  still pins it either way.

## [0.9.8] - 2026-09-26

### Changed

- When a file cannot be saved or exported, the error now names the file
  (for example, “Could not save "data.csv"”). The rare case where some
  characters still cannot be saved in the chosen encoding, even as numeric
  character references, now says so and suggests choosing another encoding,
  instead of showing the internal word “serialization”.
- An invalid regular expression in Find now tells you what to do: correct
  it, or turn off “Regular expression” to search for the text as typed. A
  search text longer than 1,024 characters gets its own message instead of
  being reported as an invalid regular expression.
- **Data > Run SQL Query…** runs on the SQLite engine from sql.js 1.14.2,
  and the icons come from lucide 1.48.0 (both were updated along with the
  rest of the build toolchain; nothing is fetched at runtime).

## [0.9.7] - 2026-09-26

### Changed

- **View > Density** now makes a clear difference: each step moves the bars,
  menu items, tabs, buttons and fields by 8px instead of 4px (bars are 24,
  32 and 40px on a desktop), and dialogs get tighter or roomier spacing to
  match. Standard looks the same as before.
- On a phone or tablet the density now applies too (it used to be ignored
  there), and the layout is more compact: at Standard the bars are 40px
  instead of 48px, so more rows of the sheet fit on screen. Compact goes
  down to 32px bars; Comfortable keeps the previous touch sizes.
- Buttons, menu items and tab close buttons now show a pressed state the
  moment you click or tap them, so a click is acknowledged even before a
  slow action finishes.
- The busy indicator no longer flashes over the window for operations that
  finish within about a third of a second; it appears only when a wait is
  long enough to notice.
- Scrolling a large sheet does less work: the grid redraws its rows only
  after you scroll past the extra rows it already keeps ready, not on every
  row.
- Converting a large CSV file to an RSF workbook is about 3–4 times faster
  (a 200,000-row, 6-column file went from about 1.4 seconds to about 0.4
  seconds in our benchmark), because cell text is read with much less
  overhead.

## [0.9.6] - 2026-09-26

### Added

- **Format part of a cell's text.** In an RSF sheet, part of a cell's text
  can now have its own bold, italic, underline, or text color. While editing
  a cell, select some of its text: a small toolbar appears above it with
  bold, italic, underline, text colors, and a button that removes the
  selected text's formatting. Ctrl+B, Ctrl+I, and Ctrl+U work on the
  selection too. The cell shows the formatting while you edit it. The
  formatting is saved in the .rsf file; releases before this one open such
  files and show the text with the cell's own formatting.
- **View > Density** switches the height of the bars, buttons, fields and
  menu items between Compact, Standard (the default) and Comfortable, 4px
  per step. Text size and the spreadsheet grid do not change. The choice is remembered on
  this device only.
- Colour pickers (text, fill, borders, conditional formats) now suggest a
  set of 65 document colours where the browser supports it (Chrome, Edge);
  any other colour can still be chosen.
- **View > Banded Rows** tints every other row of the grid. It is now off by
  default, because the stripes compete with the fill colours you give cells;
  turn it on to get the previous look. The choice is remembered on this
  device only.

### Changed

- **Clearer wording throughout the app, in Japanese and English.** Buttons
  now say what they do: closing a file with unsaved changes asks "Save
  Changes Before Closing?" with Save and Close / Close Without Saving / Keep
  Editing, and sheet dialogs say Add, Rename, or Duplicate instead of OK.
  Messages after a failed save or a download save say what happened to the
  original file and what to do next. "Document", "snapshot", and similar
  terms became "file" and "version"; File > Document is now File > This
  File, and the Convert command reads Convert to RSF Spreadsheet…. Messages
  that pointed to the wrong menu now name the right one. Background
  explanations in Settings, Keyboard Shortcuts, the export, sort, filter,
  timezone, display-language, and version-history dialogs are folded under
  "More details", and text unrelated to a dialog was removed.
- The interface text is one step larger and easier to read: menus,
  dialogs and panels use 14px instead of 13px, dialog titles 16px, and no
  text is smaller than 12px (menu shortcuts and small labels were 9–11px).
  Buttons and fields in dialogs and panels are a little taller (32px). On
  touch devices, text and controls grow to touch-friendly sizes.
- New conditional-format highlight rules start with a light red fill and
  dark red text, and new colour scales run from white to a softer green.
- Icons are drawn with a slightly finer, uniform line.
- Accent-coloured text (links, sort and filter status, the welcome screen's
  buttons) is a slightly darker green in the light theme, for better
  contrast. The Markdown and text editors use 14px text instead of 13px,
  and the JSON and YAML editors use the same fixed-width font as the rest of
  the app's code text. The keyboard-shortcut help's note on appearance now
  mentions the Hybrid theme and Density.
- The diff panel's Modified, Added and Deleted badges now use amber, green
  and red on a pale background; Modified and Added were the same green.
- Warning text and icons are a slightly lighter amber in the light theme,
  and so are the third formula-reference colour and the outline of the
  current find match.
- On touch devices, dialog titles and headings grow along with the rest of
  the text, and the status bar is 40px tall. On a phone, the document tabs'
  close buttons and the status bar's Details button are larger (40px).
- The phone layout starts at the same 700px width as before, now measured
  relative to the browser's default text size: if you have made text larger
  in your browser, the phone layout starts at a proportionally wider window.

## [0.9.5] - 2026-09-26

### Changed

- The app now takes its colours, spacing, corner radii, shadows and layer
  order from the Refrain Sheet Design System v2.0.0, the same source as the
  landing site. What you may notice: in the dark theme, secondary text is
  brighter and easier to read, and input fields are a little lighter;
  row and column headers use a paper tint, and the line under frozen rows
  and beside frozen columns is grey instead of green; the comment mark is
  blue in the top-right corner and the formula mark moved to the
  bottom-left, so a cell with both shows both; the four formula-reference
  colours are now blue, violet, amber and teal, all easier to tell apart;
  toasts use the inverted colours (light on the dark theme), and error
  toasts are red; the loading screen dims the app instead of whitening it.
  In the Hybrid theme with a dark system, the Markdown, JSON, YAML and text
  editors now stay light like the grid.
- The landing site now takes every colour, font, spacing and radius from the
  Refrain Sheet Design System v2.0.0 instead of its own copies, so it can no
  longer drift from the app. What visitors notice: headings and buttons use
  the bold weight the fonts actually have, the small all-caps labels are
  less widely spaced, corners are slightly tighter, buttons no longer lift
  on hover, sections fade in without sliding, and the dark panels and the
  cookie banner use the app's dark-theme colours. The page stays light even
  when the operating system is in dark mode, as before.
- **The first row follows the scroll.** When no rows are frozen, row 1
  now stays at the top of the grid as you scroll down, looking like an
  ordinary row. Sticky First Row still adds the line under it, and pinned
  rows wrap long text like any other row.
- **Frozen rows and columns keep their normal look.** They no longer get a
  tinted background or a pin mark on their row numbers and column letters;
  the line at the edge of the frozen area is what sets them apart.
- **No corner move handle with a mouse.** Drag the selection's border to
  move cells. The corner handle still appears on touch screens, where a
  thin border is hard to grab.
- **Markdown, JSON, YAML and text sheets now edit like a text editor, not a
  cell.** Tab types an indent (a tab in text and Markdown, two spaces in JSON
  and YAML) instead of leaving the editor, Tab and Shift+Tab indent and
  outdent the selected lines, and Enter keeps the current line's
  indentation. Press Escape, then Tab, to move focus on. A line break no
  longer turns on "Wrap Long Rows", the editor fills the sheet area without
  a form-field frame or focus highlight, JSON and YAML use a fixed-width
  font, and the status bar shows the caret's line and column and the line
  and character counts instead of a row and column count.

### Fixed

- **Add Sheet asks for the sheet type again.** Sheet > Add Sheet, the "+"
  button beside the sheet tabs, and Shift+F11 now show the sheet-type choice
  (RSF, Markdown, JSON, YAML or text), with RSF selected. The suggested name
  follows the type you pick, for example "Sheet2" for RSF and "Notes1" for
  Markdown. The grid type is now called "RSF sheet" wherever it is named.

## [0.9.4] - 2026-09-26

### Added

- **Spreadsheet font per sheet, per file, or for this browser.** In an RSF
  file, View > Spreadsheet Font now sets the font for the current sheet.
  File > Settings… can set it for the whole file or as this browser's
  default. As with zoom and wrapping, the narrowest level that sets a font
  wins: the sheet, then the file, then this browser. For a CSV file the
  View menu still sets this browser's font. Older releases open these files
  and ignore the saved fonts.
- **Default zoom and wrapping for this browser or the whole file.** File >
  Settings… can now set the zoom and long-cell wrapping for this browser
  (the default for every file) and, for an RSF file, for the whole file
  (every sheet). The narrowest level that sets a value wins: the sheet, then
  the file, then this browser. Changing the zoom or wrapping from the View
  menu still sets it for the current sheet. Older releases open these files
  and ignore the file-level setting.
- **Sticky at the selected cell.** View > Sticky at Selected Cell keeps
  every row above and every column left of the selected cell on screen
  while the rest of the sheet scrolls. Choose it again to release them.
  Each open file and each worksheet remembers its own setting for the
  session; Sticky First Row / Sticky First Column still work as before.
- **Move cells by dragging the selection's border.** In an `.rsf`
  spreadsheet you can now grab the selected range anywhere along its outer
  border, not only by the small handle at its top-left corner. The pointer
  turns into a move cursor over the border.
- **Paste Values and Paste Formatting.** Edit > Paste Special pastes only
  the copied cells' calculated values, or only their formatting.
  **Ctrl+Shift+V** (Cmd+Shift+V on macOS) pastes the values by default;
  File > Settings… can switch it to formatting.
- **Enter today's date or the current time.** **Ctrl+;** enters today's
  date and **Ctrl+Shift+;** (Ctrl+: on a Japanese keyboard) the current
  time, as `2026-09-25` and `13:45`, into the cell or at the cursor while
  editing. Also under Edit > Enter Date or Time.
- **Number, currency, and percent formats on the Format menu**, beside
  their Ctrl+Shift+1 / 4 / 5 keys.
- **Ctrl+Enter applies an edit and stays on the cell.**
- **Protected files show a lock on their file tab**, so you can see which
  open files are read-only without switching to them.

### Changed

- **Private data is no longer stored where other local files can read it.**
  When the offline build is opened from a local file (`file://`), Chrome and
  Edge let every local HTML file read the same browser storage. From there,
  File > Open Recent… and the SQL query history and saved queries are now
  kept only until the page is closed, and anything an earlier release
  stored for them is deleted. The hosted app is unchanged.
- **PageUp and PageDown move one screen** instead of a fixed 20 rows.
- **The keyboard shortcut list is grouped by task** and shows only the keys
  for your system (Cmd on macOS). It now also lists Ctrl+Enter, Alt+Enter,
  Delete / Backspace, Home / End, PageUp / PageDown, and Alt+Down (filter
  menu).
- **Plainer names for files and sheets.** The app now says "File" instead
  of "Workbook" / "Book" and "Sheet" instead of "Worksheet" (in Japanese,
  ファイル and シート instead of ブック and ワークシート). The Sheet menu's
  sheet submenu is now Sheet > Manage Sheets.
- **Plainer Japanese wording.** エクスポート／インポート became 書き出し／読み込み,
  RSFスプレッドシートドキュメント became RSFファイル, version-history
  スナップショット became 版, デコードできないバイト became 読み取れない文字,
  アクティブセル became 選択中のセル, and 書式をクリア became 書式を削除.
  フィルター and ブラウザ are now spelled the same way everywhere.

### Fixed

- **The file tab now shows the name you chose when saving.** Typing a new
  file name in the save dialog (or in File > Save to Drive as…) used to
  leave the tab with its old name.

## [0.9.3] - 2026-09-25

### Added

- **Filter buttons on the header row.** Sheet > Filter & Sort > Filter
  Buttons on Header Row puts a button in each header cell of the data
  around the active cell (or the selected range). The button opens a small
  menu next to the column: order the rows ascending or descending by that
  column, or search and tick the values to show. Filter by Condition… opens
  the full Filter panel for comparisons. Alt+Down on a header cell opens
  the same menu. Filter changes are undoable; the row order is view-only,
  as with Sort….
- **Spreadsheet keyboard shortcuts that act on the sheet.** Ctrl+F opens
  Find, Ctrl+H opens Replace (Cmd+Shift+H on macOS), F3 / Shift+F3 go to the
  next / previous match, Ctrl+G opens Go to Cell, and Ctrl+E runs Flash Fill
  (Cmd on macOS). They work wherever focus is and take precedence over the
  browser's own keys; the browser's page find stays in its menu, because it
  could not see rows outside the screen anyway. **F9** recalculates
  formulas, and **Ctrl+Alt+PageDown / PageUp** switch worksheets. Browser
  zoom, tab switching, and reload are never taken.
- **Jump to the edge of the data.** Ctrl+Arrow (Cmd+Arrow on macOS) moves
  to the end of the current block of filled cells, or to the next filled
  cell; add Shift to select up to there.
- **Cut.** Edit > Cut, the right-click menu, and Ctrl+X (Cmd+X on macOS)
  copy the selected cells and clear them in one undoable step.
- **F4 switches references while typing a formula.** With the cursor on a
  reference, F4 cycles it through A1, $A$1, A$1, and $A1 (a range such as
  A1:B10 changes both ends).
- **Number format keys.** Ctrl+Shift+1 applies a number format (2 decimals,
  thousands separator), Ctrl+Shift+4 a currency format (¥ in Japanese, $
  otherwise), and Ctrl+Shift+5 a percent format.
- **More familiar spreadsheet keys.** Shift+F11 inserts a worksheet,
  Ctrl+/ shows the keyboard shortcut list, and Ctrl+\\ clears formatting
  (Cmd on macOS). With a cell selected, Tab / Shift+Tab now move right /
  left instead of leaving the sheet; at the edge of a row Tab still moves
  focus out of the sheet.
- **Find All.** Find and Replace can list every matching cell (reference,
  worksheet, and text); click a row to jump to that cell.

### Fixed

- **Shift+Enter moves up.** With a cell selected (not editing), Shift+Enter
  moved down like Enter; it now moves up.

### Changed

- **Clearing a column's filter keeps the filter buttons.** When the last
  column's criteria are cleared, every row shows again but the range and its
  buttons stay; Clear All Filters (or turning off Filter Buttons on Header
  Row) removes them. With an active sort, rows a filter change shows again
  now take their sorted place.
- **F4, F7, and F8 no longer act outside a formula.** F4 (New), F7 /
  Shift+F7 (next / previous worksheet), and F8 (Close Tab) used keys that
  mean something else in other spreadsheets. New and Close File are on the
  File menu; switch worksheets with Ctrl+Alt+PageDown / PageUp or the
  worksheet tabs.
- **Clearer menu wording.** "Close Tab" is now **Close File**, and View >
  Move Tab is **Move File Tab**, so it is clear which tab they act on. In
  Japanese, ソート reads 並べ替え, the zoom commands read 表示倍率 / 拡大 /
  縮小 / 100%に戻す, リネーム reads 名前を変更, and the editing-hints toggle
  reads 編集のヒントを表示.
- **Find and Replace is now one side panel.** Find and Replace share a
  dockable, resizable side panel instead of the bar above the sheet, with
  Find Next, Find Previous, Find All, Replace, and Replace All.
- **Menus show the keys you actually press.** Find and Replace list Ctrl+F
  and Ctrl+H, and on macOS every menu shortcut reads Cmd instead of Ctrl.

## [0.9.2] - 2026-09-23

### Changed

- Side panels (Filter, Sort, Data Validation, Text/Background Color,
  Borders, Number Format, Conditional Formatting, SQL Query, Comments, and
  the Markdown/JSON/YAML previews) now share one title bar: every panel
  shows an icon before its title and a close (×) button at the top right,
  next to the dock-side and maximize buttons.
- Applying in a side panel no longer closes it: Apply and Clear take
  effect immediately (each one undoable on its own) and the panel stays
  open, so you can adjust and apply again or select another range and
  apply there. Close a panel with the **Close** button at the bottom right,
  the × at the top right, or Escape; the former **Cancel** button is now
  **Close**, and switching to another window no longer closes a panel.
- The controls inside side panels are laid out on one consistent grid:
  labels sit above full-width fields, related fields share a row, and
  text fields, lists, and buttons are the same height with the same
  spacing in every panel.

- The landing page (refrain-sheet.com) has been rewritten around fixing a CSV
  before it is re-imported: a new Japanese title, description and headline,
  use cases for accounting, payroll, order and core-system CSVs, a feature
  card for values that are never type-inferred, and two new FAQ entries
  (leading zeros and long IDs; malformed CSV). The comparison table no longer
  makes claims about other products' behavior, and the page now
  distinguishes normal local editing from the hosted app's optional Google
  Drive integration instead of promising zero network access everywhere.

### Fixed

- The landing page listed three production dependencies; there are four.
- The landing page still described the standalone **File > Markdown
  Editor…** removed in 0.7.34 and the old **File > Protect Document** menu
  path; it now describes Markdown sheets and **File > Document > Unprotect
  Book**.

## [0.9.1] - 2026-09-23

### Changed

- The spreadsheet now uses BIZ UD Gothic by default (View > Spreadsheet
  Font) instead of Noto Sans JP, and menus, toolbars, and dialogs prefer
  BIZ UDP Gothic. Both come with Windows 10/11; on macOS and iOS the app
  falls back to Hiragino, and on Android to the system Japanese font, with
  no extra fonts to install. A font you already chose is kept.
- Row numbers use equal-width digits so they line up on every platform.
- Grid cells are more compact by default: a column you have not sized is
  104 px wide and a row is 24 px tall (at 100% zoom), with 6 px of space left and right and
  3 px above and below the text. The grid line stays inside that size, so
  columns and rows keep exactly the same spacing all the way across a large
  sheet. Text you are typing (including IME conversion) now starts exactly
  where the cell's text is shown, at every zoom level. Columns sized by
  auto-fit and widths saved in an `.rsf` file are unchanged, and CSV files
  are never modified.

## [0.9.0] - 2026-09-23

### Added

- File > Open Recent… (also on the welcome screen) lists the last 10 files
  you opened or saved and opens one again. The list stays in your browser
  and can be cleared from the same dialog. Chrome and Edge only: other
  browsers do not let a page reopen a file.

### Changed

- **Breaking:** `.rsf` files use a new format: a JSON document compressed with
  Zstandard. Unpacking one with any Zstandard tool (`zstd -d book.rsf -o
book.json`) gives readable text, with one spreadsheet row per line.
  Files saved by earlier releases (the old binary `.rsf`, and `.rcsv`) no
  longer open; the app says so. To bring one over, open it in version 0.8.x,
  export it as CSV or XLSX, and open that file here.
- `.rsf` files are always compressed with Zstandard, so the compression
  choice is gone from Save with Options…, which now applies to CSV files
  only, and the status bar no longer shows a compression method.
- On a desktop-width window, the file tabs now sit in the menu bar's row,
  to the right of the menus, instead of taking a row of their own; the grid
  gains that row. When the window is too narrow for both (including when a
  side panel is docked to the left or right), the tabs go back to their own
  row.
- Opening an `.rsf` workbook no longer auto-fits its columns; its sheets
  keep the widths they were saved with. CSV files are still auto-fitted.
- Pasting with a range selected now starts at the range's top-left cell,
  wherever the active cell is inside it.
- A new CSV file (File > New CSV) no longer highlights its edits as
  changes, since there is no original file to compare with. Once it has
  been saved, later edits are highlighted as usual.
- Notifications now appear at the top-right on a desktop too.
- The stripes on every other row are fainter.
- Selecting a range of cells no longer also highlights the active cell's
  row.
- Right-click menus now show an icon beside each item, like the menu bar.
- Opening a second side panel (for example SQL Query while Number Format
  is open) no longer lays it on top of the first. The panels share the
  docked area as an accordion: the others shrink to their title bars, and
  clicking a title bar switches to that panel.

### Fixed

- A side panel docked to the top no longer overlaps the top of the formula
  bar after being moved there from the left or right side of a narrow
  window, and on a phone it now starts right below the file tabs.
- Copying a blank cell and pasting it now clears the destination cell;
  before, nothing happened.
- Maximizing a side panel now makes it take the whole area instead of
  stopping short and leaving a strip of the sheet showing.
- The selection's corner handles no longer show on top of the row numbers
  and column letters when the selection is scrolled under them, and a
  right-click menu opened next to a docked side panel is no longer drawn
  underneath it.
- Closing one of several open side panels no longer gives the sheet back
  the space the other panels are still using.

## Older versions

Earlier series are archived, unchanged, one file per minor version:
[0.8.x](docs/changelog/0.8.md) ·
[0.7.x](docs/changelog/0.7.md) ·
[0.6.x](docs/changelog/0.6.md).
