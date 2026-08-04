// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Cell number formats (Format > Number Format…): rendering
 * (`cell-number-format.ts`), the `NumberFormat` core in `cell-style.ts`,
 * `RsfDocument` display-value integration, and RSF codec persistence (body
 * version 9 / workbook body version 5). Mirrors `cell-format.test.ts`'s
 * coverage shape for the other style properties.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { formatCellNumber } from '../src/core/cell-number-format';
import {
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_NUMBER_FORMAT_DECIMALS,
  normalizeNumberFormat,
  numberFormatsEqual,
  type NumberFormat,
} from '../src/core/cell-style';
import { getRsfCodec, RSF_COMPRESSION_STORE } from '../src/core/csv-engine';
import { decodeRsf, encodeRsf, type RsfData } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { doc as csvDoc } from './helpers';

const HEADER_SIZE = 20;

/** Patch a store-method container body byte and re-stamp the CRC. See `rsf-display.test.ts`. */
function patchBody(bytes: Uint8Array, mutate: (body: Uint8Array) => void): Uint8Array {
  const out = bytes.slice();
  const body = out.subarray(HEADER_SIZE);
  mutate(body);
  new DataView(out.buffer).setUint32(12, getRsfCodec().crc32(body), true);
  return out;
}

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

describe('NumberFormat core', () => {
  it('normalizeNumberFormat clamps decimals into 0-MAX and defaults thousands to a boolean', () => {
    expect(normalizeNumberFormat({ kind: 'number', decimals: -5, thousands: false })).toEqual({
      kind: 'number',
      decimals: 0,
      thousands: false,
    });
    expect(
      normalizeNumberFormat({ kind: 'number', decimals: MAX_NUMBER_FORMAT_DECIMALS + 5, thousands: true }),
    ).toEqual({ kind: 'number', decimals: MAX_NUMBER_FORMAT_DECIMALS, thousands: true });
  });

  it('normalizeNumberFormat only keeps currencySymbol for kind: currency, truncated to the max length', () => {
    const long = 'A'.repeat(MAX_CURRENCY_SYMBOL_LENGTH + 5);
    expect(
      normalizeNumberFormat({ kind: 'currency', decimals: 2, thousands: false, currencySymbol: long }),
    ).toEqual({
      kind: 'currency',
      decimals: 2,
      thousands: false,
      currencySymbol: long.slice(0, MAX_CURRENCY_SYMBOL_LENGTH),
    });
    expect(normalizeNumberFormat({ kind: 'currency', decimals: 2, thousands: false }).currencySymbol).toBe(
      '$',
    );
    expect(
      normalizeNumberFormat({ kind: 'percent', decimals: 0, thousands: false, currencySymbol: '¥' })
        .currencySymbol,
    ).toBeUndefined();
  });

  it('numberFormatsEqual treats undefined on both sides as equal and compares currencySymbol only for currency', () => {
    expect(numberFormatsEqual(undefined, undefined)).toBe(true);
    expect(numberFormatsEqual(undefined, { kind: 'number', decimals: 0, thousands: false })).toBe(false);
    const a: NumberFormat = { kind: 'number', decimals: 2, thousands: true };
    const b: NumberFormat = { kind: 'number', decimals: 2, thousands: true, currencySymbol: 'ignored' };
    expect(numberFormatsEqual(a, b)).toBe(true);
    const currencyA: NumberFormat = { kind: 'currency', decimals: 2, thousands: false, currencySymbol: '$' };
    const currencyB: NumberFormat = { kind: 'currency', decimals: 2, thousands: false, currencySymbol: '¥' };
    expect(numberFormatsEqual(currencyA, currencyB)).toBe(false);
  });
});

describe('formatCellNumber', () => {
  it('renders "number" with a fixed decimal count and no separator by default', () => {
    expect(formatCellNumber(1234.5, { kind: 'number', decimals: 2, thousands: false })).toBe('1234.50');
    expect(formatCellNumber(1234.5, { kind: 'number', decimals: 0, thousands: false })).toBe('1235');
  });

  it('renders "number" with a thousands separator when requested', () => {
    expect(formatCellNumber(1234567.891, { kind: 'number', decimals: 2, thousands: true })).toBe(
      '1,234,567.89',
    );
  });

  it('renders "percent" by multiplying by 100 and appending %', () => {
    expect(formatCellNumber(0.4567, { kind: 'percent', decimals: 1, thousands: false })).toBe('45.7%');
    expect(formatCellNumber(1, { kind: 'percent', decimals: 0, thousands: false })).toBe('100%');
  });

  it('renders "currency" with the symbol before the digits, after any minus sign', () => {
    expect(
      formatCellNumber(1234.5, { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '$' }),
    ).toBe('$1,234.50');
    expect(
      formatCellNumber(-1234.5, { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '$' }),
    ).toBe('-$1,234.50');
  });

  it('defaults the currency symbol to "$" when none is stored', () => {
    expect(formatCellNumber(5, { kind: 'currency', decimals: 0, thousands: false })).toBe('$5');
  });

  it('supports a non-ASCII currency symbol', () => {
    expect(
      formatCellNumber(1000, { kind: 'currency', decimals: 0, thousands: true, currencySymbol: '¥' }),
    ).toBe('¥1,000');
  });
});

describe('RsfDocument display value with a number format', () => {
  it('getDisplayValue renders a formatted numeric cell, formula or literal alike', () => {
    const { doc } = sheet([['1234.5', '=A1*2']]);
    doc.setCellStyleOn(undefined, 0, 0, {
      numberFormat: { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '$' },
    });
    doc.setCellStyleOn(undefined, 0, 1, { numberFormat: { kind: 'number', decimals: 1, thousands: false } });
    expect(doc.getDisplayValue(0, 0)).toBe('$1,234.50');
    expect(doc.getDisplayValue(0, 1)).toBe('2469.0');
  });

  it('leaves text, boolean, blank, and error values untouched by a numberFormat', () => {
    const { doc } = sheet([['hello', '=1/0']]);
    doc.setCellStyleOn(undefined, 0, 0, { numberFormat: { kind: 'number', decimals: 2, thousands: false } });
    doc.setCellStyleOn(undefined, 0, 1, { numberFormat: { kind: 'number', decimals: 2, thousands: false } });
    expect(doc.getDisplayValue(0, 0)).toBe('hello');
    expect(doc.getDisplayValue(0, 1)).toBe('#DIV/0!');
  });

  it('a cell with no numberFormat renders exactly as before', () => {
    const { doc } = sheet([['1234.5']]);
    expect(doc.getDisplayValue(0, 0)).toBe('1234.5');
  });
});

describe('RSF codec: number-format sub-record (body version 9)', () => {
  const base: RsfData = {
    name: 'Sheet1',
    delimiter: ',',
    rowCount: 4,
    columnCount: 4,
    cells: [[0, 0, '1234.5']],
  };

  it('round-trips number, percent, and currency formats', () => {
    const withFormats: RsfData = {
      ...base,
      styles: [
        [0, 0, { numberFormat: { kind: 'number', decimals: 2, thousands: true } }],
        [1, 1, { numberFormat: { kind: 'percent', decimals: 0, thousands: false } }],
        [
          2,
          2,
          {
            bold: true,
            numberFormat: { kind: 'currency', decimals: 2, thousands: true, currencySymbol: '¥' },
          },
        ],
      ],
    };
    const bytes = encodeRsf(withFormats);
    const decoded = decodeRsf(bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.data.styles).toEqual(withFormats.styles);
  });

  it('stays on body version 8 (no number-format sub-record) when only plain styles are present', () => {
    const plainStyle: RsfData = { ...base, styles: [[0, 0, { bold: true }]] };
    const bytesWithFormat = encodeRsf(
      { ...base, styles: [[0, 0, { numberFormat: { kind: 'number', decimals: 0, thousands: false } }]] },
      RSF_COMPRESSION_STORE,
    );
    const bytesPlain = encodeRsf(plainStyle, RSF_COMPRESSION_STORE);
    // The body-version byte (right after the 20-byte container header)
    // differs: plain styles alone don't force the number-format sub-record.
    expect(bytesWithFormat[HEADER_SIZE]).toBe(9);
    expect(bytesPlain[HEADER_SIZE]).toBe(8);
    const decoded = decodeRsf(bytesPlain);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles).toEqual(plainStyle.styles);
  });

  it('a body version 8 reader-shaped payload (no formats) still round-trips styles without a numberFormat key', () => {
    const decoded = decodeRsf(encodeRsf({ ...base, styles: [[0, 0, { italic: true }]] }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.styles?.[0][2].numberFormat).toBeUndefined();
  });

  it('rejects an unknown number-format kind byte as bad-shape rather than guessing the record length', () => {
    const bytes = encodeRsf(
      { ...base, styles: [[0, 0, { numberFormat: { kind: 'number', decimals: 0, thousands: false } }]] },
      RSF_COMPRESSION_STORE,
    );
    // The number-format sub-record for this single-style, single-format
    // record (kind/decimals/thousands, no currency symbol) is the last 3
    // bytes of the (store-method, so uncompressed) body; the kind byte leads it.
    const corrupted = patchBody(bytes, (body) => {
      body[body.length - 3] = 0x7f;
    });
    const decoded = decodeRsf(corrupted);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });

  it('rejects a number-format sub-record truncated mid-currency-symbol as bad-shape', () => {
    const bytes = encodeRsf({
      ...base,
      styles: [
        [0, 0, { numberFormat: { kind: 'currency', decimals: 2, thousands: false, currencySymbol: '$$' } }],
      ],
    });
    const decoded = decodeRsf(bytes.subarray(0, bytes.length - 1));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error).toBe('bad-shape');
  });
});

describe('FormatCommands.promptNumberFormat via Commands', () => {
  it('applies the chosen format to every visible cell in the selection', async () => {
    const format: NumberFormat = { kind: 'percent', decimals: 1, thousands: false };
    const ui = stubUi({ chooseNumberFormat: vi.fn(async () => ({ action: 'apply' as const, format })) });
    const { commands, tab, doc, state } = sheet(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      ui,
    );
    state.setSelection(tab, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(await commands.promptNumberFormat(tab)).toBe(true);
    expect(doc.getStyle(0, 0)?.numberFormat).toEqual(format);
    expect(doc.getStyle(1, 1)?.numberFormat).toEqual(format);
  });

  it('"Clear" removes the format without touching the cell value', async () => {
    const ui = stubUi({ chooseNumberFormat: vi.fn(async () => ({ action: 'clear' as const })) });
    const { commands, tab, doc, state } = sheet([['5']], ui);
    doc.setCellStyleOn(undefined, 0, 0, {
      bold: true,
      numberFormat: { kind: 'number', decimals: 2, thousands: false },
    });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.promptNumberFormat(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toEqual({ bold: true });
    expect(doc.getValue(0, 0)).toBe('5');
  });

  it('does nothing when the dialog is cancelled', async () => {
    const ui = stubUi({ chooseNumberFormat: vi.fn(async () => null) });
    const { commands, tab, doc, state } = sheet([['5']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(await commands.promptNumberFormat(tab)).toBe(false);
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('is a no-op on a plain CSV tab', async () => {
    const ui = stubUi({
      chooseNumberFormat: vi.fn(async () => ({
        action: 'apply' as const,
        format: { kind: 'number' as const, decimals: 2, thousands: false },
      })),
    });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('t.csv', csvDoc('a,b\n'), null);
    state.setSelection(tab, { row: 0, col: 0 }, { row: 0, col: 1 });
    expect(commands.isEnabled('format.numberFormat')).toBe(false);
    expect(await commands.promptNumberFormat(tab)).toBe(false);
  });

  it('clearFormatting also removes a numberFormat', () => {
    const { commands, tab, doc, state } = sheet([['5']]);
    doc.setCellStyleOn(undefined, 0, 0, { numberFormat: { kind: 'currency', decimals: 2, thousands: true } });
    state.setSelection(tab, { row: 0, col: 0 }, null);
    expect(commands.clearFormatting(tab)).toBe(true);
    expect(doc.getStyle(0, 0)).toBeNull();
  });

  it('applying a number format is undoable and redoable as one atomic entry', async () => {
    const format: NumberFormat = { kind: 'number', decimals: 3, thousands: true };
    const ui = stubUi({ chooseNumberFormat: vi.fn(async () => ({ action: 'apply' as const, format })) });
    const { commands, tab, doc, state } = sheet([['1']], ui);
    state.setSelection(tab, { row: 0, col: 0 }, null);
    await commands.promptNumberFormat(tab);
    expect(doc.getStyle(0, 0)?.numberFormat).toEqual(format);
    state.undo(tab);
    expect(doc.getStyle(0, 0)).toBeNull();
    state.redo(tab);
    expect(doc.getStyle(0, 0)?.numberFormat).toEqual(format);
  });
});
