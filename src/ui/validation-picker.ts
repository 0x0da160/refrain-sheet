// SPDX-License-Identifier: MIT
import { t } from '../app/i18n';
import type { FormulaField } from './formula-autocomplete';
import { el } from './dom';
import { positionPopup } from './popup';

/** Values beyond this many are not rendered (mirrors the filter dialog's list cap). */
const VALUE_DISPLAY_CAP = 200;

let popupSeq = 0;

/**
 * The spreadsheet-standard "dropdown": a floating, keyboard-accessible list
 * of the fixed choices a `list`-kind data-validation rule allows for the
 * cell currently being edited. Shown automatically whenever the inline cell
 * editor (`Grid.openEditor`) opens on — or is typed into — a cell covered by
 * such a rule; picking an entry replaces the field's entire value.
 *
 * Mirrors `FormulaAutocomplete`'s popup/ARIA-combobox shape and reuses its
 * `.formula-autocomplete floating` / `.ac-item` CSS, but is otherwise
 * independent: `Grid` keeps the two mutually exclusive (never shown at once)
 * since the field is either a formula or a validated literal value, never
 * both. Filtering is a plain case-insensitive substring match against the
 * field's current text, the same rule the column-filter popover's value
 * search uses — no `eval`, `new Function`, or regular expressions.
 */
export class ValidationPicker {
  readonly popup: HTMLElement;
  private shown: string[] = [];
  private active = 0;
  private readonly idBase: string;

  constructor(
    private readonly field: FormulaField,
    parent: HTMLElement,
  ) {
    this.idBase = `vp-${popupSeq++}`;
    this.popup = el('ul', {
      className: 'formula-autocomplete floating',
      attrs: { role: 'listbox', id: this.idBase, hidden: 'hidden' },
    });
    parent.append(this.popup);
  }

  get isOpen(): boolean {
    return this.shown.length > 0 && !this.popup.hidden;
  }

  /** Recompute the shown list from the rule's full value set, narrowed by the field's current text. */
  update(allValues: readonly string[]): void {
    if (allValues.length === 0) {
      this.hide();
      return;
    }
    const term = this.field.value.trim().toLowerCase();
    const matches = term === '' ? allValues : allValues.filter((v) => v.toLowerCase().includes(term));
    if (matches.length === 0) {
      this.hide();
      return;
    }
    this.shown = matches.slice(0, VALUE_DISPLAY_CAP);
    this.active = 0;
    this.render();
  }

  /**
   * Handle a keydown while the popup is open. Returns true when the key was
   * consumed and the host must not act on it. Up/Down move the highlight,
   * Enter or Tab accept, Escape dismisses without cancelling the edit.
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.isOpen) {
      return false;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
      return true;
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.altKey && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.accept(this.active);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      return true;
    }
    return false;
  }

  hide(): void {
    this.popup.hidden = true;
    this.popup.replaceChildren();
    this.shown = [];
    this.active = 0;
    this.field.removeAttribute('aria-activedescendant');
  }

  /** Remove the popup entirely (for a transient host such as the cell editor). */
  dispose(): void {
    this.hide();
    this.popup.remove();
  }

  private render(): void {
    this.popup.replaceChildren();
    this.shown.forEach((value, i) => {
      const item = el('li', {
        className: i === this.active ? 'ac-item active' : 'ac-item',
        text: value,
        attrs: {
          role: 'option',
          id: `${this.idBase}-opt-${i}`,
          'aria-selected': i === this.active ? 'true' : 'false',
        },
      });
      // mousedown (not click) so the field does not blur before insertion.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.accept(i);
      });
      this.popup.append(item);
    });
    this.popup.hidden = false;
    positionPopup(this.popup, { kind: 'below', rect: this.field.getBoundingClientRect() });
    this.popup.setAttribute('aria-label', t('dialog.dataValidation.pickerLabel'));
    this.field.setAttribute('aria-activedescendant', `${this.idBase}-opt-${this.active}`);
  }

  private move(delta: number): void {
    const n = this.shown.length;
    this.active = (this.active + delta + n) % n;
    this.render();
  }

  private accept(index: number): void {
    const value = this.shown[index];
    if (value === undefined) {
      return;
    }
    this.field.setRangeText(value, 0, this.field.value.length, 'end');
    this.hide();
    this.field.focus();
  }
}
