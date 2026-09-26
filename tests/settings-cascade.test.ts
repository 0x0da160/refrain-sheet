// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Layered display settings: zoom and wrap resolve **browser > file >
 * worksheet**, each level optional, with the last-used value as the fallback.
 * Covers the pure resolver, the RSF file-level `view`, and how AppState
 * resolves, writes, and re-resolves the levels.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/app-state';
import { setBrowserWrap, setBrowserZoom, setSheetZoom } from '../src/app/settings';
import { decodeRsfWorkbook, rsfJsonText } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';
import { resolveSetting, SETTING_PRECEDENCE } from '../src/core/settings-cascade';

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
