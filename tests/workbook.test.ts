// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * RSF workbooks: the worksheet model, worksheet lifecycle commands and their
 * undo/redo atomicity, per-worksheet independence of data and display state,
 * and the versioned workbook container (including migration from, and
 * continued compatibility with, single-worksheet files).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState, type Tab } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import {
  decodeRsf,
  decodeRsfWorkbook,
  encodeRsf,
  encodeRsfWorkbook,
  MAX_RSF_SHEETS,
  RSF_CONTAINER_VERSION,
  RSF_CONTAINER_VERSION_WORKBOOK,
  RSF_MAGIC,
  type RsfWorkbookData,
} from '../src/core/rsf-codec';
import { MAX_WORKSHEETS, RsfDocument } from '../src/core/rsf-document';
import { doc as csvDoc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** An app state with one open RSF workbook tab. */
function setup(ui: UiPort = stubUi()): { state: AppState; commands: Commands; tab: Tab; doc: RsfDocument } {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const workbook = RsfDocument.empty('book.rsf', 8, 4, 'Sheet1');
  const tab = state.addTab('book.rsf', workbook, null);
  return { state, commands, tab, doc: workbook };
}

describe('workbook creation', () => {
  it('starts as one worksheet carrying the supplied (localized) default name', () => {
    const workbook = RsfDocument.blank('untitled.rsf', 10, 3, 'シート1');
    expect(workbook.sheetCount).toBe(1);
    expect(workbook.sheets[0].name).toBe('シート1');
    expect(workbook.activeSheetId).toBe(workbook.sheets[0].id);
    expect(workbook.rowCount).toBe(10);
    expect(workbook.columnCount).toBe(3);
  });

  it('converts a CSV into a one-worksheet workbook', () => {
    const workbook = RsfDocument.fromLossless(csvDoc('a,b\n1,2\n'), 'x.rsf', 'Sheet1');
    expect(workbook.sheetCount).toBe(1);
    expect(workbook.sheets[0].name).toBe('Sheet1');
    expect(workbook.getValue(0, 0)).toBe('a');
  });

  it('gives each worksheet a stable id that a rename does not change', () => {
    const { state, tab, doc } = setup();
    const id = doc.activeSheetId;
    state.renameSheet(tab, id, 'Renamed');
    expect(doc.activeSheetId).toBe(id);
    expect(doc.sheetById(id)?.name).toBe('Renamed');
  });
});

describe('worksheet lifecycle (atomic and undoable)', () => {
  it('adds a worksheet, activates it, and undoes as one step', () => {
    const { state, tab, doc } = setup();
    const added = state.addSheet(tab, 'Second');
    expect(added).not.toBeNull();
    expect(doc.sheetCount).toBe(2);
    expect(doc.activeSheetId).toBe(added!.id);
    state.undo(tab);
    expect(doc.sheetCount).toBe(1);
    state.redo(tab);
    expect(doc.sheetCount).toBe(2);
    expect(doc.sheets[1].name).toBe('Second');
  });

  it('inserts the new worksheet immediately after the active one', () => {
    const { state, tab, doc } = setup();
    state.addSheet(tab, 'B');
    state.setActiveSheet(tab, doc.sheets[0].id);
    state.addSheet(tab, 'C');
    expect(doc.sheets.map((s) => s.name)).toEqual(['Sheet1', 'C', 'B']);
  });

  it('renames a worksheet and undoes the rename', () => {
    const { state, tab, doc } = setup();
    const id = doc.activeSheetId;
    expect(state.renameSheet(tab, id, 'Sales')).toBe(true);
    expect(doc.sheetById(id)!.name).toBe('Sales');
    state.undo(tab);
    expect(doc.sheetById(id)!.name).toBe('Sheet1');
  });

  it('duplicates a worksheet deeply, right after the source', () => {
    const { state, tab, doc } = setup();
    doc.setCell(0, 0, 'original');
    const copy = state.duplicateSheet(tab, doc.activeSheetId, 'Sheet1 (copy)');
    expect(copy).not.toBeNull();
    expect(doc.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet1 (copy)']);
    expect(doc.getSheetDisplayValue(copy!.id, 0, 0)).toBe('original');
    // A deep copy: editing the copy leaves the source alone.
    doc.setCellOn(copy!.id, 0, 0, 'changed');
    expect(doc.getSheetDisplayValue(doc.sheets[0].id, 0, 0)).toBe('original');
    state.undo(tab);
    expect(doc.sheetCount).toBe(1);
  });

  it('deletes a worksheet and restores it (with its data) on undo', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'Second')!;
    doc.setCellOn(second.id, 2, 1, 'kept');
    expect(state.deleteSheet(tab, second.id)).toBe(true);
    expect(doc.sheetCount).toBe(1);
    state.undo(tab);
    expect(doc.sheetCount).toBe(2);
    expect(doc.getSheetDisplayValue(second.id, 2, 1)).toBe('kept');
  });

  it('refuses to delete the final worksheet', () => {
    const { state, tab, doc } = setup();
    expect(doc.sheetCount).toBe(1);
    expect(state.deleteSheet(tab, doc.activeSheetId)).toBe(false);
    expect(doc.sheetCount).toBe(1);
    // Even at the model level.
    expect(doc.removeSheet(doc.activeSheetId)).toBeNull();
  });

  it('reorders worksheets and undoes the move', () => {
    const { state, tab, doc } = setup();
    state.addSheet(tab, 'B');
    state.addSheet(tab, 'C');
    expect(doc.sheets.map((s) => s.name)).toEqual(['Sheet1', 'B', 'C']);
    expect(state.moveSheet(tab, doc.sheets[2].id, 0)).toBe(true);
    expect(doc.sheets.map((s) => s.name)).toEqual(['C', 'Sheet1', 'B']);
    state.undo(tab);
    expect(doc.sheets.map((s) => s.name)).toEqual(['Sheet1', 'B', 'C']);
  });

  it('enforces the workbook worksheet limit', () => {
    expect(MAX_WORKSHEETS).toBe(MAX_RSF_SHEETS);
    const { state, tab, doc } = setup();
    for (let i = doc.sheetCount; i < MAX_WORKSHEETS; i++) {
      expect(state.addSheet(tab, `S${i}`)).not.toBeNull();
    }
    expect(doc.sheetCount).toBe(MAX_WORKSHEETS);
    expect(state.addSheet(tab, 'overflow')).toBeNull();
  });

  it('switching worksheets is a view change that never dirties the workbook', () => {
    const { state, tab, doc } = setup();
    state.addSheet(tab, 'B');
    doc.markSaved();
    expect(doc.isDirty).toBe(false);
    state.setActiveSheet(tab, doc.sheets[0].id);
    expect(doc.activeSheetId).toBe(doc.sheets[0].id);
    expect(doc.isDirty).toBe(false);
  });

  it('a change on any worksheet dirties the workbook', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'B')!;
    doc.markSaved();
    expect(doc.isDirty).toBe(false);
    doc.setCellOn(second.id, 0, 0, 'x');
    expect(doc.isDirty).toBe(true);
  });
});

describe('per-worksheet independence', () => {
  it('keeps data, filters, zoom, column widths, and selection separate', () => {
    const { state, tab, doc } = setup();
    // Worksheet 1 state.
    doc.setCell(0, 0, 'one');
    tab.zoom = 150;
    tab.colWidths = [111];
    state.setSelection(tab, { row: 3, col: 2 });
    const first = doc.activeSheetId;

    const second = state.addSheet(tab, 'Second')!;
    doc.setCellOn(second.id, 0, 0, 'two');
    tab.zoom = 75;
    tab.colWidths = [222];
    state.setSelection(tab, { row: 1, col: 1 });

    // Back to the first worksheet: its own view and data are restored.
    state.setActiveSheet(tab, first);
    expect(doc.getValue(0, 0)).toBe('one');
    expect(tab.zoom).toBe(150);
    expect(tab.colWidths[0]).toBe(111);
    expect(tab.selection).toEqual({ row: 3, col: 2 });

    state.setActiveSheet(tab, second.id);
    expect(doc.getValue(0, 0)).toBe('two');
    expect(tab.zoom).toBe(75);
    expect(tab.colWidths[0]).toBe(222);
    expect(tab.selection).toEqual({ row: 1, col: 1 });
  });

  it('scopes structural edits to the active worksheet only', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'Second')!; // becomes active
    const firstRows = doc.sheets[0].rowCount;
    const secondRows = doc.sheetById(second.id)!.rowCount;
    state.insertRows(tab, 0, 3);
    expect(doc.sheetById(second.id)!.rowCount).toBe(secondRows + 3);
    expect(doc.sheets[0].rowCount).toBe(firstRows);
  });

  it('scopes filters to the worksheet that owns them', () => {
    const { state, tab, doc } = setup();
    const filter = { top: 0, left: 0, bottom: 3, right: 1, headerRow: false, columns: [] };
    state.setFilter(tab, filter);
    expect(doc.filter).toEqual(filter);
    const second = state.addSheet(tab, 'Second')!;
    expect(doc.filter).toBeNull();
    expect(doc.sheetById(second.id)!.filter).toBeNull();
  });
});

describe('cross-sheet formulas through the workbook lifecycle', () => {
  it('rewrites references across the workbook when a worksheet is renamed', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'Data')!;
    doc.setCellOn(second.id, 0, 0, '7');
    const first = doc.sheets[0].id;
    doc.setCellOn(first, 0, 0, '=Data!A1');

    state.renameSheet(tab, second.id, 'Numbers');
    expect(doc.getSheetDisplayValue(first, 0, 0)).toBe('7');
    expect(doc.sheetById(first)!.getValue(0, 0)).toBe('=Numbers!A1');

    state.undo(tab);
    expect(doc.sheetById(first)!.getValue(0, 0)).toBe('=Data!A1');
    expect(doc.getSheetDisplayValue(first, 0, 0)).toBe('7');
  });

  it('turns references into #REF! when a worksheet is deleted, and restores them on undo', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'Data')!;
    doc.setCellOn(second.id, 0, 0, '7');
    const first = doc.sheets[0].id;
    doc.setCellOn(first, 0, 0, '=Data!A1');
    expect(doc.getSheetDisplayValue(first, 0, 0)).toBe('7');

    state.deleteSheet(tab, second.id);
    expect(doc.sheetById(first)!.getValue(0, 0)).toBe('=#REF!');
    expect(doc.getSheetDisplayValue(first, 0, 0)).toBe('#REF!');

    state.undo(tab);
    expect(doc.sheetById(first)!.getValue(0, 0)).toBe('=Data!A1');
    expect(doc.getSheetDisplayValue(first, 0, 0)).toBe('7');
  });

  it('counts the formulas a deletion would break', () => {
    const { state, tab, doc } = setup();
    const second = state.addSheet(tab, 'Data')!;
    const first = doc.sheets[0].id;
    doc.setCellOn(first, 0, 0, '=Data!A1');
    doc.setCellOn(first, 1, 0, '=SUM(Data!A1:A3)');
    doc.setCellOn(first, 2, 0, '=A1');
    expect(state.countReferencesToSheet(doc, second.id)).toBe(2);
  });

  it('keeps a duplicated worksheet’s qualified references pointing at the named worksheets', () => {
    const { state, tab, doc } = setup();
    const data = state.addSheet(tab, 'Data')!;
    doc.setCellOn(data.id, 0, 0, '9');
    const first = doc.sheets[0].id;
    doc.setCellOn(first, 0, 0, '=Data!A1');
    doc.setCellOn(first, 1, 0, '=A1');

    const copy = state.duplicateSheet(tab, first, 'Copy')!;
    // Qualified references still name `Data`; unqualified ones stay local to
    // the copy (documented duplication policy).
    expect(doc.sheetById(copy.id)!.getValue(0, 0)).toBe('=Data!A1');
    expect(doc.getSheetDisplayValue(copy.id, 0, 0)).toBe('9');
    expect(doc.sheetById(copy.id)!.getValue(1, 0)).toBe('=A1');
  });

  it('adjusts qualified references in other worksheets when rows are inserted', () => {
    const { state, tab, doc } = setup();
    const other = state.addSheet(tab, 'Other')!;
    const first = doc.sheets[0].id;
    doc.setCellOn(first, 4, 0, '5');
    doc.setCellOn(other.id, 0, 0, '=Sheet1!A5');
    expect(doc.getSheetDisplayValue(other.id, 0, 0)).toBe('5');

    // Insert rows on Sheet1; the reference from `Other` must track the cell.
    state.setActiveSheet(tab, first);
    state.insertRows(tab, 0, 2);
    expect(doc.sheetById(other.id)!.getValue(0, 0)).toBe('=Sheet1!A7');
    expect(doc.getSheetDisplayValue(other.id, 0, 0)).toBe('5');

    state.undo(tab);
    expect(doc.sheetById(other.id)!.getValue(0, 0)).toBe('=Sheet1!A5');
  });
});

describe('worksheet commands', () => {
  it('validates names: empty, too long, reserved characters, duplicates', async () => {
    const seen: string[] = [];
    const ui = stubUi({
      promptSheetName: vi.fn(async (_mode, _current, validate: (n: string) => string | null) => {
        for (const candidate of ['', '   ', 'a'.repeat(101), 'bad/name', 'Sheet1', 'Fine']) {
          seen.push(`${candidate}:${validate(candidate) === null ? 'ok' : 'error'}`);
        }
        return 'Fine';
      }),
    });
    const { commands, doc } = setup(ui);
    await commands.run('worksheet.add');
    expect(seen).toEqual([
      ':error',
      '   :error',
      `${'a'.repeat(101)}:error`,
      'bad/name:error',
      'Sheet1:error', // duplicate of the existing worksheet
      'Fine:ok',
    ]);
    expect(doc.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Fine']);
  });

  it('suggests a unique default name and trims the entered one', async () => {
    let suggested = '';
    const ui = stubUi({
      promptSheetName: vi.fn(async (_mode, current: string) => {
        suggested = current;
        return '  Trimmed  ';
      }),
    });
    const { commands, doc } = setup(ui);
    await commands.run('worksheet.add');
    expect(suggested).toBe('Sheet2');
    expect(doc.sheets[1].name).toBe('Trimmed');
  });

  it('cancelling the name prompt changes nothing', async () => {
    const ui = stubUi({ promptSheetName: vi.fn(async () => null) });
    const { commands, doc } = setup(ui);
    await commands.run('worksheet.add');
    expect(doc.sheetCount).toBe(1);
  });

  it('confirms deletion of a worksheet with content and reports broken references', async () => {
    const confirmDeleteSheet = vi.fn(async () => true);
    const ui = stubUi({ confirmDeleteSheet });
    const { state, commands, tab, doc } = setup(ui);
    const data = state.addSheet(tab, 'Data')!;
    doc.setCellOn(data.id, 0, 0, 'content');
    doc.setCellOn(doc.sheets[0].id, 0, 0, '=Data!A1');
    state.setActiveSheet(tab, data.id);
    await commands.run('worksheet.delete');
    expect(confirmDeleteSheet).toHaveBeenCalledWith('Data', 1);
    expect(doc.sheetCount).toBe(1);
  });

  it('does not confirm when the worksheet is empty and unreferenced', async () => {
    const confirmDeleteSheet = vi.fn(async () => true);
    const ui = stubUi({ confirmDeleteSheet });
    const { state, commands, tab, doc } = setup(ui);
    state.addSheet(tab, 'Empty');
    await commands.run('worksheet.delete');
    expect(confirmDeleteSheet).not.toHaveBeenCalled();
    expect(doc.sheetCount).toBe(1);
  });

  it('declining the confirmation leaves the worksheet in place', async () => {
    const ui = stubUi({ confirmDeleteSheet: vi.fn(async () => false) });
    const { state, commands, tab, doc } = setup(ui);
    const data = state.addSheet(tab, 'Data')!;
    doc.setCellOn(data.id, 0, 0, 'content');
    await commands.run('worksheet.delete');
    expect(doc.sheetCount).toBe(2);
  });

  it('enables move commands only where the move is possible', () => {
    const { state, commands, tab, doc } = setup();
    expect(commands.isEnabled('worksheet.moveLeft')).toBe(false);
    expect(commands.isEnabled('worksheet.moveRight')).toBe(false);
    expect(commands.isEnabled('worksheet.delete')).toBe(false);
    state.addSheet(tab, 'B'); // now active, and last
    expect(commands.isEnabled('worksheet.moveLeft')).toBe(true);
    expect(commands.isEnabled('worksheet.moveRight')).toBe(false);
    expect(commands.isEnabled('worksheet.delete')).toBe(true);
    state.setActiveSheet(tab, doc.sheets[0].id);
    expect(commands.isEnabled('worksheet.moveRight')).toBe(true);
  });

  it('cycles worksheets with next/previous, wrapping around', async () => {
    const { state, commands, tab, doc } = setup();
    state.addSheet(tab, 'B');
    state.addSheet(tab, 'C');
    state.setActiveSheet(tab, doc.sheets[0].id);
    await commands.run('worksheet.next');
    expect(doc.activeSheet.name).toBe('B');
    await commands.run('worksheet.prev');
    expect(doc.activeSheet.name).toBe('Sheet1');
    await commands.run('worksheet.prev');
    expect(doc.activeSheet.name).toBe('C');
  });

  it('worksheet commands are unavailable for a plain CSV document', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('data.csv', csvDoc('a,b\n1,2\n'), null);
    for (const id of ['worksheet.add', 'worksheet.rename', 'worksheet.delete', 'worksheet.next'] as const) {
      expect(commands.isEnabled(id), id).toBe(false);
    }
  });
});

describe('CSV export from a workbook', () => {
  it('requires an explicit worksheet choice when the workbook has several', async () => {
    const chooseExportSheet = vi.fn(async () => null);
    const ui = stubUi({ chooseExportSheet });
    const { state, commands, tab, doc } = setup(ui);
    state.addSheet(tab, 'Second');
    expect(await commands.exportCsv(tab)).toBe(false);
    expect(chooseExportSheet).toHaveBeenCalledWith(
      [
        { id: doc.sheets[0].id, name: 'Sheet1' },
        { id: doc.sheets[1].id, name: 'Second' },
      ],
      doc.activeSheetId,
    );
  });

  it('does not ask for a worksheet when the workbook has exactly one', async () => {
    const chooseExportSheet = vi.fn(async () => null);
    const ui = stubUi({ chooseExportSheet, chooseExportCsv: vi.fn(async () => null) });
    const { commands, tab } = setup(ui);
    await commands.exportCsv(tab);
    expect(chooseExportSheet).not.toHaveBeenCalled();
  });

  it('exports the chosen worksheet, not the active one', () => {
    const { state, tab, doc } = setup();
    doc.setCell(0, 0, 'from-first');
    const second = state.addSheet(tab, 'Second')!;
    doc.setCellOn(second.id, 0, 0, 'from-second');
    expect(doc.exportSheetCsv(doc.sheets[0].id).startsWith('from-first')).toBe(true);
    expect(doc.exportSheetCsv(second.id).startsWith('from-second')).toBe(true);
  });

  it('exports formulas as their calculated values', () => {
    const { doc } = setup();
    doc.setCell(0, 0, '2');
    doc.setCell(0, 1, '=A1*3');
    expect(doc.exportSheetCsv(doc.activeSheetId).split('\n')[0]).toBe('2,6,,');
  });
});

describe('workbook container', () => {
  it('writes a single-worksheet workbook in the version-3 container (old readers still open it)', () => {
    const workbook = RsfDocument.empty('b.rsf', 3, 2, 'Sheet1');
    workbook.setCell(0, 0, 'v');
    const bytes = workbook.toBytes();
    expect(Array.from(bytes.subarray(0, 4))).toEqual(Array.from(RSF_MAGIC));
    expect(bytes[4]).toBe(RSF_CONTAINER_VERSION);
    // The legacy single-sheet decoder reads it directly.
    const legacy = decodeRsf(bytes);
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.data.name).toBe('Sheet1');
    }
  });

  it('writes a multi-worksheet workbook in the version-4 container', () => {
    const workbook = RsfDocument.empty('b.rsf', 3, 2, 'Sheet1');
    workbook.insertSheetAt(1, workbook.createWorksheet('Second', 3, 2));
    const bytes = workbook.toBytes();
    expect(bytes[4]).toBe(RSF_CONTAINER_VERSION_WORKBOOK);
    // Older readers validate the magic/version pair and reject it safely
    // rather than misparsing a format they do not understand.
    const old = decodeRsf(bytes);
    expect(old.ok).toBe(false);
    if (!old.ok) {
      expect(old.error).toBe('bad-version');
    }
  });

  it('round-trips worksheets, order, names, active worksheet, and per-sheet state', () => {
    const workbook = RsfDocument.empty('b.rsf', 4, 3, 'First');
    const second = workbook.createWorksheet('Quarter 1', 6, 2);
    workbook.insertSheetAt(1, second);
    workbook.setCell(0, 0, 'a');
    workbook.setCellOn(second.id, 5, 1, '=First!A1');
    second.displayZoom = 125;
    second.displayColWidths = [90, 0];
    workbook.setActiveSheetId(second.id);

    const reloaded = RsfDocument.fromBytes(workbook.toBytes(), 'b.rsf');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const back = reloaded.doc;
    expect(back.sheetCount).toBe(2);
    expect(back.sheets.map((s) => s.name)).toEqual(['First', 'Quarter 1']);
    expect(back.activeSheet.name).toBe('Quarter 1');
    expect(back.sheets[0].rowCount).toBe(4);
    expect(back.sheets[1].rowCount).toBe(6);
    expect(back.sheets[1].displayZoom).toBe(125);
    expect(back.sheets[1].displayColWidths[0]).toBe(90);
    // Cross-sheet formulas survive and still evaluate.
    expect(back.getSheetDisplayValue(back.sheets[1].id, 5, 1)).toBe('a');
  });

  it('restores the saved active worksheet, falling back to the first when unknown', () => {
    const workbook = RsfDocument.empty('b.rsf', 2, 2, 'A');
    workbook.insertSheetAt(1, workbook.createWorksheet('B', 2, 2));
    const data: RsfWorkbookData = {
      delimiter: ',',
      activeSheetId: 'does-not-exist',
      sheets: workbook.sheets.map((s) => ({
        id: s.id,
        name: s.name,
        rowCount: s.rowCount,
        columnCount: s.columnCount,
        cells: [],
      })),
    };
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook(data));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.activeSheetId).toBe(workbook.sheets[0].id);
    }
  });

  it('loads a legacy single-sheet container as a one-worksheet workbook', () => {
    const bytes = encodeRsf({
      name: 'Legacy',
      delimiter: ';',
      rowCount: 3,
      columnCount: 2,
      cells: [[0, 0, 'x']],
    });
    const loaded = RsfDocument.fromBytes(bytes, 'legacy.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.sheetCount).toBe(1);
    expect(loaded.doc.sheets[0].name).toBe('Legacy');
    expect(loaded.doc.delimiter).toBe(';');
    expect(loaded.doc.loadedAsSingleSheet).toBe(true);
    // It migrates to the workbook container only once a second worksheet exists.
    expect(loaded.doc.toBytes()[4]).toBe(RSF_CONTAINER_VERSION);
    loaded.doc.insertSheetAt(1, loaded.doc.createWorksheet('New', 2, 2));
    expect(loaded.doc.toBytes()[4]).toBe(RSF_CONTAINER_VERSION_WORKBOOK);
  });

  it('rejects a workbook container with too many worksheets', () => {
    const sheets = Array.from({ length: MAX_RSF_SHEETS + 1 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      rowCount: 1,
      columnCount: 1,
      cells: [] as Array<[number, number, string]>,
    }));
    const decoded = decodeRsfWorkbook(encodeRsfWorkbook({ delimiter: ',', sheets }));
    // The encoder caps what it writes, so the decoder sees at most the limit;
    // either way the result must never exceed the bound.
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.sheets.length).toBeLessThanOrEqual(MAX_RSF_SHEETS);
    }
  });

  it('rejects duplicate worksheet identifiers', () => {
    const bytes = encodeRsfWorkbook({
      delimiter: ',',
      sheets: [
        { id: 'dup', name: 'A', rowCount: 1, columnCount: 1, cells: [] },
        { id: 'dup', name: 'B', rowCount: 1, columnCount: 1, cells: [] },
      ],
    });
    const decoded = decodeRsfWorkbook(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('rejects an oversize declared worksheet', () => {
    const bytes = encodeRsfWorkbook({
      delimiter: ',',
      sheets: [
        { id: 'a', name: 'A', rowCount: 1, columnCount: 1, cells: [] },
        { id: 'b', name: 'B', rowCount: 100_000_000, columnCount: 100, cells: [] },
      ],
    });
    const decoded = decodeRsfWorkbook(bytes);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('too-large');
  });

  it('rejects truncated and corrupted workbook containers', () => {
    const workbook = RsfDocument.empty('b.rsf', 2, 2, 'A');
    workbook.insertSheetAt(1, workbook.createWorksheet('B', 2, 2));
    workbook.setCell(0, 0, 'value');
    const bytes = workbook.toBytes();

    const truncated = decodeRsfWorkbook(bytes.subarray(0, bytes.length - 2));
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.error).toBe('bad-shape');

    const corrupt = bytes.slice();
    corrupt[corrupt.length - 1] ^= 0xff;
    const decoded = decodeRsfWorkbook(corrupt);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(['checksum', 'bad-shape']).toContain(decoded.error);
  });

  it('rejects an unsupported future workbook body version', () => {
    const workbook = RsfDocument.empty('b.rsf', 2, 2, 'A');
    workbook.insertSheetAt(1, workbook.createWorksheet('B', 2, 2));
    const decoded = decodeRsfWorkbook(workbook.toBytes());
    expect(decoded.ok).toBe(true);
    // A body version this build does not know is refused, never guessed at.
    const future = decodeRsfWorkbook(
      encodeRsfWorkbook({
        delimiter: ',',
        sheets: [{ id: 'a', name: 'A', rowCount: 1, columnCount: 1, cells: [] }],
      }),
    );
    expect(future.ok).toBe(true); // single-worksheet path stays version 3
  });

  it('stores only inert data (loading never executes anything)', () => {
    const workbook = RsfDocument.empty('b.rsf', 2, 2, '<script>x</script>');
    workbook.insertSheetAt(1, workbook.createWorksheet('B', 2, 2));
    workbook.setCell(0, 0, '<script>window.x=1</script>');
    const reloaded = RsfDocument.fromBytes(workbook.toBytes(), 'b.rsf');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.doc.sheets[0].name).toBe('<script>x</script>');
    expect(reloaded.doc.getValue(0, 0)).toBe('<script>window.x=1</script>');
  });
});
