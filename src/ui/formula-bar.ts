// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { cellLabel } from '../core/formula';
import { el } from './dom';

/**
 * Formula bar for the selected cell. Shows and edits the raw cell input —
 * for formula cells this is the underlying formula expression, while the
 * grid shows the calculated value. Values containing newlines are edited
 * here (the inline grid editor is single-line). Enter applies the value and
 * moves down; Alt+Enter inserts a newline; Escape restores the value the
 * cell had when it was selected.
 */
export class FormulaBar {
  readonly element: HTMLElement;
  private readonly refEl: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly hintEl: HTMLElement;
  private baseValue = '';

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly moveDown: () => void,
  ) {
    this.refEl = el('div', { className: 'cell-ref', attrs: { 'aria-hidden': 'true' } });
    this.textarea = el('textarea', { attrs: { rows: '1', spellcheck: 'false' } });
    this.hintEl = el('div', { className: 'hint' });
    this.element = el('div', { className: 'formula-bar' }, [this.refEl, this.textarea, this.hintEl]);

    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const { selectionStart, selectionEnd } = this.textarea;
        this.textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
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
    });
    this.textarea.addEventListener('blur', () => this.commit());
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
    }
    if (document.activeElement !== this.textarea || selectionChanged) {
      this.textarea.value = value;
    }
  }
}
