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
import { markedText, type TextRange } from './find-marks';

/**
 * Past this many matches only the current one is painted: an overlay with
 * every mark would cost as much as the text it sits behind.
 */
const MAX_PAINTED_MATCHES = 2000;

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
  /**
   * The find highlights behind the text (see `setMatches`). A sibling of the
   * textarea in a positioned pane, placed under it, and hidden until painted.
   */
  readonly marks: HTMLElement = el('div', {
    className: 'source-editor-marks',
    attrs: { 'aria-hidden': 'true' },
  });
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
    this.marks.hidden = true;
    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('blur', () => {
      this.tabLeaves = false;
    });
    this.textarea.addEventListener('scroll', () => this.followScroll());
    // Typing moves the text under the marks, so they go until the find paints them again.
    this.textarea.addEventListener('input', () => this.clearMarks());
    const report = (): void => this.reportCaret();
    for (const type of ['input', 'select', 'keyup', 'pointerup', 'focus', 'selectionchange']) {
      this.textarea.addEventListener(type, report);
    }
    // A resized textarea (its handle, a window or pane resize) moves its box.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.syncMarks()).observe(this.textarea);
    }
  }

  /** The caret's current line/column and the text's size. */
  caret(): CaretPosition {
    return caretPosition(this.textarea.value, this.textarea.selectionStart);
  }

  /** Replace the whole text (loading another worksheet), resetting the caret to the start. */
  setValue(value: string): void {
    this.clearMarks();
    this.textarea.value = value;
    this.textarea.setSelectionRange(0, 0);
    this.reportCaret();
  }

  /**
   * Paint find matches behind the text: `ranges` are offsets into the text, and
   * `current` is the index of the match being shown (-1 for none). An empty list
   * hides the overlay. While matches show, the textarea's background is left to
   * the overlay, which copies it, so the text reads as it does without them.
   */
  setMatches(ranges: readonly TextRange[], current: number): void {
    const capped = ranges.length > MAX_PAINTED_MATCHES;
    const shown = capped ? (current >= 0 ? [ranges[current]] : []) : ranges;
    const emphasized = capped ? 0 : current;
    if (shown.length === 0) {
      this.clearMarks();
      return;
    }
    const ta = this.textarea;
    // Read the background before the class that gives it up is applied.
    ta.classList.remove('find-matches');
    const background = getComputedStyle(ta).backgroundColor;
    ta.classList.add('find-matches');
    this.marks.hidden = false;
    this.marks.style.backgroundColor = background;
    this.marks.replaceChildren(...markedText(ta.value, shown, (index) => index === emphasized));
    this.syncMarks();
  }

  /** Drop the overlay and give the textarea its own background back. */
  private clearMarks(): void {
    this.textarea.classList.remove('find-matches');
    this.marks.hidden = true;
    this.marks.replaceChildren();
  }

  /**
   * Select a match and scroll it into view. The keyboard focus stays where it
   * is: a Next from the find panel never moves it into the text.
   */
  revealMatch(start: number, end: number): void {
    const ta = this.textarea;
    ta.setSelectionRange(start, end);
    const current = this.marks.querySelector<HTMLElement>('.find-hit-current');
    if (current && !this.marks.hidden) {
      // The overlay lays out the text exactly as the textarea does, so the
      // current mark's offset is its line's place in the scrollable text.
      ta.scrollTop = Math.max(0, current.offsetTop - ta.clientHeight / 2);
    }
    this.followScroll();
  }

  /** Keep the overlay's box, type and scroll position over the textarea's. */
  private syncMarks(): void {
    if (this.marks.hidden) {
      return;
    }
    const ta = this.textarea;
    const style = getComputedStyle(ta);
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    // A vertical scrollbar takes width from the textarea's text but not from
    // the overlay's, so the overlay reserves it to wrap each line alike.
    const scrollbar = Math.max(0, ta.offsetWidth - ta.clientWidth - borderX);
    const box = this.marks.style;
    box.boxSizing = 'border-box';
    box.left = `${ta.offsetLeft}px`;
    box.top = `${ta.offsetTop}px`;
    box.width = `${ta.offsetWidth}px`;
    box.height = `${ta.offsetHeight}px`;
    box.borderStyle = 'solid';
    box.borderColor = 'transparent';
    box.borderWidth = `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`;
    box.paddingTop = style.paddingTop;
    box.paddingBottom = style.paddingBottom;
    box.paddingLeft = style.paddingLeft;
    box.paddingRight = `calc(${style.paddingRight} + ${scrollbar}px)`;
    box.fontFamily = style.fontFamily;
    box.fontSize = style.fontSize;
    box.fontWeight = style.fontWeight;
    box.fontStyle = style.fontStyle;
    box.lineHeight = style.lineHeight;
    box.letterSpacing = style.letterSpacing;
    box.wordSpacing = style.wordSpacing;
    box.tabSize = style.tabSize;
    box.textIndent = style.textIndent;
    box.whiteSpace = style.whiteSpace;
    box.overflowWrap = style.overflowWrap;
    box.wordBreak = style.wordBreak;
    this.followScroll();
  }

  private followScroll(): void {
    this.marks.scrollTop = this.textarea.scrollTop;
    this.marks.scrollLeft = this.textarea.scrollLeft;
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
