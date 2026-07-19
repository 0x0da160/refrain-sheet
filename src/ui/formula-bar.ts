// SPDX-License-Identifier: MIT
import type { AppState, FormulaRefTarget } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { cellLabel, extractFormulaRefs, type FormulaRefRange } from '../core/formula';
import { el } from './dom';
import { FormulaAutocomplete, FormulaFieldRef } from './formula-autocomplete';
import { isComposingKey } from './ime';

/**
 * Formula bar for the selected cell. Shows and edits the raw cell input —
 * for formula cells this is the underlying formula expression, while the
 * grid shows the calculated value. Values containing newlines are edited
 * here (the inline grid editor is single-line). Enter applies the value and
 * moves down; Alt+Enter inserts a newline; Escape restores the value the
 * cell had when it was selected.
 *
 * The accessible function autocomplete and pointer-driven cell references are
 * provided by the shared {@link FormulaAutocomplete} / {@link FormulaFieldRef}
 * helpers, so the formula bar and the inline cell editor behave identically.
 */
export class FormulaBar implements FormulaRefTarget {
  readonly element: HTMLElement;
  private readonly refEl: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly hintEl: HTMLElement;
  /** Visually hidden description of the currently referenced ranges (for AT). */
  private readonly refsDescEl: HTMLElement;
  private readonly autocomplete: FormulaAutocomplete;
  private readonly ref: FormulaFieldRef;
  private baseValue = '';
  /** True between compositionstart and compositionend (IME is composing). */
  private composing = false;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly moveDown: () => void,
    /** Receives the referenced ranges to highlight in the grid ([] clears). */
    private readonly onRefsChange: (refs: FormulaRefRange[]) => void = () => undefined,
  ) {
    this.refEl = el('div', { className: 'cell-ref', attrs: { 'aria-hidden': 'true' } });
    this.textarea = el('textarea', {
      attrs: { rows: '1', spellcheck: 'false', 'aria-describedby': 'formula-refs-desc' },
    });
    this.refsDescEl = el('span', {
      className: 'visually-hidden',
      attrs: { id: 'formula-refs-desc' },
    });
    this.hintEl = el('div', { className: 'hint' });
    const field = el('div', { className: 'formula-field' }, [this.textarea, this.refsDescEl]);
    this.element = el('div', { className: 'formula-bar' }, [this.refEl, field, this.hintEl]);

    this.autocomplete = new FormulaAutocomplete(this.textarea, field, false);
    this.ref = new FormulaFieldRef(
      this.textarea,
      () => this.autocomplete.hide(),
      () => this.updateRefs(),
    );

    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    this.textarea.addEventListener('compositionend', () => {
      this.composing = false;
      // Composition committed text; refresh completions/highlights from it.
      this.autocomplete.update();
      this.updateRefs();
    });
    this.textarea.addEventListener('input', () => {
      // Typing invalidates any pending pointer-entered reference.
      this.ref.clear();
      // Don't recompute/overwrite completions mid-composition.
      if (!this.composing) {
        this.autocomplete.update();
      }
      this.updateRefs();
    });
    this.textarea.addEventListener('click', () => this.autocomplete.update());
    this.textarea.addEventListener('blur', () => {
      this.autocomplete.hide();
      this.commit();
      this.clearRefs();
    });
    this.textarea.addEventListener('focus', () => this.updateRefs());

    this.state.formulaRefTarget = this;
  }

  /**
   * Recompute the referenced ranges of the formula being edited and push
   * them to the grid highlight + the accessible description. Invalid or
   * incomplete reference syntax simply yields fewer (or no) ranges.
   */
  private updateRefs(): void {
    const value = this.textarea.value;
    const refs = value.startsWith('=') ? extractFormulaRefs(value) : [];
    this.refsDescEl.textContent =
      refs.length > 0 ? t('formulaBar.refsLabel', { list: refs.map((r) => r.text).join(', ') }) : '';
    this.onRefsChange(refs);
  }

  private clearRefs(): void {
    this.refsDescEl.textContent = '';
    this.onRefsChange([]);
  }

  // ----- FormulaRefTarget: pointer-entered references from the grid -----

  isCapturing(): boolean {
    return this.ref.isCapturing();
  }

  beginRef(): void {
    this.ref.beginRef();
  }

  setRef(text: string): void {
    this.ref.setRef(text);
  }

  endRef(): void {
    this.ref.endRef();
  }

  private onKeyDown(event: KeyboardEvent): void {
    // While the IME is composing, let it own every key (Enter confirms a
    // candidate, Escape cancels one). Never commit or run autocomplete then.
    if (isComposingKey(event, this.composing)) {
      return;
    }
    if (this.autocomplete.onKeyDown(event)) {
      return;
    }
    if (event.key === 'Enter' && event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const { selectionStart, selectionEnd } = this.textarea;
      this.textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
      this.autocomplete.update();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commit();
      this.moveDown();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.textarea.value = this.baseValue;
      this.commit();
    }
  }

  private commit(): void {
    const tab = this.state.activeTab;
    if (!tab || !tab.selection) return;
    const { row, col } = tab.selection;
    if (this.textarea.value !== tab.doc.getValue(row, col)) {
      void this.commands.commitCellEdit(tab, row, col, this.textarea.value);
    }
  }

  refresh(selectionChanged: boolean): void {
    this.textarea.setAttribute('aria-label', t('formulaBar.label'));
    this.hintEl.textContent = t('formulaBar.hint');
    const tab = this.state.activeTab;
    if (!tab || !tab.selection) {
      this.refEl.textContent = '';
      this.textarea.value = '';
      this.textarea.disabled = true;
      this.autocomplete.hide();
      return;
    }
    this.textarea.disabled = false;
    const { row, col } = tab.selection;
    this.refEl.textContent = cellLabel(row, col);
    // The formula bar always shows the raw input (the formula expression for
    // formula cells); the grid shows the calculated value.
    const value = tab.doc.getValue(row, col);
    if (selectionChanged) {
      this.baseValue = value;
      this.autocomplete.hide();
    }
    if (document.activeElement !== this.textarea || selectionChanged) {
      this.textarea.value = value;
    }
  }
}
