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
import { DEFAULT_CSV_EXPORT_OPTIONS } from '../src/core/csv-export';
import { RsfDocument } from '../src/core/rsf-document';
import { compileQuery } from '../src/core/search';
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
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
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
    showDiff: vi.fn(async () => undefined),
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

/** Numeric progress argument passed alongside the label, when present. */
function progressValues(ui: UiPort): number[] {
  return (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[1])
    .filter((p): p is number => typeof p === 'number');
}

/** A CSV document large enough to cross the large-operation threshold. */
function largeCsv(): string {
  // 5,000 rows × 6 columns = 30,000 cells > LARGE_OP_CELLS.
  expect(5_000 * 6).toBeGreaterThan(LARGE_OP_CELLS);
  return Array.from({ length: 5_000 }, (_, r) => `r${r},b,c,d,e,f`).join('\n') + '\n';
}

describe('CSV → RSF conversion progress', () => {
  it('the explicit Convert command scans in slices with a percentage label', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    await commands.run('sheet.convert');
    // A new RSF tab with identical values; the source CSV tab is untouched.
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1].doc.kind).toBe('rsf');
    expect(state.tabs[1].doc.getValue(4_999, 0)).toBe('r4999');
    expect(tab.doc.kind).toBe('csv');
    const labels = busyLabels(ui);
    const percents = percentValues(labels);
    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeLessThan(100); // 100% never shows while work remains
    }
    expect(labels[labels.length - 1]).toBeNull();
    // The determinate progress bar's numeric value matches the labels' text.
    expect(progressValues(ui)).toEqual(percents);
  });

  it('an implicit (in-place) conversion of a large document also reports progress', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    const converted = await commands.ensureRsf(tab, 'structure');
    expect(converted).not.toBeNull();
    expect(tab.doc.kind).toBe('rsf');
    expect(tab.doc.getValue(123, 0)).toBe('r123');
    const percents = percentValues(busyLabels(ui));
    expect(percents.length).toBeGreaterThan(0);
    expect(busyLabels(ui)[busyLabels(ui).length - 1]).toBeNull();
    expect(progressValues(ui)).toEqual(percents);
  });

  it('declining the conversion shows no loading UI and changes nothing', async () => {
    const ui = stubUi({ confirmConvert: vi.fn(async () => false) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(largeCsv()), null);
    expect(await commands.ensureRsf(tab, 'structure')).toBeNull();
    expect(tab.doc.kind).toBe('csv');
    expect(busyLabels(ui)).toHaveLength(0);
  });
});

describe('RSF save and compression progress', () => {
  function largeRsfTab(state: AppState) {
    const rcsv = RsfDocument.empty('big.rsf', 5_000, 6);
    for (let r = 0; r < 5_000; r += 7) {
      rcsv.setCell(r, 2, `value ${r}`);
    }
    const tab = state.addTab('big.rsf', rcsv, null);
    tab.rsfSaveExplained = true;
    return tab;
  }

  it('saving shows a sliced serialization percentage, then a distinct compression phase', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = largeRsfTab(state);
    expect(await commands.save(tab, KEEP_SAVE_OPTIONS)).toBe(true);
    const labels = busyLabels(ui);
    // Phase 1: percentage progress while collecting cells.
    const serializePrefix = t('loading.savingSerialize', { name: 'big.rsf', pct: 999 }).split('999')[0];
    const serialize = labels.filter((l) => typeof l === 'string' && l.startsWith(serializePrefix));
    expect(percentValues(labels).length).toBeGreaterThan(0);
    expect(serialize.length).toBeGreaterThan(0);
    // Phase 2: the labeled compression step (honestly indeterminate).
    expect(labels).toContain(t('loading.savingCompress', { name: 'big.rsf' }));
    // The indicator is dismissed only at the end.
    expect(labels[labels.length - 1]).toBeNull();
    expect(tab.doc.isDirty).toBe(false);
    // Phase 1 reports a determinate progress bar value; phase 2 (compression)
    // has no honest percentage, so it carries no numeric progress argument.
    expect(progressValues(ui)).toEqual(percentValues(labels));
    const compressCall = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === t('loading.savingCompress', { name: 'big.rsf' }),
    );
    expect(compressCall?.[1]).toBeUndefined();
  });
});

describe('progress percentages never reach 100% early', () => {
  it('CSV export of a large RSF document floors its percentage below 100', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    const ui = stubUi({ chooseExportCsv: vi.fn(async () => DEFAULT_CSV_EXPORT_OPTIONS) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const rsf = RsfDocument.empty('big.rsf', 5_000, 6);
    for (let r = 0; r < 5_000; r += 3) {
      rsf.setCell(r, 1, `text ${r}`);
    }
    const tab = state.addTab('big.rsf', rsf, null);
    tab.rsfSaveExplained = true;
    expect(await commands.exportCsv(tab)).toBe(true);
    const percents = percentValues(busyLabels(ui));
    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeLessThan(100);
    }
    expect(progressValues(ui)).toEqual(percents);
  });

  it('Replace All floors its scan percentage below 100', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    state.addTab('big.csv', doc(largeCsv()), null);
    const query = compileQuery({ text: 'r49', matchCase: true, regex: false });
    const { count } = await commands.replaceAll(query, 'z49');
    expect(count).toBeGreaterThan(0);
    const percents = percentValues(busyLabels(ui));
    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeLessThan(100);
    }
  });
});
