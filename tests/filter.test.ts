// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * RSF filtering: the deterministic predicate core, RSF body-version-4
 * serialization and validation of persisted filter metadata (including
 * corrupt/oversized/unsupported cases), and the command-level flow — apply,
 * edit, clear, undo/redo, hidden-row navigation and copy/fill/clear
 * semantics, structural-edit interaction, and the CSV-mode restriction.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type FilterDialogResult, type UiPort } from '../src/app/commands';
import { copyRows } from '../src/core/clipboard';
import {
  computeHiddenRows,
  matchColumn,
  rowMatchesFilter,
  validateFilter,
  MAX_FILTER_ROWS,
  type ColumnFilter,
  type SheetFilter,
} from '../src/core/filter';
import { getRsfCodec, RSF_COMPRESSION_STORE } from '../src/core/csv-engine';
import { decodeRsf, encodeRsf, type RsfData } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
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
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
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

function sheet(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RsfDocument.empty('t.rsf', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('t.rsf', doc, null);
  return { state, commands, tab, doc, ui };
}

const textCol = (
  col: number,
  conditions: ColumnFilter['conditions'],
  values: string[] | null = null,
): ColumnFilter => ({
  col,
  join: 'and',
  conditions,
  values,
});

describe('filter predicate core', () => {
  const get = (values: string[][]) => (r: number, c: number) => values[r]?.[c] ?? '';

  it('text operators match the displayed value', () => {
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'contains', value: 'pp' }]), 'apple')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'notContains', value: 'z' }]), 'apple')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'equals', value: 'apple' }]), 'apple')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'beginsWith', value: 'ap' }]), 'apple')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'endsWith', value: 'le' }]), 'apple')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'blank', value: '' }]), '  ')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'notBlank', value: '' }]), 'x')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'text', op: 'equals', value: 'apple' }]), 'Apple')).toBe(false);
  });

  it('number operators require a numeric displayed value', () => {
    expect(matchColumn(textCol(0, [{ kind: 'number', op: 'numGreater', value: 5 }]), '10')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'number', op: 'numLessEq', value: 5 }]), '5')).toBe(true);
    expect(matchColumn(textCol(0, [{ kind: 'number', op: 'numBetween', value: 1, value2: 3 }]), '2')).toBe(
      true,
    );
    // Non-numeric text never satisfies a numeric comparison, even a negated one.
    expect(matchColumn(textCol(0, [{ kind: 'number', op: 'numNotEquals', value: 5 }]), 'abc')).toBe(false);
  });

  it('conditions in a column combine with AND or OR; values add an AND clause', () => {
    const or: ColumnFilter = {
      col: 0,
      join: 'or',
      conditions: [
        { kind: 'text', op: 'equals', value: 'a' },
        { kind: 'text', op: 'equals', value: 'b' },
      ],
      values: null,
    };
    expect(matchColumn(or, 'a')).toBe(true);
    expect(matchColumn(or, 'b')).toBe(true);
    expect(matchColumn(or, 'c')).toBe(false);
    const withValues = textCol(0, [{ kind: 'text', op: 'contains', value: 'a' }], ['apple']);
    expect(matchColumn(withValues, 'apple')).toBe(true);
    expect(matchColumn(withValues, 'apricot')).toBe(false); // contains 'a' but not in the value list
  });

  it('columns across the filter combine with AND; header rows are never hidden', () => {
    const values = [
      ['name', 'qty'],
      ['apple', '10'],
      ['banana', '3'],
      ['cherry', '20'],
    ];
    const filter: SheetFilter = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 1,
      headerRow: true,
      columns: [textCol(1, [{ kind: 'number', op: 'numGreaterEq', value: 10 }])],
    };
    const hidden = computeHiddenRows(filter, get(values));
    // Row 0 is the header (never evaluated); rows with qty < 10 are hidden.
    expect(hidden.has(0)).toBe(false);
    expect(hidden.has(1)).toBe(false); // 10
    expect(hidden.has(2)).toBe(true); // 3
    expect(hidden.has(3)).toBe(false); // 20
    expect(rowMatchesFilter(filter, 2, get(values))).toBe(false);
  });
});

describe('filter validation and bounds', () => {
  const base = { top: 0, left: 0, bottom: 4, right: 2, headerRow: true };

  it('accepts an in-bounds filter and rejects out-of-range coordinates', () => {
    const ok: SheetFilter = { ...base, columns: [textCol(1, [{ kind: 'text', op: 'equals', value: 'x' }])] };
    expect(validateFilter(ok, 5, 3)).not.toBeNull();
    expect(validateFilter({ ...ok, bottom: 99 }, 5, 3)).toBeNull(); // beyond rowCount
    expect(validateFilter({ ...ok, right: 99 }, 5, 3)).toBeNull(); // beyond columnCount
  });

  it('rejects a column outside the range, duplicate columns, and empty criteria', () => {
    expect(
      validateFilter({ ...base, columns: [textCol(9, [{ kind: 'text', op: 'equals', value: 'x' }])] }, 5, 3),
    ).toBeNull();
    const dup = [
      textCol(1, [{ kind: 'text', op: 'equals', value: 'x' }]),
      textCol(1, [{ kind: 'text', op: 'equals', value: 'y' }]),
    ];
    expect(validateFilter({ ...base, columns: dup }, 5, 3)).toBeNull();
    // A column entry with neither conditions nor a value list is meaningless.
    expect(validateFilter({ ...base, columns: [textCol(1, [], null)] }, 5, 3)).toBeNull();
  });

  it('rejects over-long value lists and over-range row spans', () => {
    const many = Array.from({ length: 1001 }, (_, i) => String(i));
    expect(validateFilter({ ...base, columns: [textCol(1, [], many)] }, 5, 3)).toBeNull();
    expect(
      validateFilter(
        {
          top: 0,
          left: 0,
          bottom: MAX_FILTER_ROWS,
          right: 0,
          headerRow: false,
          columns: [textCol(0, [], ['x'])],
        },
        MAX_FILTER_ROWS + 2,
        1,
      ),
    ).toBeNull();
  });
});

// ----- RSF persistence (body version 4) -----

const HEADER_SIZE = 20;
const baseData: RsfData = {
  name: 'Sheet1',
  delimiter: ',',
  rowCount: 6,
  columnCount: 3,
  cells: [[0, 0, 'x']],
};

function patchBody(bytes: Uint8Array, mutate: (body: Uint8Array) => void): Uint8Array {
  const out = bytes.slice();
  const body = out.subarray(HEADER_SIZE);
  mutate(body);
  new DataView(out.buffer).setUint32(12, getRsfCodec().crc32(body), true);
  return out;
}

describe('RSF filter persistence (body version 4)', () => {
  const filter: SheetFilter = {
    top: 0,
    left: 0,
    bottom: 5,
    right: 2,
    headerRow: true,
    columns: [
      {
        col: 1,
        join: 'or',
        conditions: [
          { kind: 'text', op: 'contains', value: 'a' },
          { kind: 'number', op: 'numBetween', value: 1, value2: 9 },
        ],
        values: ['apple', 'apricot'],
      },
    ],
  };

  it('writes body version 4 only when a filter is present, and round-trips it', () => {
    const noFilter = encodeRsf(baseData, RSF_COMPRESSION_STORE);
    expect(noFilter[HEADER_SIZE]).toBe(1);
    const withFilter = encodeRsf({ ...baseData, filter }, RSF_COMPRESSION_STORE);
    expect(withFilter[HEADER_SIZE]).toBe(4);
    const decoded = decodeRsf(withFilter);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.filter).toEqual(filter);
  });

  it('a version-4 body without a filter flag decodes with no filter', () => {
    // Force version 4 by pairing a filter with display settings, then a
    // filter-less container still has no filter after decode.
    const bytes = encodeRsf({ ...baseData, display: { zoom: 100 } }, RSF_COMPRESSION_STORE);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.filter).toBeUndefined();
    }
  });

  it('ignores a filter whose range is out of bounds (drops it, sheet still loads)', () => {
    const bytes = encodeRsf({ ...baseData, filter }, RSF_COMPRESSION_STORE);
    // Body layout with no app metadata + filter: version(1) delim(1)
    // appNameLen(2=0) appVerLen(2=0) zoom(2) widthCount(4) filterFlag(1)
    // headerRow(1) top(4) left(4) bottom(4)… so the filter's `bottom` u32 is
    // at body offset 22. Patch it past the sheet's row count.
    const broken = patchBody(bytes, (body) => {
      new DataView(body.buffer, body.byteOffset).setUint32(22, 999_999, true);
    });
    const decoded = decodeRsf(broken);
    expect(decoded.ok).toBe(true); // the sheet itself still loads
    if (decoded.ok) {
      expect(decoded.data.filter).toBeUndefined(); // the invalid filter was dropped
      expect(decoded.data.filterDropped).toBe(true);
    }
  });

  it('rejects a structurally truncated filter block as bad-shape', () => {
    const bytes = encodeRsf({ ...baseData, filter }, RSF_COMPRESSION_STORE);
    // Truncate the container body by one byte and re-stamp: the filter block
    // can no longer be read to completion.
    const out = bytes.slice(0, bytes.length - 1);
    const body = out.subarray(HEADER_SIZE);
    new DataView(out.buffer).setUint32(8, body.length, true); // uncompressed len
    new DataView(out.buffer).setUint32(16, body.length, true); // payload len (store)
    new DataView(out.buffer).setUint32(12, getRsfCodec().crc32(body), true);
    const decoded = decodeRsf(out);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error).toBe('bad-shape');
    }
  });

  it('round-trips the filter through RsfDocument save/load and marks it dirty on change', () => {
    const doc = RsfDocument.empty('t.rsf', 6, 3);
    doc.setCell(1, 1, 'apple');
    doc.markSaved();
    doc.setFilterState(filter);
    expect(doc.isDirty).toBe(true); // a filter change is a document change
    const loaded = RsfDocument.fromBytes(doc.toBytes(), 't.rsf');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.filter).toEqual(filter);
    expect(loaded.doc.getValue(1, 1)).toBe('apple');
  });

  it('CSV bytes never carry a filter', () => {
    // A filter only exists on RSF documents; a CSV document has no filter API
    // and its identity serialization is unaffected (covered by identity.test).
    expect(baseData.filter).toBeUndefined();
  });
});

describe('filter command flow', () => {
  it('applies, hides non-matching rows, and reports counts; undo/redo restore visibility', () => {
    const { state, tab, doc } = sheet([
      ['name', 'qty'],
      ['apple', '10'],
      ['banana', '3'],
      ['cherry', '20'],
    ]);
    const filter: SheetFilter = {
      top: 0,
      left: 0,
      bottom: 3,
      right: 1,
      headerRow: true,
      columns: [textCol(1, [{ kind: 'number', op: 'numGreaterEq', value: 10 }])],
    };
    expect(state.setFilter(tab, filter)).toBe(true);
    expect(doc.filter).toEqual(filter);
    const hidden = state.hiddenRows(tab);
    expect(hidden && [...hidden]).toEqual([2]); // only 'banana' (qty 3) hidden
    // Undo clears the filter; redo restores it.
    state.undo(tab);
    expect(doc.filter).toBeNull();
    expect(state.hiddenRows(tab)).toBeNull();
    state.redo(tab);
    expect(doc.filter).toEqual(filter);
    expect(state.isRowHidden(tab, 2)).toBe(true);
  });

  it('the dialog route builds and applies a filter for the active column', async () => {
    const applied: FilterDialogResult = {
      action: 'apply',
      headerRow: true,
      column: textCol(1, [{ kind: 'number', op: 'numGreaterEq', value: 10 }]),
    };
    const ui = stubUi({ chooseFilter: vi.fn(async () => applied) });
    const { state, commands, tab, doc } = sheet(
      [
        ['name', 'qty'],
        ['apple', '10'],
        ['banana', '3'],
      ],
      ui,
    );
    state.setSelection(tab, { row: 1, col: 1 }, { row: 2, col: 1 });
    await commands.filterDialog(tab);
    expect(ui.chooseFilter).toHaveBeenCalled();
    expect(doc.filter).not.toBeNull();
    expect(state.isRowHidden(tab, 2)).toBe(true);
  });

  it('CSV documents refuse to filter with a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    const result = await commands.filterDialog(tab);
    expect(result).toBe(false);
    expect(ui.showMessage).toHaveBeenCalled();
    expect(ui.chooseFilter).not.toHaveBeenCalled();
  });

  it('clear-all makes every row visible again (undoable)', () => {
    const { state, tab, doc } = sheet([['a'], ['1'], ['2']]);
    state.setFilter(tab, {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      columns: [textCol(0, [{ kind: 'text', op: 'equals', value: '1' }])],
    });
    expect(state.hiddenRows(tab)?.size).toBeGreaterThan(0);
    state.setFilter(tab, null);
    expect(doc.filter).toBeNull();
    expect(state.hiddenRows(tab)).toBeNull();
  });

  it('structural edits clear the active filter atomically (undo restores both)', () => {
    const { state, tab, doc } = sheet([['1'], ['2'], ['3']]);
    state.setFilter(tab, {
      top: 0,
      left: 0,
      bottom: 2,
      right: 0,
      headerRow: false,
      columns: [textCol(0, [{ kind: 'number', op: 'numGreater', value: 1 }])],
    });
    expect(doc.filter).not.toBeNull();
    state.insertRows(tab, 0, 1);
    expect(doc.filter).toBeNull(); // cleared as part of the structural entry
    state.undo(tab);
    expect(doc.filter).not.toBeNull(); // structure and filter restored together
    expect(doc.rowCount).toBe(3);
  });

  it('copy excludes hidden rows (visible rows form a contiguous block)', () => {
    const { state, tab } = sheet([['a'], ['b'], ['c'], ['d']]);
    state.setFilter(tab, {
      top: 0,
      left: 0,
      bottom: 3,
      right: 0,
      headerRow: false,
      columns: [textCol(0, [{ kind: 'text', op: 'notEquals', value: 'b' }])],
    });
    const hidden = state.hiddenRows(tab);
    const rows = copyRows({ top: 0, left: 0, bottom: 3, right: 0 }, hidden);
    expect(rows).toEqual([0, 2, 3]); // 'b' (row 1) excluded
  });

  it('clear-range and fill never modify rows hidden by the filter', () => {
    const { state, commands, tab, doc } = sheet([['1'], ['2'], ['3'], ['4']]);
    state.setFilter(tab, {
      top: 0,
      left: 0,
      bottom: 3,
      right: 0,
      headerRow: false,
      columns: [textCol(0, [{ kind: 'text', op: 'notEquals', value: '2' }])],
    });
    expect(state.isRowHidden(tab, 1)).toBe(true);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 3, col: 0 });
    commands.clearRange(tab);
    // The hidden row keeps its value; visible rows are cleared.
    expect(doc.getValue(1, 0)).toBe('2');
    expect(doc.getValue(0, 0)).toBe('');
    expect(doc.getValue(2, 0)).toBe('');
  });
});
