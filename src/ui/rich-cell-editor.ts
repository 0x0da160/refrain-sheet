// SPDX-License-Identifier: MIT
import { dateStampKeyOf, localDateStamp } from '../app/shortcuts';
import type { CellStyle } from '../core/cell-style';
import {
  charFormats,
  clearFormats,
  isFormatOn,
  remapFormats,
  runsFromChars,
  setFormatKey,
  type RunFormat,
  type TextRun,
} from '../core/rich-text';
import { el } from './dom';
import { richTextNodes } from './rich-text-render';
import { RichTextToolbar, type RichTextAction } from './rich-text-toolbar';

/** What the grid lends the rich-text editing of one cell. */
export interface RichCellEditorHost {
  /** The grid's plain-text cell editor (the IME sink); kept holding the same text. */
  readonly input: HTMLTextAreaElement;
  /** Where the formatted editor is mounted, over the cell (the grid canvas). */
  readonly container: HTMLElement;
  /** The cell's own style: parts inherit what they do not set. */
  cellStyle(): CellStyle | null;
  /** A key the formatted editor does not handle itself: Enter, Tab, Escape. */
  navigationKey(event: KeyboardEvent): void;
  /** Focus left the editor and its toolbar for somewhere else: commit. */
  focusLeft(): void;
}

/**
 * Rich text in the cell editor (RSF grid worksheets). The grid edits a cell
 * in a plain `<textarea>` (the IME sink); as soon as part of the text is
 * formatted — or the cell being edited already has formatted parts — this
 * swaps in a `contenteditable="plaintext-only"` field over the same cell
 * that shows the formatting as it will look. The browser only ever inserts
 * plain text into it; the format of each part is ours (one `<span>` per
 * part, its format kept in a `WeakMap`), so typed text simply takes the
 * format of the part it is typed into.
 *
 * A floating toolbar ({@link RichTextToolbar}) appears over a text
 * selection: bold, italic, underline, a few colors or any color, and
 * removing the selection's own formatting. Ctrl+B / Ctrl+I / Ctrl+U do the
 * same from the keyboard.
 */
export class RichCellEditor {
  /** One format per character of `text`, or null while nothing is formatted. */
  private formats: RunFormat[] | null;
  private text: string;
  /** The formatted field, while it replaces the plain one. */
  private field: HTMLElement | null = null;
  private readonly spanFormats = new WeakMap<Node, RunFormat>();
  private readonly toolbar: RichTextToolbar;
  /** The last selection inside the editor, kept while focus visits the toolbar. */
  private selection: [number, number] = [0, 0];
  private composing = false;
  /** True once the formats are this editor's to decide (the cell had formatted parts, or some were set). */
  private tracking: boolean;
  private readonly onSelectionChange = (): void => this.selectionChanged();

  constructor(
    private readonly host: RichCellEditorHost,
    runs: readonly TextRun[] | null,
    /** True when the edit replaces the cell's text (type-to-edit): old formatting does not carry over. */
    private readonly replace: boolean,
  ) {
    this.text = host.input.value;
    this.formats = runs ? charFormats(runs) : null;
    this.tracking = runs !== null;
    this.toolbar = new RichTextToolbar(
      (action) => this.apply(action),
      (next) => this.focusLeftToolbar(next),
    );
    document.addEventListener('selectionchange', this.onSelectionChange);
  }

  /** True while the formatted field replaces the plain one. */
  get active(): boolean {
    return this.field !== null;
  }

  /** The element that holds the editor's focus now. */
  get focusTarget(): HTMLElement {
    return this.field ?? this.host.input;
  }

  /** Whether focus moving to `target` stays within the editor (so no commit). */
  owns(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (target === this.host.input || !!this.field?.contains(target) || this.toolbar.contains(target))
    );
  }

  /** Show the formatted field right away, with the caret at `caret` (a cell that already has formatted parts). */
  begin(caret: number): void {
    if (this.formats) {
      this.enter(caret, caret);
    }
  }

  /** The plain field changed (typing, pasting, an IME): carry the formats along. */
  plainChanged(): void {
    if (this.field) {
      return;
    }
    const value = this.host.input.value;
    if (value !== this.text) {
      if (this.formats) {
        this.formats = remapFormats(this.text, value, this.formats);
      }
      this.text = value;
    }
    this.selectionChanged();
  }

  /** Insert text at the selection (Alt+Enter's line break, a date stamp) in the formatted field. */
  insertText(inserted: string): void {
    if (!this.field) {
      return;
    }
    const [start, end] = this.currentSelection();
    const next = this.text.slice(0, start) + inserted + this.text.slice(end);
    this.formats = remapFormats(this.text, next, this.formats ?? []);
    this.text = next;
    this.host.input.value = next;
    this.render();
    this.setSelection(start + inserted.length, start + inserted.length);
  }

  /** Ctrl+B / Ctrl+I / Ctrl+U: toggle on the selected text. Returns false when there is nothing to format. */
  toggle(key: 'bold' | 'italic' | 'underline'): boolean {
    return this.apply({ kind: 'toggle', key });
  }

  /** The runs to commit: an array, null to clear, or undefined for "unchanged". */
  runs(): TextRun[] | null | undefined {
    this.readField();
    if (this.formats) {
      return runsFromChars(this.text, this.formats);
    }
    return this.tracking || this.replace ? null : undefined;
  }

  dispose(): void {
    document.removeEventListener('selectionchange', this.onSelectionChange);
    this.toolbar.dispose();
    this.field?.remove();
    this.field = null;
    this.host.input.classList.remove('rich-hidden');
  }

  // ----- Formatting -----

  private apply(action: RichTextAction): boolean {
    this.readField();
    if (this.text.startsWith('=')) {
      return false;
    }
    const [start, end] =
      this.field || document.activeElement === this.host.input ? this.currentSelection() : this.selection;
    if (start === end) {
      return false;
    }
    const cell = this.host.cellStyle();
    let formats = this.formats ?? this.text.split('').map((): RunFormat => ({}));
    if (action.kind === 'toggle') {
      const cellOn = !!cell?.[action.key];
      const on = !isFormatOn(formats, start, end, action.key, cellOn);
      // Store the part's value only where it differs from the whole cell's.
      formats = setFormatKey(formats, start, end, action.key, on === cellOn ? null : on);
    } else if (action.kind === 'color') {
      const color = action.color === cell?.textColor ? null : action.color;
      formats = setFormatKey(formats, start, end, 'textColor', color);
    } else {
      formats = clearFormats(formats, start, end);
    }
    this.formats = formats;
    this.tracking = true;
    if (this.field) {
      this.render();
    } else {
      this.enter(start, end);
    }
    this.setSelection(start, end);
    this.field?.focus();
    this.selectionChanged();
    return true;
  }

  // ----- The formatted field -----

  /** Replace the plain field with the formatted one, selecting `[start, end)`. */
  private enter(start: number, end: number): void {
    const input = this.host.input;
    const field = el('div', {
      className: 'rich-cell-editor',
      attrs: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': input.getAttribute('aria-label') ?? '',
        spellcheck: 'false',
      },
    });
    field.setAttribute('contenteditable', 'plaintext-only');
    // Same place and size as the plain field over the cell.
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      field.style[key] = input.style[key];
    }
    // The grid's own pointer handling (selection drags, double-click to
    // edit) must not see clicks inside the text.
    for (const type of ['mousedown', 'pointerdown', 'dblclick', 'click']) {
      field.addEventListener(type, (event) => event.stopPropagation());
    }
    field.addEventListener('keydown', (event) => this.keyDown(event));
    field.addEventListener('compositionstart', () => (this.composing = true));
    field.addEventListener('compositionend', () => {
      this.composing = false;
      this.fieldInput();
    });
    field.addEventListener('input', () => this.fieldInput());
    field.addEventListener('blur', (event) => {
      if (!this.owns(event.relatedTarget)) {
        this.host.focusLeft();
      }
    });
    this.field = field;
    this.render();
    this.host.container.append(field);
    input.classList.add('rich-hidden');
    field.focus({ preventScroll: true });
    this.setSelection(start, end);
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.isComposing || this.composing || event.keyCode === 229) {
      return;
    }
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const key = mod ? event.key.toLowerCase() : '';
    if (key === 'b' || key === 'i' || key === 'u') {
      event.preventDefault();
      event.stopPropagation();
      this.toggle(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
      return;
    }
    // Alt+Enter: a line break; Ctrl+; / Ctrl+Shift+;: today's date / the time.
    const stamp = dateStampKeyOf(event);
    if ((event.key === 'Enter' && event.altKey) || stamp) {
      event.preventDefault();
      event.stopPropagation();
      this.insertText(stamp ? localDateStamp(stamp) : '\n');
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'Escape') {
      this.host.navigationKey(event);
    }
  }

  private fieldInput(): void {
    if (this.composing) {
      return;
    }
    this.readField();
    // The browser may add a line break element of its own; show the text
    // the way it will be stored instead.
    if (this.field?.querySelector('br, div, p')) {
      const [start, end] = this.currentSelection();
      this.render();
      this.setSelection(start, end);
    }
    this.selectionChanged();
  }

  /** Read the formatted field's text and each character's format back. */
  private readField(): void {
    const field = this.field;
    if (!field) {
      return;
    }
    let text = '';
    const formats: RunFormat[] = [];
    const walk = (node: Node, format: RunFormat): void => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const data = child.textContent ?? '';
          text += data;
          for (let i = 0; i < data.length; i++) {
            formats.push(format);
          }
        } else if (child.nodeName === 'BR') {
          text += '\n';
          formats.push(format);
        } else {
          const own = this.spanFormats.get(child) ?? format;
          if ((child.nodeName === 'DIV' || child.nodeName === 'P') && text !== '' && !text.endsWith('\n')) {
            text += '\n';
            formats.push(own);
          }
          walk(child, own);
        }
      }
    };
    walk(field, {});
    this.text = text;
    this.formats = formats.some((format) => Object.keys(format).length > 0) ? formats : null;
    this.host.input.value = text;
  }

  /** Rebuild the formatted field from the text and formats. */
  private render(): void {
    const field = this.field;
    if (!field) {
      return;
    }
    const cell = this.host.cellStyle();
    const runs = runsFromChars(this.text, this.formats ?? []) ?? (this.text ? [{ text: this.text }] : []);
    const spans = richTextNodes(runs, cell);
    spans.forEach((span, i) => {
      const format: RunFormat = { ...runs[i] };
      delete (format as Partial<TextRun>).text;
      this.spanFormats.set(span, format);
    });
    field.replaceChildren(...spans);
    field.style.color = cell?.textColor ?? '';
    field.style.fontWeight = cell?.bold ? 'bold' : '';
    field.style.fontStyle = cell?.italic ? 'italic' : '';
  }

  // ----- Selection -----

  /** The selection as character offsets in the text. */
  private currentSelection(): [number, number] {
    const field = this.field;
    if (!field) {
      const input = this.host.input;
      return [input.selectionStart ?? 0, input.selectionEnd ?? 0];
    }
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || !field.contains(selection.anchorNode)) {
      return this.selection;
    }
    const range = selection.getRangeAt(0);
    const offset = (node: Node, at: number): number => {
      const before = document.createRange();
      before.setStart(field, 0);
      before.setEnd(node, at);
      return before.toString().length;
    };
    const a = offset(range.startContainer, range.startOffset);
    const b = offset(range.endContainer, range.endOffset);
    return [Math.min(a, b), Math.max(a, b)];
  }

  private setSelection(start: number, end: number): void {
    const field = this.field;
    this.selection = [start, end];
    if (!field) {
      return;
    }
    const point = (at: number): [Node, number] => {
      let remaining = at;
      const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
      let last: Node | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (remaining <= length) {
          return [node, remaining];
        }
        remaining -= length;
        last = node;
      }
      return last ? [last, last.textContent?.length ?? 0] : [field, 0];
    };
    const selection = document.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.setStart(...point(start));
    range.setEnd(...point(end));
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** Keep the toolbar over a non-empty selection, showing the selection's state. */
  private selectionChanged(): void {
    const active = document.activeElement;
    const focused = this.field ? active === this.field : active === this.host.input;
    if (!focused) {
      // Focus is on the toolbar (its color picker) or leaving: keep it as is.
      return;
    }
    const [start, end] = this.currentSelection();
    this.selection = [start, end];
    const value = this.field ? this.text : this.host.input.value;
    if (start === end || value.startsWith('=') || this.composing) {
      this.toolbar.hide();
      return;
    }
    const cell = this.host.cellStyle();
    const formats = this.field ? (this.formats ?? []) : this.plainFormats();
    this.toolbar.show(this.focusTarget.getBoundingClientRect(), {
      bold: isFormatOn(formats, start, end, 'bold', !!cell?.bold),
      italic: isFormatOn(formats, start, end, 'italic', !!cell?.italic),
      underline: isFormatOn(formats, start, end, 'underline', !!cell?.underline),
    });
  }

  private plainFormats(): RunFormat[] {
    const value = this.host.input.value;
    return this.formats && value === this.text ? this.formats : value.split('').map((): RunFormat => ({}));
  }

  /** Focus left the toolbar's color picker: back to the text, or out of the editor. */
  private focusLeftToolbar(next: EventTarget | null): void {
    if (!this.owns(next)) {
      this.host.focusLeft();
    }
  }
}
