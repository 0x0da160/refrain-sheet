// SPDX-License-Identifier: MIT
/**
 * Typing a shape's text on the shape itself: a double-click on a rectangle,
 * an ellipse or a text box puts an editable copy of its text in place, laid
 * out as the shape shows it. Enter starts a new line; Ctrl+Enter (or
 * clicking elsewhere) keeps the text as one undo step; Escape puts it back.
 * Keys typed here never reach the grid or the object shortcuts.
 */
import type { SheetObject, SheetObjectKind } from '../../core/workbook/sheet-objects';
import { MAX_OBJECT_TEXT_LENGTH } from '../../core/workbook/sheet-objects';
import { el } from '../dom';
import { objectTextBox } from '../sheet-object-view';

/** The kinds whose text is typed on the shape; the others open the object list. */
export const INLINE_TEXT_KINDS: ReadonlySet<SheetObjectKind> = new Set(['rect', 'ellipse', 'text']);

/**
 * Start editing `o`'s text inside `node`. `done` gets the new text (or null
 * when cancelled or unchanged) once, when editing ends.
 */
export function editObjectText(node: HTMLElement, o: SheetObject, done: (text: string | null) => void): void {
  node.querySelector('.sheet-object-text')?.remove();
  const box = objectTextBox(o);
  box.classList.add('sheet-object-text-editing');
  const field = el('span', {
    className: 'sheet-object-text-field',
    attrs: {
      contenteditable: 'plaintext-only',
      role: 'textbox',
      'aria-multiline': 'true',
      spellcheck: 'false',
    },
  });
  field.textContent = o.text ?? '';
  box.append(field);
  node.append(box);
  let finished = false;
  const finish = (keep: boolean): void => {
    if (finished) {
      return;
    }
    finished = true;
    const text = (field.textContent ?? '').slice(0, MAX_OBJECT_TEXT_LENGTH);
    box.remove();
    done(keep && text !== (o.text ?? '') ? text : null);
  };
  field.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  });
  for (const type of ['pointerdown', 'mousedown', 'dblclick', 'contextmenu']) {
    field.addEventListener(type, (event) => event.stopPropagation());
  }
  field.addEventListener('blur', () => finish(true));
  field.focus();
  // Caret at the end of the text.
  const selection = field.ownerDocument.getSelection();
  if (selection) {
    selection.selectAllChildren(field);
    selection.collapseToEnd();
  }
}
