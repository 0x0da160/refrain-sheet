// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { LoadingOverlay } from '../src/ui/loading-overlay';
import { utf8 } from './helpers';

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
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
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
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

describe('loading overlay', () => {
  it('is hidden until a label is set and exposes accessible busy state', () => {
    const overlay = new LoadingOverlay();
    expect(overlay.element.hidden).toBe(true);
    expect(overlay.element.getAttribute('role')).toBe('status');
    expect(overlay.element.getAttribute('aria-live')).toBe('polite');

    overlay.set('Opening big.csv…');
    expect(overlay.element.hidden).toBe(false);
    expect(overlay.element.getAttribute('aria-busy')).toBe('true');
    expect(overlay.element.querySelector('.loading-label')!.textContent).toBe('Opening big.csv…');

    overlay.set(null);
    expect(overlay.element.hidden).toBe(true);
    expect(overlay.element.getAttribute('aria-busy')).toBe('false');
  });

  it('shows a determinate progress bar in place of the spinner when a percentage is given', () => {
    const overlay = new LoadingOverlay();
    const spinner = overlay.element.querySelector<HTMLElement>('.loading-spinner')!;
    const progress = overlay.element.querySelector<HTMLProgressElement>('.loading-progress')!;

    overlay.set('Converting… (0%)', 0);
    expect(spinner.hidden).toBe(true);
    expect(progress.hidden).toBe(false);
    expect(progress.value).toBe(0);
    expect(progress.max).toBe(100);

    overlay.set('Converting… (42%)', 42);
    expect(progress.value).toBe(42);

    // No percentage available (e.g. the RSF compression phase): the
    // indeterminate spinner is shown, unchanged.
    overlay.set('Compressing…');
    expect(spinner.hidden).toBe(false);
    expect(progress.hidden).toBe(true);

    overlay.set(null);
    expect(spinner.hidden).toBe(false);
    expect(progress.hidden).toBe(true);
  });
});

describe('busy indicator during file open', () => {
  it('opens a small file synchronously, with no busy overlay flicker', async () => {
    const calls: Array<string | null> = [];
    const ui = stubUi({ setBusy: (label) => calls.push(label) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);

    const bytes = utf8('x,y\n1,2\n');
    await commands.openFiles([{ name: 'a.csv', bytes, handle: null, size: bytes.length }], {
      confirmNonCsv: false,
    });

    // Small files complete well within LARGE_OPEN_BYTES: no overlay is shown at all.
    expect(calls).toHaveLength(0);
    expect(state.tabs).toHaveLength(1);
  });

  it('shows a labeled busy state for a large file and clears it afterward', async () => {
    const calls: Array<string | null> = [];
    const ui = stubUi({ setBusy: (label) => calls.push(label) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);

    // Real bytes stay tiny (fast to parse in a test); only the reported
    // `size` needs to cross LARGE_OPEN_BYTES to exercise the "large" path.
    const bytes = utf8('x,y\n1,2\n');
    await commands.openFiles([{ name: 'big.csv', bytes, handle: null, size: 500_000 }], {
      confirmNonCsv: false,
    });

    // The busy state is raised (non-null label) and then cleared (null).
    expect(calls.some((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(calls[calls.length - 1]).toBeNull();
    expect(state.tabs).toHaveLength(1);
  });
});
