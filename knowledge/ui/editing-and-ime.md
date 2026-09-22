---
type: ui-concept
title: Editing and IME safety
description: Inline cell editing, the formula bar as a second edit surface, multi-line editing, and the user-facing flow behind the IME-safe hidden "sink" textarea.
sources:
  - resource: ../../README.md
  - resource: ../../src/ui/grid.ts
  - resource: ../../tests/ime-composition.test.ts
status: stable
generated:
  by: claude-code/claude-sonnet-5
  at: 2026-09-22T16:27:14Z
---

# Editing and IME safety

## Starting an edit

A cell enters edit mode four ways: **click** to select then **double-click**,
press **F2**, or simply **start typing**. Inline editing never shifts the
table layout — the editor is laid over the cell's existing box, not inserted
into the flow. **Enter** commits and moves the selection down one row;
**Esc** cancels the in-progress edit and restores the prior value.

The **formula bar** above the grid is a second, always-visible edit surface
for the same selected cell: **Enter** applies the edit and moves down,
**Alt+Enter** inserts a newline, and **Esc** restores the value the cell had
when it was selected. Both surfaces stay in sync with the active cell and
behave identically for formula autocomplete and pointer-entered references
(see [selection-and-navigation.md](selection-and-navigation.md) and the
formula-editing behavior documented in `README.md`'s "Formula autocomplete
and pointer references" section).

## Multi-line editing

Both the inline editor and the formula bar are multi-line surfaces:
**Alt+Enter** inserts a line break at the caret (replacing any active
selection) without committing the edit, moving the selection, or opening a
menu. A multi-line value round-trips through CSV (the edited field is quoted
per the minimal-diff rules — see
[../formats/index.md](../formats/index.md)), through RSF, through undo/redo,
through copy/paste, and through Wrap Long Rows, which grows the row to fit
the extra lines (see
[theming-and-visual-system.md](theming-and-visual-system.md) for the
row-height/wrapping model).

## Visual feedback while editing

- Edited cells are tinted yellow; hovering one shows the original value as a
  plain-text tooltip.
- Right-click a cell for **Revert Cell to Original**; **Edit > Revert All
  Edits** discards every edit in the document as one undoable step.
- Selected rows stay highlighted while unselected rows keep their
  alternating (zebra) background.
- The inline-editor / formula-bar usage guidance (Enter commits and moves
  down, Alt+Enter inserts a newline, Esc cancels, `=` starts a formula in
  RSF) is not persistent chrome — it is a **tooltip** on both surfaces plus
  an equivalent ARIA description announced on focus. **View > Editing Help
  Tooltips** toggles it (default: enabled); the preference lives only in
  `localStorage`, never in a document, and the tooltip never obscures the
  active cell, the caret, autocomplete, or IME composition UI.

## IME safety — the user-facing flow

Japanese/CJK IME input is safe **from the first keystroke**. This is the most
safety-critical piece of the editing surface: a composition that leaks its
first Romaji character as a literal Latin letter, or that starts in a
non-editable element and has to be re-parented mid-composition, is a
data-corrupting bug class for CJK users specifically.

What the user experiences:

1. The grid's keyboard target is a **permanently mounted, hidden text field**
   (informally "the sink") that keeps DOM focus while the user navigates the
   grid with the mouse or arrow keys — even though no cell is being edited
   yet.
2. Because the sink is already an editable text field, an IME composition
   that begins the instant the user starts typing on a selected cell starts
   **inside an already-editable element** — never in a `<div>` or other
   non-editable node that would have to be swapped out mid-composition.
3. Typing **promotes that same element in place** into the cell editor: it
   is never re-parented and never re-focused mid-composition. The first
   Romaji character therefore joins the IME composition instead of being
   committed as a literal character.
4. The key that started the edit is **never synthesized** from `keydown` /
   `keypress`, and is never consumed by application logic while a
   composition is active — editing is driven entirely by the standard
   `beforeinput` / `input` / `composition*` events and `isComposing`.
5. While a composition is active, the editor stays mounted and focused, and
   **Enter / Esc / arrows / autocomplete belong to the IME** — Enter confirms
   an IME candidate, never the cell — until composition completes.
6. The same guards apply to the **formula bar**, the second edit surface.

This file describes the user-visible editing flow this architecture
produces. The underlying guarantee — "no printable character is ever
synthesized from `keydown`, composition never starts in a non-editable
element" — is recorded as an invariant in
[../architecture/invariants.md](../architecture/invariants.md) (see its "IME
safety" bullet); that file is the durable guarantee tests protect, this file
is how it reads from the keyboard. `tests/ime-composition.test.ts` covers
composition detection (`isComposing` / `keyCode` 229 / a tracked flag),
typing opening an empty editor without synthesizing the key or calling
`preventDefault`, Enter/Esc belonging to the IME while composing, the editor
surviving a rerender mid-composition, and the formula bar's own composition
guard.

The mobile/touch variant of the same "focus without popping the keyboard"
technique — marking a field `readOnly` for a tap-to-select focus, then
restoring it — is a related but distinct mechanism; see
[mobile-and-touch.md](mobile-and-touch.md).
