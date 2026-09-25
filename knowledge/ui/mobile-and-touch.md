---
type: ui-concept
title: Mobile and touch
description: Touch drag gestures, on-screen-keyboard suppression rules, and phone-width layout adaptations, grounded in code and tests rather than the (touch-thin) README.
sources:
  - resource: ../../tests/grid-touch.test.ts
  - resource: ../../tests/mobile-input-focus.test.ts
  - resource: ../../tests/mobile-menu.test.ts
  - resource: ../../tests/status-bar.test.ts
  - resource: ../../tests/mobile-zoom.test.ts
  - resource: ../../tests/side-panel-mobile-dock.test.ts
  - resource: ../../src/styles/mobile-layout.css
  - resource: ../../src/ui/dom.ts
  - resource: ../../src/ui/grid.ts
  - resource: ../../src/ui/popup.ts
  - resource: ../../tests/keyboard-viewport-fix.test.ts
  - resource: ../../tests/grid-autoscroll.test.ts
  - resource: ../../src/ui/viewport-debug.ts
  - resource: ../../tests/focus-on-tap.test.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Mobile and touch

`README.md` barely mentions touch, so this file is grounded directly in
`src/ui/`, `src/styles/mobile-layout.css`, and the mobile/touch test suite
(`tests/grid-touch.test.ts`, `tests/mobile-input-focus.test.ts`,
`tests/mobile-menu.test.ts`, `tests/mobile-zoom.test.ts`,
`tests/side-panel-mobile-dock.test.ts`). Where a behavior is not confirmed
by one of these, it is either omitted here or explicitly caveated — nothing
below is inferred from the README's touch-thin prose alone.

## Touch drag gestures on the grid

The grid listens to pointer events and distinguishes `pointerType`, so
mouse listeners and touch/pen listeners never both fire for the same
gesture (`tests/grid-touch.test.ts`, "ignores pointer events whose
pointerType is 'mouse'"). Two different start rules apply, by design:

- **Handle-anchored drags start immediately on touch**, exactly like a
  mouse press — no hold required. This covers: the column-resize handle,
  the fill handle, and the range-move handle. A touch-drag on any of these
  three behaves like the mouse-drag documented elsewhere (see
  [column-resize-and-autofit.md](column-resize-and-autofit.md) and
  [copy-paste-fill-and-flash-fill.md](copy-paste-fill-and-flash-fill.md)).
- **Plain cell/header drags need a brief press-and-hold first** (400ms in
  the test suite) before they arm a range-selection drag. A quick tap
  before the hold completes never arms a drag — it is left entirely to the
  browser's own synthetic click/tap-to-select, so a plain tap keeps
  ordinary scrolling and tap-to-select working unchanged. Real movement
  during the hold window (past a small jitter tolerance) is read as the
  start of a scroll and cancels the pending drag rather than starting a
  selection.

**Long-press also opens the context menu**, as the touch equivalent of a
right-click: a completed press-and-hold that lifts with no further movement
opens the context menu (on both cells and row/column headers); a quick tap,
a hold that turns into a drag, or a `pointercancel` all suppress it. The
completed hold tolerates small coordinate jitter from a genuinely held
finger without treating it as the start of a drag and cancelling the
pending menu.

**Double-tap opens the inline cell editor**, mirroring `dblclick` on
desktop: a second quick tap landing on the _same_ cell within a 300ms
window (in the test suite) opens the editor; a tap on a different cell, a
tap arriving after the window, or a tap that follows a completed
press-and-hold (rather than two plain taps) does not.

## On-screen-keyboard suppression

A single tap-to-select must not pop the on-screen keyboard; only an action
that actually opens an editable field (double-tap, or explicitly focusing a
text field) should. The mechanism, shared across the grid and every dialog/
docked-panel text field (the Find and Replace panel included):

- **The technique** is to focus the field with `readOnly` set, then restore
  `readOnly` to its normal value immediately after — a standard trick for
  moving DOM focus without triggering a mobile browser's on-screen
  keyboard. `focusWithoutKeyboard` (`src/ui/dom.ts`) is the shared
  implementation, gated on `matchMedia('(pointer: coarse)')` so a
  fine-pointer (mouse) device focuses fields normally.
- **On the grid**, the same technique is applied to the grid's hidden
  keyboard-target "sink" textarea (see
  [editing-and-ime.md](editing-and-ime.md) for what the sink is normally
  for): a touch tap-to-select focuses the sink read-only, so no keyboard
  appears, and a subsequent double-tap that actually opens the cell editor
  focuses it normally (not read-only), so the keyboard appears exactly when
  editing starts. That focus must go to a _different_ element: iOS Safari
  shows no keyboard for blurring and refocusing the same, already
  silently focused textarea (the on-device keyboard probe, #588), so the
  double-tap swaps in a fresh sink (`Grid.replaceSink`) and focuses it
  (#590). Two taps pair into a double-tap when both hit the same cell
  within `DOUBLE_TAP_MS` and `DOUBLE_TAP_SLOP_PX` (30px; a finger's second
  tap often lands 10-15px away). A brand-new document's first render also claims keyboard
  focus before any touch event has reached that `Grid` instance; the
  pointer-type tracking defaults safely so that first claim is still
  treated as keyboard-safe rather than assumed to be a mouse user.
- **Elsewhere**, `focusWithoutKeyboard` covers dialog/popover/docked-panel
  autofocus and the Find and Replace panel's input — opening any of these on a
  touch device does not pop the keyboard, but the Find field's text is
  still selected as usual once focus lands.
- **On-device keyboard diagnostics.** Emulation does not reproduce how
  iOS Safari moves the viewport when the keyboard opens, so
  `installViewportDebug` (`src/ui/viewport-debug.ts`) adds an opt-in panel
  when the URL hash is `#debug-viewport` (#582). It logs the visual
  viewport, page scroll, `#app`, grid, and editor geometry on each
  viewport/scroll/focus/keyboard event and every frame shortly after, and
  copies the log. Without the hash it installs nothing. It also logs how
  each tap ends (`pointerup` / `pointercancel` / `click`) and has a
  keyboard probe (#588): buttons that focus a test field from `pointerup`,
  `touchend`, `click`, or the grid's own silent-focus-then-refocus
  sequence, to learn which ones iOS answers with a keyboard.
- **No reveal scroll for the formula bar.** A text field focused natively
  by a tap, where the keyboard will cover it, makes iOS Safari scroll the
  whole page up (animated) before the app re-fits above the keyboard.
  A field focused from script with `preventScroll` gets the keyboard
  without that scroll (the grid's editor, per the on-device log).
  `focusOnTapWithoutRevealScroll` (`src/ui/dom.ts`) therefore takes over a
  quick tap on the unfocused formula bar on `touchend` (#592). Taps on the
  focused bar, scrolls, and long-presses stay native.
- **iOS Safari auto-zoom prevention.** Mobile Safari zooms the page in on
  a focused text control whose computed font size is under ~16px.
  `src/styles/mobile-layout.css` floors every dialog text
  input/select/textarea (including the SQL query editor and the
  data-validation list-values field), the Find and Replace panel's inputs, the formula
  bar, and the grid's cell editor/resting cells to 16px at the mobile
  breakpoint — the grid and formula bar use `max(16px, …)` against their
  own zoom-scaled font size so the floor only engages below roughly 130%
  spreadsheet zoom (see
  [theming-and-visual-system.md](theming-and-visual-system.md) for the
  zoom sizing model this floor sits on top of).
- **The app fits the visible area while the keyboard is open.** iOS
  Safari pushes the page up when the keyboard opens, which used to hide
  the menu bar and top rows, including a cell being edited near the top.
  `installKeyboardViewportFix` (`src/ui/popup.ts`) detects an open keyboard
  (`isKeyboardLikelyOpen`), sets `data-keyboard-open` on the root, and pins
  `#app` to the visual viewport's top and height. While the keyboard is
  open it no longer resets the page scroll, which fought WebKit on every
  keystroke (#574); it resets it once the keyboard closes (#402). Each
  open/close transition is announced through `onKeyboardOpenChange`, and a
  height change while open through `onKeyboardResize`. When a touch
  edit-entry gesture opens the editor, the grid remembers its scroll
  position (forgotten if the editor closes with no keyboard open). The
  editor must stay in place and visible while it takes focus: parking it
  transparent at the top of the screen to avoid Safari's reveal scroll
  (v0.8.11) stopped iOS from showing the keyboard at all, as the on-device
  `#debug-viewport` log showed, and was removed (#586). On open,
  `Grid.keyboardOpenChanged` scrolls the edited (or selected) cell to the vertical middle of the
  grid's shortened scroll area (`centeredScrollOffset`,
  `src/ui/grid/center-scroll.ts`); for a second after, each further shrink
  (the keyboard still sliding in) re-centers it (`keyboardResized`). On
  close the remembered position is restored. The same happens when the
  keyboard opens for the formula bar, which sits below the grid on phones
  and edits the selected cell: `main.ts` registers it with
  `Grid.addKeyboardEditField` (#584 — the on-device `#debug-viewport` log
  showed this path had been skipped). The inline
  editor stays open across a grid scroll as long as its cell is still
  rendered (it commits only once the cell leaves the window).

## Phone-width layout adaptations

`src/styles/mobile-layout.css` gates a `@media (max-width: 700px)` block
that changes layout without touching desktop-width behavior:

- **The formula bar moves below the grid**, directly above the worksheet
  strip, instead of above the grid — thumb reach while typing matters more
  on a narrow viewport than the desktop convention of a formula bar above
  the grid.
- **The top-level menu row collapses behind a hamburger toggle**
  (`.menu-bar-toggle`), a separate top-level element (not nested inside the
  menu bar) so it can sit in its own column past the status bar, within
  thumb reach. Expanding it wraps the File/Edit/… items onto their own
  full-width row below the logo row, rather than scrolling horizontally —
  a deliberate change from an earlier horizontal-scroll design, because
  iOS Safari's inertial-scroll-then-synthetic-click-at-the-original-touch-
  point behavior could open a different menu item than the one actually
  tapped. The expanded names sit in an even four-column grid rather than
  wrapping wherever each name ends (#594). A menu taller than the viewport
  scrolls vertically in place instead of pushing the rest of the app
  off-screen.
- **Bottom-row reorganization.** The app shell becomes a small CSS grid at
  this width: the app icon, the status bar, and the menu-bar toggle occupy
  three grid columns in the app's bottom row, so the hamburger stays at the
  far edge within thumb reach while the status bar keeps the middle. The
  app's logotype gives way to just the icon (with the app name kept
  visually hidden but still in the accessibility tree).
- **A one-line status bar** (#594). The file details — document kind,
  encoding, delimiter, line endings, size, engine, grid size, compression,
  formula count, and the version — are marked `.status-detail` and hidden
  behind a **Details** button (`aria-expanded`), which stays open across
  re-renders. Protection, problems, unsaved/edit state, filter/sort, and the
  selection stay visible. Desktop always shows everything and never shows
  the button.
- **A compact document tab row.** The close button's 36px tap target sets
  a tab's height; the tab adds only a 2px frame around it.
- **Dockable side panels** (Filter/Sort/Format/SQL Query/Comments/Find and Replace/preview —
  see [view-formatting-and-panels.md](view-formatting-and-panels.md))
  default to docking at the **bottom** instead of the desktop default of
  the right edge, specifically on a narrow, portrait viewport
  (`(max-width: 700px) and (orientation: portrait)`) — there is little
  usable width for a left/right split there. This is only the _default_:
  once a user explicitly picks a dock side from the panel's header
  switcher, that explicit choice is remembered for the rest of the session
  regardless of viewport, exactly as on desktop.
- Tap targets grow at this width: tabs, worksheet-strip tabs, menu items,
  dialog buttons, and the menu-bar toggle all carry explicit minimum
  height/width floors (36–44px) so padding trims do not shrink the actual
  touch target.
- Toasts sit at the top-right on every screen size, away from where a
  phone's thumb rests and where the on-screen keyboard first appears.
- Narrow dialog rows (label + select, the Filter condition row, the Sort
  key row) wrap onto their own lines instead of forcing horizontal dialog
  scroll, and the standalone Markdown editor's fixed side-by-side
  source/preview split stacks vertically instead.

This is a shorter file than the others in this domain because it is scoped
to what code and tests actually assert; broader touch/mobile UX claims
(e.g. specific gesture affordances beyond the ones above) are not made here
without that grounding.
