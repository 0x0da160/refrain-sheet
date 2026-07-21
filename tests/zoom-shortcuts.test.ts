// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Spreadsheet-zoom keyboard shortcuts and Ctrl/Cmd + mouse wheel. All routes
 * drive the same shared zoom command/state; browser zoom keys (Ctrl +/-/0)
 * are never intercepted, and the wheel gesture is consumed only over the grid
 * and never during text entry / IME / another pointer interaction.
 */
import { describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { nextZoomLevel } from '../src/app/settings';
import { resolveShortcut, type ShortcutKey } from '../src/app/shortcuts';
import { Grid } from '../src/ui/grid';
import { RsfDocument } from '../src/core/rsf-document';

function key(over: Partial<ShortcutKey>): ShortcutKey {
  return { key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

function stubUi(): UiPort {
  return {
    confirmValidation: async () => true,
    confirmUnsaved: async () => 'discard',
    chooseSaveOptions: async () => null,
    confirmUnrepresentable: async () => false,
    notifyNcr: async () => undefined,
    confirmUndecodableEdit: async () => true,
    chooseReopen: async () => null,
    confirmConvert: async () => true,
    explainRsfSave: async () => true,
    chooseRsfSave: async () => 2,
    chooseExportCsv: async () => null,
    chooseInsertShift: async () => null,
    confirmFlashFill: async () => false,
    chooseFilter: async () => null,
    confirm: async () => true,
    showMessage: async () => undefined,
    notify: () => undefined,
    openFindBar: () => undefined,
    findNext: () => undefined,
    showAbout: () => undefined,
    showFormulaHelp: () => undefined,
    chooseSettings: async () => null,
    setBusy: () => undefined,
  };
}

describe('nextZoomLevel', () => {
  it('steps through the presets and clamps at the ends', () => {
    expect(nextZoomLevel(100, 1)).toBe(110);
    expect(nextZoomLevel(100, -1)).toBe(90);
    expect(nextZoomLevel(200, 1)).toBe(200); // clamp high
    expect(nextZoomLevel(50, -1)).toBe(50); // clamp low
    // A non-preset (restored from an RSF file) still steps to the next preset.
    expect(nextZoomLevel(105, 1)).toBe(110);
    expect(nextZoomLevel(105, -1)).toBe(100);
  });
});

describe('zoom keyboard shortcuts', () => {
  const ctx = { inTextField: false, isComposing: false, inGrid: true };

  it('maps Ctrl+Shift+. / , / 0 to zoom in / out / reset via the physical key', () => {
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, code: 'Period', key: '>' }), ctx)).toBe(
      'view.zoom.in',
    );
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, code: 'Comma', key: '<' }), ctx)).toBe(
      'view.zoom.out',
    );
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, code: 'Digit0', key: ')' }), ctx)).toBe(
      'view.zoom.reset',
    );
  });

  it('never intercepts the browser zoom keys Ctrl +/-/0', () => {
    expect(resolveShortcut(key({ ctrlKey: true, code: 'Equal', key: '=' }), ctx)).toBeNull();
    expect(resolveShortcut(key({ ctrlKey: true, code: 'Minus', key: '-' }), ctx)).toBeNull();
    expect(resolveShortcut(key({ ctrlKey: true, code: 'Digit0', key: '0' }), ctx)).toBeNull();
  });

  it('does not fire while a text field has focus', () => {
    const textCtx = { inTextField: true, isComposing: false, inGrid: false };
    expect(resolveShortcut(key({ ctrlKey: true, shiftKey: true, code: 'Period' }), textCtx)).toBeNull();
  });
});

describe('Ctrl/Cmd + mouse wheel', () => {
  function setup() {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const grid = new Grid(state, commands);
    Object.defineProperty(grid.element, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(grid.element, 'clientWidth', { value: 600, configurable: true });
    document.body.append(grid.element);
    const doc = RsfDocument.empty('t.rsf', 40, 8);
    const tab = state.addTab('t.rsf', doc, null);
    grid.refresh();
    return { state, grid, tab };
  }

  it('zooms in on Ctrl+wheel-up and out on Ctrl+wheel-down (preventing the default)', () => {
    const { tab, grid } = setup();
    expect(tab.zoom).toBe(100);
    const up = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true });
    grid.element.dispatchEvent(up);
    expect(tab.zoom).toBe(110);
    expect(up.defaultPrevented).toBe(true);

    const down = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true, bubbles: true });
    grid.element.dispatchEvent(down);
    expect(tab.zoom).toBe(100);
    expect(down.defaultPrevented).toBe(true);
  });

  it('leaves a plain (unmodified) wheel scroll alone', () => {
    const { tab, grid } = setup();
    const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    grid.element.dispatchEvent(plain);
    expect(tab.zoom).toBe(100);
    expect(plain.defaultPrevented).toBe(false);
  });
});
