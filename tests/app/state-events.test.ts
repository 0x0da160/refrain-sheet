// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Characterization of the events `AppState` emits for a scripted session
 * (docs/proposals/structural-refactoring-plan.md, R0). Every UI surface
 * re-renders from these events, so splitting the state into stores must keep
 * the same events in the same order.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type StateEventType } from '../../src/app/state';
import { Commands, type UiPort } from '../../src/app/commands';
import { utf8 } from '../helpers';

function inertUi(): UiPort {
  return new Proxy({} as UiPort, { get: () => vi.fn(async () => null) });
}

describe('AppState event sequence (characterization)', () => {
  it('emits the same events for a scripted session', async () => {
    const state = new AppState();
    const commands = new Commands(state, inertUi(), document);
    const log: string[] = [];
    let step = '';
    const events: StateEventType[] = [];
    state.subscribe((event) => events.push(event));
    const record = async (name: string, action: () => unknown): Promise<void> => {
      step = name;
      events.length = 0;
      const result = await action();
      const tab = state.activeTab;
      const cell = tab ? `${tab.doc.rowCount}x${tab.doc.getValue(0, 0)}|${tab.doc.getValue(1, 1)}` : '-';
      log.push(
        `${step}: [${events.join(' ')}] -> ${typeof result === 'boolean' ? result : typeof result} ${cell}`,
      );
    };

    const bytes = utf8('a,b\n1,2\n3,4\n');
    await record('open csv', () =>
      commands.openFiles([{ name: 'a.csv', bytes, handle: null, size: bytes.length }], {
        confirmNonCsv: false,
      }),
    );
    const csv = state.activeTab!;
    await record('unprotect', () => state.setReadOnly(csv, false));
    await record('select', () => state.setSelection(csv, { row: 1, col: 1 }, { row: 2, col: 0 }));
    await record('edit', () => state.editCell(csv, 1, 1, 'x'));
    await record('undo', () => state.undo(csv));
    await record('redo', () => state.redo(csv));
    await record('insert rows', () => state.insertRows(csv, 1, 2));
    await record('delete cols', () => state.deleteCols(csv, 0, 1));
    await record('zoom', () => state.setTabZoom(csv, 150));
    await record('wrap', () => state.setWrapCells(!state.wrapCells));
    await record('freeze', () => state.setTabFreeze(csv, { rows: 1, cols: 1 }));
    await record('read-only', () => state.setReadOnly(csv, true));
    await record('new rsf', () => commands.run('file.new'));
    const rsf = state.activeTab!;
    await record('add sheet', () => state.addSheet(rsf, 'Two'));
    const second = state.activeWorkbook()!.sheets[1];
    await record('rename sheet', () => state.renameSheet(rsf, second.id, 'Second'));
    await record('switch sheet', () => state.setActiveSheet(rsf, state.activeWorkbook()!.sheets[0].id));
    await record('move sheet', () => state.moveSheet(rsf, second.id, 0));
    await record('delete sheet', () => state.deleteSheet(rsf, second.id));
    await record('rsf edit', () => state.editCell(rsf, 0, 0, '=1+2'));
    await record('rsf insert rows', () => state.insertRows(rsf, 0, 2));
    await record('rsf delete cols', () => state.deleteCols(rsf, 1, 1));
    await record('rsf undo', () => state.undo(rsf));
    await record('rsf filter', () => state.setFilter(rsf, null));
    await record('activate csv', () => state.activateTab(csv.id));
    await record('cycle', () => state.cycleTab(1));
    await record('move tab', () => state.moveTab(csv.id, 1));
    await record('close rsf', () => state.closeTab(rsf.id));

    expect(log).toMatchSnapshot();
  });
});
