// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The grid look (banded rows and their strength, gridlines, the selected
 * row/column highlight): layered sheet > file > browser like zoom and wrap,
 * stored in the RSF `view`, and applied as attributes on the document root.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { applyGridLook, getBrowserGridLook, setBrowserGridLook } from '../src/app/grid-look';
import { resolveGridLook } from '../src/app/state/view-layers';
import { DEFAULT_GRID_LOOK, resolveGridLook as resolveLayers } from '../src/core/grid-look';
import { decodeRsfWorkbook, rsfJsonText } from '../src/core/rsf-codec';
import { RsfDocument } from '../src/core/rsf-document';

beforeEach(() => {
  localStorage.clear();
});

function rsfDoc(): RsfDocument {
  return RsfDocument.empty('b', 3, 2, 'S1');
}

function decodeData(bytes: Uint8Array) {
  const decoded = decodeRsfWorkbook(bytes);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.data;
}

function reopen(doc: RsfDocument): RsfDocument {
  return RsfDocument.fromWorkbookData(decodeData(doc.toBytes()), 'b');
}

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return new Proxy(
    { notify: vi.fn(), setBusy: vi.fn(), ...overrides },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn(async () => null)),
    },
  ) as unknown as UiPort;
}

describe('grid look defaults and resolution', () => {
  it('defaults to no bands at the light level, gridlines on, row highlight only', () => {
    expect(DEFAULT_GRID_LOOK).toEqual({
      bands: false,
      bandLevel: 1,
      gridlines: true,
      rowHighlight: true,
      colHighlight: false,
    });
    expect(resolveGridLook(null)).toEqual(DEFAULT_GRID_LOOK);
  });

  it('resolves each key on its own, narrowest level first', () => {
    expect(
      resolveLayers({
        browser: { bands: true, bandLevel: 3, colHighlight: true },
        file: { bandLevel: 2, gridlines: false },
        sheet: { bandLevel: 1, rowHighlight: false },
      }),
    ).toEqual({ bands: true, bandLevel: 1, gridlines: false, rowHighlight: false, colHighlight: true });
  });

  it('uses the sheet, then the file, then this browser for an RSF document', () => {
    setBrowserGridLook({ bands: true, gridlines: false });
    const doc = rsfDoc();
    expect(resolveGridLook(doc).gridlines).toBe(false);
    doc.fileLook = { gridlines: true };
    expect(resolveGridLook(doc).gridlines).toBe(true);
    doc.activeSheet.displayLook = { gridlines: false };
    expect(resolveGridLook(doc).gridlines).toBe(false);
    expect(resolveGridLook(doc).bands).toBe(true);
  });
});

describe("this browser's level", () => {
  it('keeps the key View > Banded Rows always used, and clears unset keys', () => {
    localStorage.setItem('refrain-csv-html.bandedRows', '1');
    expect(getBrowserGridLook()).toEqual({ bands: true });
    setBrowserGridLook({ bandLevel: 2, colHighlight: true });
    expect(localStorage.getItem('refrain-csv-html.bandedRows')).toBeNull();
    expect(getBrowserGridLook()).toEqual({ bandLevel: 2, colHighlight: true });
  });

  it('ignores a stored band level outside 1-3', () => {
    localStorage.setItem('refrain-csv-html.bandLevel', '7');
    expect(getBrowserGridLook()).toEqual({});
  });

  it('applies the look as root attributes', () => {
    const root = document.documentElement;
    applyGridLook({ bands: true, bandLevel: 3, gridlines: false, rowHighlight: false, colHighlight: true });
    expect(root.hasAttribute('data-banded-rows')).toBe(true);
    expect(root.getAttribute('data-band-level')).toBe('3');
    expect(root.hasAttribute('data-no-gridlines')).toBe(true);
    expect(root.hasAttribute('data-row-highlight')).toBe(false);
    expect(root.hasAttribute('data-col-highlight')).toBe(true);
    applyGridLook(DEFAULT_GRID_LOOK);
    expect(root.hasAttribute('data-banded-rows')).toBe(false);
    expect(root.getAttribute('data-band-level')).toBe('1');
    expect(root.hasAttribute('data-no-gridlines')).toBe(false);
    expect(root.hasAttribute('data-row-highlight')).toBe(true);
    expect(root.hasAttribute('data-col-highlight')).toBe(false);
  });
});

describe('RSF view keys', () => {
  it('round-trips the file and sheet looks, false values included', () => {
    const doc = rsfDoc();
    doc.fileLook = { bands: true, bandLevel: 2 };
    doc.activeSheet.displayLook = { gridlines: false, colHighlight: true };
    const data = decodeData(doc.toBytes());
    const tree = JSON.parse(rsfJsonText(data)) as {
      view?: unknown;
      sheets: Array<{ view?: unknown }>;
    };
    expect(tree.view).toEqual({ bands: true, bandLevel: 2 });
    expect(tree.sheets[0].view).toEqual({ gridlines: false, colHighlight: true });
    const back = reopen(doc);
    expect(back.fileLook).toEqual({ bands: true, bandLevel: 2 });
    expect(back.activeSheet.displayLook).toEqual({ gridlines: false, colHighlight: true });
  });

  it('writes no view when nothing is specified', () => {
    const tree = JSON.parse(rsfJsonText(decodeData(rsfDoc().toBytes()))) as {
      view?: unknown;
      sheets: Array<{ view?: unknown }>;
    };
    expect(tree.view).toBeUndefined();
    expect(tree.sheets[0].view).toBeUndefined();
  });

  it('refuses a band level outside 1-3 or a non-boolean toggle', () => {
    const base = JSON.parse(rsfJsonText(decodeData(rsfDoc().toBytes()))) as Record<string, unknown>;
    for (const view of [{ bandLevel: 4 }, { bandLevel: '2' }, { gridlines: 'no' }]) {
      const tree = { ...base, view };
      expect(decodeRsfWorkbook(new TextEncoder().encode(JSON.stringify(tree))).ok).toBe(false);
    }
  });
});

describe('commands', () => {
  it("toggles the RSF sheet's own value from the View menu, and this browser's otherwise", async () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const doc = rsfDoc();
    doc.fileLook = { bands: true };
    state.addTab('a.rsf', doc, null);
    await commands.run('view.bandedRows');
    await commands.run('view.highlightCol');
    expect(doc.activeSheet.displayLook).toEqual({ bands: false, colHighlight: true });
    expect(doc.fileLook).toEqual({ bands: true });
    expect(getBrowserGridLook()).toEqual({});
    state.closeTab(state.activeTab!.id);
    await commands.run('view.gridlines');
    await commands.run('view.highlightRow');
    expect(getBrowserGridLook()).toEqual({ gridlines: false, rowHighlight: false });
  });

  it("saves both levels from Settings and clears the sheets' own changed keys", async () => {
    const state = new AppState();
    const doc = rsfDoc();
    doc.activeSheet.displayLook = { bands: false, gridlines: false };
    const chooseSettings = vi.fn(async (current: Parameters<UiPort['chooseSettings']>[0]) => ({
      ...current,
      browserDisplay: { ...current.browserDisplay, look: { bandLevel: 3 as const } },
      fileDisplay: { ...current.fileDisplay!, look: { bands: true } },
    }));
    const commands = new Commands(state, stubUi({ chooseSettings }), document);
    state.addTab('a.rsf', doc, null);
    await commands.run('app.settings');
    expect(getBrowserGridLook()).toEqual({ bandLevel: 3 });
    expect(doc.fileLook).toEqual({ bands: true });
    expect(doc.activeSheet.displayLook).toEqual({ gridlines: false });
    expect(resolveGridLook(doc)).toMatchObject({ bands: true, bandLevel: 3, gridlines: false });
  });
});
