// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Non-blocking large operations: heavy read/prepare phases run in cooperative
 * time slices (never one long unbroken main-thread loop) and the loading UI
 * reports a numeric percentage, with 100% never shown while work remains.
 * Large paste / insertion progress lives in insert-cells.test.ts; Replace All
 * progress in search tests; multi-column auto-fit in autofit.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, LARGE_OP_CELLS, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { RcsvDocument } from '../src/core/rcsv-document';
import { KEEP_SAVE_OPTIONS } from '../src/core/serializer';
import { doc } from './helpers';

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
    chooseRcsvSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
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

function busyLabels(ui: UiPort): Array<string | null> {
  return (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string | null);
}

function percentValues(labels: Array<string | null>): number[] {
  return labels
    .filter((l): l is string => typeof l === 'string')
    .map((l) => /\((\d+)%/.exec(l) ?? /(\d+)%/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

/** A CSV document large enough to cross the large-operation threshold. */
function largeCsv(): string {
  // 5,000 rows × 6 columns = 30,000 cells > LARGE_OP_CELLS.
  expect(5_000 * 6).toBeGreaterThan(LARGE_OP_CELLS);
  return Array.from({ length: 5_000 }, (_, r) => `r${r},b,c,d,e,f`).join('\n') + '\n';
}

describe('CSV → RCSV conversion progress', () => {
  it('the explicit Convert command scans in slices with a percentage label', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    await commands.run('sheet.convert');
    // A new RCSV tab with identical values; the source CSV tab is untouched.
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1].doc.kind).toBe('rcsv');
    expect(state.tabs[1].doc.getValue(4_999, 0)).toBe('r4999');
    expect(tab.doc.kind).toBe('csv');
    const labels = busyLabels(ui);
    const percents = percentValues(labels);
    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeLessThan(100); // 100% never shows while work remains
    }
    expect(labels[labels.length - 1]).toBeNull();
  });

  it('an implicit (in-place) conversion of a large document also reports progress', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    const converted = await commands.ensureRcsv(tab, 'structure');
    expect(converted).not.toBeNull();
    expect(tab.doc.kind).toBe('rcsv');
    expect(tab.doc.getValue(123, 0)).toBe('r123');
    expect(percentValues(busyLabels(ui)).length).toBeGreaterThan(0);
    expect(busyLabels(ui)[busyLabels(ui).length - 1]).toBeNull();
  });

  it('declining the conversion shows no loading UI and changes nothing', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    expect(await commands.ensureRcsv(tab, 'structure')).toBeNull();
    expect(tab.doc.kind).toBe('csv');
    expect(busyLabels(ui)).toHaveLength(0);
  });
});

describe('RCSV save and compression progress', () => {
  function largeRcsvTab(state: AppState) {
    const rcsv = RcsvDocument.empty('big.rcsv', 5_000, 6);
    for (let r = 0; r < 5_000; r += 7) {
      rcsv.setCell(r, 2, `value ${r}`);
    }
    const tab = state.addTab('big.rcsv', rcsv, null);
    tab.rcsvSaveExplained = true;
    return tab;
  }

  it('saving shows a sliced serialization percentage, then a distinct compression phase', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = largeRcsvTab(state);
    expect(await commands.save(tab, KEEP_SAVE_OPTIONS)).toBe(true);
    const labels = busyLabels(ui);
    // Phase 1: percentage progress while collecting cells.
    const serializePrefix = t('loading.savingSerialize', { name: 'big.rcsv', pct: 999 }).split('999')[0];
    const serialize = labels.filter((l) => typeof l === 'string' && l.startsWith(serializePrefix));
    expect(percentValues(labels).length).toBeGreaterThan(0);
    expect(serialize.length).toBeGreaterThan(0);
    // Phase 2: the labeled compression step (honestly indeterminate).
    expect(labels).toContain(t('loading.savingCompress', { name: 'big.rcsv' }));
    // The indicator is dismissed only at the end.
    expect(labels[labels.length - 1]).toBeNull();
    expect(tab.doc.isDirty).toBe(false);
  });
});
