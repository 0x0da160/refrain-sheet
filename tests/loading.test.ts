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
});

describe('busy indicator during file open', () => {
  it('shows a labeled busy state before parsing and clears it afterward', async () => {
    const calls: Array<string | null> = [];
    const ui = stubUi({ setBusy: (label) => calls.push(label) });
    const state = new AppState();
    const commands = new Commands(state, ui, document);

    await commands.openFiles([{ name: 'a.csv', bytes: utf8('x,y\n1,2\n'), handle: null, size: 8 }], {
      confirmNonCsv: false,
    });

    // The busy state is raised (non-null label) and then cleared (null).
    expect(calls.some((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    expect(calls[calls.length - 1]).toBeNull();
    expect(state.tabs).toHaveLength(1);
  });
});
