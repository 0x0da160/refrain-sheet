// SPDX-License-Identifier: MIT
/**
 * The IME-safe editing session: the hidden keyboard sink, its promotion into
 * the in-cell editor, commit/cancel, and the editor's autocomplete,
 * reference highlighting, validation picker and rich-text companions.
 * See knowledge/ui/editing-and-ime.md.
 *
 * A collaborator of the grid (see `./core.ts`): it owns no state of its own
 * beyond what is declared here, and reaches shared grid state through
 * `this.core`.
 */
import { isWorkbook } from '../../core/editor-document';
import type { Tab } from '../../app/state';
import { t } from '../../app/i18n';
import { getEditHints } from '../../app/settings';
import { dateStampKeyOf, localDateStamp } from '../../app/shortcuts';
import { runsForText } from '../../core/workbook/rich-text';
import { extractFormulaRefs } from '../../core/formula';
import { FormulaAutocomplete, FormulaFieldRef, isRefToggleKey } from '../formula-autocomplete';
import { isComposingKey } from '../ime';
import { createSink, richFormatKeyOf } from './dom-support';
import { ValidationPicker } from '../validation-picker';
import { RichCellEditor } from '../rich-cell-editor';
import type { GridCore } from './core';

export class EditSession {
  constructor(private readonly core: GridCore) {}

  /** Attach the sink's IME and editing listeners (see `createSink`, `replaceSink`). */
  wireSink(sink: HTMLTextAreaElement): void {
    sink.addEventListener('compositionstart', () => {
      this.core.composing = true;
      // A composition that starts while navigating promotes the sink into the
      // cell editor in place (no focus change, no value reset) so the composed
      // text lands in the cell — including engines that fire no keydown first.
      if (!this.core.editor) {
        this.beginTypedEdit();
      }
    });
    sink.addEventListener('compositionend', () => {
      this.core.composing = false;
      if (this.core.editor) {
        // Composition committed text; refresh completions/highlights from it.
        this.core.editor.autocomplete.update();
        this.core.editor.updateRefs();
      } else {
        // A composition that never had a target cell leaves no stray text.
        this.core.sink.value = '';
      }
    });
    sink.addEventListener('beforeinput', (event) => {
      // Text about to be inserted while no editor is open (an engine that
      // fires neither keydown 229 nor compositionstart first) still promotes
      // the sink before the value changes. Never synthesized from keydown.
      if (!this.core.editor && event.inputType.startsWith('insert')) {
        this.beginTypedEdit();
      }
    });
    sink.addEventListener('keydown', (event) => this.sinkKeyDown(event));
    sink.addEventListener('input', () => this.sinkInput());
    sink.addEventListener('click', () => this.core.editor?.autocomplete.update());
    sink.addEventListener('blur', (event) => {
      // Moving to the formatted field or its toolbar keeps the edit open.
      if (!this.core.editor?.rich?.owns(event.relatedTarget)) {
        this.commitEditor();
      }
    });
  }

  /**
   * Swap in a fresh sink element, focused by the caller. iOS Safari only
   * brings up the on-screen keyboard for a focus that moves to a *different*
   * element: blurring and refocusing the sink that a tap-to-select already
   * focused read-only (#469) never shows it, while focusing another field
   * from the same `pointerup` does (on-device keyboard probe, #588/#590).
   */
  private replaceSink(): void {
    const old = this.core.sink;
    const fresh = createSink();
    this.wireSink(fresh);
    this.core.sink = fresh;
    old.replaceWith(fresh);
  }

  /**
   * Focus the grid's keyboard target (the hidden IME-capturing sink). A plain
   * touch/pen tap only selects a cell — it must not pop the on-screen
   * keyboard (#469) — so DOM focus still moves (scroll-into-view, IME
   * readiness, and any attached physical keyboard keep working exactly as
   * before), but the virtual keyboard is suppressed for that one focus call
   * by briefly making the sink read-only around it, the standard technique
   * for focusing an input without triggering a mobile on-screen keyboard.
   * `openEditor`'s own direct `.focus()` call when editing actually starts
   * (double-tap, Enter, F2, the formula bar, …) is untouched, so the
   * keyboard still appears exactly then.
   */
  focusGrid(): void {
    if (this.core.lastPointerType === 'mouse') {
      this.core.sink.focus({ preventScroll: true });
      return;
    }
    this.focusSinkSilently();
  }

  /** Focus the sink without ever popping the mobile on-screen keyboard —
   * the standard technique of briefly marking the target read-only around
   * the focus call. Used for focus claims that are never themselves an
   * explicit edit-entry gesture (a touch tap-to-select, or a document
   * becoming active with nothing else focused), regardless of device. */
  focusSinkSilently(): void {
    this.core.sink.readOnly = true;
    this.core.sink.focus({ preventScroll: true });
    this.core.sink.readOnly = false;
  }

  /** Promote the focused sink into an empty cell editor for type-to-edit. */
  private beginTypedEdit(): void {
    const tab = this.core.state.activeTab;
    if (tab?.selection && !this.core.editor) {
      this.openEditor(tab, tab.selection.row, tab.selection.col, '');
    }
  }

  // ----- Editing -----

  /**
   * Open the inline cell editor by promoting the permanent sink textarea in
   * place. `initial === null` edits the current value (the raw formula
   * expression for formula cells); the caret lands at `caretOffset` when
   * given (double-click: the clicked position) or at the end of the text
   * otherwise (F2: a common convention). `initial === ''` opens an **empty**
   * editor for type-to-edit — the sink already has focus and may already be
   * receiving the initiating keystroke or IME composition, so its value,
   * caret, and focus are deliberately left untouched (touching them would
   * abort the composition). Any other `initial` seeds the editor. The editor
   * is a `<textarea>`, so it holds multi-line values (Alt+Enter).
   */
  openEditor(tab: Tab, row: number, col: number, initial: string | null, caretOffset?: number): void {
    this.commitEditor();
    if (
      initial !== '' &&
      this.core.lastPointerType !== 'mouse' &&
      document.documentElement.dataset.keyboardOpen === undefined
    ) {
      // A touch edit-entry gesture (not type-to-edit, where a keyboard is
      // already delivering text) is about to bring up the on-screen keyboard.
      // Remember where the grid was before selecting the cell scrolls it:
      // restored when the keyboard closes (`keyboardOpenChanged`).
      this.core.keyboard.rememberScroll();
    }
    if (row < 0 || row >= tab.doc.rowCount || col >= tab.doc.fieldCount(row)) {
      return;
    }
    // A double-tap's first tap already focused the sink through `focusGrid()`'s
    // read-only suppression (#469). iOS Safari shows no on-screen keyboard
    // for refocusing that same element, even after a blur (on-device probe,
    // #588), but does for focus moving to a different one: so swap in a
    // fresh sink to focus below. Not for `initial === ''`, the type-to-edit
    // path, where the sink is deliberately already focused and mid-keystroke/
    // IME-composition (#487).
    if (
      initial !== '' &&
      this.core.lastPointerType !== 'mouse' &&
      document.activeElement === this.core.sink
    ) {
      this.replaceSink();
    }
    this.core.navigation.select(tab, row, col, true);
    const cell = this.core.pointer.cellAt(row, col);
    if (!cell) {
      return;
    }
    const input = this.core.sink;
    input.classList.add('cell-editor');
    input.setAttribute('aria-label', t('formulaBar.label'));
    // Editing-help tooltip (preference-controlled): a native title for the
    // mouse plus an ARIA description for keyboard/screen-reader users.
    // Attribute-only changes — the value, caret, and any live IME
    // composition are untouched.
    if (getEditHints()) {
      input.setAttribute('title', t('formulaBar.hint'));
      this.core.editorHint.textContent = t('formulaBar.hint');
      input.setAttribute('aria-describedby', 'grid-editor-hint');
    } else {
      input.removeAttribute('title');
      input.removeAttribute('aria-describedby');
    }
    this.placeSinkOverCell(cell);
    if (initial !== null && initial !== '') {
      input.value = initial;
    } else if (initial === null) {
      input.value = tab.doc.getValue(row, col);
    }
    // Autocomplete and pointer references, identical to the formula bar. The
    // popup floats (position: fixed) so the narrow cell never clips it.
    const autocomplete = new FormulaAutocomplete(input, document.body, true);
    // Pointer-entered references rewrite the field without an input event, so
    // the highlight refresh hooks the reference writer directly.
    const updateRefs = () =>
      this.core.cells.setFormulaRefs(input.value.startsWith('=') ? extractFormulaRefs(input.value) : []);
    const ref = new FormulaFieldRef(input, () => autocomplete.hide(), updateRefs);
    // While editing a formula inline, the grid routes cell clicks into this
    // field as references; restore whatever target was active (the formula
    // bar) when the editor closes.
    const prevRefTarget = this.core.state.formulaRefTarget;
    this.core.state.formulaRefTarget = ref;
    // The dropdown of allowed values for a `list`-kind data-validation rule
    // covering this cell, or null when none applies (including CSV
    // documents, where `validationAt` always returns null).
    const rule = this.core.commands.validationAt(tab, row, col);
    const pickerValues = rule?.rule.kind === 'list' ? rule.rule.values : null;
    const picker = new ValidationPicker(input, document.body);
    // Rich text applies only to a grid worksheet of an RSF file.
    const doc = tab.doc;
    const rich =
      isWorkbook(doc) && doc.activeSheet.kind === 'grid'
        ? new RichCellEditor(
            {
              input,
              container: this.core.canvas,
              cellStyle: () => (isWorkbook(tab.doc) ? tab.doc.getStyle(row, col) : null),
              navigationKey: (event) => this.editorNavigationKey(event),
              focusLeft: () => this.commitEditor(),
            },
            initial === null ? runsForText(doc.getStyle(row, col)?.runs, input.value) : null,
            initial !== null,
          )
        : null;
    this.core.editor = {
      row,
      col,
      input,
      autocomplete,
      ref,
      prevRefTarget,
      updateRefs,
      picker,
      pickerValues,
      rich,
    };
    input.focus({ preventScroll: true });
    if (initial === null) {
      // Never select-all here: that would silently replace the whole cell on
      // the next keystroke. Land the caret at the click position when known,
      // otherwise at the end of the text.
      const pos =
        caretOffset === undefined
          ? input.value.length
          : Math.max(0, Math.min(caretOffset, input.value.length));
      input.setSelectionRange(pos, pos);
    } else if (!this.core.composing && initial !== '') {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    // Offer completions immediately when a formula is being started/edited.
    autocomplete.update();
    updateRefs();
    this.refreshValidationPicker(this.core.editor);
    // A cell that already has formatted parts is edited showing them.
    rich?.begin(input.selectionStart ?? input.value.length);
  }

  /**
   * Show or hide the value-picker dropdown for the open editor: shown only
   * when the cell carries a `list`-kind validation rule and the field is not
   * currently a formula (the autocomplete popup owns that case instead) —
   * the two floating popups are mutually exclusive.
   */
  private refreshValidationPicker(editor: NonNullable<GridCore['editor']>): void {
    if (editor.pickerValues && !editor.autocomplete.isOpen) {
      editor.picker.update(editor.pickerValues);
    } else {
      editor.picker.hide();
    }
  }

  /** Handle a keydown on the sink while it is promoted to the cell editor. */
  private sinkKeyDown(event: KeyboardEvent): void {
    const editor = this.core.editor;
    if (!editor) {
      return; // navigating: the container-level onKeyDown handles it
    }
    // While the IME is composing, let it own every key (Enter confirms a
    // candidate, Escape cancels one, arrows move candidates). Never commit,
    // navigate, or run autocomplete on a composition keystroke.
    if (isComposingKey(event, this.core.composing)) {
      return;
    }
    const input = editor.input;
    // Ctrl+B / Ctrl+I / Ctrl+U format the selected part of the text.
    const richKey = richFormatKeyOf(event);
    if (richKey && editor.rich) {
      event.preventDefault();
      event.stopPropagation();
      editor.rich.toggle(richKey);
      return;
    }
    if (isRefToggleKey(event) && editor.ref.toggleReference()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Alt+Enter inserts a literal newline, Ctrl+; / Ctrl+Shift+; today's
    // date / the current time, at the caret (replacing any selection); none
    // of them commits, navigates, or opens a menu.
    const stamp = dateStampKeyOf(event);
    if ((event.key === 'Enter' && event.altKey) || stamp) {
      event.preventDefault();
      event.stopPropagation();
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(stamp ? localDateStamp(stamp) : '\n', start, end, 'end');
      editor.autocomplete.update();
      editor.updateRefs();
      editor.rich?.plainChanged();
      return;
    }
    if (editor.autocomplete.onKeyDown(event)) {
      return;
    }
    if (editor.picker.onKeyDown(event)) {
      return;
    }
    this.editorNavigationKey(event);
  }

  /** Enter / Tab commit (and move), Escape cancels — for either cell editor field. */
  private editorNavigationKey(event: KeyboardEvent): void {
    const tab = this.core.state.activeTab;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      // Ctrl+Enter (Cmd+Enter) commits and stays on the cell.
      if (tab && !event.ctrlKey && !event.metaKey) {
        this.core.navigation.moveSelection(tab, event.shiftKey ? -1 : 1, 0, false, 'enter');
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.commitEditor();
      if (tab) {
        this.core.navigation.moveSelection(tab, 0, event.shiftKey ? -1 : 1, false, 'tab');
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Restore the value the cell had when editing began.
      this.closeEditor(false);
      this.focusGrid();
    }
  }

  /** Handle an input event on the sink (both navigating and editing modes). */
  private sinkInput(): void {
    const editor = this.core.editor;
    if (!editor) {
      // Text reached the sink with no cell to edit (no tab/selection). Never
      // keep it — but never clear mid-composition, which would abort the IME.
      if (!this.core.composing) {
        this.core.sink.value = '';
      }
      return;
    }
    editor.ref.clear();
    // Don't recompute/overwrite completions mid-composition (compositionend
    // refreshes them from the committed text).
    if (!this.core.composing) {
      editor.autocomplete.update();
      this.refreshValidationPicker(editor);
    }
    editor.updateRefs();
    editor.rich?.plainChanged();
  }

  /** Position the sink exactly over a rendered cell (canvas coordinates). */
  placeSinkOverCell(cell: HTMLElement): void {
    const rect = cell.getBoundingClientRect();
    const origin = this.core.canvas.getBoundingClientRect();
    const s = this.core.sink.style;
    s.left = `${rect.left - origin.left}px`;
    s.top = `${rect.top - origin.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
  }

  /**
   * While navigating, keep the hidden sink parked at the selected cell so the
   * IME candidate window opens next to the cell the composition will edit.
   */
  positionSink(): void {
    if (this.core.editor) {
      return;
    }
    const tab = this.core.state.activeTab;
    const cell = tab?.selection ? this.core.pointer.cellAt(tab.selection.row, tab.selection.col) : null;
    if (cell) {
      this.placeSinkOverCell(cell);
    } else {
      const s = this.core.sink.style;
      s.left = '0px';
      s.top = '0px';
      s.width = '1px';
      s.height = '1px';
    }
  }

  /** Return the sink to its hidden navigating state (keeps focus untouched). */
  private demoteSink(): void {
    if (this.core.element.ownerDocument.documentElement.dataset.keyboardOpen === undefined) {
      // The editor closed without a keyboard ever opening (e.g. a hardware
      // keyboard): nothing to restore later.
      this.core.keyboard.forgetScroll();
    }
    this.core.sink.classList.remove('cell-editor');
    this.core.sink.value = '';
    this.core.sink.setAttribute('aria-label', t('grid.label'));
    this.core.sink.removeAttribute('title');
    this.core.sink.removeAttribute('aria-describedby');
    this.positionSink();
  }

  /** Tear down the editor's autocomplete popup and restore the reference target. */
  private disposeEditor(editor: NonNullable<GridCore['editor']>): void {
    editor.autocomplete.dispose();
    editor.picker.dispose();
    editor.rich?.dispose();
    editor.ref.endRef();
    if (this.core.state.formulaRefTarget === editor.ref) {
      this.core.state.formulaRefTarget = editor.prevRefTarget;
    }
    // The inline editor's formula is no longer being edited.
    this.core.cells.setFormulaRefs([]);
  }

  /** Commit the inline editor if open. */
  commitEditor(): void {
    const editor = this.core.editor;
    if (!editor) {
      return;
    }
    this.core.editor = null;
    const tab = this.core.state.activeTab;
    // Read the formatted field first: it writes its text back to the input.
    const runs = editor.rich?.runs();
    const value = editor.input.value;
    this.disposeEditor(editor);
    this.demoteSink();
    if (tab && tab.doc === this.core.lastDoc) {
      void this.core.commands.commitCellEdit(tab, editor.row, editor.col, value, runs);
    }
  }

  closeEditor(commit: boolean): void {
    if (commit) {
      this.commitEditor();
      return;
    }
    const editor = this.core.editor;
    if (!editor) {
      return;
    }
    this.core.editor = null;
    this.disposeEditor(editor);
    this.demoteSink();
  }

  /**
   * Discard any in-progress inline edit without committing it, tearing down
   * the autocomplete popup, the IME sink promotion, the formula-reference
   * capture, and the reference highlights. Called when the active worksheet or
   * document changes so an editor opened on one worksheet can never commit its
   * text into another.
   */
  cancelEditing(): void {
    this.closeEditor(false);
  }

  /** True when the grid (not an editor input) should own copy/paste events. */
  isNavigating(): boolean {
    return (
      this.core.editor === null &&
      (document.activeElement === this.core.element || document.activeElement === this.core.sink)
    );
  }
}
