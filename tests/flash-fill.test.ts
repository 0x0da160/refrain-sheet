// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Flash Fill: deterministic offline inference (core), and the command-level
 * flow — preview + explicit confirmation, cancellation leaving the document
 * untouched, overwrite protection, ambiguity refusal, undo/redo atomicity,
 * and the CSV-mode restriction.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type FlashFillPreview, type UiPort } from '../src/app/commands';
import {
  applyFlashFillOp,
  flashFillRow,
  inferFlashFillCandidates,
  type FlashFillOp,
} from '../src/core/flash-fill';
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

/** Grid-backed source reader over a value matrix. */
function reader(values: string[][]): (row: number, col: number) => string {
  return (row, col) => values[row]?.[col] ?? '';
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

describe('core inference', () => {
  it('infers a two-column join with a literal separator', () => {
    const values = [
      ['Taro', 'Yamada', 'Taro Yamada'],
      ['Hanako', 'Sato', ''],
    ];
    const ops = inferFlashFillCandidates([{ row: 0, value: 'Taro Yamada' }], [0, 1], reader(values));
    expect(ops.length).toBeGreaterThan(0);
    const out = flashFillRow(ops, (c) => values[1][c]);
    expect(out).toEqual({ kind: 'agreed', value: 'Hanako Sato' });
  });

  it('infers delimited extraction (part of a split)', () => {
    // Two examples of different lengths rule out the constant-length prefix
    // candidate, leaving only the unambiguous split-by-@ extraction.
    const values = [
      ['taro@example.com', 'taro'],
      ['hanako@example.org', 'hanako'],
      ['jiro@example.net', ''],
    ];
    const ops = inferFlashFillCandidates(
      [
        { row: 0, value: 'taro' },
        { row: 1, value: 'hanako' },
      ],
      [0],
      reader(values),
    );
    expect(ops.length).toBeGreaterThan(0);
    expect(flashFillRow(ops, (c) => values[2][c])).toEqual({ kind: 'agreed', value: 'jiro' });
  });

  it('infers casing normalization only when demonstrated', () => {
    const values = [
      ['tokyo', 'TOKYO'],
      ['osaka', ''],
    ];
    const ops = inferFlashFillCandidates([{ row: 0, value: 'TOKYO' }], [0], reader(values));
    expect(ops.some((op) => op.kind === 'copy' && op.casing === 'upper')).toBe(true);
    expect(flashFillRow(ops, (c) => values[1][c])).toEqual({ kind: 'agreed', value: 'OSAKA' });
  });

  it('infers a constant-length prefix', () => {
    const values = [
      ['AB-1234', 'AB'],
      ['CD-9876', ''],
    ];
    const ops = inferFlashFillCandidates([{ row: 0, value: 'AB' }], [0], reader(values));
    expect(ops.length).toBeGreaterThan(0);
    expect(flashFillRow(ops, (c) => values[1][c])).toEqual({ kind: 'agreed', value: 'CD' });
  });

  it('reports a conflict when candidates disagree on a fill row', () => {
    // "x" is both the first split part and a 1-char prefix on the example, but
    // the two rules disagree on the second row ("yz-w" → "yz" vs "y").
    const values = [
      ['x-a', 'x'],
      ['yz-w', ''],
    ];
    const ops = inferFlashFillCandidates([{ row: 0, value: 'x' }], [0], reader(values));
    const outcome = flashFillRow(ops, (c) => values[1][c]);
    if (ops.length > 1) {
      expect(outcome.kind).toBe('conflict');
    }
  });

  it('returns no candidates when nothing reproduces the examples', () => {
    const values = [
      ['alpha', 'zzz'],
      ['beta', ''],
    ];
    expect(inferFlashFillCandidates([{ row: 0, value: 'zzz' }], [0], reader(values))).toEqual([]);
  });

  it('requires all examples to match (multiple examples disambiguate)', () => {
    const values = [
      ['a b', 'a'],
      ['c d', 'd'], // second example contradicts "first split part"
      ['e f', ''],
    ];
    const ops = inferFlashFillCandidates(
      [
        { row: 0, value: 'a' },
        { row: 1, value: 'd' },
      ],
      [0],
      reader(values),
    );
    expect(ops).toEqual([]);
  });

  it('rows with empty sources yield null (left untouched)', () => {
    const op: FlashFillOp = { kind: 'copy', col: 0, casing: 'none' };
    expect(applyFlashFillOp(op, () => '')).toBeNull();
  });
});

describe('Flash Fill command flow', () => {
  const NAMES = [
    ['Taro', 'Yamada', 'Taro Yamada'],
    ['Hanako', 'Sato', ''],
    ['Jiro', 'Suzuki', ''],
  ];

  it('previews, applies on confirmation, and is singly undoable', async () => {
    let seen: FlashFillPreview | null = null;
    const ui = stubUi({
      confirmFlashFill: vi.fn(async (p: FlashFillPreview) => {
        seen = p;
        return true;
      }),
    });
    const { state, commands, tab, doc } = sheet(NAMES, ui);
    state.setSelection(tab, { row: 0, col: 2 }, null);
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(true);
    expect(doc.getValue(1, 2)).toBe('Hanako Sato');
    expect(doc.getValue(2, 2)).toBe('Jiro Suzuki');
    const preview = seen as FlashFillPreview | null;
    expect(preview).not.toBeNull();
    expect(preview!.changeCount).toBe(2);
    expect(preview!.overwriteCount).toBe(0);
    expect(preview!.range).toBe('C2:C3');
    expect(preview!.sample.length).toBe(2);
    expect(preview!.sample[0]).toEqual({ cell: 'C2', before: '', after: 'Hanako Sato' });
    // One atomic history entry: a single undo restores every filled cell.
    state.undo(tab);
    expect(doc.getValue(1, 2)).toBe('');
    expect(doc.getValue(2, 2)).toBe('');
    state.redo(tab);
    expect(doc.getValue(1, 2)).toBe('Hanako Sato');
  });

  it('a rejected preview leaves the document untouched', async () => {
    const ui = stubUi({ confirmFlashFill: vi.fn(async () => false) });
    const { state, commands, tab, doc } = sheet(NAMES, ui);
    state.setSelection(tab, { row: 0, col: 2 }, null);
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(false);
    expect(doc.getValue(1, 2)).toBe('');
    expect(doc.isDirty).toBe(false);
    expect(tab.history.canUndo).toBe(false);
  });

  it('counts and warns about overwrites; applying overwrites only after confirmation', async () => {
    let seen: FlashFillPreview | null = null;
    const ui = stubUi({
      confirmFlashFill: vi.fn(async (p: FlashFillPreview) => {
        seen = p;
        return true;
      }),
    });
    const values = [
      ['Taro', 'Yamada', 'Taro Yamada'],
      ['Hanako', 'Sato', ''],
      ['Jiro', 'Suzuki', 'WRONG VALUE'],
    ];
    const { state, commands, tab, doc } = sheet(values, ui);
    state.setSelection(tab, { row: 0, col: 2 }, null);
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(true);
    const preview = seen as FlashFillPreview | null;
    expect(preview!.overwriteCount).toBe(1);
    expect(doc.getValue(2, 2)).toBe('Jiro Suzuki');
    state.undo(tab);
    expect(doc.getValue(2, 2)).toBe('WRONG VALUE');
  });

  it('explains ambiguity and changes nothing when candidates disagree', async () => {
    const messages: string[] = [];
    const ui = stubUi({
      showMessage: vi.fn(async (_t: string, m: string) => {
        messages.push(m);
      }),
    });
    const values = [
      ['x-a', 'x'],
      ['yz-w', ''],
    ];
    const { state, commands, tab, doc } = sheet(values, ui);
    state.setSelection(tab, { row: 0, col: 1 }, null);
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(false);
    expect(doc.getValue(1, 1)).toBe('');
    expect(messages.length).toBe(1);
    expect(ui.confirmFlashFill).not.toHaveBeenCalled();
  });

  it('explains missing examples without changing anything', async () => {
    const ui = stubUi();
    const values = [
      ['a', ''],
      ['b', ''],
    ];
    const { state, commands, tab } = sheet(values, ui);
    state.setSelection(tab, { row: 0, col: 1 }, null);
    expect(await commands.flashFill(tab)).toBe(false);
    expect(ui.showMessage).toHaveBeenCalledOnce();
    expect(ui.confirmFlashFill).not.toHaveBeenCalled();
  });

  it('is restricted to RSF: CSV mode shows a localized explanation', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('a.csv', csvDoc('x,y\n1,2\n'), null);
    state.setSelection(tab, { row: 0, col: 1 }, null);
    expect(await commands.flashFill(tab)).toBe(false);
    expect(ui.showMessage).toHaveBeenCalledOnce();
    expect(ui.confirmFlashFill).not.toHaveBeenCalled();
    expect(tab.doc.kind).toBe('csv');
    expect(tab.doc.isDirty).toBe(false);
  });

  it('operates on an explicitly selected multi-row range', async () => {
    const values = [
      ['Taro', 'Yamada', 'Taro Yamada'],
      ['Hanako', 'Sato', ''],
      ['Jiro', 'Suzuki', ''],
      ['Shiro', 'Tanaka', ''],
    ];
    const { state, commands, tab, doc } = sheet(values);
    // Select only C1:C3 — row 4 stays outside the fill.
    state.setSelection(tab, { row: 2, col: 2 }, { row: 0, col: 2 });
    expect(await commands.flashFill(tab)).toBe(true);
    expect(doc.getValue(1, 2)).toBe('Hanako Sato');
    expect(doc.getValue(2, 2)).toBe('Jiro Suzuki');
    expect(doc.getValue(3, 2)).toBe('');
  });

  it('large blocks run the sliced scan with progress and honor cancellation', async () => {
    const busyLabels: string[] = [];
    const ui = stubUi({
      setBusy: vi.fn((label: string | null) => {
        if (label) busyLabels.push(label);
      }),
      confirmFlashFill: vi.fn(async () => true),
    });
    const rows = 25_000;
    const doc = RsfDocument.empty('big.rsf', rows, 3);
    for (let r = 0; r < rows; r++) {
      doc.setCell(r, 0, `First${r}`);
      doc.setCell(r, 1, `Last${r}`);
    }
    doc.setCell(0, 2, 'First0 Last0');
    doc.markSaved();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.rsf', doc, null);
    state.setSelection(tab, { row: 0, col: 2 }, null);
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(true);
    expect(doc.getValue(rows - 1, 2)).toBe(`First${rows - 1} Last${rows - 1}`);
    // Progress labels never report 100% while the scan is still running.
    const pcts = busyLabels
      .map((l) => /\((\d+)%\)/.exec(l)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);
    expect(pcts.length).toBeGreaterThan(0);
    expect(pcts.every((p) => p < 100)).toBe(true);
  });

  it('a document swap during the sliced scan aborts without changes', async () => {
    const ui = stubUi();
    const rows = 25_000;
    const doc = RsfDocument.empty('big.rsf', rows, 3);
    for (let r = 0; r < rows; r++) {
      doc.setCell(r, 0, `First${r}`);
      doc.setCell(r, 1, `Last${r}`);
    }
    doc.setCell(0, 2, 'First0 Last0');
    doc.markSaved();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.rsf', doc, null);
    state.setSelection(tab, { row: 0, col: 2 }, null);
    // Swap the tab's document as soon as the busy indicator appears.
    (ui.setBusy as ReturnType<typeof vi.fn>).mockImplementation(() => {
      tab.doc = RsfDocument.empty('other.rsf', 1, 1);
    });
    const applied = await commands.flashFill(tab);
    expect(applied).toBe(false);
    expect(doc.getValue(1, 2)).toBe('');
    expect(ui.confirmFlashFill).not.toHaveBeenCalled();
  });
});
