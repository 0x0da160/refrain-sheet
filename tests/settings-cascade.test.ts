// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Layered display settings: zoom and wrap resolve **browser > file >
 * worksheet**, each level optional, with the last-used value as the fallback.
 * Covers the pure resolver, the RSF file-level `view`, and how AppState
 * resolves, writes, and re-resolves the levels.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Commands, type UiPort } from '../src/app/commands';
import { AppState } from '../src/app/app-state';
import { setBrowserWrap, setBrowserZoom, setSheetZoom } from '../src/app/settings';
import { decodeRsfWorkbook, rsfJsonText } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { resolveSetting, SETTING_PRECEDENCE } from '../src/core/settings-cascade';
import { getSheetFont, setBrowserSheetFont } from '../src/app/sheet-font';
import { resolveSheetFont } from '../src/app/state/view-layers';

beforeEach(() => {
  localStorage.clear();
});

function rsfDoc(): RsfDocument {
  return RsfDocument.empty('b', 3, 2, 'S1');
}

/** Save and reopen, as the file would be read back. */
function reopen(doc: RsfDocument): RsfDocument {
  const decoded = decodeRsfWorkbook(doc.toBytes());
  if (!decoded.ok) throw new Error(decoded.error);
  return RsfDocument.fromWorkbookData(decoded.data, 'b');
}

describe('resolveSetting', () => {
  it('orders the levels sheet, file, browser (narrowest first)', () => {
    expect([...SETTING_PRECEDENCE]).toEqual(['sheet', 'file', 'browser']);
  });

  it('takes the narrowest specified level and reports where it came from', () => {
    expect(resolveSetting({ browser: 1, file: 2, sheet: 3 }, 0)).toEqual({ value: 3, source: 'sheet' });
    expect(resolveSetting({ browser: 1, file: 2 }, 0)).toEqual({ value: 2, source: 'file' });
    expect(resolveSetting({ browser: 1 }, 0)).toEqual({ value: 1, source: 'browser' });
    expect(resolveSetting<number>({}, 0)).toEqual({ value: 0, source: 'default' });
  });

  it('treats false as a specified value', () => {
    expect(resolveSetting({ browser: true, file: false }, true)).toEqual({ value: false, source: 'file' });
  });
});

describe('RSF file-level view', () => {
  it('round-trips zoom and an explicit wrap-off at the top level', () => {
    const doc = rsfDoc();
    doc.fileZoom = 150;
    doc.fileWrap = false;
    const data = decodeOk(doc);
    expect(data.display).toEqual({ zoom: 150, wrap: false });
    expect((JSON.parse(rsfJsonText(data)) as { view?: unknown }).view).toEqual({ zoom: 150, wrap: false });
    const back = reopen(doc);
    expect(back.fileZoom).toBe(150);
    expect(back.fileWrap).toBe(false);
  });

  it('writes no top-level view when the file specifies nothing', () => {
    const doc = rsfDoc();
    const text = rsfJsonText(decodeOk(doc));
    expect((JSON.parse(text) as { view?: unknown }).view).toBeUndefined();
    const back = reopen(doc);
    expect(back.fileZoom).toBeUndefined();
    expect(back.fileWrap).toBeUndefined();
  });

  it('refuses a malformed top-level view', () => {
    const doc = rsfDoc();
    const tree = JSON.parse(rsfJsonText(decodeOk(doc))) as Record<string, unknown>;
    tree.view = { zoom: 'big' };
    const bytes = new TextEncoder().encode(JSON.stringify(tree));
    expect(decodeRsfWorkbook(bytes).ok).toBe(false);
  });
});

function decodeOk(doc: RsfDocument): ReturnType<typeof decodeData> {
  return decodeData(doc.toBytes());
}

function decodeData(bytes: Uint8Array) {
  const decoded = decodeRsfWorkbook(bytes);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.data;
}

describe('AppState: sheet > file > browser', () => {
  it('lets the sheet beat the file, and the file beat the browser default', () => {
    setBrowserZoom(200);
    const state = new AppState();
    expect(state.addTab('a.rsf', rsfDoc(), null).zoom).toBe(200);
    const doc = rsfDoc();
    doc.fileZoom = 125;
    expect(state.addTab('b.rsf', doc, null).zoom).toBe(125);
    doc.activeSheet.displayZoom = 75;
    expect(state.addTab('c.rsf', doc, null).zoom).toBe(75);
  });

  it('falls back to the last-used zoom when no level specifies one', () => {
    setSheetZoom(110);
    const state = new AppState();
    expect(state.addTab('a.rsf', rsfDoc(), null).zoom).toBe(110);
  });

  it('writes a View-menu zoom change to the sheet, which wins', () => {
    setBrowserZoom(90);
    const state = new AppState();
    const doc = rsfDoc();
    doc.fileZoom = 125;
    const tab = state.addTab('a.rsf', doc, null);
    state.setTabZoom(tab, 150);
    expect(doc.activeSheet.displayZoom).toBe(150);
    expect(doc.fileZoom).toBe(125);
    expect(tab.zoom).toBe(150);
    state.reapplyViewSettings();
    expect(tab.zoom).toBe(150);
  });

  it('re-resolves every open tab when the browser default changes', () => {
    const state = new AppState();
    const a = state.addTab('a.rsf', rsfDoc(), null);
    const b = state.addTab('b.rsf', rsfDoc(), null);
    setBrowserWrap(true);
    state.reapplyViewSettings();
    expect(a.wrapCells).toBe(true);
    expect(b.wrapCells).toBe(true);
    setBrowserWrap(undefined);
    state.reapplyViewSettings();
    expect(a.wrapCells).toBe(false);
  });

  it('keeps an inherited file zoom out of the saved worksheet', () => {
    const state = new AppState();
    const doc = rsfDoc();
    doc.fileZoom = 150;
    const tab = state.addTab('a.rsf', doc, null);
    expect(tab.zoom).toBe(150);
    state.addSheet(tab, 'S2');
    expect(doc.sheets[0].displayZoom).toBeUndefined();
  });
});

describe('spreadsheet font: sheet > file > browser', () => {
  it('round-trips the sheet and file fonts through the RSF view', () => {
    const doc = rsfDoc();
    doc.fileFont = 'meiryo-ui';
    doc.activeSheet.displayFont = 'ms';
    const data = decodeOk(doc);
    expect(data.display).toEqual({ font: 'meiryo-ui' });
    expect(data.sheets[0].display).toEqual({ font: 'ms' });
    const back = reopen(doc);
    expect(back.fileFont).toBe('meiryo-ui');
    expect(back.activeSheet.displayFont).toBe('ms');
  });

  it('refuses a malformed font id', () => {
    const tree = JSON.parse(rsfJsonText(decodeOk(rsfDoc()))) as Record<string, unknown>;
    tree.view = { font: '<b>' };
    expect(decodeRsfWorkbook(new TextEncoder().encode(JSON.stringify(tree))).ok).toBe(false);
  });

  it('resolves the narrowest level, skipping ids this release does not know', () => {
    const doc = rsfDoc();
    expect(resolveSheetFont(doc)).toEqual({ value: 'biz-ud', source: 'default' });
    setBrowserSheetFont('ms-ui');
    expect(resolveSheetFont(doc)).toEqual({ value: 'ms-ui', source: 'browser' });
    doc.fileFont = 'noto-sans-jp';
    expect(resolveSheetFont(doc)).toEqual({ value: 'noto-sans-jp', source: 'file' });
    doc.activeSheet.displayFont = 'future-font';
    expect(resolveSheetFont(doc).source).toBe('file');
    doc.activeSheet.displayFont = 'ms';
    expect(resolveSheetFont(doc)).toEqual({ value: 'ms', source: 'sheet' });
    expect(resolveSheetFont(null).value).toBe('ms-ui');
  });

  it('clears the browser font back to the default', () => {
    setBrowserSheetFont('ms');
    setBrowserSheetFont(undefined);
    expect(getSheetFont()).toBe('biz-ud');
  });
});

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn(), ...overrides },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

describe('commands: where font and file-level settings are written', () => {
  it("sets an RSF sheet font from the View menu, and this browser's font for a CSV", async () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const doc = rsfDoc();
    state.addTab('a.rsf', doc, null);
    await commands.run('view.sheetFont.ms');
    expect(doc.activeSheet.displayFont).toBe('ms');
    expect(getSheetFont()).toBe('biz-ud');
    state.closeTab(state.activeTab!.id);
    await commands.run('view.sheetFont.meiryoUi');
    expect(getSheetFont()).toBe('meiryo-ui');
  });

  it("clears the sheets' own values when a file-level value is chosen in Settings", async () => {
    const state = new AppState();
    const doc = rsfDoc();
    doc.activeSheet.displayFont = 'ms';
    doc.activeSheet.displayZoom = 75;
    const chooseSettings = vi.fn(async (current: Parameters<UiPort['chooseSettings']>[0]) => ({
      ...current,
      fileDisplay: { zoom: 125, wrap: undefined, font: 'noto-sans-jp' as const },
    }));
    const commands = new Commands(state, stubUi({ chooseSettings }), document);
    const tab = state.addTab('a.rsf', doc, null);
    await commands.run('app.settings');
    expect(doc.activeSheet.displayFont).toBeUndefined();
    expect(doc.activeSheet.displayZoom).toBeUndefined();
    expect(resolveSheetFont(doc)).toEqual({ value: 'noto-sans-jp', source: 'file' });
    expect(tab.zoom).toBe(125);
  });
});
