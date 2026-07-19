// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { encodeCsvExport, type CsvExportOptions } from '../src/core/csv-export';
import { decodeBytes } from '../src/core/encoding';
import { RcsvDocument } from '../src/core/rcsv-document';

const UTF8_LF: CsvExportOptions = { encoding: 'utf-8', bom: false, lineEnding: 'lf' };

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
    explainRcsvSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => UTF8_LF),
    chooseInsertShift: vi.fn(async () => null),
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

/** An RCSV tab prepopulated from a value matrix. */
function rcsvSetup(values: string[][], ui: UiPort = stubUi()) {
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const doc = RcsvDocument.empty('data.rcsv', values.length, values[0].length);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      doc.setCell(r, c, values[r][c]);
    }
  }
  doc.markSaved();
  const tab = state.addTab('data.rcsv', doc, null);
  return { state, commands, tab, doc, ui };
}

function interceptDownload(): { text: () => Promise<string | null> } {
  let captured: Blob | null = null;
  URL.createObjectURL = vi.fn((b: Blob) => {
    captured = b;
    return 'blob:fake';
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {});
  return {
    text: async () => {
      if (!captured) return null;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(captured as unknown as Blob);
      });
    },
  };
}

describe('encodeCsvExport (pure)', () => {
  it('applies the selected line-ending style exactly, terminating every record', () => {
    const values = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    for (const [lineEnding, eol] of [
      ['crlf', '\r\n'],
      ['lf', '\n'],
      ['cr', '\r'],
    ] as const) {
      const result = encodeCsvExport(values, ',', { ...UTF8_LF, lineEnding });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(decodeBytes(result.bytes, 'utf-8')).toBe(`a,b${eol}c,d${eol}`);
      }
    }
  });

  it('includes or omits the UTF-8 BOM exactly as requested', () => {
    const withBom = encodeCsvExport([['x']], ',', { ...UTF8_LF, bom: true });
    const without = encodeCsvExport([['x']], ',', UTF8_LF);
    expect(withBom.ok && without.ok).toBe(true);
    if (withBom.ok && without.ok) {
      expect([...withBom.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(without.bytes[0]).not.toBe(0xef);
    }
  });

  it('ignores the BOM flag for non-UTF-8 encodings', () => {
    const result = encodeCsvExport([['abc']], ',', { encoding: 'shift_jis', bom: true, lineEnding: 'lf' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    }
  });

  it('quotes fields containing the delimiter, quotes, or line breaks', () => {
    const result = encodeCsvExport([['a,b', 'he said "hi"', 'two\nlines']], ',', UTF8_LF);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(decodeBytes(result.bytes, 'utf-8')).toBe('"a,b","he said ""hi""","two\nlines"\n');
    }
  });

  it('reports unrepresentable characters per cell and produces nothing', () => {
    const result = encodeCsvExport(
      [
        ['ok', '😀emoji'],
        ['ĝ', 'fine'],
      ],
      ',',
      { encoding: 'shift_jis', bom: false, lineEnding: 'lf' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unrepresentable).toHaveLength(2);
      expect(result.unrepresentable[0]).toMatchObject({ row: 0, col: 1 });
      expect(result.unrepresentable[0].chars).toContain('😀');
      expect(result.unrepresentable[1]).toMatchObject({ row: 1, col: 0 });
    }
  });

  it('with explicit consent replaces unrepresentable characters with NCRs and reports counts', () => {
    const result = encodeCsvExport(
      [['a😀b']],
      ',',
      { encoding: 'shift_jis', bom: false, lineEnding: 'lf' },
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ncrReplacements).toEqual([{ row: 0, col: 0, count: 1 }]);
      expect(decodeBytes(result.bytes, 'shift_jis')).toBe('a&#128512;b\n');
    }
  });

  it('exports Shift_JIS bytes for representable Japanese text', () => {
    const result = encodeCsvExport([['日本語']], ',', {
      encoding: 'shift_jis',
      bom: false,
      lineEnding: 'crlf',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(decodeBytes(result.bytes, 'shift_jis')).toBe('日本語\r\n');
    }
  });
});

describe('exportCsv command flow', () => {
  it('cancelling the options dialog exports nothing and touches nothing', async () => {
    const ui = stubUi({ chooseExportCsv: vi.fn(async () => null) });
    const dl = interceptDownload();
    const { commands, tab, doc } = rcsvSetup([['1', '2']], ui);
    expect(await commands.exportCsv(tab)).toBe(false);
    expect(await dl.text()).toBeNull();
    expect(doc.isDirty).toBe(false);
    void tab;
  });

  it('exports formulas as calculated display values with the chosen line ending', async () => {
    const ui = stubUi({
      chooseExportCsv: vi.fn(async () => ({ encoding: 'utf-8', bom: false, lineEnding: 'crlf' }) as const),
    });
    const dl = interceptDownload();
    const { commands, tab, doc } = rcsvSetup(
      [
        ['2', '=A1*10'],
        ['3', '=SUM(A1:A2)'],
      ],
      ui,
    );
    expect(await commands.exportCsv(tab)).toBe(true);
    expect(await dl.text()).toBe('2,20\r\n3,5\r\n');
    // The source document still holds the formulas and is not marked saved.
    expect(doc.getValue(0, 1)).toBe('=A1*10');
    expect(doc.isDirty).toBe(false);
  });

  it('cancels by default when the encoding cannot represent some characters', async () => {
    const ui = stubUi({
      chooseExportCsv: vi.fn(async () => ({ encoding: 'shift_jis', bom: false, lineEnding: 'lf' }) as const),
      confirmUnrepresentable: vi.fn(async () => false),
    });
    const dl = interceptDownload();
    const { commands, tab } = rcsvSetup([['😀']], ui);
    expect(await commands.exportCsv(tab)).toBe(false);
    expect(ui.confirmUnrepresentable).toHaveBeenCalledTimes(1);
    // Affected-cell details were passed to the dialog.
    const cells = (ui.confirmUnrepresentable as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{
      row: number;
      col: number;
    }>;
    expect(cells).toMatchObject([{ row: 0, col: 0 }]);
    expect(await dl.text()).toBeNull();
  });

  it('continues with NCR replacement only after explicit confirmation, then reports it', async () => {
    const ui = stubUi({
      chooseExportCsv: vi.fn(async () => ({ encoding: 'shift_jis', bom: false, lineEnding: 'lf' }) as const),
      confirmUnrepresentable: vi.fn(async () => true),
    });
    const dl = interceptDownload();
    const { commands, tab, doc } = rcsvSetup([['a😀']], ui);
    expect(await commands.exportCsv(tab)).toBe(true);
    expect(await dl.text()).toBe('a&#128512;\n');
    expect(ui.notifyNcr).toHaveBeenCalledTimes(1);
    // The replacement happened only in the export, never in the document.
    expect(doc.getValue(0, 0)).toBe('a😀');
  });

  it('shows the loading indicator while exporting', async () => {
    const ui = stubUi();
    interceptDownload();
    const { commands, tab } = rcsvSetup([['1']], ui);
    await commands.exportCsv(tab);
    const busyCalls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(busyCalls.some((label) => typeof label === 'string')).toBe(true);
    expect(busyCalls[busyCalls.length - 1]).toBeNull();
  });

  it('derives the default filename by replacing .rcsv with .csv', async () => {
    const ui = stubUi();
    interceptDownload();
    let downloadName = '';
    const notifySpy = ui.notify as ReturnType<typeof vi.fn>;
    const { commands, tab } = rcsvSetup([['1']], ui);
    expect(await commands.exportCsv(tab)).toBe(true);
    downloadName = String(notifySpy.mock.calls[0][0]);
    expect(downloadName).toContain('data.csv');
  });
});
