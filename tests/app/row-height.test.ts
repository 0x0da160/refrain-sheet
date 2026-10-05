// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Format > Row Height… and the row heights' life through row deletes and
 * moves (undo gives a deleted row its height back; a moved row keeps it).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { RsfDocument } from '../../src/core/workbook/rsf-document';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn(), ...overrides },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

function setup(ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', 6, 2);
  for (let r = 0; r < 6; r++) {
    doc.setCell(r, 0, `r${r + 1}`);
  }
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, doc, tab };
}

describe('Format > Row Height…', () => {
  it('sets the selected rows to the height asked for, and Automatic clears it', async () => {
    const promptRowHeight = vi.fn<UiPort['promptRowHeight']>(async () => 40);
    const { state, commands, doc, tab } = setup(stubUi({ promptRowHeight }));
    state.setSelection(tab, { row: 1, col: 0 }, { row: 2, col: 1 });
    await commands.run('format.rowHeight');
    expect(promptRowHeight).toHaveBeenCalledWith(24);
    expect([...doc.activeSheet.rowHeights]).toEqual([
      [1, 40],
      [2, 40],
    ]);
    promptRowHeight.mockResolvedValueOnce('auto');
    await commands.run('format.rowHeight');
    expect(promptRowHeight).toHaveBeenLastCalledWith(40);
    expect(doc.activeSheet.rowHeights.size).toBe(0);
  });

  it('gives a deleted row its height back on undo, and keeps a moved row at its height', async () => {
    const { state, commands, doc, tab } = setup();
    commands.setRowHeight(tab, [2], 50);
    expect(state.deleteRows(tab, 1, 2)).toBe(true);
    expect(doc.activeSheet.rowHeights.size).toBe(0);
    await commands.run('edit.undo');
    expect([...doc.activeSheet.rowHeights]).toEqual([[2, 50]]);

    expect(state.moveAxis(tab, 'row', 2, 1, 5)).toBe(true);
    expect(doc.getValue(4, 0)).toBe('r3');
    expect([...doc.activeSheet.rowHeights]).toEqual([[4, 50]]);
    await commands.run('edit.undo');
    expect([...doc.activeSheet.rowHeights]).toEqual([[2, 50]]);
  });
});
