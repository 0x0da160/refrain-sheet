// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Selected objects saved as one picture (the SVG, the file name, the
 * command and what it leaves out), and objects in File > Print….
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { objectImageName } from '../../src/app/commands/object-export';
import { DEFAULT_PRINT_SETTINGS } from '../../src/core/print-layout';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import type { SheetObject } from '../../src/core/workbook/sheet-objects';
import { objectsSvg, svgFileText, type TextSetting } from '../../src/ui/object-export';
import { printTab } from '../../src/ui/print-view';

const text: TextSetting = { family: 'sans-serif', measure: (s) => s.length * 7 };

const shape = (id: string, extra: Partial<SheetObject> = {}) =>
  ({
    id,
    name: id,
    kind: 'rect',
    row: 0,
    col: 0,
    dx: 0,
    dy: 0,
    width: 40,
    height: 20,
    ...extra,
  }) as SheetObject;

function book(objects: SheetObject[] = []) {
  const state = new AppState();
  const doc = RsfDocument.empty('b.rsf', 10, 5, 'Sheet1');
  doc.setObjectsOn(undefined, objects);
  doc.markSaved();
  const tab = state.addTab('b.rsf', doc, null);
  return { state, doc, tab };
}

afterEach(() => {
  document.body.textContent = '';
  vi.restoreAllMocks();
});

describe('objects as a picture', () => {
  it('draws the objects in one SVG just big enough, keeping their places and order', () => {
    const { doc } = book();
    const drawn = objectsSvg(
      doc,
      [
        { o: shape('a', { fill: '#ff0000' }), x: 100, y: 50 },
        { o: shape('b', { kind: 'ellipse' }), x: 130, y: 60 },
      ],
      text,
    )!;
    expect([drawn.width, drawn.height]).toEqual([70, 30]);
    const groups = Array.from(drawn.svg.children);
    expect(groups.map((g) => g.getAttribute('transform'))).toEqual(['translate(0 0)', 'translate(30 10)']);
    expect(groups[0].querySelector('rect')?.getAttribute('fill')).toBe('#ff0000');
    expect(groups[1].querySelector('ellipse')).not.toBeNull();
    // No background: nothing is drawn behind the objects.
    expect(drawn.svg.firstElementChild?.tagName).toBe('g');
    expect(svgFileText(drawn.svg)).toMatch(/^<\?xml[^>]*>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  });

  it('wraps shape text to the shape and keeps its colour, black when none is set', () => {
    const { doc } = book();
    const o = shape('t', {
      kind: 'text',
      width: 60,
      height: 60,
      text: 'one two three',
      textColor: '#336699',
    });
    const drawn = objectsSvg(doc, [{ o, x: 0, y: 0 }], text)!;
    const node = drawn.svg.querySelector('text')!;
    expect(Array.from(node.querySelectorAll('tspan')).map((s) => s.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(node.getAttribute('fill')).toBe('#336699');
    const plain = objectsSvg(doc, [{ o: { ...o, textColor: undefined }, x: 0, y: 0 }], text)!;
    expect(plain.svg.querySelector('text')?.getAttribute('fill')).toBe('#000000');
  });

  it('grows the picture to hold a rotated object', () => {
    const { doc } = book();
    const drawn = objectsSvg(
      doc,
      [{ o: shape('r', { width: 40, height: 40, rotation: 45 }), x: 0, y: 0 }],
      text,
    )!;
    expect(drawn.width).toBe(58);
    expect(drawn.svg.querySelector('g')?.getAttribute('transform')).toContain('rotate(45 20 20)');
  });

  it('names the file after the one object, or in general for several', () => {
    expect(objectImageName([shape('a', { name: 'Plan: A/B' })], 'png')).toBe('Plan_ A_B.png');
    expect(objectImageName([shape('a'), shape('b')], 'svg')).toBe('objects.svg');
  });
});

describe('Save Objects as SVG Image…', () => {
  function setup(objects: SheetObject[]) {
    const { state, doc, tab } = book(objects);
    const notify = vi.fn();
    const ui = new Proxy({ notify } as unknown as UiPort, {
      get: (_target, key) => (key === 'notify' ? notify : vi.fn(async () => null)),
    });
    const commands = new Commands(state, ui, document);
    const render = vi.fn(async () => new Uint8Array([1, 2, 3]));
    commands.objectImages = { render };
    return { state, doc, tab, commands, render, notify };
  }

  it('saves the shown selected objects and leaves hidden ones out', async () => {
    const { state, tab, commands, render, notify } = setup([
      shape('a'),
      shape('b', { hidden: true }),
      shape('c'),
    ]);
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    state.objectSelection.select(tab, ['a', 'b', 'c']);
    await commands.run('object.saveAsSvg');
    expect(render).toHaveBeenCalledTimes(1);
    const [, objects, format] = render.mock.calls[0] as unknown as [unknown, SheetObject[], string];
    expect(objects.map((o) => o.id)).toEqual(['a', 'c']);
    expect(format).toBe('svg');
    expect(click).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('objects.svg'), 'info');
  });

  it('is off when nothing shown is selected', () => {
    const { state, tab, commands } = setup([shape('a', { hidden: true }), shape('b')]);
    expect(commands.isEnabled('object.saveAsPng')).toBe(false);
    state.objectSelection.select(tab, ['a']);
    expect(commands.isEnabled('object.saveAsPng')).toBe(false);
    state.objectSelection.select(tab, ['b']);
    expect(commands.isEnabled('object.saveAsPng')).toBe(true);
  });
});

describe('objects in print', () => {
  /** Print and keep a copy of the layer as the browser would print it. */
  function printed(state: AppState, tab: ReturnType<AppState['addTab']>): HTMLElement {
    let copy: HTMLElement | null = null;
    const win = {
      document,
      onafterprint: null,
      addEventListener: (type: string, fn: () => void) => window.addEventListener(type, fn),
      removeEventListener: (type: string, fn: () => void) => window.removeEventListener(type, fn),
      print: () => {
        copy = document.querySelector<HTMLElement>('.print-root')!.cloneNode(true) as HTMLElement;
        window.dispatchEvent(new Event('afterprint'));
      },
    } as unknown as Window;
    printTab(state, tab, DEFAULT_PRINT_SETTINGS, win);
    return copy!;
  }

  it('draws shown objects from their anchor cell, in stacking order, and leaves hidden ones out', () => {
    const { state, doc, tab } = book([
      shape('a', { row: 1, col: 1, dx: 5, dy: 7, text: 'Hi' }),
      shape('h', { row: 1, col: 1, hidden: true }),
      shape('b', { row: 3, col: 2 }),
    ]);
    doc.setCell(0, 0, 'x');
    const root = printed(state, tab);
    const anchors = root.querySelectorAll('td.print-object-anchor');
    expect(anchors).toHaveLength(2);
    const first = anchors[0].querySelector<HTMLElement>('.sheet-object')!;
    expect(first.dataset.objectId).toBe('a');
    expect([first.style.left, first.style.top, first.style.zIndex]).toEqual(['5px', '7px', '1']);
    expect(root.querySelector('[data-object-id="h"]')).toBeNull();
    expect(anchors[1].querySelector<HTMLElement>('.sheet-object')!.style.zIndex).toBe('2');
    // The rows reach the lowest anchor even though only A1 holds a value.
    expect(root.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('prints a sheet that holds only objects', () => {
    const { state, tab } = book([shape('a', { row: 2, col: 0 })]);
    const root = printed(state, tab);
    expect(root.querySelectorAll('[data-object-id="a"]')).toHaveLength(1);
  });
});
