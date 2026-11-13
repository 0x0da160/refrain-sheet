// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Enter and Escape that confirm or cancel a Japanese conversion (IME) must not
 * act on the control they are typed into. Safari delivers the keydown that
 * confirms a candidate after `compositionend`, with `isComposing` already false
 * and `keyCode` 229, so these handlers check `isComposingKey`, not only
 * `isComposing`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Commands, type UiPort } from '../../src/app/commands';
import { AppState } from '../../src/app/state';
import type { SheetObject } from '../../src/core/workbook/sheet-objects';
import { buildColorPicker } from '../../src/ui/color-picker';
import { FindBar } from '../../src/ui/find-bar';
import { Grid } from '../../src/ui/grid';
import { editObjectText } from '../../src/ui/grid/object-text-editor';
import { editNameInPlace } from '../../src/ui/sheet-name-field';
import { doc } from '../helpers';

/** A keydown. `keyCode` 229 is the one Safari sends for the key that confirms a candidate. */
function keydown(key: string, keyCode = 0): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (keyCode !== 0) {
    Object.defineProperty(event, 'keyCode', { value: keyCode });
  }
  return event;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('Enter and Escape during a Japanese conversion', () => {
  it('does not rename a sheet until the conversion is finished', () => {
    const label = document.createElement('div');
    document.body.append(label);
    const rename = vi.fn((): string | null => null);
    const done = vi.fn();
    editNameInPlace(label, { name: 'Sheet1', label: 'Sheet name', rename, announce: vi.fn(), done });
    const input = label.querySelector('input') as HTMLInputElement;
    input.value = 'Budget';

    input.dispatchEvent(keydown('Enter', 229));
    expect(rename).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();

    input.dispatchEvent(keydown('Enter'));
    expect(rename).toHaveBeenCalledWith('Budget');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet-name field open on the Escape that cancels a conversion', () => {
    const label = document.createElement('div');
    document.body.append(label);
    const done = vi.fn();
    editNameInPlace(label, {
      name: 'Sheet1',
      label: 'Sheet name',
      rename: () => null,
      announce: vi.fn(),
      done,
    });
    const input = label.querySelector('input') as HTMLInputElement;

    input.dispatchEvent(keydown('Escape', 229));
    expect(done).not.toHaveBeenCalled();
    expect(label.contains(input)).toBe(true);

    input.dispatchEvent(keydown('Escape'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not apply a color code until the conversion is finished', () => {
    const onPick = vi.fn();
    const picker = buildColorPicker({ current: null, onPick });
    const code = picker.querySelector('.color-picker-code') as HTMLInputElement;
    code.value = 'red';

    code.dispatchEvent(keydown('Enter', 229));
    expect(onPick).not.toHaveBeenCalled();

    code.dispatchEvent(keydown('Enter'));
    expect(onPick).toHaveBeenCalledWith('#ff0000');
  });

  it('neither runs find-next nor closes the find bar on the keys that confirm or cancel a conversion', () => {
    const state = new AppState();
    // Only the find bar's own keys are exercised here; every UiPort method is a no-op stub.
    const ui = new Proxy({}, { get: () => vi.fn() }) as unknown as UiPort;
    const commands = new Commands(state, ui, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    state.addTab('data.csv', doc('foo,x\nfoo,y\n'), null);
    const findBar = new FindBar(state, commands, grid);
    document.body.append(findBar.element);
    const findInput = findBar.element.querySelector('input[type="text"]') as HTMLInputElement;
    const next = vi.spyOn(findBar as unknown as { next: (direction: 1 | -1) => void }, 'next');
    const close = vi.spyOn(findBar as unknown as { close: () => void }, 'close');

    findInput.dispatchEvent(keydown('Enter', 229));
    findInput.dispatchEvent(keydown('Escape', 229));
    expect(next).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    findInput.dispatchEvent(keydown('Enter'));
    expect(next).toHaveBeenCalledWith(1);
    findInput.dispatchEvent(keydown('Escape'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the shape text being typed on the Escape that cancels a conversion', () => {
    const node = document.createElement('div');
    document.body.append(node);
    const shape = { id: 'shape-1', kind: 'rect', text: 'abc' } as unknown as SheetObject;
    const done = vi.fn();
    editObjectText(node, shape, done);
    const field = node.querySelector('.sheet-object-text-field') as HTMLElement;
    field.textContent = 'abcd';

    field.dispatchEvent(keydown('Escape', 229));
    expect(done).not.toHaveBeenCalled();
    expect(node.querySelector('.sheet-object-text-field')).not.toBeNull();

    field.dispatchEvent(keydown('Escape'));
    expect(done).toHaveBeenCalledWith(null);
  });
});
