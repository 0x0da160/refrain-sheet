// SPDX-License-Identifier: MIT
import { t } from '../app/i18n';
import { functionCompletions, type FunctionInfo } from '../core/formula';
import { el } from './dom';

/** A text field that can hold a formula: the formula bar or an inline cell editor. */
export type FormulaField = HTMLInputElement | HTMLTextAreaElement;

let popupSeq = 0;

/**
 * Reusable formula autocomplete popup for any formula text field (the formula
 * bar's textarea and the inline cell <input> both use it, so the two editing
 * surfaces behave identically). It owns only the accessible listbox popup and
 * the ARIA wiring on the field; the host keeps ownership of commit/cancel and
 * calls {@link onKeyDown} first so the popup can consume navigation keys.
 *
 * Parsing is entirely string-based (`functionCompletions`) — no `eval`,
 * `new Function`, or dynamic code execution is ever used.
 */
export class FormulaAutocomplete {
  readonly popup: HTMLElement;
  private matches: FunctionInfo[] = [];
  private active = 0;
  /** The [start, end) range of the identifier word being completed. */
  private wordSpan: [number, number] | null = null;
  private readonly idBase: string;

  /**
   * @param field    The formula text field to complete.
   * @param parent   Element the popup is appended to.
   * @param floating When true the popup is positioned `fixed` at the field's
   *                 on-screen rect (used for the inline cell editor, whose
   *                 cell would otherwise clip an in-flow popup). When false the
   *                 popup uses its stylesheet's in-flow absolute placement.
   */
  constructor(
    private readonly field: FormulaField,
    parent: HTMLElement,
    private readonly floating = false,
  ) {
    this.idBase = `ac-${popupSeq++}`;
    this.popup = el('ul', {
      className: 'formula-autocomplete',
      attrs: { role: 'listbox', id: this.idBase, hidden: 'hidden' },
    });
    if (floating) {
      this.popup.classList.add('floating');
    }
    parent.append(this.popup);
    field.setAttribute('role', 'combobox');
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-expanded', 'false');
    field.setAttribute('aria-controls', this.idBase);
  }

  get isOpen(): boolean {
    return this.matches.length > 0 && !this.popup.hidden;
  }

  /** Recompute completions from the current value and caret. Call on input/click. */
  update(): void {
    const value = this.field.value;
    const caret = this.field.selectionStart ?? value.length;
    const { word, matches } = functionCompletions(value, caret);
    if (matches.length === 0) {
      this.hide();
      return;
    }
    this.wordSpan = [caret - word.length, caret];
    this.matches = matches;
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
    this.matches = [];
    this.wordSpan = null;
    this.active = 0;
    this.field.setAttribute('aria-expanded', 'false');
    this.field.removeAttribute('aria-activedescendant');
  }

  /** Remove the popup from the DOM (for a transient host such as the cell editor). */
  dispose(): void {
    this.hide();
    this.popup.remove();
  }

  private render(): void {
    this.popup.replaceChildren();
    this.matches.forEach((info, i) => {
      const item = el('li', {
        className: i === this.active ? 'ac-item active' : 'ac-item',
        attrs: {
          role: 'option',
          id: `${this.idBase}-opt-${i}`,
          'aria-selected': i === this.active ? 'true' : 'false',
        },
      });
      item.append(
        el('span', { className: 'ac-sig', text: info.signature }),
        el('span', { className: 'ac-desc', text: t(`formula.fn.${info.name}`) }),
      );
      // mousedown (not click) so the field does not blur before insertion.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.accept(i);
      });
      this.popup.append(item);
    });
    if (this.floating) {
      const rect = this.field.getBoundingClientRect();
      this.popup.style.left = `${rect.left}px`;
      this.popup.style.top = `${rect.bottom}px`;
    }
    this.popup.hidden = false;
    this.popup.setAttribute('aria-label', t('formulaBar.autocompleteLabel'));
    this.field.setAttribute('aria-expanded', 'true');
    this.field.setAttribute('aria-activedescendant', `${this.idBase}-opt-${this.active}`);
  }

  private move(delta: number): void {
    const n = this.matches.length;
    this.active = (this.active + delta + n) % n;
    this.render();
  }

  private accept(index: number): void {
    const info = this.matches[index];
    if (!info || !this.wordSpan) {
      return;
    }
    const [start, end] = this.wordSpan;
    this.field.setRangeText(`${info.name}(`, start, end, 'end');
    this.hide();
    this.field.focus();
  }
}

/**
 * Pointer-entered cell/range references for a formula text field. While a
 * formula is being edited, clicking or dragging cells in the grid inserts a
 * reference at the caret (rewriting one span during a drag) instead of moving
 * the selection. Shared by the formula bar and the inline cell editor so both
 * accept mouse-driven references identically.
 */
export class FormulaFieldRef {
  private span: [number, number] | null = null;

  constructor(
    private readonly field: FormulaField,
    private readonly onBegin?: () => void,
    /**
     * Called after a pointer-entered reference rewrites the field —
     * `setRangeText` fires no input event, so hosts that track the value
     * (e.g. live reference highlighting) hook this instead.
     */
    private readonly onChange?: () => void,
  ) {}

  isCapturing(): boolean {
    return document.activeElement === this.field && this.field.value.startsWith('=');
  }

  beginRef(): void {
    const caret = this.field.selectionStart ?? this.field.value.length;
    this.span = [caret, caret];
    this.onBegin?.();
  }

  setRef(text: string): void {
    if (!this.span) {
      this.beginRef();
    }
    const [start, end] = this.span as [number, number];
    this.field.setRangeText(text, start, end, 'end');
    this.span = [start, start + text.length];
    this.onChange?.();
  }

  endRef(): void {
    this.span = null;
  }

  /** Typing invalidates any pending pointer-entered reference. */
  clear(): void {
    this.span = null;
  }
}
