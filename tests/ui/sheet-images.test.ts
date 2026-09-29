// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Pictures over a worksheet: reading a picture's type and size, the file's
 * picture store (each picture once, only the ones still shown), the `.rsf`
 * round trip and what the reader refuses, inserting and pasting, and the
 * grid's drawing (crop, mirroring) and ratio-keeping resize.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import {
  base64ToBytes,
  bytesToBase64,
  ImageStore,
  imageSize,
  MAX_IMAGE_BYTES,
  sniffImageType,
} from '../../src/core/workbook/sheet-images';
import { validateObject, type SheetObject } from '../../src/core/workbook/sheet-objects';
import { Grid } from '../../src/ui/grid';
import { ObjectsPanel } from '../../src/ui/objects-panel';
import { rsfFromTree, rsfTree } from '../rsf-single-sheet';

/** A 2 × 1 PNG (a red and a blue pixel). */
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 123,
  64, 232, 221, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 0, 4, 255, 1, 7, 0, 1, 255, 226, 35, 158,
  89, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);
const svg = (text: string): Uint8Array => new TextEncoder().encode(text);
const SVG = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="10" height="10"/></svg>',
);

function setup() {
  const state = new AppState();
  const notify = vi.fn();
  const fakes = new Map<string | symbol, unknown>([
    ['notify', notify],
    ['confirmConvert', vi.fn(async () => true)],
  ]);
  const ui = new Proxy({} as UiPort, {
    get: (_target, key) => {
      if (!fakes.has(key)) {
        fakes.set(
          key,
          vi.fn(async () => null),
        );
      }
      return fakes.get(key);
    },
  });
  const commands = new Commands(state, ui, document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 800, configurable: true });
  document.body.append(grid.element);
  state.subscribe((e) => (e === 'selection' ? grid.refreshSelection() : grid.refresh()));
  const doc = RsfDocument.empty('t.rsf', 6, 4);
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  grid.refresh();
  return { state, grid, commands, tab, doc, notify };
}

const picture = (overrides: Partial<SheetObject> = {}): SheetObject => ({
  id: 'o1',
  name: 'Image 1',
  kind: 'image',
  row: 1,
  col: 1,
  dx: 0,
  dy: 0,
  width: 200,
  height: 100,
  image: 'p1',
  ...overrides,
});

beforeEach(() => {
  document.body.textContent = '';
  localStorage.clear();
});

describe('sheet images: pictures', () => {
  it('tells PNG, JPEG, WebP and SVG apart and refuses anything else', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(svg('RIFF\0\0\0\0WEBPVP8X'))).toBe('image/webp');
    expect(sniffImageType(SVG)).toBe('image/svg+xml');
    expect(sniffImageType(svg('<html><body>no</body></html>'))).toBeNull();
    expect(sniffImageType(svg('GIF89a'))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toBeNull();
  });

  it('reads the size a picture states', () => {
    expect(imageSize({ type: 'image/png', bytes: PNG })).toEqual({ width: 2, height: 1 });
    expect(imageSize({ type: 'image/svg+xml', bytes: SVG })).toEqual({ width: 300, height: 150 });
    expect(imageSize({ type: 'image/svg+xml', bytes: svg('<svg viewBox="0 0 40 20"></svg>') })).toEqual({
      width: 40,
      height: 20,
    });
    expect(imageSize({ type: 'image/svg+xml', bytes: svg('<svg width="50%"></svg>') })).toBeNull();
    // A baseline JPEG: SOI, an APP0 segment, then SOF0 with 16 × 9.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 16, 1, 1, 0x11, 0,
    ]);
    expect(imageSize({ type: 'image/jpeg', bytes: jpeg })).toEqual({ width: 16, height: 9 });
    const webp = new Uint8Array(30);
    webp.set(svg('RIFF'), 0);
    webp.set(svg('WEBPVP8X'), 8);
    webp.set([99, 0, 0, 49, 0, 0], 24); // 100 × 50, stored minus one
    expect(imageSize({ type: 'image/webp', bytes: webp })).toEqual({ width: 100, height: 50 });
  });

  it('round-trips bytes through Base64 and refuses loose Base64', () => {
    expect(base64ToBytes(bytesToBase64(PNG))).toEqual(PNG);
    for (const bad of ['abc', 'ab c', 'ab==cd==', '****']) {
      expect(base64ToBytes(bad)).toBeNull();
    }
  });

  it('keeps each picture once and renames a clashing one on merge', () => {
    const store = new ImageStore();
    const a = store.add({ type: 'image/png', bytes: PNG });
    expect(store.add({ type: 'image/png', bytes: PNG.slice() })).toBe(a);
    const b = store.add({ type: 'image/svg+xml', bytes: SVG });
    expect(b).not.toBe(a);
    const renamed = store.merge([
      { id: a, type: 'image/png', bytes: PNG },
      { id: b, type: 'image/png', bytes: PNG },
      { id: 'other', type: 'image/svg+xml', bytes: SVG },
    ]);
    expect(renamed.size).toBe(1);
    expect(renamed.get(b)).toBe(a);
    expect(store.get('other')?.bytes).toBe(SVG);
  });

  it('validates the picture fields of an object', () => {
    expect(validateObject(picture(), 6, 4)).not.toBeNull();
    expect(
      validateObject(picture({ crop: { top: 10, right: 0, bottom: 20, left: 5 } }), 6, 4),
    ).not.toBeNull();
    for (const bad of [
      picture({ image: undefined }),
      picture({ image: 'a b' }),
      picture({ text: 'x' }),
      picture({ crop: { top: 60, right: 0, bottom: 40, left: 0 } }),
      picture({ crop: { top: -1, right: 0, bottom: 0, left: 0 } }),
      picture({ aspectFree: false as unknown as true }),
      { ...picture(), kind: 'rect' as const },
      {
        ...picture({ image: undefined }),
        kind: 'rect' as const,
        crop: { top: 1, right: 0, bottom: 0, left: 0 },
      },
    ]) {
      expect(validateObject(bad, 6, 4)).toBeNull();
    }
  });
});

describe('sheet images: the file', () => {
  it('stores a picture once, reopens it, and drops it when nothing shows it', async () => {
    const { doc, tab, commands, state } = setup();
    state.setSelection(tab, { row: 2, col: 1 });
    await commands.insertImage(tab, PNG);
    await commands.insertImage(tab, PNG);
    expect(doc.objects.map((o) => o.image)).toEqual([doc.objects[0].image, doc.objects[0].image]);
    const tree = rsfTree(doc.toBytes());
    expect(Object.keys(tree.images)).toEqual([doc.objects[0].image]);
    expect(tree.images[doc.objects[0].image!]).toEqual({ type: 'image/png', data: bytesToBase64(PNG) });
    expect(tree.sheets[0].objects[0]).toMatchObject({ kind: 'image', at: 'B3', image: doc.objects[0].image });

    const reopened = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const back = reopened.doc;
    expect(back.objects).toEqual(doc.objects);
    expect(back.images.get(back.objects[0].image!)?.bytes).toEqual(PNG);

    doc.setObjectsOn(undefined, []);
    expect('images' in rsfTree(doc.toBytes())).toBe(false);
    // Undo can still bring the picture back.
    expect(doc.images.get(tree.sheets[0].objects[0].image)).toBeDefined();
  });

  it('keeps crop, mirroring and free resizing through a save', () => {
    const { doc } = setup();
    const id = doc.images.add({ type: 'image/svg+xml', bytes: SVG });
    const o = picture({
      image: id,
      crop: { top: 5, right: 10, bottom: 0, left: 2.5 },
      flipH: true,
      aspectFree: true,
      rotation: 90,
    });
    doc.setObjectsOn(undefined, [o]);
    const reopened = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(reopened.ok && reopened.doc.objects).toEqual([o]);
  });

  it('refuses a picture the file does not hold, or one that is not what it says', () => {
    const file = (images: unknown, objects: unknown[]) =>
      rsfFromTree({
        format: 'refrain-sheet',
        version: 1,
        sheets: [{ id: 's1', name: 'Sheet1', rows: 2, cols: 2, cells: [['a']], objects }],
        ...(images === undefined ? {} : { images }),
      });
    const o = {
      id: 'o1',
      name: 'P',
      kind: 'image',
      at: 'A1',
      dx: 0,
      dy: 0,
      width: 10,
      height: 10,
      image: 'p1',
    };
    const png = { type: 'image/png', data: bytesToBase64(PNG) };
    expect(RsfDocument.fromBytes(file({ p1: png }, [o]), 't.rsf').ok).toBe(true);
    for (const [images, objects] of [
      [undefined, [o]],
      [{ p2: png }, [o]],
      [{ p1: { ...png, type: 'image/jpeg' } }, [o]],
      [{ p1: { ...png, type: 'image/gif' } }, [o]],
      [{ p1: { ...png, data: 'not base64' } }, [o]],
      [{ p1: { type: 'image/svg+xml', data: bytesToBase64(svg('<p>hi</p>')) } }, [o]],
      [{ 'p 1': png }, []],
      [[png], []],
      [{ p1: png }, [{ ...o, crop: { top: 50, right: 0, bottom: 50, left: 0 } }]],
      [{ p1: png }, [{ ...o, crop: [0, 0, 0, 0] }]],
      [{ p1: png }, [{ ...o, kind: 'rect' }]],
    ] as Array<[unknown, unknown[]]>) {
      const result = RsfDocument.fromBytes(file(images, objects), 't.rsf');
      expect(result.ok ? 'ok' : result.error).toBe('bad-shape');
    }
  });

  it('brings back the pictures of a restored version', async () => {
    const { doc, tab, commands } = setup();
    await commands.insertImage(tab, PNG);
    const id = doc.objects[0].image!;
    doc.toBytes(); // the first save: a version with the picture
    const fresh = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const reopened = fresh.doc;
    reopened.setObjectsOn(undefined, []);
    const reread = RsfDocument.fromBytes(reopened.toBytes(), 't.rsf');
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    const latest = reread.doc;
    expect(latest.images.get(id)).toBeUndefined();
    expect(latest.restoreFromSnapshot(0)).toBe(true);
    expect(latest.objects[0].image).toBe(id);
    expect(latest.images.get(id)?.bytes).toEqual(PNG);
  });
});

describe('sheet images: commands', () => {
  it('inserts a picture at its own size (shrunk to fit), selects it, and undoes it', async () => {
    const { doc, tab, commands, state } = setup();
    await commands.insertImage(tab, SVG);
    expect(doc.objects[0]).toMatchObject({ kind: 'image', name: 'Image 1', width: 300, height: 150 });
    expect(state.objectSelection.selected(tab)).toEqual([doc.objects[0].id]);
    const big = svg('<svg width="1920" height="1080"></svg>');
    await commands.insertImage(tab, big);
    expect(doc.objects[1]).toMatchObject({ width: 480, height: 270, name: 'Image 2' });
    state.undo(tab);
    state.undo(tab);
    expect(doc.objects).toHaveLength(0);
  });

  it('refuses a file that is not a picture, or one over the size limit', async () => {
    const { doc, tab, commands, notify } = setup();
    await commands.insertImage(tab, svg('plain text'));
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('PNG, JPEG, WebP'), 'warn');
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    huge.set(PNG);
    await commands.insertImage(tab, huge);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('20 MB'), 'warn');
    expect(doc.objects).toHaveLength(0);
  });

  it('refuses a crop change on an edit-locked picture but not on a position-fixed one', () => {
    const { doc, tab, commands } = setup();
    const id = doc.images.add({ type: 'image/png', bytes: PNG });
    doc.setObjectsOn(undefined, [picture({ image: id, lockPosition: true })]);
    const crop = { top: 10, right: 0, bottom: 0, left: 0 };
    expect(commands.updateObjects(tab, [{ ...doc.objects[0], crop }], 'history.editObject')).toBe(true);
    doc.setObjectsOn(undefined, [picture({ image: id, lockEdit: true })]);
    expect(commands.updateObjects(tab, [{ ...doc.objects[0], crop }], 'history.editObject')).toBe(false);
  });
});

describe('sheet images: the grid', () => {
  const node = (grid: Grid): HTMLElement | null => grid.element.querySelector<HTMLElement>('.sheet-object');

  it('draws the picture cropped and mirrored', () => {
    const { grid, doc } = setup();
    const id = doc.images.add({ type: 'image/png', bytes: PNG });
    doc.setObjectsOn(undefined, [
      picture({ image: id, crop: { top: 0, right: 0, bottom: 50, left: 50 }, flipH: true }),
    ]);
    grid.refresh();
    const img = node(grid)?.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`data:image/png;base64,${bytesToBase64(PNG)}`);
    // What is left (the right half, the top half) fills the 200 × 100 box.
    expect(img?.style.width).toBe('400px');
    expect(img?.style.height).toBe('200px');
    expect(img?.style.left).toBe('-200px');
    expect(img?.style.top).toBe('0px');
    expect((node(grid)?.firstElementChild as HTMLElement).style.transform).toBe('scale(-1, 1)');
  });

  it('keeps the ratio on a corner drag unless Shift is held, with corner handles only', () => {
    const { grid, doc, tab, state } = setup();
    const id = doc.images.add({ type: 'image/png', bytes: PNG });
    doc.setObjectsOn(undefined, [picture({ image: id })]);
    state.objectSelection.select(tab, ['o1']);
    grid.refresh();
    expect(grid.element.querySelectorAll('.sheet-object-handle')).toHaveLength(4);
    const drag = (dx: number, dy: number, shiftKey = false) => {
      const handle = grid.element.querySelector<HTMLElement>('.handle-se')!;
      handle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }),
      );
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: dx, clientY: dy, shiftKey }));
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: dx, clientY: dy, shiftKey }));
    };
    drag(100, 10);
    expect(doc.objects[0]).toMatchObject({ width: 300, height: 150 });
    drag(0, 50, true);
    expect(doc.objects[0]).toMatchObject({ width: 300, height: 200 });
  });
});

describe('sheet images: the object list', () => {
  it('crops by cutting the box down, follows one side with the other, and frees the ratio', async () => {
    const { state, commands, grid, tab, doc } = setup();
    const id = doc.images.add({ type: 'image/png', bytes: PNG });
    doc.setObjectsOn(undefined, [picture({ image: id })]);
    const panel = new ObjectsPanel(state, commands, grid);
    document.body.append(panel.element);
    state.subscribe(() => panel.render());
    panel.open();
    state.objectSelection.select(tab, ['o1']);
    const field = (key: string) =>
      panel.element.querySelector<HTMLInputElement>(`[data-focus-key="${key}"]`)!;
    // Each change redraws the list once the keyboard has moved on (a task later).
    const set = async (key: string, value: string) => {
      field(key).value = value;
      field(key).dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    // No fill, line or text for a picture.
    expect(panel.element.querySelector('[data-focus-key="fill"]')).toBeNull();
    expect(panel.element.querySelector('[data-focus-key="text"]')).toBeNull();
    await set('crop:left', '50');
    expect(doc.objects[0]).toMatchObject({ width: 100, height: 100, crop: { left: 50, top: 0 } });
    await set('crop:left', '0');
    expect(doc.objects[0]).toMatchObject({ width: 200, height: 100 });
    expect(doc.objects[0].crop).toBeUndefined();
    await set('width', '400');
    expect(doc.objects[0]).toMatchObject({ width: 400, height: 200 });
    field('aspectFree').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(doc.objects[0].aspectFree).toBe(true);
    await set('width', '100');
    expect(doc.objects[0]).toMatchObject({ width: 100, height: 200 });
  });
});
