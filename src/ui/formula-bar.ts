// SPDX-License-Identifier: MIT
import type { AppState, FormulaRefTarget } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { cellLabel, functionCompletions, type FunctionInfo } from '../core/formula';
import { el } from './dom';

/**
 * Formula bar for the selected cell. Shows and edits the raw cell input —
 * for formula cells this is the underlying formula expression, while the
 * grid shows the calculated value. Values containing newlines are edited
 * here (the inline grid editor is single-line). Enter applies the value and
 * moves down; Alt+Enter inserts a newline; Escape restores the value the
 * cell had when it was selected.
 *
 * While a formula is being typed, an accessible autocomplete popup lists the
 * built-in functions whose name matches the word before the caret. Arrow keys
 * move the highlight, Enter or Tab inserts the highlighted function (with its
 * opening parenthesis), and Escape dismisses the popup without cancelling the
 * edit.
 */
export class FormulaBar implements FormulaRefTarget {
  readonly element: HTMLElement;
  private readonly refEl: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly hintEl: HTMLElement;
  private readonly popupEl: HTMLElement;
  private baseValue = '';
  private matches: FunctionInfo[] = [];
  private activeMatch = 0;
  /** The [start, end) range of the identifier word being completed. */
  private wordSpan: [number, number] | null = null;
  /** The [start, end) span of a reference being entered by pointer, if any. */
  private refSpan: [number, number] | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly moveDown: () => void,
  ) {
    this.refEl = el('div', { className: 'cell-ref', attrs: { 'aria-hidden': 'true' } });
    this.textarea = el('textarea', {
      attrs: {
        rows: '1',
        spellcheck: 'false',
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': 'false',
      },
    });
    this.hintEl = el('div', { className: 'hint' });
    this.popupEl = el('ul', {
      className: 'formula-autocomplete',
      attrs: { role: 'listbox', hidden: 'hidden' },
    });
    const field = el('div', { className: 'formula-field' }, [this.textarea, this.popupEl]);
    this.element = el('div', { className: 'formula-bar' }, [this.refEl, field, this.hintEl]);

    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('input', () => {
      // Typing invalidates any pending pointer-entered reference.
      this.refSpan = null;
      this.updateAutocomplete();
    });
    this.textarea.addEventListener('click', () => this.updateAutocomplete());
    this.textarea.addEventListener('blur', () => {
      this.hidePopup();
      this.commit();
    });

    this.state.formulaRefTarget = this;
  }

  // ----- FormulaRefTarget: pointer-entered references from the grid -----

  isCapturing(): boolean {
    return document.activeElement === this.textarea && this.textarea.value.startsWith('=');
  }

  beginRef(): void {
    const caret = this.textarea.selectionStart ?? this.textarea.value.length;
    this.refSpan = [caret, caret];
    this.hidePopup();
  }

  setRef(text: string): void {
    if (!this.refSpan) {
      this.beginRef();
    }
    const [start, end] = this.refSpan as [number, number];
    this.textarea.setRangeText(text, start, end, 'end');
    this.refSpan = [start, start + text.length];
  }

  endRef(): void {
    this.refSpan = null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const open = this.matches.length > 0 && !this.popupEl.hidden;
    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveActive(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveActive(-1);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.altKey && !event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        this.acceptMatch(this.activeMatch);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hidePopup();
        return;
      }
    }
    if (event.key === 'Enter' && event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const { selectionStart, selectionEnd } = this.textarea;
      this.textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
      this.updateAutocomplete();
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

  private updateAutocomplete(): void {
    const { value, selectionStart } = this.textarea;
    const { word, matches } = functionCompletions(value, selectionStart ?? value.length);
    if (matches.length === 0) {
      this.hidePopup();
      return;
    }
    this.wordSpan = [selectionStart - word.length, selectionStart];
    this.matches = matches;
    this.activeMatch = 0;
    this.renderPopup();
  }

  private renderPopup(): void {
    this.popupEl.replaceChildren();
    this.matches.forEach((info, i) => {
      const item = el('li', {
        className: i === this.activeMatch ? 'ac-item active' : 'ac-item',
        attrs: {
          role: 'option',
          id: `ac-opt-${i}`,
          'aria-selected': i === this.activeMatch ? 'true' : 'false',
        },
      });
      item.append(
        el('span', { className: 'ac-sig', text: info.signature }),
        el('span', { className: 'ac-desc', text: t(`formula.fn.${info.name}`) }),
      );
      // mousedown (not click) so the textarea does not blur before insertion.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.acceptMatch(i);
      });
      this.popupEl.append(item);
    });
    this.popupEl.hidden = false;
    this.popupEl.setAttribute('aria-label', t('formulaBar.autocompleteLabel'));
    this.textarea.setAttribute('aria-expanded', 'true');
    this.textarea.setAttribute('aria-activedescendant', `ac-opt-${this.activeMatch}`);
  }

  private moveActive(delta: number): void {
    const n = this.matches.length;
    this.activeMatch = (this.activeMatch + delta + n) % n;
    this.renderPopup();
  }

  private acceptMatch(index: number): void {
    const info = this.matches[index];
    if (!info || !this.wordSpan) {
      return;
    }
    const [start, end] = this.wordSpan;
    const insert = `${info.name}(`;
    this.textarea.setRangeText(insert, start, end, 'end');
    this.hidePopup();
    this.textarea.focus();
  }

  private hidePopup(): void {
    this.popupEl.hidden = true;
    this.popupEl.replaceChildren();
    this.matches = [];
    this.wordSpan = null;
    this.activeMatch = 0;
    this.textarea.setAttribute('aria-expanded', 'false');
    this.textarea.removeAttribute('aria-activedescendant');
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
      this.hidePopup();
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
      this.hidePopup();
    }
    if (document.activeElement !== this.textarea || selectionChanged) {
      this.textarea.value = value;
    }
  }
}
