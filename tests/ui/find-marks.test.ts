// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markedText } from '../../src/ui/find-marks';
import { caretOffsetFromPoint } from '../../src/ui/grid/cell-paint';
import { el } from '../../src/ui/dom';

function host(nodes: Node[]): HTMLElement {
  const div = document.createElement('div');
  div.append(...nodes);
  return div;
}

describe('markedText', () => {
  it('wraps each range in a mark and keeps the rest as text', () => {
    const div = host(
      markedText('one cat, two cats', [
        { start: 4, end: 7 },
        { start: 13, end: 16 },
      ]),
    );
    expect(div.textContent).toBe('one cat, two cats');
    const marks = Array.from(div.querySelectorAll('mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['cat', 'cat']);
    expect(marks.every((m) => m.className === 'find-hit')).toBe(true);
  });

  it('emphasizes only the ranges it is told to', () => {
    const div = host(
      markedText(
        'a b a',
        [
          { start: 0, end: 1 },
          { start: 4, end: 5 },
        ],
        (i) => i === 1,
      ),
    );
    expect(div.querySelectorAll('mark.find-hit')).toHaveLength(2);
    expect(div.querySelectorAll('mark.find-hit-current')).toHaveLength(1);
    expect(div.querySelector('mark.find-hit-current')?.previousSibling?.textContent).toBe(' b ');
  });

  it('sets matched text as text, never as markup', () => {
    const div = host(markedText('<b>x</b> x', [{ start: 0, end: 8 }]));
    expect(div.querySelector('b')).toBeNull();
    expect(div.querySelector('mark')?.textContent).toBe('<b>x</b>');
  });

  it('skips empty ranges, and yields nothing for empty text', () => {
    expect(markedText('', [])).toEqual([]);
    const div = host(markedText('abc', [{ start: 1, end: 1 }]));
    expect(div.querySelector('mark')).toBeNull();
    expect(div.textContent).toBe('abc');
  });
});

describe('caretOffsetFromPoint across find marks', () => {
  it('counts the marked and plain text before a hit, in document order', () => {
    const cell = el('div', { className: 'vcell' }, markedText('ab cd ef', [{ start: 3, end: 5 }]));
    document.body.append(cell);
    const last = cell.lastChild as Text;
    Object.assign(document, { caretPositionFromPoint: () => ({ offsetNode: last, offset: 2 }) });
    try {
      // 'ab ' (3) + the marked 'cd' (2) + 2 characters into ' ef'.
      expect(caretOffsetFromPoint(cell, 0, 0)).toBe(7);
    } finally {
      Reflect.deleteProperty(document, 'caretPositionFromPoint');
      cell.remove();
    }
  });
});
