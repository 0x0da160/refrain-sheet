// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Responsiveness regression tests: these verify the *structure* of the
 * performance work (bounded DOM churn, deferred aggregates, sliced scans,
 * prompt busy feedback) rather than wall-clock timings, so they are
 * deterministic across machines. Throughput itself is measured by
 * `npm run bench` (see docs/performance.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { forEachIndexSliced } from '../src/core/scheduler';
import { compileQuery } from '../src/core/search';
import { Grid } from '../src/ui/grid';
import { StatusBar, STATS_DEBOUNCE_MS, SYNC_STATS_CELL_LIMIT } from '../src/ui/status-bar';
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
    confirmExportCsv: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

function bigCsv(rows: number, cols = 4): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < cols; c++) {
      parts.push(String(r * cols + c));
    }
    lines.push(parts.join(','));
  }
  return lines.join('\n') + '\n';
}

function gridSetup(csv: string) {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const grid = new Grid(state, commands);
  Object.defineProperty(grid.element, 'clientHeight', { value: 520, configurable: true });
  Object.defineProperty(grid.element, 'clientWidth', { value: 900, configurable: true });
  document.body.append(grid.element);
  const tab = state.addTab('big.csv', doc(csv), null);
  grid.refresh();
  return { state, commands, grid, tab };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('in-place repaint (no full-grid rerender for cell edits)', () => {
  it('a single-cell edit updates the existing cell element instead of rebuilding the window', () => {
    const { state, grid, tab } = gridSetup(bigCsv(10_000));
    const before = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="1"]')!;
    const rowEl = before.parentElement!;
    state.editCell(tab, 2, 1, 'edited');
    grid.refresh(); // what the 'doc' subscription does
    const after = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="1"]')!;
    // Same DOM nodes, updated content: the visible window was not torn down.
    expect(after).toBe(before);
    expect(after.parentElement).toBe(rowEl);
    expect(after.textContent).toBe('edited');
    expect(after.classList.contains('edited')).toBe(true);
  });

  it('a structural change (different row count) still rebuilds the window', () => {
    const { state, grid, tab } = gridSetup(bigCsv(50));
    state.convertToRcsv(tab);
    grid.refresh();
    const before = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="1"]')!;
    state.insertRows(tab, 0, 1);
    grid.refresh();
    const after = grid.element.querySelector<HTMLElement>('[data-row="2"][data-col="1"]')!;
    expect(after).not.toBe(before);
  });

  it('an open inline editor survives an in-place repaint', () => {
    const { grid, tab, state } = gridSetup(bigCsv(100));
    grid.openEditor(tab, 1, 1, null);
    const input = grid.element.querySelector<HTMLInputElement>('input.cell-editor')!;
    state.editCell(tab, 5, 0, 'elsewhere');
    grid.refresh();
    expect(grid.element.querySelector('input.cell-editor')).toBe(input);
  });
});

describe('deferred selection statistics', () => {
  it('small selections compute statistics synchronously', () => {
    const state = new AppState();
    const tab = state.addTab('a.csv', doc('1,2\n3,4\n'), null);
    const statusBar = new StatusBar(state, () => undefined);
    state.setSelection(tab, { row: 1, col: 1 }, { row: 0, col: 0 });
    statusBar.render();
    expect(statusBar.element.textContent).toContain('10'); // sum 1+2+3+4
    expect(statusBar.element.querySelector('.calculating')).toBeNull();
  });

  it('large selections render immediately with Calculating… and fill in asynchronously', async () => {
    const rows = 30_000;
    const state = new AppState();
    const tab = state.addTab('big.csv', doc(bigCsv(rows, 1)), null);
    const statusBar = new StatusBar(state, () => undefined);
    document.body.append(statusBar.element); // a detached bar abandons its scan
    state.setSelection(tab, { row: rows - 1, col: 0 }, { row: 0, col: 0 });
    expect(rows).toBeGreaterThan(SYNC_STATS_CELL_LIMIT);
    const start = performance.now();
    statusBar.render();
    const elapsed = performance.now() - start;
    // The render itself returned without scanning the whole selection.
    expect(statusBar.element.querySelector('.calculating')).not.toBeNull();
    expect(elapsed).toBeLessThan(STATS_DEBOUNCE_MS + 250);
    // The background scan replaces the placeholder with real statistics.
    await vi.waitFor(
      () => {
        expect(statusBar.element.querySelector('.calculating')).toBeNull();
        expect(statusBar.element.querySelectorAll('.sel-stat').length).toBeGreaterThan(3);
      },
      { timeout: 5_000 },
    );
    const expectedSum = ((rows - 1) * rows) / 2; // values 0..rows-1
    expect(statusBar.element.textContent).toContain(expectedSum.toLocaleString('en-US'));
  });

  it('a newer selection cancels the previous background scan', async () => {
    const rows = 30_000;
    const state = new AppState();
    const tab = state.addTab('big.csv', doc(bigCsv(rows, 1)), null);
    const statusBar = new StatusBar(state, () => undefined);
    state.setSelection(tab, { row: rows - 1, col: 0 }, { row: 0, col: 0 });
    statusBar.render();
    // Before the debounce elapses, shrink the selection to a tiny range.
    state.setSelection(tab, { row: 1, col: 0 }, { row: 0, col: 0 });
    statusBar.render();
    expect(statusBar.element.querySelector('.calculating')).toBeNull();
    expect(statusBar.element.textContent).toContain('1'); // sum 0+1
    // Wait past the debounce: the stale scan must not resurrect a placeholder.
    await new Promise((resolve) => setTimeout(resolve, STATS_DEBOUNCE_MS + 50));
    expect(statusBar.element.querySelector('.calculating')).toBeNull();
  });
});

describe('sliced Replace All', () => {
  it('yields between slices, reports progress, and stays atomic for undo', async () => {
    const rows = 9_000; // above SLICE_MAX_INDICES, so at least one yield occurs
    const busyLabels: Array<string | null> = [];
    const ui = stubUi({ setBusy: (label) => busyLabels.push(label) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(bigCsv(rows, 2)), null);
    const query = compileQuery({ text: '1', matchCase: true, regex: false });
    const result = await commands.replaceAll(query, 'X');
    expect(result.count).toBeGreaterThan(0);
    // Progress labels were reported while scanning (percentage suffix).
    expect(busyLabels.some((l) => typeof l === 'string' && /\(\d+%\)/.test(l))).toBe(true);
    expect(busyLabels[busyLabels.length - 1]).toBeNull();
    // One undo restores everything: the mutation was a single atomic entry.
    expect(tab.doc.getValue(0, 1)).toBe('X');
    state.undo(tab);
    expect(tab.doc.getValue(0, 1)).toBe('1');
    expect(tab.doc.isDirty).toBe(false);
  });

  it('aborts without mutating when the document is replaced mid-scan', async () => {
    const rows = 9_000;
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tab = state.addTab('big.csv', doc(bigCsv(rows, 2)), null);
    const query = compileQuery({ text: '1', matchCase: true, regex: false });
    const pending = commands.replaceAll(query, 'X');
    // Swap the document while the scan is yielding (reopen/convert scenario).
    state.convertToRcsv(tab);
    const result = await pending;
    expect(result).toEqual({ count: 0, cells: 0 });
    expect(tab.doc.getValue(0, 1)).toBe('1');
    expect(tab.history.canUndo).toBe(false);
  });
});

describe('scheduler', () => {
  it('processes every index exactly once and reports monotonic progress', async () => {
    const seen: number[] = [];
    const progress: number[] = [];
    const ok = await forEachIndexSliced(10_000, (i) => seen.push(i), {
      maxSlice: 1_000,
      onProgress: (done) => progress.push(done),
    });
    expect(ok).toBe(true);
    expect(seen.length).toBe(10_000);
    expect(seen[0]).toBe(0);
    expect(seen[9_999]).toBe(9_999);
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    }
  });

  it('stops at the next yield when cancelled', async () => {
    let processed = 0;
    const ok = await forEachIndexSliced(10_000, () => (processed += 1), {
      maxSlice: 1_000,
      shouldStop: () => processed >= 1_000,
    });
    expect(ok).toBe(false);
    expect(processed).toBeLessThan(10_000);
  });
});
