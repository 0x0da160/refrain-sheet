// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
/**
 * A pivot table sheet's link is saved with its worksheet. Opening the saved file
 * reopens the panel with the same settings, and an update refuses a summary that
 * was moved or edited, writing nothing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppState } from '../../src/app/state';
import { Commands, type PivotDialogInput, type UiPort } from '../../src/app/commands';
import { setLocale } from '../../src/app/i18n';
import { pivotLinkOn } from '../../src/app/state/pivot-links';
import { RsfDocument } from '../../src/core/workbook/rsf-document';

beforeAll(() => {
  setLocale('en');
});

/** Opens the pivot table panel on the active tab and hands back what the panel would get. */
async function openPanel(state: AppState): Promise<PivotDialogInput> {
  let captured: PivotDialogInput | null = null;
  const ui = {
    showPivot: vi.fn(async (input: PivotDialogInput) => {
      captured = input;
    }),
    notify: vi.fn(),
  } as unknown as UiPort;
  await new Commands(state, ui, document).run('data.pivotTable');
  return captured!;
}

/** A workbook: a header row, then four sales. */
function salesBook(): { state: AppState; doc: RsfDocument } {
  const state = new AppState();
  const doc = RsfDocument.blank('sales.rsf');
  const rows = [
    ['region', 'item', 'amount'],
    ['East', 'pen', '1200'],
    ['West', 'pen', '50'],
    ['East', 'ink', '25'],
    ['West', 'ink', '75'],
  ];
  rows.forEach((row, r) => row.forEach((value, c) => doc.setCell(r, c, value)));
  state.addTab('sales.rsf', doc, null);
  return { state, doc };
}

/** The displayed text of the top-left `rows` by `cols` cells of the active sheet. */
function block(doc: RsfDocument, rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => doc.getSheetDisplayValue(doc.activeSheetId, r, c)),
  );
}

const byRegion = { rowField: 0, columnField: null, valueField: 2, aggregation: 'sum' as const };

describe('a pivot table sheet in a saved file', () => {
  it('keeps its link when the file is saved and opened again, and updates from the reopened panel', async () => {
    const { state, doc } = salesBook();
    const sourceId = doc.activeSheetId;
    (await openPanel(state)).create(byRegion);
    const pivotId = doc.activeSheetId;

    const loaded = RsfDocument.fromBytes(doc.toBytes(), 'sales.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const reopened = new AppState();
    const tab = reopened.addTab('sales.rsf', loaded.doc, null);
    expect(loaded.doc.activeSheetId).toBe(pivotId);
    expect(pivotLinkOn(tab, pivotId)).toMatchObject({
      sourceTabId: tab.id,
      sourceId,
      request: byRegion,
    });

    const panel = await openPanel(reopened);
    expect(panel.initial).toEqual(byRegion);
    const average = { ...byRegion, aggregation: 'average' as const };
    expect(panel.update!(average)).toEqual({
      ok: true,
      sheetName: 'Pivot Table',
      ignored: 0,
      mode: 'updated',
    });
  });

  it('refuses to update a summary that was moved, and writes nothing', async () => {
    const { state, doc } = salesBook();
    (await openPanel(state)).create(byRegion);
    // A row is inserted above the summary, which moves it down.
    doc.sheetById(doc.activeSheetId)!.insertRows(0, [[]]);
    const moved = block(doc, 6, 3);

    const outcome = (await openPanel(state)).update!({ ...byRegion, aggregation: 'average' });
    expect(outcome).toEqual({ ok: false, error: { code: 'summaryChanged', params: {} } });
    expect(block(doc, 6, 3)).toEqual(moved);
  });

  it('refuses to update a summary that was edited by hand', async () => {
    const { state, doc } = salesBook();
    (await openPanel(state)).create(byRegion);
    const pivotId = doc.activeSheetId;
    doc.setCellOn(pivotId, 1, 1, 'edited');

    const outcome = (await openPanel(state)).update!({ ...byRegion, aggregation: 'average' });
    expect(outcome).toEqual({ ok: false, error: { code: 'summaryChanged', params: {} } });
    expect(doc.getSheetDisplayValue(pivotId, 1, 1)).toBe('edited');
  });

  it('still updates after rows are added below the summary', async () => {
    const { state, doc } = salesBook();
    (await openPanel(state)).create(byRegion);
    doc.sheetById(doc.activeSheetId)!.insertRows(20, [[]]);

    const outcome = (await openPanel(state)).update!({ ...byRegion, aggregation: 'average' });
    expect(outcome).toMatchObject({ ok: true, mode: 'updated' });
  });
});
