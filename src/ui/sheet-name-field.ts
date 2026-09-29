// SPDX-License-Identifier: MIT
/**
 * Typing a sheet's or a sheet folder's new name on its tab or header in the
 * worksheet strip (`sheet-bar.ts`): a text field takes the name's place.
 */
import { MAX_SHEET_NAME_LENGTH } from '../core/formula';
import { el } from './dom';

export interface NameFieldOptions {
  /** The name shown now. */
  readonly name: string;
  /** The field's accessible name. */
  readonly label: string;
  /** Use a name: what is wrong with it (the field stays open), or null once done. */
  readonly rename: (next: string) => string | null;
  /** Say a problem to assistive technologies. */
  readonly announce: (message: string) => void;
  /** Called once when typing ends, however it ends. */
  readonly done: () => void;
}

/**
 * Put a text field holding the name in place of `label`'s content. Enter
 * keeps the name, and a name that cannot be used keeps the field open,
 * marked invalid with the reason; Escape, or leaving the field with such a
 * name, puts the old one back. Keys and clicks in the field stay in it.
 */
export function editNameInPlace(label: HTMLElement, options: NameFieldOptions): void {
  const input = el('input', {
    className: 'sheet-name-edit',
    attrs: {
      type: 'text',
      value: options.name,
      'aria-label': options.label,
      maxlength: String(MAX_SHEET_NAME_LENGTH),
    },
  }) as HTMLInputElement;
  input.value = options.name;
  label.replaceChildren(input);
  let finished = false;
  const finish = (keep: boolean): void => {
    if (finished) {
      return;
    }
    if (keep) {
      const problem = options.rename(input.value);
      if (problem !== null) {
        input.setAttribute('aria-invalid', 'true');
        input.title = problem;
        options.announce(problem);
        return;
      }
    }
    finished = true;
    options.done();
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // arrows, Home/End and F2 belong to the text here
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  for (const type of ['click', 'pointerdown', 'mousedown', 'dblclick', 'contextmenu', 'dragstart']) {
    input.addEventListener(type, (event) => event.stopPropagation());
  }
  input.addEventListener('blur', () => {
    finish(true);
    finish(false); // leaving the field with a name that cannot be used puts the old one back
  });
  input.focus();
  input.select();
}
