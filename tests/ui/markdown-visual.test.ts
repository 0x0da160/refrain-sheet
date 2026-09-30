// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The Markdown sheet's visual mode (`MarkdownVisualEditor`): editing a block
 * rewrites only that block's Markdown, and every other line of the source
 * stays exactly as it was.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { MarkdownVisualEditor } from '../../src/ui/markdown-visual';

const SOURCE = [
  '#   Title  ',
  '',
  'First *para*.',
  '',
  '* one',
  '*  two',
  '',
  '| a |',
  '|---|',
  '| 1 |',
].join('\n');

function editor(source = SOURCE): { visual: MarkdownVisualEditor; changes: string[] } {
  const visual = new MarkdownVisualEditor();
  const changes: string[] = [];
  visual.onChange = (text) => changes.push(text);
  document.body.replaceChildren(visual.element);
  visual.load(source);
  return { visual, changes };
}

function last(changes: string[]): string {
  return changes[changes.length - 1];
}

function blocks(visual: MarkdownVisualEditor): HTMLElement[] {
  return Array.from(
    visual.element.querySelectorAll(':scope > .markdown-visual-row > .markdown-visual-block'),
  ) as HTMLElement[];
}

function caretIn(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function type(target: HTMLElement, text: string): void {
  target.textContent = text;
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  setLocale('en');
});

describe('MarkdownVisualEditor', () => {
  it('shows each block formatted and editable, plus an empty paragraph for new text', () => {
    const { visual } = editor();
    const shown = blocks(visual);
    expect(shown.map((node) => node.tagName)).toEqual(['H1', 'P', 'UL', 'TABLE', 'P']);
    expect(shown[1].querySelector('em')?.textContent).toBe('para');
    expect(shown[1].contentEditable).toBe('true');
    // A table is edited cell by cell.
    expect(shown[3].contentEditable).not.toBe('true');
    expect(shown[3].querySelector('td')!.contentEditable).toBe('true');
    expect(shown[4].dataset.placeholder).toBe('Type here to add text');
  });

  it('rewrites only the edited block', () => {
    const { visual, changes } = editor();
    const paragraph = blocks(visual)[1];
    paragraph.append(' More.');
    paragraph.dispatchEvent(new Event('input', { bubbles: true }));
    expect(last(changes)).toBe(SOURCE.replace('First *para*.', 'First *para*. More.'));
  });

  it('writes a table cell back into the table', () => {
    const { visual, changes } = editor();
    type(blocks(visual)[3].querySelector('td')!, '2');
    expect(last(changes).split('\n').slice(7)).toEqual(['| a |', '| --- |', '| 2 |']);
    expect(last(changes).split('\n').slice(0, 7)).toEqual(SOURCE.split('\n').slice(0, 7));
  });

  it('adds text typed at the end as a new paragraph', () => {
    const { visual, changes } = editor('# Title');
    type(blocks(visual)[1], 'Hello');
    expect(last(changes)).toBe('# Title\n\nHello');
    type(blocks(visual)[1], 'Hello again');
    expect(last(changes)).toBe('# Title\n\nHello again');
  });

  it('starts an empty document from the empty paragraph', () => {
    const { visual, changes } = editor('');
    expect(blocks(visual)).toHaveLength(1);
    type(blocks(visual)[0], 'First');
    expect(last(changes)).toBe('First');
  });

  it('removes a paragraph whose text is deleted', () => {
    const { visual, changes } = editor();
    type(blocks(visual)[1], '');
    expect(last(changes)).toBe(SOURCE.replace('First *para*.\n\n', ''));
  });

  it('splits a paragraph in two on Enter', () => {
    const { visual, changes } = editor('Hello world');
    const paragraph = blocks(visual)[0];
    caretIn(paragraph.firstChild!, 5);
    paragraph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(last(changes)).toBe('Hello\n\n world');
    expect(blocks(visual).map((node) => node.textContent)).toEqual(['Hello', ' world', '']);
    expect(blocks(visual)[1].contains(document.getSelection()!.anchorNode)).toBe(true);
  });

  it('joins a paragraph onto the one before on Backspace at its start', () => {
    const { visual, changes } = editor('One\n\nTwo');
    const second = blocks(visual)[1];
    caretIn(second.firstChild!, 0);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(last(changes)).toBe('OneTwo');
  });

  it('turns the focused block into another kind', () => {
    const { visual, changes } = editor();
    const paragraph = blocks(visual)[1];
    paragraph.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    visual.setBlockKind('h2');
    expect(last(changes)).toBe(SOURCE.replace('First *para*.', '## First *para*.'));
    expect(blocks(visual)[1].tagName).toBe('H2');
    blocks(visual)[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    visual.setBlockKind('bullets');
    expect(last(changes)).toBe(SOURCE.replace('First *para*.', '- First *para*.'));
  });

  it('makes the selected text bold, and plain again', () => {
    const { visual, changes } = editor('Hello world');
    const paragraph = blocks(visual)[0];
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 6);
    range.setEnd(paragraph.firstChild!, 11);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    visual.toggleInline('strong');
    expect(last(changes)).toBe('Hello **world**');
    visual.toggleInline('strong');
    expect(last(changes)).toBe('Hello world');
  });

  it('pastes plain text only', () => {
    const { visual, changes } = editor('Hello');
    const paragraph = blocks(visual)[0];
    caretIn(paragraph.firstChild!, 5);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? ' <b>there</b>' : '<img src=x>') },
    });
    paragraph.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(paragraph.querySelector('b, img')).toBeNull();
    expect(last(changes)).toBe('Hello <b>there</b>');
  });

  it('turns editing off when read-only', () => {
    const { visual } = editor();
    visual.setReadOnly(true);
    expect(visual.element.querySelectorAll('[contenteditable="true"]')).toHaveLength(0);
  });

  describe('block tools', () => {
    const tool = (visual: MarkdownVisualEditor, index: number, action: string): HTMLButtonElement =>
      blocks(visual)[index].parentElement!.querySelector<HTMLButtonElement>(`.markdown-block-${action}`)!;

    it('labels each tool and keeps it out of the editable text', () => {
      const { visual } = editor();
      const tools = blocks(visual)[1].parentElement!.querySelector<HTMLElement>('.markdown-block-tools')!;
      expect(tools.getAttribute('contenteditable')).toBe('false');
      expect(tool(visual, 1, 'up').getAttribute('aria-label')).toBe('Move Block Up');
      expect(tool(visual, 1, 'delete').getAttribute('aria-label')).toBe('Delete Block');
    });

    it('moves a block down and up, keeping every other line', () => {
      const { visual, changes } = editor();
      tool(visual, 1, 'down').click();
      expect(last(changes)).toBe(
        ['#   Title  ', '', '* one', '*  two', '', 'First *para*.', '', '| a |', '|---|', '| 1 |'].join('\n'),
      );
      expect(blocks(visual).map((node) => node.tagName)).toEqual(['H1', 'UL', 'P', 'TABLE', 'P']);
      tool(visual, 2, 'up').click();
      expect(last(changes)).toBe(SOURCE);
    });

    it('does not move the first block up or the last block down', () => {
      const { visual, changes } = editor();
      tool(visual, 0, 'up').click();
      tool(visual, 3, 'down').click();
      expect(changes).toHaveLength(0);
    });

    it('keeps two blocks apart when a move puts them side by side', () => {
      const { visual, changes } = editor('A\n\n* one\nB');
      expect(blocks(visual).map((node) => node.tagName)).toEqual(['P', 'UL', 'P', 'P']);
      tool(visual, 0, 'down').click();
      expect(last(changes)).toBe('* one\n\nA\n\nB');
    });

    it('deletes a block with its source lines', () => {
      const { visual, changes } = editor();
      tool(visual, 2, 'delete').click();
      expect(last(changes)).toBe(
        ['#   Title  ', '', 'First *para*.', '', '| a |', '|---|', '| 1 |'].join('\n'),
      );
      expect(blocks(visual).map((node) => node.tagName)).toEqual(['H1', 'P', 'TABLE', 'P']);
    });

    it('keeps the empty paragraph at the end for new text', () => {
      const { visual, changes } = editor();
      tool(visual, 4, 'delete').click();
      expect(changes).toHaveLength(0);
      expect(blocks(visual)).toHaveLength(5);
    });

    it('adds an empty paragraph below a block, written once text is typed', () => {
      const { visual, changes } = editor();
      tool(visual, 0, 'add').click();
      const shown = blocks(visual);
      expect(shown.map((node) => node.tagName)).toEqual(['H1', 'P', 'P', 'UL', 'TABLE', 'P']);
      type(shown[1], 'New');
      expect(last(changes)).toContain('#   Title  \n\nNew\n\nFirst *para*.');
    });

    it('moves the block with the caret on Alt+Shift+Arrow', () => {
      const { visual, changes } = editor();
      const paragraph = blocks(visual)[1];
      caretIn(paragraph.firstChild!, 0);
      paragraph.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true, bubbles: true }),
      );
      expect(last(changes).startsWith('First *para*.\n\n#   Title  ')).toBe(true);
    });

    it('does nothing while the sheet is locked', () => {
      const { visual, changes } = editor();
      visual.setReadOnly(true);
      tool(visual, 1, 'down').click();
      tool(visual, 1, 'delete').click();
      expect(changes).toHaveLength(0);
      expect(visual.element.classList.contains('read-only')).toBe(true);
    });
  });
});

describe('MarkdownVisualEditor: Markdown typed at the start of a line', () => {
  it('turns "# " into a heading as it is typed, keeping the text after it', () => {
    const { visual, changes } = editor('Intro');
    const tail = blocks(visual)[1];
    tail.textContent = '## Plan';
    caretIn(tail.firstChild!, 7);
    tail.dispatchEvent(new Event('input', { bubbles: true }));
    expect(blocks(visual)[1].tagName).toBe('H2');
    expect(blocks(visual)[1].textContent).toBe('Plan');
    expect(last(changes)).toBe('Intro\n\n## Plan');
    // The caret stays after "Plan", inside the heading.
    const selection = document.getSelection()!;
    expect(blocks(visual)[1].contains(selection.anchorNode)).toBe(true);
    expect(selection.anchorOffset).toBe(4);
  });

  it('starts an empty heading, list or quote from its marker alone', () => {
    for (const [typed, tag, source] of [
      ['# ', 'H1', '# '],
      ['- ', 'UL', '- '],
      ['1. ', 'OL', '1. '],
      ['> ', 'BLOCKQUOTE', '>'],
    ] as const) {
      const { visual, changes } = editor('');
      const paragraph = blocks(visual)[0];
      type(paragraph, typed);
      expect(blocks(visual)[0].tagName).toBe(tag);
      expect(last(changes)).toBe(source);
    }
  });

  it('accepts the full-width marks a Japanese input method types, once composing ends', () => {
    const { visual, changes } = editor('');
    const paragraph = blocks(visual)[0];
    paragraph.textContent = '＃　見出し';
    paragraph.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    expect(blocks(visual)[0].tagName).toBe('P');
    paragraph.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(blocks(visual)[0].tagName).toBe('H1');
    expect(last(changes)).toBe('# 見出し');
  });

  it('leaves a paragraph alone when the mark is not at its start', () => {
    const { visual, changes } = editor('');
    type(blocks(visual)[0], 'Use # for headings');
    expect(blocks(visual)[0].tagName).toBe('P');
    expect(last(changes)).toBe('Use # for headings');
  });

  it('opens a code block when Enter is pressed on a fence', () => {
    const { visual, changes } = editor('');
    const paragraph = blocks(visual)[0];
    type(paragraph, '```js');
    caretIn(paragraph.firstChild!, 5);
    paragraph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(blocks(visual)[0].tagName).toBe('PRE');
    expect(last(changes)).toBe('```js\n\n```');
  });
});
