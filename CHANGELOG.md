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

### Changed

- A closed sheet folder now folds away the sheet being shown too; the
  folder's header is marked instead, so you can see which folder it is in.
- The Add Sheet and New Folder buttons at the end of the sheet tabs are
  plain icons, so they no longer look like a cut-off tab, below the grid or
  beside it.
- The folder button now creates an empty folder (New Folder… /
  フォルダを作成…), and sheets are dragged into it. Moving the current sheet
  into a new folder is still in the sheet's right-click menu.
- File version history now keeps a new version only when something changed
  since the last one: the content, a sheet's or the file's settings saved in
  the RSF file. Saving again without changes (or after only switching
  sheets) no longer adds an identical version.
- Customize Status Bar now shows three lists (Show in Bar, Show in Details,
  Don't Show). Drag an item by its grip to another list or to a new place
  in its list. The bar and Details show the items in the order you
  arranged them.
- The pixel pets play twelve different scenes in a random order instead of
  one loop: a chase, ball play, a nap, a butterfly, a ball of yarn, a hopping
  game, a song, a fish, a shooting star, the zoomies, a nose boop, and a bone.
- The font lists (View > Spreadsheet Font, and the font picker in Format >
  Font…) are grouped into monospace and proportional fonts.
- In the formatted Markdown editor, a block's buttons (move, add, delete)
  now appear just above its top left corner, close to the text, instead of
  at the far right.
- Formatted Markdown and its preview show headings in green and bold text
  in violet, so they stand out from the body text (all themes except High
  contrast).
- After clicking + under the last row (or right of the last column), the
  sheet scrolls by the added row or column, so the + stays under the
  pointer and the new row is in view.

### Fixed

- After clicking a sheet tab, typing now goes straight into the selected
  cell (or the sheet's text) instead of being lost on the tab.

### Added

- Markdown, JSON, YAML and text sheets each keep their own zoom (View >
  Spreadsheet Zoom, the zoom keys, or Ctrl/Cmd + mouse wheel), saved with
  the sheet.
- Alt+Z (Option+Z on a Mac) turns wrapping on or off. On a Markdown, JSON,
  YAML or text sheet the View menu item reads "Wrap Long Lines"; with
  wrapping off, long lines stay on one line and scroll sideways. Each sheet
  keeps its own setting.
- View > Proportional Font switches the sheet between a monospace font
  (BIZ UD Gothic) and a proportional one (Yu Gothic UI). A font chosen on a
  Markdown, JSON, YAML or text sheet now applies to it.
- Row heights on RSF sheets: drag the bottom edge of a row number to make
  the row taller or shorter (double-click it to go back to the automatic
  height), or set an exact height in px with Format > Row Height…. The
  heights are saved with the file and move with their rows.
- Format > Text Alignment now also has Align Top, Align Middle and Align
  Bottom, which place a cell's text up and down a taller row. Middle stays
  the default.

## [0.9.25] - 2026-10-03

### Changed

- The pixel pets (the puppy and kitten at the top right) are now hidden
  until turned on in File > Settings…. Once turned on there, they stay on
  in this browser.

- The row and column header hover tools are smaller and no longer cover
  each other, the header label, or a column's width handle. Each + now sits
  on the outer corner of the boundary it inserts at, and the move grip is a
  thin row of dots along the header's top edge (columns) or left edge
  (rows), so narrow columns, grid-paper squares and short rows keep their
  letter or number readable and a column's width can be dragged from most
  of its boundary.

## [0.9.23] - 2026-09-30

### Added

- A white puppy and a black kitten now play in the free space at the top
  right of the window, drawn as pixel art. They never get in the way of a
  click, stand still when the system asks for reduced motion, and are left
  out on a phone. Turn them off in File > Settings… (kept in this browser).
- **New Markdown, JSON and YAML files.** The start screen has New Markdown,
  New JSON and New YAML buttons, and File > New Markdown / JSON / YAML has
  the same three. Each opens an empty editor that saves as a UTF-8 text file.
- **Blank CSV sheets in an RSF file.** The Add Sheet dialog has a CSV Sheet
  choice, and Sheet > Manage Sheets > New Sheet has Add CSV Sheet: a blank
  sheet named CSV1, CSV2, … next to Add from CSV File….
- **Markdown display themes.** The Markdown sheet's toolbar has a Theme
  list (Standard, Easy Reading, Paper, Dark, High Contrast) for the preview
  and the Formatted editor. The choice is kept in this browser.
- **Markdown turns into formatting as you type.** In the Formatted editor,
  typing `# ` (up to `###### `) at the start of a line makes it a heading,
  `- ` a bulleted list, `1. ` a numbered list and `> ` a quote, and Enter on
  a line of just ` ``` ` starts a code block. The full-width marks a
  Japanese input method types (`＃　` and so on) work too.
- **File size and details in the status bar.** RSF, Markdown, JSON and YAML
  files now show their size, and every size also shows in KB or MB. On a
  desktop the status bar always has a Details button listing the file's
  name, where it is saved, and every detail about it.

### Changed

- **Repeated messages no longer pile up.** When the same message pops up
  again while it is still on screen, it stays one message with a count
  (×2, ×3, …), and it stays up for the full time from the latest repeat.
- **Double-clicking a shape or text box also opens its settings.** The text
  is typed on the shape as before, and the object settings panel opens
  beside it.
- **Alt-dragging a shape snaps to cells reliably.** The shape now shows the
  cell corner it will land on while you drag, Alt can also be pressed during
  the drag, and the browser no longer takes the Alt key for its own menu.
- **Protection is one switch.** The status bar shows one button, Protected
  with a lock or Edit with a pencil, and clicking it switches between them.

## [0.9.22] - 2026-09-30

### Added

- **One color picker everywhere.** Text and fill colors, borders, sheet tabs,
  shapes, charts and conditional formats now share one picker: recently used
  colors, favorites (the star), the colors already used in this file, the
  full palette, and "More colors" for a color code, a CSS color name such as
  `tomato`, or any color from the browser's chooser. Picking a color applies
  it at once. Recent colors and favorites are kept in this browser.
- **Colors and borders open next to the button.** Text Color, Fill Color and
  Borders chosen from the toolbar or the right-click menu open as a small
  panel beside the button instead of the side panel; from the Format menu
  they still open in the side panel.
- Type a rectangle's, an ellipse's or a text box's text right on the shape: double-click it (or press F2 with it selected). Enter starts a new line, Ctrl+Enter or clicking elsewhere keeps the text as one undo step, and Escape puts it back. Double-clicking any other object still opens its settings, and the object list now says how both work.
- Hold Alt while resizing an object to put the edges you drag on the nearest cell edges, as Alt already does when moving one.
- A folder button next to the sheet tabs' + puts the current sheet in a new folder.
- With the sheet tabs on the left, drag the list's right edge (or focus it and use the arrow keys) to make it wider or narrower; double-click the edge to go back to the standard width. The width is kept in this browser.
- The status bar's right end has the spreadsheet zoom (−, a list of the zoom levels, +) and a Full Screen button (on a desktop-width window; a phone keeps them in the View menu).
- **Align cell text left, center or right.** Format > Text Alignment > Align
  Left, Align Center and Align Right, and three new toolbar buttons, place the text of
  the selected cells. Pressing the alignment the cells already have takes
  them back to the left. The alignment is saved in the RSF file and shows on
  screen, in print and PDF, and in Copy as Image. Older versions of the app
  open such files and show the text at the left.
- Add a CSV file to an RSF file as a new sheet: Sheet > Manage Sheets > New Sheet > Add Sheet from CSV File…, or From a CSV File… in the Add Sheet dialog. Each file becomes a sheet named after it, read with the same encoding detection as opening it; the CSV file itself is left unchanged.
- Choose what the status bar shows: View > Toolbar & Status Bar > Customize Status Bar… (or right-click the status bar) sets each item — file type, encoding, delimiter, line endings, size, rows × columns, formula count, edited cells, filter, sort, CSV engine, the selected cell and totals, version — to show in the bar, in Details, or not at all. Items in Details open from the Details button at the right end. The choice is kept in this browser.
- Copy a selection as a Backlog table: Edit > Copy As > Backlog Table (also on the cell right-click menu) copies the selected cells in Backlog's table notation, with no header, the first row as header (`|h`), or the first column as header (`|~`).
- Copy a Markdown table with or without a header row: Edit > Copy As > Markdown Table now asks whether the first row is the header; No Header writes an empty header row and keeps every selected row as data.
- Rearrange a Markdown sheet in Formatted mode: each block now has tools beside it to move it up or down (also Alt+Shift+↑/↓), drag it by its grip, add a paragraph below it, or delete it. Only the moved block's lines change place, so the rest of the Markdown stays exactly as written.
- Save a Markdown, JSON, YAML or text sheet as a file of its own: File > Export > Export This Sheet as a File… (also on the sheet tab's right-click menu) writes it as UTF-8 to a `.md`, `.json`, `.yaml` or `.txt` file named after the sheet.
- File > Open Recent… now lists Google Drive files too (on the hosted site with Google Drive): the Drive files you last opened or saved appear under their own Google Drive heading, apart from the files on this device, and open again without the Drive file picker. Clear List empties both lists.

### Changed

- **Filtering is called "フィルター" everywhere in Japanese.** Menus, header
  buttons and messages used both 絞り込み and フィルター for the same
  feature; they now all say フィルター.
- **Panels and bars outside the grid use the interface font.** The comments
  panel, Find and Replace, the name box and the Markdown source editor now use
  the same font as the menus, and code (SQL, formula signatures, shortcut keys)
  uses the code font.
- **Sheet tabs beside the grid have more room.** In the vertical tab layout,
  each tab, folder and the add button is taller, with more space between them,
  so they are easier to read and click.
- **Flash Fill explains how to use it.** When it cannot find a pattern, the
  message now says to type one or two examples from the row just under the
  headings and press Ctrl+E.
- **Borders are drawn with one press.** The Borders panel now has buttons for
  all borders, the outside border, the lines inside the selection, one edge,
  and no borders, applied as soon as you press them (no Apply button). Choose
  the line's color, style and width first; presses combine, so the outside
  border then the inside lines gives a framed table.
- **The in-cell text toolbar uses the palette's colors** and shows your recent
  colors first.
- Objects now stay on whole pixels: an edit rounds their position and size to whole pixels, line widths to whole pixels of at least 1, and text sizes to whole points, and the object list takes whole numbers only for line width and text size. A fractional value from an older file is kept until the object is next edited.
- Renaming a sheet or a sheet folder now happens on its tab: double-click it (or press F2) and type. Enter keeps the name, Escape puts the old one back, and a name that cannot be used says why without closing the field. Double-clicking a sheet that was not active now renames it too.
- The status bar's protection control is now one switch, Edit | Protected, with the current state pressed, instead of a "Protected" label beside an "Edit" or "Protect" button.
- Shorter menus: related commands now sit together in submenus, and a submenu can open one more level inside it: Edit > Fill; Sheet > Manage Sheets > New Sheet, Sheet Folders and Move Sheet; Insert > Shape, Arrange Objects and Save Objects as Image; Format > Text Alignment and Number Format; View > Sticky Rows & Columns, Grid Look, Toolbar & Status Bar and Language. The right-click menus for cells, sheet tabs and shapes are grouped the same way. The CSV-only edition follows the same layout.
- The row and column header tools moved: a column's move grip is now at the middle of its top edge, and each header shows a + on both of its boundaries, centered on the line, that inserts a column left or right (or a row above or below) right there. A row's grip stays at its left end.
- Bold text in a Markdown sheet's Formatted mode and preview now stands out clearly from the text around it; both use a font with a true bold weight.
- Printing and PDF now keep rows as tall as on screen: when the sheet does not wrap long text, each row prints one line tall and the text is cut at the cell's edge, as on screen. Banded rows print too when the sheet shows them, in the sheet's band strength.

### Fixed

- **Flash Fill works on a table with a heading row.** With the heading typed
  in the column to fill, Flash Fill treated it as an example and found no
  pattern. It now skips the heading and fills from the examples under it.
- **Password managers no longer offer to fill app fields.** Entry fields such
  as the name box, Find, and dialog inputs showed 1Password and similar
  prompts; they are now marked as not login fields.
- **A locked sheet cannot be typed into in the Markdown, JSON, YAML and text
  editors.** Before, the editor let you type and only refused the change when
  it was saved, which asked about unlocking every time you switched sheets.
  The editor is now read-only while the sheet is locked.
- **Automatic formatting of YAML keeps what you wrote.** An empty value
  (`aaa:`) no longer becomes `aaa: null`, `~` stays `~`, and comments are
  kept. Only indentation and spacing change.
- **Formatting JSON keeps numbers as written.** `1.0` stays `1.0` and long
  integers keep all their digits.
- **Automatic formatting waits until you leave the editor.** It no longer runs
  while you pause typing, so the text does not change under the cursor and
  half-typed JSON or YAML does not show an error. The option now reads
  "Format automatically when you leave the editor".
- In a Markdown sheet (and a JSON or YAML sheet with its preview open), the preview now scrolls along with the editor, and the editor with the preview. The preview's panel was scrolling instead of the preview itself, so the two never moved together.

## [0.9.21] - 2026-09-29

### Added

- **Faster toolbar tooltips.** A toolbar button's name and shortcut now
  appear about a third of a second after you point at it, and at once as you
  move along the toolbar, instead of after the browser's usual wait.
- **Reorder the toolbar by dragging.** In View > Customize Toolbar…, drag a
  command by the grip at the start of its row. The Up and Down buttons still
  work.
- **Show or hide the toolbar from File > Settings…**, as well as from View >
  Show Toolbar.

### Changed

- **Toolbar and menu commands turn off where they do nothing.** Bold, colors,
  borders and the other cell formatting are off on a CSV, on a Markdown,
  JSON, YAML or text sheet, on a grid paper sheet, and while a shape is
  picked, and the button's tooltip says why. Sort, filter, fill and the
  other cell commands are off on a Markdown, JSON, YAML or text sheet.

### Fixed

- **Cut on a Markdown, JSON, YAML or text sheet no longer empties the
  sheet.** The toolbar's and the Edit menu's Cut, Copy and Paste now act on
  the text you selected in the sheet's editor. Before, Cut removed the whole
  text.

## [0.9.20] - 2026-09-29

### Fixed

- **Typing into a cell after unlocking a file works again.** After you
  unlocked an opened file (or closed any other dialog), selecting a cell and
  typing without pressing F2 first saved the cell as empty. Now the text you
  type goes into the cell.

## [0.9.19] - 2026-09-29

### Added

- **Sort and filter a CSV without converting it.** Sheet > Filter & Sort
  (Sort…, Filter…, and the filter buttons on the header row) now works on a
  CSV file as it is. The sort and filter only change which rows show and in
  what order: the file stays a CSV and saving writes the same bytes as
  before. They stay on after saving, and carry over if you convert the file
  to an RSF spreadsheet. On a CSV, a filter is not an undo step.
- **Grid paper sheets.** Sheet > Add Grid Paper Sheet (or Grid paper sheet
  in the Add Sheet dialog) adds a sheet of small squares for forms, screen
  mock-ups and wireframes. Its squares stay empty: text goes in text boxes,
  and a text box inserted over several selected squares covers them.
  Shapes, pictures and charts on grid paper are placed, dragged, resized and
  moved with the arrow keys square by square, and the sheet prints with
  squares of the same size. Its tab shows a grid icon. Releases without grid
  paper open the file as an ordinary sheet with the same objects.
- **Save objects as a picture, and print them.** Insert > Save Objects as
  PNG Image… and Save Objects as SVG Image… (also on an object's right-click
  menu) save the selected shapes, pictures and charts as one image, laid out
  and stacked as on the sheet, on a transparent background. File > Print…
  now prints shapes, pictures and charts over the cells, each from the cell
  it is anchored to. Hidden objects are left out of both.

## [0.9.17] - 2026-09-29

### Added

- **Group, align and space out objects.** Insert > Group makes the
  selected shapes, pictures and charts one group: clicking any member
  selects the whole group, so it moves, copies and deletes as one, and
  clicking a member of a selected group again selects just that one to edit
  it. Insert > Align lines the selected objects up on their left edges,
  centers, right edges, tops, middles or bottoms, or spaces three or more
  evenly across or down (a whole selected group moves as one). While
  dragging, objects snap to the edges and middles of other objects, with a
  guide line showing each match; hold Alt to snap to cell corners instead.
- **Copy and paste shapes, pictures and charts.** With objects selected,
  Cut, Copy and Paste (Ctrl+X, Ctrl+C, Ctrl+V, the Edit menu, or the
  object's right-click menu) act on the objects: paste onto the same sheet,
  another sheet, or another open file. A chart pasted within its file keeps
  showing its cells; pasted into another file it keeps the values it showed,
  so it never depends on the first file. The object list edits the values
  such a chart keeps as tab-separated text, and "Put Data in a New Sheet"
  moves them into a new sheet the chart then shows (one undoable step).
- **Charts on a sheet.** Insert > Chart draws a bar chart of the selected
  cells (or of the filled block around the selected cell) beside them on an
  RSF spreadsheet sheet. The chart updates as the cells change, and its
  range follows rows and columns inserted or deleted in its sheet. The
  object list switches it to a line or pie chart and changes its sheet and
  range, whether each column or each row is a series, its title, axis
  titles, legend, series colors and value labels. Deleting the sheet a
  chart shows warns first; the chart then keeps the values it showed, and
  undo brings the range back.
- **Pictures on a sheet.** Insert > Image… places a PNG, JPEG, WebP or SVG
  picture at the selected cell of an RSF spreadsheet sheet, and Ctrl+V
  places a copied picture when the clipboard holds no text. A picture is
  saved inside the RSF file, once however many times it is placed, and
  only while something still shows it. Dragging a corner keeps its
  proportions (hold Shift, or turn off "Keep proportions when resizing" in
  the object list, to stretch it); the object list also crops it, flips it
  and rotates it. Pictures up to 20 MB each.
- **Shapes on a sheet.** The new Insert menu adds a rectangle, ellipse,
  line, arrow or text box at the selected cell of an RSF spreadsheet sheet
  (a CSV file is converted first). Drag a shape to move it (hold Alt to
  snap it to a cell corner), drag its handles to resize it, and use the
  arrow keys to nudge it (Shift for 10 pixels); Delete removes it. A shape
  moves with the cells when rows or columns are inserted, deleted or
  moved, and keeps its size when a row height or column width changes.
  Insert > Object List… lists the sheet's shapes front first: show or hide
  each, change the stacking order, and set its name, position and size (in
  pixels or millimeters), rotation, fill, line and text. Two locks keep a
  shape as it is: **Fix Position** stops moving and resizing, and **Lock
  Editing** also stops changing or deleting it. Every change can be undone,
  and shapes are saved in the file.
- **A toolbar you can arrange.** A row of buttons above the formula bar
  runs common commands (Save, Undo, Redo, Cut, Copy, Paste, Bold, Italic,
  Underline, Font, colors, Borders, Sort, Filter). View > Customize
  Toolbar… (or the button at its right end) lets you reorder the buttons,
  remove them, add any other menu command that has an icon, and reset to
  the default set. View > Show Toolbar hides it. These choices are saved in
  this browser only, never in a file, so files look the same on every
  computer.

- **Choose a font and size for cells and for parts of a cell's text.**
  Format > Font… sets the selected cells' font and size (in points), and
  the toolbar over text selected in the cell editor now has font and size
  lists for just that text. The lists offer the sheet fonts plus Arial,
  Times New Roman and Courier New, and, where the browser allows it, Show
  Fonts on This Device… adds the fonts installed on your computer. A file
  opened on a computer without the chosen font shows the text in the sheet
  font and keeps the font you chose. Rows do not yet grow to fit larger
  text.

- **Edit Markdown sheets formatted.** A Markdown sheet's toolbar now
  switches between Markdown and Formatted. Formatted shows the document as
  it reads and lets you edit headings, paragraphs, lists, quotes, code
  blocks and table cells in place, change a block's type, and make text
  bold, italic or code. The sheet is still saved as Markdown text, and only
  the parts you edit are rewritten. Undo from the Edit menu now also
  updates a Markdown sheet's text while it is open.

- **Build SQL queries without typing SQL.** Data > Run SQL Query… now has
  Build a Query: tick the columns to show, add conditions (equals, greater
  than, contains, is blank, …) matched all or any, group rows by a column
  with counts, sums, averages, minimums and maximums, sort, and limit the
  rows. The query box fills in as you choose and can still be edited by
  hand. After a query runs, Put Results in New Sheet copies the result into
  a new sheet (undoable); from a CSV file it opens a new spreadsheet tab.
  Queries still only read the data.

- **Version history shows what changed.** Previewing a saved version
  (Sheet > File Version History… > Preview) now highlights the cells whose
  value or formula changed and, with a different mark, those whose
  formatting changed since the version saved before it, counts them, lists
  sheets added, deleted or renamed, and steps through the changes with Go
  to Next Change. The highlight can be turned off.

- **Print and PDF.** File > Print… prints the current sheet, the selected
  cells, or every sheet of the file, with paper size, orientation, shrink
  to the page width or a scale, gridlines, row numbers and column letters,
  the first row repeated on every page, and rows per page. It prints what
  the sheet shows, including formatting, sort and filter. To make a PDF,
  choose Save as PDF in the print dialog.

- **`&` joins text in formulas.** `=A1&" "&B1` puts values together as
  text, the same as `CONCAT`. Numbers and TRUE/FALSE join as they are
  written, an empty cell adds nothing, and an error in either side is the
  result. `&` binds more loosely than `+ -` and more tightly than the
  comparisons, so `=1+2&3` gives `33`. Formulas using `&` used to show
  an error.
- **Column rules and more kinds of data validation.** Data > Data
  Validation… can now require whole numbers, limit text length, or accept
  only dates (`YYYY-MM-DD`, optionally between two days), and can refuse
  blank cells. Ticking "Apply to all of columns" makes the rule cover
  those columns to the last row, below the header if you like, including
  rows added later. A refused value now says why.
- **Data > Check Data…** lists every cell whose value breaks its rule, on
  the sheet or across the file, and goes to a cell when you select it.

### Changed

- **Data validation rules are saved with the file.** Rules set with
  Data > Data Validation… are now kept in the RSF file, can be undone and
  redone, and follow rows and columns: inserting inside a rule's range
  grows it, deleting shrinks it, and moving rows or columns takes their
  rules along. Before, rules lasted only until the tab closed and any row
  or column insert or delete removed them all. Older versions open such
  files and ignore the rules.

## [0.9.16] - 2026-09-28

### Added

- **Sheet tab colors.** Sheet > Sheet Tab Color… (or right-click a sheet
  tab) gives a sheet's tab a color, from nine ready-made colors or any
  color you pick. The color shows as a bar along the tab, is saved in the
  RSF file, is kept when you duplicate the sheet, and can be undone.
  **No Color** removes it. Older versions open such files and ignore the
  color.
- **Sheet folders.** Sheet > Move to New Folder… groups a sheet into a
  folder, and Sheet > Move to Folder… moves it between folders; folders can
  sit inside folders. Click a folder in the sheet tabs to open or close it,
  or drop a sheet tab on it. Right-click a folder to rename it, move it,
  remove it while keeping its sheets, or delete it with its sheets (after a
  confirmation). Everything can be undone, and folders are saved in the RSF
  file. Older versions open such files and show the sheets without folders.
- **Sheet tabs on the left.** View > Sheet Tabs on the Left lists a
  file's sheets in a column beside the grid instead of a row under it, so
  long sheet names and many sheets stay readable. Up/Down arrows move
  between sheets there, and dragging a tab drops it above or below another.
  The choice is remembered in this browser. Narrow screens such as phones
  keep the row.

## [0.9.15] - 2026-09-28

### Added

- **Open and save Markdown, JSON, YAML, and text files directly.** A `.md`,
  `.json`, `.yaml`/`.yml`, or `.txt` file now opens in its editor, and Save
  writes the text back into the same file, keeping its encoding, BOM, and
  line endings. If you add a second sheet, Save creates a new `.rsf` file
  instead and leaves the original alone.

### Changed

- A `.json` file now opens in the JSON editor and a `.txt` file in the text
  editor. To turn an array of JSON objects into a table, use
  **File > Import JSON as Table…**; to open a `.txt` file as a table, rename
  it to `.csv` or `.tsv`.
- RSF files are much smaller when they keep version history. Each past
  version now stores only what changed since the next one, instead of a
  full copy of the workbook, so a save that edits a few cells adds a few
  hundred bytes. A 2,000-row sheet with 20 saves drops from about 940 KB to
  about 51 KB, and such files open and save faster. The JSON inside is also
  written without indentation. Files saved by earlier versions still open,
  history included; releases up to 0.9.14 open the new files without their
  version history.

### Fixed

- **The YAML check catches mis-indented lines.** YAML reads a line indented
  further than the one above as the rest of that value, so a `- item` or
  `key: value` indented one step too far, or stray brackets, used to pass as
  "no syntax errors". The check now points at such a line and says which
  value it was folded into. An alias (`*name`) with no matching anchor is
  also reported.
- Scrolling the grid quickly no longer flashes the dark gray of the area
  outside the sheet where rows have not been drawn yet; the sheet stays white.

## [0.9.14] - 2026-09-27

### Added

- Hovering a row number or column letter shows a grip and a small + button.
  Drag the grip to move the row or column (or all the selected ones) to
  another place in an RSF sheet; the rows or columns in between close up,
  and formulas, formatting, comments, and column widths move with the cells.
  The + inserts one row below or one column to the right.

### Fixed

- Inserting or deleting columns now moves the column widths with the
  columns, so each column keeps its width and a new column starts at the
  default width. Undoing a column delete brings back the deleted columns'
  widths.
- The small move handle at the top-left of a selection no longer shows on a
  desktop or laptop driven by a mouse, even when it also has a touch screen.
- After copying, the moving dashed border around the copied cells is no
  longer hidden under the selection's solid border.

## [0.9.13] - 2026-09-27

### Changed

- **Filter & Sort from Headers.** The menu item that puts filter buttons on
  the header row is renamed from "Filter Buttons on Header Row", and it is now
  in the right-click menu too, with a check mark while it is on. The header
  buttons are small rounded squares instead of pills. A column with no values
  gets no button until something is typed into it.

### Fixed

- **The JSON/YAML syntax check no longer misses your last edit.** If you
  typed an error and then clicked outside the editor (or switched sheets)
  straight away, the line under the editor kept saying there were no syntax
  errors. It now re-checks on its own as you type and again when the editor
  loses focus.

### Changed

- In File > Settings…, every "Not specified" choice now says what then
  applies: the default (for example, "Not specified (default: Light)"), the
  value last used for zoom and wrapping, or — for the file — this browser's
  setting, which updates as you change it in the same dialog.
- The row and column headers are lighter again, and the area past the last
  row and column is now clearly darker than the headers in the light theme
  and a lighter gray in the dark theme, so the edge of the table stands out.
- Side panels now close only from the × at the top right of the panel (or
  Escape). The Close button at the bottom of Filter, Sort, Format, Data
  Validation, Conditional Format, Color, Borders, Number Format and SQL
  Query is gone; View > Comments Panel and the Show preview button of
  Markdown, JSON and YAML sheets now only open their panel instead of
  closing it when pressed again.
- **A file can be open in only one place at a time.** Opening a file that
  another browser tab of the app already has open now says so and does not
  open a second copy, so two copies can no longer overwrite each other's
  saves. Opening an `.rsf` file that is already open in this window now
  switches to its tab, as CSV files already did. Files opened without the
  browser's file access (for example in Firefox) cannot be recognised and
  are not checked.

## [0.9.12] - 2026-09-27

### Added

- Banded rows now come in three strengths — Light, Medium, and Dark — chosen
  in File > Settings…. Light, the default, is as faint as bands were before
  the recent redesign made them darker.
- View > Gridlines turns the lines between cells on or off, View > Highlight
  Selected Row turns the tint of the selected cell's row on or off (on by
  default), and the new View > Highlight Selected Column tints its column
  (off by default).
- Like zoom, wrapping, and font, these settings can be set for a sheet, for
  an RSF file (File > Settings…), and for this browser (File > Settings…);
  the narrowest one wins. In an RSF file, the View menu changes the current
  sheet; in a CSV file, it changes this browser's setting.

### Changed

- Row numbers and column letters sit on a darker background, and the area
  past the last row and column is shaded instead of white, so the edges of
  the sheet are easy to see.

## [0.9.11] - 2026-09-27

### Fixed

- Saving no longer silently overwrites changes made to the same file
  elsewhere. When the file was saved from another browser tab or changed by
  another app after you opened it, Save now asks whether to overwrite it,
  save to a different file, or cancel.

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
