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
section above it. Purely internal changes (CI, tests, refactors, tooling,
repository-meta issues with no user-visible effect) do not need an entry — and
because this project cuts a release for nearly every merged pull request, a
released version that only contained such internal changes simply has no
section below and is not listed. This file previously went a long time
without that split ever happening (every change accumulated under
`Unreleased` across dozens of releases); the entries below were reconstructed
per-version from the actual merged pull request and tag history so this file
is no longer stale, but treat it as a best-effort backfill rather than
something written at release time.

CI enforces the first half of that convention: a pull request that changes
`src/` or `wasm/src/` fails unless it also changes this file. Because "touched
`src/`" is only an approximation of "a user would notice", the gate can be
waived — put `Changelog: not-needed` in the pull request description when the
change really is internal, rather than inventing an entry to satisfy it. The
release-time half (retitling `Unreleased`) is still done by hand.

## [Unreleased]

### Fixed

- Double-tapping a cell on a touch device now opens it for editing and
  brings up the on-screen keyboard, matching what double-clicking already
  does with a mouse.
  ([#458](https://github.com/0x0da160/refrain-sheet/issues/458))

### Changed

- Opening a plain CSV file no longer shows a "CSV holds one sheet" note in
  the worksheet strip; a single-sheet CSV simply shows no worksheet tabs.
  The "add row" / "add column" icon buttons now render immediately after
  the grid, ahead of the worksheet tabs, instead of trailing after them.
  ([#456](https://github.com/0x0da160/refrain-sheet/issues/456))
- The landing page's Features section now introduces the Google Drive
  integration, the read-only Protect Document mode, and the standalone
  Markdown editor, which previously had no marketing copy. Its five
  marketing screenshots were also recaptured: the demo browser window is
  narrower so the sample sheet fills the frame instead of leaving a wide
  empty margin to its right. ([#449](https://github.com/0x0da160/refrain-sheet/issues/449))
- The active document tab in the top tab strip now shows a blue underline,
  matching the active worksheet tab below the grid, so it's easier to tell
  at a glance which open file is active.
  ([#457](https://github.com/0x0da160/refrain-sheet/issues/457))
- On narrow (phone-width) screens, the menu bar, tab strip, worksheet tabs,
  dialogs, find bar, status bar, formula bar, and context menus now use
  tighter spacing, margins, and font sizes, so more of the app fits without
  scrolling. Existing touch-target sizes and the input auto-zoom prevention
  are unchanged. ([#462](https://github.com/0x0da160/refrain-sheet/issues/462))
- The dockable side panel (Filter/Sort/Format/SQL Query/Compare-Diff, and the
  comments panel) now defaults to docking at the bottom of the screen instead
  of the right when opened on a smartphone held in portrait orientation, where
  there's little usable width for a side dock. Manually picking a side still
  overrides this for the rest of the session, exactly as before.
  ([#459](https://github.com/0x0da160/refrain-sheet/issues/459))

## [0.7.29] - 2026-09-14

### Added

- Opening an existing file now defaults to a protected, read-only mode, so a
  file can't be edited by accident. A new status bar control (and a
  **File > Protect Document** menu toggle) unlocks it for editing and can
  re-apply protection afterward; the setting is per-tab and session-only,
  never saved with the file. Newly created blank documents (File > New /
  New CSV) still start editable, unchanged.
  ([#443](https://github.com/0x0da160/refrain-sheet/issues/443))
- A new CSV starts as a single 1×1 cell with no obvious way to grow it. Two
  "+" buttons next to the worksheet strip below the grid now add a row or a
  column at the end of the sheet with one click, for CSV and RSF documents
  alike — no selection required.
  ([#441](https://github.com/0x0da160/refrain-sheet/issues/441))
- The hosted landing site (refrain-sheet.com) now has Privacy Policy and
  Terms of Service pages, linked from the footer in both languages. They
  describe the introduction page's opt-in Google Analytics and the hosted
  app's Google Drive integration (`drive.file` scope, in-memory-only access
  token, no Refrain Sheet backend); the downloadable offline build is
  unaffected. ([#431](https://github.com/0x0da160/refrain-sheet/issues/431))
- A new **File > Markdown Editor…** opens a standalone Markdown editor with a
  real-time rendered preview alongside the source text, independent of any
  open CSV/spreadsheet tab. It can open an existing `.md` file from disk and
  save the edited text back (overwriting the original file when the browser
  allows it, or as a download otherwise).
  ([#433](https://github.com/0x0da160/refrain-sheet/issues/433))
- Each open tab now shows a small icon marking whether that file is local or
  came from Google Drive, so you can tell the two apart at a glance when
  several files are open at once. Hover a tab to see the same distinction
  spelled out in its tooltip. ([#432](https://github.com/0x0da160/refrain-sheet/issues/432))

### Changed

- The default **Spreadsheet Font** (View > Spreadsheet Font) for new/
  unconfigured installs is now **Noto Sans JP** instead of **BIZ UD Gothic**.
  Anyone who already picked a font keeps that choice; only new installs
  and installs that never changed the setting notice the difference.
  ([#438](https://github.com/0x0da160/refrain-sheet/issues/438))

### Fixed

- The **File** menu listed **Markdown Editor…** twice. The duplicate entry (and
  its extra separator) is gone, so the menu reads correctly again and keyboard
  navigation no longer stops on the repeated item.
  ([#433](https://github.com/0x0da160/refrain-sheet/issues/433))
- The Japanese welcome-screen button for creating a new RSF spreadsheet read
  "新しい RSF スプレッドシート", inconsistent with the equivalent File menu and
  keyboard-shortcut labels ("新規スプレッドシート") and with the spacing used
  everywhere else the app refers to an "RSFスプレッドシート". It now reads
  "新規RSFスプレッドシート". ([#430](https://github.com/0x0da160/refrain-sheet/issues/430))
- Ctrl+S / Cmd+S (and **File > Save**) on a tab opened from or previously saved
  to Google Drive always fell back to a local save/download instead of
  overwriting that same Drive file. It now saves back to Drive, matching
  **Drive > Save**. ([#429](https://github.com/0x0da160/refrain-sheet/issues/429))

## [0.7.28] - 2026-09-13

### Fixed

- The **Open from Drive…** file picker rendered with broken layout. Google's
  picker styles its own dialog inline, which the hosted app's
  Content-Security-Policy was blocking. The hosted build now permits inline
  styles; the downloadable offline build is unaffected and its policy is
  unchanged. ([#425](https://github.com/0x0da160/refrain-sheet/issues/425))

## [0.7.27] - 2026-09-13

### Fixed

- The **File > Google Drive** menu did not appear on app.refrain-sheet.com in
  v0.7.26. The release build was produced without the Google OAuth client id,
  which compiles Drive sync out entirely, so the feature shipped invisible. The
  release now injects the credential and refuses to publish a hosted build that
  is missing it. ([#416](https://github.com/0x0da160/refrain-sheet/issues/416))

## [0.7.26] - 2026-09-13

### Added

- **File > Google Drive** opens, saves, and overwrites spreadsheets in Google
  Drive, on the hosted app at app.refrain-sheet.com. **Open from Drive…** picks
  a file through Google's own file picker; **Save to Drive** overwrites the file
  a document came from, and **Save to Drive as…** creates a new one. Large files
  upload in resumable chunks. Nothing contacts Google until you use one of these
  menu items, the app is only ever granted access to files you pick or it
  created, and it asks for a short-lived access token that is never stored — so
  signing out, or simply reloading, leaves it with nothing. The downloadable
  offline build has no Drive support at all and continues to make zero network
  requests. ([#416](https://github.com/0x0da160/refrain-sheet/issues/416))
- On a touchscreen, pressing and holding a cell or a row/column header (with
  no dragging) now opens the same right-click context menu a mouse gets,
  giving touch input a way to reach menu-only actions like Insert Row/Column
  or Delete Row/Column. ([#406](https://github.com/0x0da160/refrain-sheet/issues/406))

### Fixed

- On iOS Safari, the page no longer stays visually shifted upward after the
  on-screen keyboard closes while a bottom-docked panel (Comments, or the
  Filter/Sort/Format/SQL Query side panel) is open.
  ([#402](https://github.com/0x0da160/refrain-sheet/issues/402))

## [0.7.25] - 2026-09-13

### Changed

- The **Comments panel** and the **SQL Query** dialog now use the same
  dockable, resizable side panel as Filter/Sort/Format — pick top, right,
  bottom, or left from the header, and resize by dragging its inner edge —
  instead of their own separate layouts. A panel docked to the top or bottom
  now sits below the menu bar / above the status bar instead of covering
  them. ([#399](https://github.com/0x0da160/refrain-sheet/issues/399))

### Fixed

- The right-click context menu no longer closes a submenu while you're
  moving the pointer toward it: crossing a sibling item on a diagonal path
  into an open submenu (or hovering one of the submenu's own items) used to
  dismiss it before you could click anything inside. Closing a sibling's
  submenu is now a "triangle safe zone" test (the same technique used by
  Amazon's mega-menu) — it only closes when the pointer is actually heading
  away from the open submenu.
  ([#399](https://github.com/0x0da160/refrain-sheet/issues/399))

## [0.7.24] - 2026-09-12

### Added

- **File > New CSV** (also on the welcome screen) creates a blank CSV
  document, alongside the existing **File > New** (blank RSF spreadsheet).
  ([#396](https://github.com/0x0da160/refrain-sheet/issues/396))
- The right-click context menu on the grid is now grouped into submenus by
  feature — **Edit** (screenshot/Markdown copy, insert copied cells/rows/
  columns, Flash Fill, Move Selected Cells, Revert Cell) and **Rows &
  Columns** — the same treatment already applied to the top menu bar, instead
  of one long flat list. Copy, Paste, and Select All stay at the top level as
  the most common actions.
  ([#396](https://github.com/0x0da160/refrain-sheet/issues/396))
- Three more spreadsheet font choices — **Noto Sans JP**, **Meiryo UI**, and
  **Yu Gothic UI** — join the existing BIZ UD Gothic/MS Gothic/MS UI Gothic
  under View > Spreadsheet Font.
  ([#396](https://github.com/0x0da160/refrain-sheet/issues/396))

### Changed

- The Filter/Sort/Data Validation/Format side panel no longer closes when you
  click outside it — a stray click on the sheet while adjusting its settings
  no longer silently discards them — and it now reserves its own space along
  the docked edge (a genuine split view) instead of floating over the sheet.
  Escape, window blur, and its own Cancel button still close it.
  ([#396](https://github.com/0x0da160/refrain-sheet/issues/396))

## [0.7.23] - 2026-09-12

### Added

- Menu items across File/Edit/Search/Sheet/Format/Data/Help now show a small
  leading icon (reusing the same left-hand space a checkable item's checkmark
  already occupied, so nothing widens), making the menus easier to scan at a
  glance. The Borders dialog gained an **All** checkbox alongside Top/Right/
  Bottom/Left, and those four are now arranged in a spatial cross layout that
  matches their actual position on a cell instead of a plain vertical list.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))
- The Filter, Sort, Data Validation, and Format (colors/borders/number format/
  conditional formatting) dialogs are now a single **dockable, resizable side
  panel** instead of separate popups: it can be docked to the top, right,
  bottom, or left edge of the window from buttons in its header, and resized
  by dragging its inner edge — mirroring the existing Comments panel, and
  keeping the sheet visible and usable behind it while open.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))

### Changed

- The default color theme for new users is now **Hybrid** (the UI chrome
  follows the OS/browser preference, while the spreadsheet grid stays light)
  instead of System. ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))
- Edit menu: **Copy as Image** was removed (it was an exact duplicate of
  **Copy Screenshot**, both producing the same screen-accurate image); the
  remaining command is relabeled **Copy Image**.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))
- The Sheet menu's own **Export as CSV…** / **Export as XLSX…** entries were
  removed as an exact duplicate of the File menu's; both formats are still
  exported from the File menu.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))

### Fixed

- **Copy Image** now reflects **Wrap Text** (View > Wrap Text): a wrapped
  cell's row grows in the captured image exactly as it does on screen, with
  the text painted on multiple lines, instead of always being ellipsis-
  truncated to a single line.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))
- Popup dialogs (Sort, Format, Go to Cell, etc.) no longer leave dead space
  below their content — or detach their footer from the bottom of the
  window — when resized; the body now grows/shrinks to fill the available
  space and scrolls if the content still doesn't fit.
  ([#393](https://github.com/0x0da160/refrain-sheet/issues/393))

## [0.7.22] - 2026-09-12

### Added

- **File > Export as CSV…** now lets you choose a **delimiter** (keep the
  workbook's own delimiter, or override with comma / semicolon / tab) and a
  **quoting** style (quote only when needed, the default, or always quote
  every field), alongside the existing encoding/BOM/line-ending options.
  ([#388](https://github.com/0x0da160/refrain-sheet/issues/388))

### Fixed

- Bold-formatted cells in the grid now look noticeably bolder. On systems
  where the selected spreadsheet font falls back to MS Gothic / BIZ UDGothic,
  those fonts have no true bold glyphs, so the browser's synthesized ("faux")
  bold barely differed from regular weight; bold cells now also get a thin
  text-stroke outline that reinforces the weight regardless of which font
  actually resolved. ([#389](https://github.com/0x0da160/refrain-sheet/issues/389))

## [0.7.21] - 2026-09-12

### Added

- The landing page's spreadsheet section now lists the Comments Panel as a
  feature card (both languages), and its five marketing screenshots were
  recaptured from the current UI. A new `npm run capture:landing-screenshots`
  command (`scripts/capture-landing-screenshots.mjs`) drives the built app in
  headless Chromium to regenerate those screenshots — the master `.webp` plus
  every responsive srcset size `template.html` references — on demand instead
  of by hand.
  ([#379](https://github.com/0x0da160/refrain-sheet/issues/379))

### Changed

- The marketing landing page (refrain-sheet.com) reworks its copy and layout
  for first-time visitors: a shorter hero promise with a one-line "who this
  is for", a new "Use cases" section right after the problem statement, the
  top stats band trimmed to the three numbers that matter most (bytes
  changed, fields changed, network requests — with the function/dependency
  counts still shown further down, in the spreadsheet and security
  sections), and a short reassurance line (no sign-up, nothing uploaded, try
  it with a copy first) next to the final call to action. No change to the
  app itself. ([#385](https://github.com/0x0da160/refrain-sheet/issues/385))

## [0.7.20] - 2026-09-12

### Added

- A **Comments panel** (View > Comments Panel), docked to the right of the
  grid, lists every cell comment with a scope toggle between the current
  worksheet and the whole workbook; clicking an entry selects and reveals its
  cell, switching worksheets first if needed.
  ([#375](https://github.com/0x0da160/refrain-sheet/issues/375))

## [0.7.19] - 2026-09-12

### Added

- **Hybrid theme**, a new choice in View > Theme alongside System default /
  Light / Dark: the surrounding UI still follows the OS/browser color-scheme
  preference, but the spreadsheet/grid area always stays light, even when the
  rest of the UI resolves to dark. Existing users and new installs keep
  following System default unless they pick Hybrid themselves.
  ([#363](https://github.com/0x0da160/refrain-sheet/issues/363))
- The app version is now shown at the right edge of the status bar while a
  document is open, not only on the empty (no-tab) screen and in the About
  dialog. ([#366](https://github.com/0x0da160/refrain-sheet/issues/366))
- Every popup-style dialog — modal dialogs (e.g. Sort, Go to Cell, Format,
  Settings, SQL Query) and the anchored Filter popover alike — can now be
  dragged by its title bar to reposition it, and resized from a handle in
  its bottom-right corner, both clamped so the window always stays at least
  partly on screen. The Filter popover stops re-following its column header
  on scroll/resize once moved or resized by hand, so it no longer snaps back.
  ([#361](https://github.com/0x0da160/refrain-sheet/issues/361))

### Changed

- **Copy as Image** now renders the copied PNG using the sheet's actual
  on-screen appearance — the active theme's colors, the current font and
  zoom level, and per-cell bold/italic/underline, text/background color,
  border, and conditional formatting — the same rendering **Copy
  Screenshot** already used, instead of a plain white-background table with
  a fixed font. Selection highlighting is still never included in either
  command's output. ([#362](https://github.com/0x0da160/refrain-sheet/issues/362))
- A **Cell Comment** now persists in the `.rsf` file (RSF body version 11+)
  and is undoable, like other cell-level state, instead of being session-only
  view state that was lost on closing and reopening the document.
  ([#364](https://github.com/0x0da160/refrain-sheet/issues/364))

## [0.7.18] - 2026-09-12

### Added

- **Copy as Markdown Table**, alongside the existing Copy as Image / Copy
  Screenshot actions in the Edit menu and cell context menu: copies the
  selected range to the clipboard as a GitHub-Flavored Markdown table (the
  range's first row becomes the header). Pasting (Ctrl+V or the Paste menu
  command) now also recognizes Markdown-table-formatted clipboard text and
  fills it into the grid, in addition to the existing tab-separated paste
  format. ([#358](https://github.com/0x0da160/refrain-sheet/issues/358))

### Fixed

- The landing page's Japanese text no longer forces proportional
  (narrowed) character spacing via `font-feature-settings: 'palt' 1`,
  which rendered noticeably over-tight on Windows/Chrome (fine on
  iOS/Safari). Japanese text now uses normal character spacing; the
  English page was unaffected. ([#355](https://github.com/0x0da160/refrain-sheet/issues/355))

## [0.7.17] - 2026-08-15

### Changed

- Filter, Sort, Data Validation, Conditional Formatting, Cell Comment, and
  Move Range now offer a **Convert to RSF** button directly in the same
  conversion-explanation dialog on a plain CSV tab, instead of only
  explaining that the operation requires an RSF spreadsheet and leaving the
  conversion command to be found elsewhere. Declining still leaves the
  document unchanged; accepting converts the tab and continues straight into
  the original dialog, matching the existing Flash Fill / large-paste
  pattern. ([#352](https://github.com/0x0da160/refrain-sheet/issues/352))

## [0.7.16] - 2026-08-08

### Fixed

- Creating, opening, or switching to a document now puts the keyboard focus
  in the grid immediately, so typing or navigating with the arrow keys works
  right away. Previously, right after "New RSF Spreadsheet" (or opening a
  file), the keyboard focus stayed on `<body>` and every keystroke was
  silently dropped until the grid was clicked once.
  ([#282](https://github.com/0x0da160/refrain-sheet/issues/282))

## [0.7.15] - 2026-08-08

### Fixed

- The SQL Query dialog's default query, `SELECT * FROM data`, and column
  enumeration now read only a worksheet's used range instead of its fully
  allocated grid (e.g. 100 rows × 26 columns for a new sheet), so a first run
  against a small sheet no longer returns dozens of entirely blank rows and
  columns. ([#345](https://github.com/0x0da160/refrain-sheet/issues/345))
- Pressing Enter after typing across a row with Tab now returns the selection
  to the column where that row's typing began, instead of moving one row down
  from wherever the last Tab landed — matching Excel/Sheets/Calc and fixing a
  "staircase" of misaligned data when entering rows via Tab then Enter. Plain
  Enter with no preceding Tab is unchanged.
  ([#344](https://github.com/0x0da160/refrain-sheet/issues/344))

## [0.7.14] - 2026-08-08

### Added

- A new **Edit > Copy Screenshot** command (also on the right-click menu)
  copies the selected range to the clipboard as a PNG that matches its
  actual on-screen appearance — the active color theme, the current sheet
  font and zoom level, and any per-cell bold/italic/underline, text/
  background color, and border (including conditional formatting) —
  alongside the existing **Copy as Image**, which stays a plain,
  theme-independent table by design.
  ([#331](https://github.com/0x0da160/refrain-sheet/issues/331))

### Fixed

- Disabled dialog buttons (Apply Rule, OK, Save, Run, etc.) now render dimmed
  with a "not-allowed" cursor, instead of looking identical to an enabled
  button — including the primary (accent-colored) button style, in both
  themes. ([#338](https://github.com/0x0da160/refrain-sheet/issues/338))
- The Conditional Formatting dialog's numeric "Cell value" conditions
  (Greater than, Less than, Between, etc.) now keep "Apply Rule" disabled
  and show the existing "incomplete" notice when the Value field is left
  blank or whitespace-only, instead of silently applying a rule compared
  against `0`. ([#339](https://github.com/0x0da160/refrain-sheet/issues/339))

## [0.7.13] - 2026-08-08

### Added

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
- The Format menu's items (Bold, Italic, Underline, Text Color, Background
  Color, Borders, Number Format, Clear Formatting) now show a tooltip
  explaining that formatting requires an RSF spreadsheet while they are
  greyed out on a plain CSV tab, instead of giving no reason. The same
  tooltip now appears on the equivalent quick-access formatting toolbar in
  the right-click menu. ([#293](https://github.com/0x0da160/refrain-sheet/issues/293))

### Fixed

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
- Pressing Escape now cancels an in-progress fill-handle drag or
  column-resize drag without applying it, matching the existing Escape
  behavior for a range-move drag. Previously, releasing the mouse always
  applied whatever fill destination or column width was under the pointer,
  so an accidental fill or resize could only be corrected afterward with
  Undo. ([#288](https://github.com/0x0da160/refrain-sheet/issues/288))
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
- The grid's right-click formatting toolbar now uses distinct icons for
  Background Color and Borders, instead of two nearly identical hatch-square
  glyphs (`▨`/`▦`) that were easy to mis-click at toolbar size.
  ([#294](https://github.com/0x0da160/refrain-sheet/issues/294))
- The status bar's "Sum" stat for a multi-cell selection no longer shows a
  misleading "Sum 0" when the selection has no numeric cells — it now hides
  alongside Average/Min/Max in that case, instead of only those three doing
  so. ([#299](https://github.com/0x0da160/refrain-sheet/issues/299))
- Closing a modal dialog (Format Cells, Sort, Data Validation, Settings, SQL,
  Diff, and every other menu-driven dialog) now returns keyboard focus to
  whatever was focused before it opened, instead of dropping focus to the
  top of the page. ([#298](https://github.com/0x0da160/refrain-sheet/issues/298))
- The Delete Rows / Delete Columns confirmation and the "open a non-CSV file"
  prompt now default focus to Cancel instead of the affirmative button, so a
  reflexive Enter press no longer deletes data or opens an unintended file.
  The "unrepresentable characters" save warning also now matches its sibling
  "undecodable characters" edit warning, instead of the two dialogs using
  opposite button placement and focus for the same kind of risk.
  ([#295](https://github.com/0x0da160/refrain-sheet/issues/295))
- The Data Validation dialog's list rule now shows a notice when more than
  500 allowed values are entered and only the first 500 are kept, instead of
  silently dropping the rest with no indication. The Filter dialog now flags
  a condition with a missing or invalid value inline and disables Apply until
  it is fixed or reset, instead of silently dropping that condition from the
  applied filter. ([#296](https://github.com/0x0da160/refrain-sheet/issues/296))

## [0.7.12] - 2026-08-08

### Changed

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
- Dragging past the visible edge of the grid now auto-scrolls the viewport
  toward the pointer until it re-enters the grid, for all four drag
  gestures that previously just stopped updating at the edge: range
  selection, the fill handle, column resize, and range-move.
  ([#285](https://github.com/0x0da160/refrain-sheet/issues/285))

## [0.7.11] - 2026-08-08

### Changed

- The **Data > Run SQL Query…** dialog's query engine was replaced with
  [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to
  WebAssembly, embedded as Base64 at build time), adding support for joins,
  subqueries, and SQLite's comparison, aggregate, and scalar functions on
  top of the existing single-`SELECT` dialog — while keeping the query fully
  local, with zero runtime network access (see `docs/architecture.md` "The
  SQL query engine"). ([#277](https://github.com/0x0da160/refrain-sheet/issues/277))

## [0.7.10] - 2026-08-06

### Changed

- The landing page's spreadsheet section now lists six more capabilities that
  had shipped since the last refresh — Data Validation, Conditional
  Formatting, Number Format, SQL Query, Compare / Diff, and Cell Comment —
  as new feature cards, and the structured-data feature list was updated to
  match. The "1 dependency" stat and its mention in the security section were
  also corrected to "2 dependencies" (still zero transitive dependencies),
  reflecting the `lucide` icon package added earlier.
  ([#273](https://github.com/0x0da160/refrain-sheet/issues/273))

## [0.7.8] - 2026-08-06

### Added

- A new **Data > Cell Comment…** dialog (also on the right-click menu) lets
  you attach a short free-text note to the active cell, independent of its
  value — the noted cell shows a small corner marker, and hovering it shows
  the note. Comments never affect a cell's value, formula results, sort,
  filter, or CSV export. Like Sort and Data Validation, a comment was
  RSF-only, session-only view state at this point — not saved to the `.rsf`
  container and not undoable (this changed later, see
  [0.7.19](#0719---2026-09-12)).
  ([#235](https://github.com/0x0da160/refrain-sheet/issues/235))
- A new **Format > Conditional Formatting…** dialog colors a range's cells
  automatically from their computed value: highlight values that satisfy a
  comparison (greater/less than, between, equal to, or text contains),
  highlight duplicate values, or shade a range with a two-color scale by
  relative magnitude. Like data validation, a rule applies to a session-only
  view — it is never saved to the file, never affects the underlying value,
  formula results, or CSV/XLSX export, and (like other cell formatting) is
  RSF-only, with a message explaining the required conversion on a plain CSV
  tab. ([#234](https://github.com/0x0da160/refrain-sheet/issues/234))
- A new **Search > Go to Cell…** command jumps the selection straight to any
  cell reference you type (e.g. `B12`), like Excel's Name Box or Ctrl+G. It
  works on both CSV and RSF tabs, since it only moves the selection.
  ([#236](https://github.com/0x0da160/refrain-sheet/issues/236))
- On narrow (mobile-width) viewports, the top-level menu bar (File / Edit /
  Search / …) is now reached through a menu icon in the top-right of the
  logo row instead of a horizontally scrolling strip: tapping it expands the
  menu names on their own row below the logo, wrapping instead of scrolling.
  ([#267](https://github.com/0x0da160/refrain-sheet/issues/267))

### Changed

- The landing page's hero screenshot and the CSV-validation-dialog feature
  screenshot now have an additional, smaller `srcset` variant (400w), so
  narrow (mobile) viewports are no longer served the 800w/750w image when
  the picture is displayed well under that width — roughly 39 KiB less
  transfer on a mobile viewport of the Japanese page.
  ([#269](https://github.com/0x0da160/refrain-sheet/issues/269))

### Fixed

- On iOS Safari, tapping a top-level menu bar button (File / Edit / Search /
  …) after horizontally scrolling the menu row could open a different menu
  than the one tapped. The mobile menu row no longer scrolls horizontally
  (see the Added entry above), which removes the interaction that caused
  this. ([#267](https://github.com/0x0da160/refrain-sheet/issues/267))

## [0.7.7] - 2026-08-06

### Fixed

- On narrow (mobile-width) viewports, tapping a top-level menu bar button
  (File / Edit / Search / …) no longer resets the menu bar's horizontal
  scroll position, which used to be able to land the tap on a different
  menu than the one intended.
  ([#261](https://github.com/0x0da160/refrain-sheet/issues/261))

## [0.7.6] - 2026-08-05

### Added

- A new **Data > Compare / Diff…** dialog compares the active tab against
  another already-open tab by one or more key columns you pick, and
  classifies every row as added, modified, deleted, unchanged, or a key
  issue (blank or duplicate key) — with changed rows shown first and
  changed cells highlighted. It never writes back to either source
  document, works fully offline with no new dependency (see
  `docs/csv-diff-review-proposal.md`), and can export the shown rows as a
  diff CSV. ([#255](https://github.com/0x0da160/refrain-sheet/issues/255))

## [0.7.5] - 2026-08-05

### Added

- The marketing landing page (refrain-sheet.com) now shows a cookie-consent
  banner and, only if a visitor clicks "Accept", loads Google Analytics to
  measure page visits; declining or ignoring the banner loads nothing, and
  the choice can be changed anytime from "Cookie settings" in the footer.
  This applies to the landing page only — the CSV editor app itself
  (app.refrain-sheet.com) is unaffected and continues to make no network
  connections at runtime. ([#254](https://github.com/0x0da160/refrain-sheet/issues/254))

## [0.7.4] - 2026-08-05

### Changed

- On narrow (mobile-width) layouts, the top-level menu bar (File / Edit / …)
  no longer collapses behind a hamburger toggle button; the menu names are
  now always visible in a single row that scrolls horizontally, matching how
  the document tab strip and worksheet strip already behave on mobile. The
  menu names also no longer wrap onto multiple lines as the row narrows —
  each name keeps its full width and the row scrolls instead. (This was
  replaced in turn by a menu icon in [0.7.8](#078---2026-08-06).)
  ([#246](https://github.com/0x0da160/refrain-sheet/issues/246))

## [0.7.3] - 2026-08-05

### Changed

- Several previously text-only or hand-drawn controls now show a small icon
  from the [Lucide](https://lucide.dev/) icon set: the checkmark on a checked
  menu item, the tab and worksheet close/add buttons, Find bar's
  Previous/Next/Close buttons, the Welcome screen's Open/New actions, and the
  status bar's problem-count button. Every icon is purely decorative (an
  adjacent label or `aria-label` already names the control) and bundled
  locally at build time like the rest of the app — no icon font or CDN is
  involved. ([#248](https://github.com/0x0da160/refrain-sheet/issues/248))

### Fixed

- On narrow (≤700px) mobile viewports, focusing the **Data > Run SQL Query…**
  editor or the **Data > Data Validation…** list-values field no longer
  triggers iOS Safari's automatic zoom; both textareas now get the same
  16px minimum font size that other dialog fields already had.
  ([#247](https://github.com/0x0da160/refrain-sheet/issues/247))

## [0.7.2] - 2026-08-05

### Changed

- The **Data > Run SQL Query…** dialog now offers a **Format** button that
  auto-formats the query (keyword casing, one line per SELECT item and
  clause), a live syntax-check message as you type, and prefix-match
  suggestions for keywords, functions, and the source's column names. It
  also keeps a local run history (reload or delete a past query) and lets
  you save/load named queries — both stored only in this browser's local
  storage, never in the exported CSV or RSF file.
  ([#239](https://github.com/0x0da160/refrain-sheet/issues/239))
- **Format > Borders…** now lets you choose a border's line style (Solid,
  Dashed, Dotted, or Double) and width (Thin, Medium, or Thick), not just its
  color, and where two adjacent cells each set a border on their shared edge,
  the grid now paints it once as a single line instead of two lines side by
  side. The new style/width is saved in the `.rsf` file like border color
  already was; files saved with only color-and-default-style borders are
  unaffected and remain readable by older releases.
  ([#241](https://github.com/0x0da160/refrain-sheet/issues/241))

### Added

- Right-clicking a cell, row, or column header now shows a small formatting
  toolbar (Bold, Italic, Underline, Text Color, Background Color, Borders)
  above the existing right-click menu, so common cell formatting is reachable
  without opening the Format menu. Like the rest of cell formatting, it is
  RSF-only — disabled (not hidden) on a plain CSV tab.
  ([#240](https://github.com/0x0da160/refrain-sheet/issues/240))

## [0.7.1] - 2026-08-04

### Added

- A new **Data > Data Validation…** dialog restricts which values a cell in
  the selected range accepts — a fixed list of choices (shown as a
  keyboard-accessible dropdown while editing a covered cell) or a numeric
  range. An edit that violates the rule covering its cell is refused with an
  explanation; clearing a cell is always allowed. Like Sort and Filter, a
  rule is RSF-only, session-only view state — not saved to the `.rsf`
  container and not undoable. ([#215](https://github.com/0x0da160/refrain-sheet/issues/215))

## [0.7.0] - 2026-08-04

### Added

- A new **Data > Run SQL Query…** dialog runs a local, read-only SQL query
  (a single `SELECT`, with `WHERE`/`GROUP BY`/`ORDER BY`/`LIMIT`) against the
  active worksheet or the open CSV, using a small dependency-free SQL engine
  built for this feature, and shows the result in a keyboard-navigable table.
  It never writes back to the source document. (Its engine was later
  replaced with SQLite/sql.js — see
  [0.7.11](#0711---2026-08-08) — which added joins, subqueries, and more SQL
  functions.) ([#228](https://github.com/0x0da160/refrain-sheet/issues/228))

## [0.6.17] - 2026-08-04

### Added

- **Format > Number Format…** applies a numeric display format (Number,
  Percent, or Currency, with configurable decimal places, an optional
  thousands separator, and a currency symbol) to the selected cell or range
  on RSF spreadsheets. Like other cell formatting, it is purely
  presentational (it never affects the cell's value, formula results,
  sort/filter, or CSV export), is undoable, and is saved in the `.rsf` file.
  ([#214](https://github.com/0x0da160/refrain-sheet/issues/214))

## [0.6.16] - 2026-08-04

### Added

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

- The landing page's hero and feature screenshots now load a smaller image on
  narrow viewports (via `srcset`), cutting mobile data transfer for those
  images by roughly two-thirds and improving Largest Contentful Paint;
  desktop viewports still receive the full-resolution image.
  ([#218](https://github.com/0x0da160/refrain-sheet/issues/218))
- The landing page's stylesheet is now minified during the build (comments
  and whitespace stripped), shrinking it by about 22% for a slightly faster
  first paint. ([#219](https://github.com/0x0da160/refrain-sheet/issues/219))
- The landing page's spreadsheet section now has its own navigation link and
  is reorganized into six feature cards (formulas, workbooks, filter & sort,
  cell formatting, export, and the no-`eval` formula engine), adding the
  cell-formatting and sorting capabilities that were missing from its copy.
  Its SEO metadata (meta description and structured-data feature list, in
  both languages) was refreshed to mention them too, and a new FAQ entry
  clarifies that cell formatting never changes CSV bytes.
  ([#224](https://github.com/0x0da160/refrain-sheet/issues/224))

## [0.6.15] - 2026-08-03

### Changed

- The landing page no longer loads Google Fonts from an external CDN (it now
  falls back to local/system fonts, like the app itself), and its footer no
  longer misdescribes the page as an "unofficial" introduction page.
  ([#209](https://github.com/0x0da160/refrain-sheet/issues/209))

## [0.6.14] - 2026-08-03

### Changed

- The app icon, the app favicon, and the marketing site favicon now share one
  brand mark (a rounded frame with a grid divider and a small flourish). The
  favicon also follows the OS/browser dark-mode preference.
  ([#205](https://github.com/0x0da160/refrain-sheet/issues/205))
- The "Web App" link (About dialog, README, and landing page) now points to
  `https://app.refrain-sheet.com/` instead of the GitHub Pages URL.
  ([#204](https://github.com/0x0da160/refrain-sheet/issues/204))

## [0.6.13] - 2026-08-03

### Added

- A new **Sort** command sorts a range by one or more columns. Like Filter,
  it applies to a session-only view — sorting doesn't reorder the
  underlying rows, isn't saved to the `.rsf` container, and doesn't affect
  the CSV. Editing rows/columns in a way that would invalidate an active
  sort clears it with a status-bar notice, instead of silently leaving a
  stale sort applied. ([#193](https://github.com/0x0da160/refrain-sheet/issues/193))

## [0.6.12] - 2026-08-02

### Removed

- The on-device "AI Assistant" feature — an experimental side panel (added
  in v0.6.2) that ran a language model entirely locally in the browser to
  interpret natural-language requests and propose, then (with approval)
  execute, spreadsheet edits — has been removed entirely: the side panel,
  menu entry, in-browser language model engines, bundled model weights, and
  the related build step are all gone. Several releases between v0.6.2 and
  this one had added a choice of models and fixed installation/loading
  issues for this feature; none of that carries forward.
  ([#190](https://github.com/0x0da160/refrain-sheet/issues/190), originally
  added in [#122](https://github.com/0x0da160/refrain-sheet/issues/122))

## [0.6.3] - 2026-08-01

### Added

- The marketing landing page (refrain-sheet.com) was added.
  ([#128](https://github.com/0x0da160/refrain-sheet/issues/128))

## [0.6.2] - 2026-08-01

### Added

- The **Filter** dialog's value list now has "Select all" / "Deselect all"
  buttons, and shows itself as a non-modal popover anchored to the column
  header instead of a centered modal dialog.
  ([#121](https://github.com/0x0da160/refrain-sheet/issues/121))

## Scope note

This file starts tracking changes as of `v0.6.1` (2026-08-01) — `v0.6.1`
itself had no user-facing changes, so the first dated section above is
`v0.6.2`. Refrain Sheet had 30 earlier tagged releases (`v0.1.0` through
`v0.6.0`); their content is not reconstructed here: this project's GitHub
Release notes are a fixed description of the app, not a per-version summary
of what changed, and the earliest tagged commits predate descriptive commit
messages, so there is no reliable source to summarize those versions from
without risking inaccurate, invented history. The full commit and tag
history remains available via `git log`/`git tag` and the
[GitHub Releases page](https://github.com/0x0da160/refrain-sheet/releases).
A human wanting that historical backfill written up can file a follow-up
Issue scoping which versions and what level of detail are wanted.
