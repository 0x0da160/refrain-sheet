// SPDX-License-Identifier: MIT
import {
  caretPosition,
  indentLines,
  insertAtSelection,
  newlineKeepingIndent,
  outdentLines,
  selectionSpansLines,
  type CaretPosition,
  type TextEdit,
} from '../core/text-editing';
import { el } from './dom';

export interface SourceEditorOptions {
  /** The textarea's id (kept stable for tests and `for=` references). */
  readonly id: string;
  /** Extra class names for the textarea, e.g. the owning view's own hook. */
  readonly className: string;
  /** Accessible name — there is no visible form label on an editor surface. */
  readonly label: string;
  /**
   * What Tab inserts and one indent step is: a tab character for free text
   * (plain text, Markdown), spaces where the format forbids or discourages
   * tabs (YAML indentation, JSON's pretty-printed style).
   */
  readonly indentUnit: string;
}

/**
 * The editing surface shared by the Markdown, JSON, YAML and plain-text
 * worksheets. It is a document editor, not a cell: Tab types an indent (or
 * indents the selected lines; Shift+Tab outdents), Enter keeps the current
 * line's indentation, and the caret's line and column are reported for the
 * status bar. Escape followed by Tab still moves focus out, so keyboard
 * users are never trapped.
 *
 * Edits are applied through the browser's own text insertion so the
 * textarea's native undo (Ctrl+Z while typing) and `input` events keep
 * working exactly as for typed text; where that is unavailable the text is
 * spliced directly and an `input` event dispatched instead.
 */
export class SourceEditor {
  readonly textarea: HTMLTextAreaElement;
  /** Called whenever the caret or the text may have changed. */
  onCaretChange: ((position: CaretPosition) => void) | null = null;
  /** Set by Escape: the next Tab leaves the editor instead of indenting. */
  private tabLeaves = false;

  constructor(private readonly options: SourceEditorOptions) {
    this.textarea = el('textarea', {
      className: `source-editor markdown-editor-source ${options.className}`,
      attrs: {
        id: options.id,
        spellcheck: 'false',
        autocomplete: 'off',
        autocapitalize: 'off',
        'aria-label': options.label,
      },
    }) as HTMLTextAreaElement;
    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('blur', () => {
      this.tabLeaves = false;
    });
    const report = (): void => this.reportCaret();
    for (const type of ['input', 'select', 'keyup', 'pointerup', 'focus', 'selectionchange']) {
      this.textarea.addEventListener(type, report);
    }
  }

  /** The caret's current line/column and the text's size. */
  caret(): CaretPosition {
    return caretPosition(this.textarea.value, this.textarea.selectionStart);
  }

  /** Replace the whole text (loading another worksheet), resetting the caret to the start. */
  setValue(value: string): void {
    this.textarea.value = value;
    this.textarea.setSelectionRange(0, 0);
    this.reportCaret();
  }

  private reportCaret(): void {
    this.onCaretChange?.(this.caret());
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) {
      return; // IME conversion owns the key
    }
    if (event.key === 'Escape') {
      this.tabLeaves = true;
      return;
    }
    const leave = this.tabLeaves;
    this.tabLeaves = false;
    if (this.textarea.readOnly || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const ta = this.textarea;
    const { value, selectionStart: start, selectionEnd: end } = ta;
    let edit: TextEdit | null = null;
    if (event.key === 'Tab') {
      if (leave) {
        return; // Escape, then Tab: let focus move on
      }
      event.preventDefault();
      const unit = this.options.indentUnit;
      if (event.shiftKey) {
        edit = outdentLines(value, start, end, unit);
      } else {
        edit = selectionSpansLines(value, start, end)
          ? indentLines(value, start, end, unit)
          : insertAtSelection(start, end, unit);
      }
    } else if (event.key === 'Enter' && !event.shiftKey) {
      edit = newlineKeepingIndent(value, start, end);
      if (edit) {
        event.preventDefault();
      }
    }
    if (edit) {
      this.apply(edit);
    }
  }

  private apply(edit: TextEdit): void {
    const ta = this.textarea;
    ta.setSelectionRange(edit.from, edit.to);
    // `insertText` keeps the edit on the textarea's native undo stack and
    // fires `input`; it is deprecated but has no replacement for that, so
    // a direct splice (no native undo) is the fallback.
    const inserted =
      typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.insert);
    if (!inserted) {
      ta.setRangeText(edit.insert, edit.from, edit.to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    this.reportCaret();
  }
}
