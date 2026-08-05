// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Cell/range visual formatting (bold/italic/underline, text/background
 * color, borders): the pure `CellStyle` core, `Worksheet` storage and
 * structural-edit reindexing, RSF codec persistence (body version 8), and
 * the command-level flow — toggling, dialogs, clear, undo/redo, hidden-row
 * skipping, and the CSV-mode restriction.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import {
  applyCellStylePatch,
  borderSideValue,
  cellStylesEqual,
  isEmptyCellStyle,
  isHexColor,
  normalizeHexColor,
  resolveSharedBorder,
  type CellStyle,
} from '../src/core/cell-style';
import { decodeRsf, encodeRsf, RSF_BODY_VERSION, type RsfData } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { Worksheet } from '../src/core/worksheet';
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
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => 'down' as const),
    confirmFlashFill: vi.fn(async () => true),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
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
    showSqlQuery: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
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

describe('CellStyle core', () => {
  it('isHexColor accepts only well-formed #rrggbb, case-insensitively', () => {
    expect(isHexColor('#aabbcc')).toBe(true);
    expect(isHexColor('#AABBCC')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('aabbcc')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
  });

  it('normalizeHexColor lowercases a valid color and rejects an invalid one', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHexColor('#zzzzzz')).toBeNull();
  });

  it('isEmptyCellStyle is true when no property is set (a false boolean counts as unset)', () => {
    expect(isEmptyCellStyle({})).toBe(true);
    expect(isEmptyCellStyle({ bold: false })).toBe(true);
    expect(isEmptyCellStyle({ bold: true })).toBe(false);
    expect(isEmptyCellStyle({ textColor: '#000000' })).toBe(false);
  });

  it('cellStylesEqual treats null and an empty style as the same "no style"', () => {
    expect(cellStylesEqual(null, null)).toBe(true);
    expect(cellStylesEqual(null, {})).toBe(true);
    expect(cellStylesEqual({ bold: false }, null)).toBe(true);
    expect(cellStylesEqual({ bold: true }, null)).toBe(false);
    expect(cellStylesEqual({ bold: true, textColor: '#111111' }, { bold: true, textColor: '#111111' })).toBe(
      true,
    );
    expect(cellStylesEqual({ bold: true }, { bold: true, italic: true })).toBe(false);
  });

  it('applyCellStylePatch sets and clears booleans without mutating its input', () => {
    const base: CellStyle = { bold: true };
    const next = applyCellStylePatch(base, { italic: true });
    expect(base).toEqual({ bold: true }); // unmutated
    expect(next).toEqual({ bold: true, italic: true });
    const cleared = applyCellStylePatch(next, { bold: false });
    expect(cleared).toEqual({ italic: true });
  });

  it('applyCellStylePatch sets and clears colors (null clears, undefined leaves as-is)', () => {
    const withColor = applyCellStylePatch(null, { textColor: '#123456' });
    expect(withColor).toEqual({ textColor: '#123456' });
    const untouched = applyCellStylePatch(withColor, { bold: true });
    expect(untouched).toEqual({ textColor: '#123456', bold: true });
    const clearedColor = applyCellStylePatch(untouched, { textColor: null });
    expect(clearedColor).toEqual({ bold: true });
  });

  it('applyCellStylePatch returns null (not `{}`) when the result has no properties', () => {
    const style = applyCellStylePatch(null, { bold: true });
    expect(applyCellStylePatch(style, { bold: false })).toBeNull();
    expect(applyCellStylePatch(null, {})).toBeNull();
  });

  it("applyCellStylePatch drops a side's style/width when its color is cleared, and picks up a supplied style/width when set", () => {
    const withBorder = applyCellStylePatch(null, {
      borderTop: '#000000',
      borderTopStyle: 'dashed',
      borderTopWidth: 'thick',
    });
    expect(withBorder).toEqual({ borderTop: '#000000', borderTopStyle: 'dashed', borderTopWidth: 'thick' });
    const cleared = applyCellStylePatch(withBorder, { borderTop: null });
    expect(cleared).toBeNull();
  });

  it('borderSideValue defaults an unset line style/width to solid/thin, and is null when the side has no color', () => {
    expect(borderSideValue(null, 'borderTop')).toBeNull();
    expect(borderSideValue({ borderTop: '#000000' }, 'borderTop')).toEqual({
      color: '#000000',
      lineStyle: 'solid',
      width: 'thin',
    });
    expect(
      borderSideValue(
        { borderTop: '#000000', borderTopStyle: 'dotted', borderTopWidth: 'medium' },
        'borderTop',
      ),
    ).toEqual({ color: '#000000', lineStyle: 'dotted', width: 'medium' });
  });

  it('resolveSharedBorder picks the wider side, then the higher-precedence style, then own on a full tie', () => {
    const thin = { color: '#111111', lineStyle: 'solid' as const, width: 'thin' as const };
    const thick = { color: '#222222', lineStyle: 'solid' as const, width: 'thick' as const };
    expect(resolveSharedBorder(thin, thick)).toBe(thick);
    expect(resolveSharedBorder(thick, thin)).toBe(thick);

    const dotted = { color: '#333333', lineStyle: 'dotted' as const, width: 'thin' as const };
    const solid = { color: '#444444', lineStyle: 'solid' as const, width: 'thin' as const };
    expect(resolveSharedBorder(dotted, solid)).toBe(solid);
    expect(resolveSharedBorder(solid, dotted)).toBe(solid);

    const own = { color: '#555555', lineStyle: 'solid' as const, width: 'thin' as const };
    const neighbor = { color: '#666666', lineStyle: 'solid' as const, width: 'thin' as const };
    expect(resolveSharedBorder(own, neighbor)).toBe(own);

    expect(resolveSharedBorder(null, neighbor)).toBe(neighbor);
    expect(resolveSharedBorder(own, null)).toBe(own);
    expect(resolveSharedBorder(null, null)).toBeNull();
  });
});

describe('Worksheet cell styles', () => {
  it('getStyle/setStyle/collectStyles/styledCellCount round-trip', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 5);
    expect(ws.getStyle(1, 1)).toBeNull();
    expect(ws.setStyle(1, 1, { bold: true })).toBe(true);
    expect(ws.getStyle(1, 1)).toEqual({ bold: true });
    expect(ws.styledCellCount).toBe(1);
    expect(ws.collectStyles()).toEqual([[1, 1, { bold: true }]]);
    // Setting an equal style is a no-op change.
    expect(ws.setStyle(1, 1, { bold: true })).toBe(false);
    // Clearing removes the entry entirely.
    expect(ws.setStyle(1, 1, null)).toBe(true);
    expect(ws.getStyle(1, 1)).toBeNull();
    expect(ws.styledCellCount).toBe(0);
    expect(ws.collectStyles()).toEqual([]);
  });

  it('setStyle on an out-of-bounds cell is a no-op', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 2, 2);
    expect(ws.setStyle(99, 99, { bold: true })).toBe(false);
    expect(ws.styledCellCount).toBe(0);
  });

  it('clone copies every cell style independently of the original', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 3, 3);
    ws.setStyle(0, 0, { bold: true });
    const copy = ws.clone('s2', 'Sheet2');
    expect(copy.getStyle(0, 0)).toEqual({ bold: true });
    copy.setStyle(0, 0, { italic: true });
    expect(ws.getStyle(0, 0)).toEqual({ bold: true }); // original untouched
  });

  it('inserting rows shifts styled cells below the insertion point', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 2);
    ws.setStyle(0, 0, { bold: true });
    ws.setStyle(3, 0, { italic: true });
    ws.insertRows(1, [
      ['', ''],
      ['', ''],
    ]);
    expect(ws.getStyle(0, 0)).toEqual({ bold: true }); // above insertion: unmoved
    expect(ws.getStyle(5, 0)).toEqual({ italic: true }); // at/below: shifted down by 2
    expect(ws.getStyle(3, 0)).toBeNull();
  });

  it('deleting rows drops styles on removed rows and shifts the rest up', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 5, 2);
    ws.setStyle(1, 0, { bold: true }); // will be deleted
    ws.setStyle(4, 0, { italic: true }); // will shift up
    ws.deleteRows(1, 2);
    expect(ws.getStyle(1, 0)).toBeNull();
    expect(ws.getStyle(2, 0)).toEqual({ italic: true });
    expect(ws.styledCellCount).toBe(1);
  });

  it('inserting/deleting columns reindexes styled cells the same way', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 2, 5);
    ws.setStyle(0, 3, { underline: true });
    ws.insertCols(1, [
      ['', ''],
      ['', ''],
    ]);
    expect(ws.getStyle(0, 5)).toEqual({ underline: true });
    ws.deleteCols(0, 1);
    expect(ws.getStyle(0, 4)).toEqual({ underline: true });
  });

  it('copyRowInto (row duplication) carries the row style along with its values', () => {
    const ws = Worksheet.empty('s1', 'Sheet1', 3, 2);
    ws.setStyle(0, 0, { backgroundColor: '#00ff00' });
    const shell = ws.cloneShell('s2', 'Sheet2');
    ws.copyRowInto(0, shell);
    expect(shell.getStyle(0, 0)).toEqual({ backgroundColor: '#00ff00' });
  });
});

describe('RSF codec: cell-style block (body version 8)', () => {
  const base: RsfData = {
    name: 'Sheet1',
    delimiter: ',',
    rowCount: 4,
    columnCount: 4,
    cells: [[0, 0, 'x']],
  };

  it('round-trips bold/italic/underline, colors, and every border side', () => {
    const withStyles: RsfData = {
      ...base,
      styles: [
        [0, 0, { bold: true, italic: true, underline: true }],
        [
          1,
          2,
          {
            textColor: '#ff0000',
            backgroundColor: '#00ff00',
            borderTop: '#0000ff',
            borderRight: '#111111',
            borderBottom: '#222222',
            borderLeft: '#333333',
          },
        ],
      ],
    };
    const bytes = encodeRsf(withStyles);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.styles).toEqual(withStyles.styles);
  });

  it('omits the style block, staying on a lower body version, when no cell is styled', () => {
    const decoded = decodeRsf(encodeRsf(base));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toBeUndefined();
  });

  it('an empty style array behaves like no styles at all', () => {
    const decoded = decodeRsf(encodeRsf({ ...base, styles: [] }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toBeUndefined();
  });

  it('rejects a style referencing a row or column outside the sheet as bad-shape', () => {
    const bad: RsfData = { ...base, styles: [[99, 99, { bold: true }]] };
    const decoded = decodeRsf(encodeRsf(bad));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('rejects a style block truncated mid-record as bad-shape', () => {
    const withStyles: RsfData = { ...base, styles: [[0, 0, { bold: true }]] };
    const bytes = encodeRsf(withStyles);
    const decoded = decodeRsf(bytes.subarray(0, bytes.length - 1));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });
});

describe('RSF codec: border line style and width (body version 10)', () => {
  const base: RsfData = {
    name: 'Sheet1',
    delimiter: ',',
    rowCount: 4,
    columnCount: 4,
    cells: [[0, 0, 'x']],
  };

  it('round-trips a non-default border line style and width', () => {
    const withStyles: RsfData = {
      ...base,
      styles: [
        [
          0,
          0,
          {
            borderTop: '#0000ff',
            borderTopStyle: 'dashed',
            borderTopWidth: 'thick',
            borderRight: '#111111',
            borderRightStyle: 'double',
            borderRightWidth: 'medium',
          },
        ],
      ],
    };
    const decoded = decodeRsf(encodeRsf(withStyles));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toEqual(withStyles.styles);
  });

  it('a border left at the default solid/thin style encodes identically whether or not that default is written explicitly', () => {
    const implicit: RsfData = { ...base, styles: [[0, 0, { borderTop: '#0000ff' }]] };
    const explicit: RsfData = {
      ...base,
      styles: [[0, 0, { borderTop: '#0000ff', borderTopStyle: 'solid', borderTopWidth: 'thin' }]],
    };
    expect(encodeRsf(explicit)).toEqual(encodeRsf(implicit));
    const decoded = decodeRsf(encodeRsf(explicit));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toEqual(implicit.styles);
  });

  it('RSF_BODY_VERSION is 10, so a version-9 file (no border style/width bytes) still decodes unchanged', () => {
    expect(RSF_BODY_VERSION).toBe(10);
    // A color-only border never triggers the version-10 upgrade (see the
    // identical-bytes assertion above), so every pre-existing version-9 .rsf
    // file — which by definition carries no line-style/width byte — decodes
    // through the same `bodyVersion >= 10` guard that skips reading one.
    const colorOnly: RsfData = { ...base, styles: [[0, 0, { borderTop: '#0000ff' }]] };
    const decoded = decodeRsf(encodeRsf(colorOnly));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toEqual(colorOnly.styles);
  });
});

describe('FormatCommands via Commands (RSF worksheets)', () => {
  it('toggleBold applies to every visible cell and follows the uniform-selection rule', () => {
    const { state, commands, tab, doc } = sheet([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(commands.isFormatActive(tab, 'bold')).toBe(false);
    expect(commands.toggleBold(tab)).toBe(true);
    expect(doc.getStyle(0, 0)?.bold).toBe(true);
    expect(doc.getStyle(1, 1)?.bold).toBe(true);
    expect(commands.isFormatActive(tab, 'bold')).toBe(true);
    // Uniform selection is already all-bold: the next toggle turns it off everywhere.
    expect(commands.toggleBold(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toBeNull();
    expect(commands.isFormatActive(tab, 'bold')).toBe(false);
  });

  it('a partially-bold selection toggles to fully bold, not fully off', () => {
    const { commands, tab, doc, state } = sheet([['a', 'b']]);
    doc.setCellStyleOn(undefined, 0, 0, { bold: true });
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(commands.isFormatActive(tab, 'bold')).toBe(false); // not uniform
    commands.toggleBold(tab);
    expect(doc.getStyle(0, 0)?.bold).toBe(true);
    expect(doc.getStyle(0, 1)?.bold).toBe(true);
  });

  it('toggleItalic and toggleUnderline behave the same way, independently of bold', () => {
    const { commands, tab, doc, state } = sheet([['a']]);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    commands.toggleBold(tab);
    commands.toggleItalic(tab);
    expect(doc.getStyle(0, 0)).toEqual({ bold: true, italic: true });
    commands.toggleUnderline(tab);
    expect(doc.getStyle(0, 0)).toEqual({ bold: true, italic: true, underline: true });
    commands.toggleItalic(tab);
    expect(doc.getStyle(0, 0)).toEqual({ bold: true, underline: true });
  });

  it('is a no-op on a plain CSV tab', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(commands.isEnabled('format.bold')).toBe(false);
    expect(commands.toggleBold(tab)).toBe(false);
  });

  it('promptTextColor applies the chosen color and Clear Color removes it', async () => {
    const ui = stubUi({
      chooseTextColor: vi.fn(async () => ({ action: 'apply' as const, color: '#ff00ff' })),
    });
    const { commands, tab, doc, state } = sheet([['a']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.promptTextColor(tab)).toBe(true);
    expect(doc.getStyle(0, 0)?.textColor).toBe('#ff00ff');

    (ui.chooseTextColor as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'clear' });
    expect(await commands.promptTextColor(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('promptTextColor does nothing when the dialog is cancelled', async () => {
    const ui = stubUi({ chooseTextColor: vi.fn(async () => null) });
    const { commands, tab, doc, state } = sheet([['a']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.promptTextColor(tab)).toBe(false);
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('promptBackgroundColor applies the chosen color', async () => {
    const ui = stubUi({
      chooseBackgroundColor: vi.fn(async () => ({ action: 'apply' as const, color: '#abcdef' })),
    });
    const { commands, tab, doc, state } = sheet([['a']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.promptBackgroundColor(tab)).toBe(true);
    expect(doc.getStyle(0, 0)?.backgroundColor).toBe('#abcdef');
  });

  it('promptBorders sets checked sides (with the chosen style/width) and clears unchecked ones', async () => {
    const ui = stubUi({
      chooseBorders: vi.fn(async () => ({
        action: 'apply' as const,
        sides: { borderTop: '#000000', borderBottom: null },
        lineStyle: 'dashed' as const,
        width: 'thick' as const,
      })),
    });
    const { commands, tab, doc, state } = sheet([['a']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    doc.setCellStyleOn(undefined, 0, 0, { borderBottom: '#ffffff' });
    expect(await commands.promptBorders(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toEqual({
      borderTop: '#000000',
      borderTopStyle: 'dashed',
      borderTopWidth: 'thick',
    });
  });

  it('clearFormatting removes every style property without touching cell values', () => {
    const { commands, tab, doc, state } = sheet([['keep-me']]);
    doc.setCellStyleOn(undefined, 0, 0, { bold: true, textColor: '#ff0000', borderTop: '#000000' });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(commands.clearFormatting(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toBeNull();
    expect(doc.getValue(0, 0)).toBe('keep-me');
  });

  it('formatting is undoable and redoable as one atomic entry', () => {
    const { commands, tab, doc, state } = sheet([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 1 });
    commands.toggleBold(tab);
    expect(doc.getStyle(0, 0)?.bold).toBe(true);
    expect(doc.getStyle(1, 1)?.bold).toBe(true);
    state.undo(tab);
    expect(doc.getStyle(0, 0)).toBeNull();
    expect(doc.getStyle(1, 1)).toBeNull();
    state.redo(tab);
    expect(doc.getStyle(0, 0)?.bold).toBe(true);
    expect(doc.getStyle(1, 1)?.bold).toBe(true);
  });

  it('rows hidden by an active filter are skipped', () => {
    const { commands, tab, doc, state } = sheet([['a'], ['b'], ['c']]);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 2, col: 0 });
    vi.spyOn(state, 'hiddenRows').mockReturnValue(new Set([1]));
    commands.toggleBold(tab);
    expect(doc.getStyle(0, 0)?.bold).toBe(true);
    expect(doc.getStyle(1, 0)).toBeNull();
    expect(doc.getStyle(2, 0)?.bold).toBe(true);
  });
});
