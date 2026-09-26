// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  dateStampKeyOf,
  displayShortcut,
  displayShortcutKeys,
  isMacPlatform,
  localDateStamp,
  resolveShortcut,
  SHORTCUT_GROUPS,
  type ShortcutContext,
  type ShortcutKey,
} from '../src/app/shortcuts';
import { CATALOGS } from '../src/app/i18n';

function key(partial: Partial<ShortcutKey>): ShortcutKey {
  return { key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

const GRID: ShortcutContext = { inTextField: false, isComposing: false };
const FIELD: ShortcutContext = { inTextField: true, isComposing: false };

describe('resolveShortcut — recognized accelerators', () => {
  it('maps the file and search commands to non-reserved keys', () => {
    expect(resolveShortcut(key({ key: 's', ctrlKey: true }), GRID)).toBe('file.save');
    expect(resolveShortcut(key({ key: 'S', ctrlKey: true, shiftKey: true }), GRID)).toBe('file.saveOptions');
    expect(resolveShortcut(key({ key: 'o', ctrlKey: true }), GRID)).toBe('file.open');
    expect(resolveShortcut(key({ key: 'f', ctrlKey: true, shiftKey: true }), GRID)).toBe('search.find');
    expect(resolveShortcut(key({ key: 'h', ctrlKey: true, shiftKey: true }), GRID)).toBe('search.replace');
  });

  it('maps editing commands only outside text fields', () => {
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true }), GRID)).toBe('edit.undo');
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true, shiftKey: true }), GRID)).toBe('edit.redo');
    expect(resolveShortcut(key({ key: 'y', ctrlKey: true }), GRID)).toBe('edit.redo');
    expect(resolveShortcut(key({ key: 'd', ctrlKey: true }), GRID)).toBe('edit.fillDown');
    // In a text field the editor/browser keep undo/redo/fill.
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true }), FIELD)).toBeNull();
    expect(resolveShortcut(key({ key: 'd', ctrlKey: true }), FIELD)).toBeNull();
  });

  it('treats Cmd (metaKey) like Ctrl for cross-platform parity', () => {
    expect(resolveShortcut(key({ key: 's', metaKey: true }), GRID)).toBe('file.save');
    expect(resolveShortcut(key({ key: 'f', metaKey: true, shiftKey: true }), GRID)).toBe('search.find');
  });

  it('save and open still work while editing a text field', () => {
    expect(resolveShortcut(key({ key: 's', ctrlKey: true }), FIELD)).toBe('file.save');
    expect(resolveShortcut(key({ key: 'o', ctrlKey: true }), FIELD)).toBe('file.open');
  });
});

describe('resolveShortcut — reserved keys are never intercepted', () => {
  const reserved: Array<[string, ShortcutKey]> = [
    ['Ctrl+N (new window)', key({ key: 'n', ctrlKey: true })],
    ['Ctrl+T (new tab)', key({ key: 't', ctrlKey: true })],
    ['Ctrl+W (close tab)', key({ key: 'w', ctrlKey: true })],
    ['Ctrl+P (print)', key({ key: 'p', ctrlKey: true })],
    ['Ctrl+R (reload)', key({ key: 'r', ctrlKey: true })],
    ['Ctrl+L (address bar)', key({ key: 'l', ctrlKey: true })],
    ['Ctrl+Tab (tab switch)', key({ key: 'Tab', ctrlKey: true })],
    ['Ctrl+PageDown (tab switch)', key({ key: 'PageDown', ctrlKey: true })],
    ['Ctrl+PageUp (tab switch)', key({ key: 'PageUp', ctrlKey: true })],
    ['F5 (reload)', key({ key: 'F5' })],
    ['F6 (address bar)', key({ key: 'F6' })],
    ['F11 (fullscreen)', key({ key: 'F11' })],
    ['F12 (dev tools)', key({ key: 'F12' })],
    ['Ctrl+ + (zoom in)', key({ key: '+', ctrlKey: true })],
  ];
  for (const [name, ev] of reserved) {
    it(`does not intercept ${name}`, () => {
      expect(resolveShortcut(ev, GRID)).toBeNull();
    });
  }
});

describe('resolveShortcut — IME and modifiers', () => {
  it('never fires during IME composition', () => {
    expect(
      resolveShortcut(key({ key: 's', ctrlKey: true }), { inTextField: true, isComposing: true }),
    ).toBeNull();
    expect(resolveShortcut(key({ key: 'Process' }), GRID)).toBeNull();
  });

  it('does not fire when Alt is held (AltGr / OS combinations)', () => {
    expect(resolveShortcut(key({ key: 's', ctrlKey: true, altKey: true }), GRID)).toBeNull();
  });
});

describe('SHORTCUT_GROUPS', () => {
  const rows = SHORTCUT_GROUPS.flatMap((g) => g.items);

  it('every group and documented shortcut has text in both locales', () => {
    for (const key of [...SHORTCUT_GROUPS.map((g) => g.titleKey), ...rows.map((r) => r.descKey)]) {
      expect(CATALOGS.en[key], `missing en ${key}`).toBeTruthy();
      expect(CATALOGS.ja[key], `missing ja ${key}`).toBeTruthy();
    }
  });

  it('does not advertise any browser-reserved accelerator', () => {
    const joined = rows.flatMap((r) => r.keys).join(' | ');
    expect(joined).not.toMatch(/Ctrl\+N\b/);
    expect(joined).not.toMatch(/Ctrl\+T\b/);
    expect(joined).not.toMatch(/Ctrl\+W\b/);
    expect(joined).not.toMatch(/Ctrl\+Tab/);
    expect(joined).not.toMatch(/Ctrl\+PageDown\b/);
  });

  it("shows only the current platform's keys, without duplicates", () => {
    expect(displayShortcutKeys(['Ctrl+Y', 'Ctrl+Shift+Z'], false)).toBe('Ctrl+Y / Ctrl+Shift+Z');
    expect(displayShortcutKeys(['Ctrl+Y', 'Ctrl+Shift+Z'], true)).toBe('Cmd+Shift+Z');
    expect(displayShortcutKeys(['Ctrl+H'], true)).toBe('Cmd+Shift+H');
    expect(displayShortcutKeys(['Alt+Enter'], true)).toBe('Option+Enter');
    expect(displayShortcutKeys(['Ctrl+Shift+4'], true)).toBe('Ctrl+Shift+4');
  });
});

describe('resolveShortcut — Paste Special and date/time keys', () => {
  const IN_GRID: ShortcutContext = { ...GRID, inGrid: true };

  it('Ctrl+Shift+V pastes values by default and formatting when set', () => {
    const v = key({ key: 'V', ctrlKey: true, shiftKey: true });
    expect(resolveShortcut(v, IN_GRID)).toBe('edit.pasteValues');
    expect(resolveShortcut(v, { ...IN_GRID, shiftPaste: 'values' })).toBe('edit.pasteValues');
    expect(resolveShortcut(v, { ...IN_GRID, shiftPaste: 'formats' })).toBe('edit.pasteFormats');
    expect(resolveShortcut(key({ key: 'V', metaKey: true, shiftKey: true }), IN_GRID)).toBe(
      'edit.pasteValues',
    );
  });

  it('leaves Ctrl+Shift+V to text fields and the rest of the page', () => {
    const v = key({ key: 'V', ctrlKey: true, shiftKey: true });
    expect(resolveShortcut(v, FIELD)).toBeNull();
    expect(resolveShortcut(v, { ...GRID, inGrid: false })).toBeNull();
  });

  it('Ctrl+; enters the date and Ctrl+Shift+; the time on US and Japanese layouts', () => {
    expect(resolveShortcut(key({ key: ';', ctrlKey: true }), IN_GRID)).toBe('edit.insertDate');
    // US: Shift+; produces ":" (some browsers report ";" while Cmd is held).
    expect(resolveShortcut(key({ key: ':', ctrlKey: true, shiftKey: true }), IN_GRID)).toBe(
      'edit.insertTime',
    );
    expect(resolveShortcut(key({ key: ';', metaKey: true, shiftKey: true }), IN_GRID)).toBe(
      'edit.insertTime',
    );
    // Japanese: ":" has its own key.
    expect(resolveShortcut(key({ key: ':', ctrlKey: true }), IN_GRID)).toBe('edit.insertTime');
    // Japanese Shift+; produces "+", the browser's zoom-in: never taken.
    expect(resolveShortcut(key({ key: '+', ctrlKey: true, shiftKey: true }), IN_GRID)).toBeNull();
  });

  it('leaves Ctrl+; outside the grid to the browser', () => {
    expect(resolveShortcut(key({ key: ';', ctrlKey: true }), FIELD)).toBeNull();
    expect(resolveShortcut(key({ key: ';', ctrlKey: true }), { ...GRID, inGrid: false })).toBeNull();
    expect(dateStampKeyOf(key({ key: ';', ctrlKey: true, altKey: true }))).toBeNull();
    expect(dateStampKeyOf(key({ key: ';' }))).toBeNull();
  });

  it('stamps the device clock as ISO date and 24-hour time', () => {
    const now = new Date(2026, 8, 5, 7, 3, 59);
    expect(localDateStamp('date', now)).toBe('2026-09-05');
    expect(localDateStamp('time', now)).toBe('07:03');
  });
});

describe('resolveShortcut — spreadsheet keys always win over the browser', () => {
  const contexts: Array<[string, ShortcutContext]> = [
    ['the grid', { ...GRID, inGrid: true }],
    ['a text field', FIELD],
    ['the rest of the page', { ...GRID, inGrid: false }],
  ];
  const cases: Array<[string, ShortcutKey, string]> = [
    ['Ctrl+F', key({ key: 'f', ctrlKey: true }), 'search.find'],
    ['Cmd+F', key({ key: 'f', metaKey: true }), 'search.find'],
    ['Ctrl+Shift+F', key({ key: 'F', ctrlKey: true, shiftKey: true }), 'search.find'],
    ['Ctrl+H', key({ key: 'h', ctrlKey: true }), 'search.replace'],
    ['Cmd+Shift+H', key({ key: 'H', metaKey: true, shiftKey: true }), 'search.replace'],
    ['Ctrl+G', key({ key: 'g', ctrlKey: true }), 'search.goToCell'],
    ['Ctrl+E', key({ key: 'e', ctrlKey: true }), 'edit.flashFill'],
    ['F3', key({ key: 'F3' }), 'search.findNext'],
    ['Shift+F3', key({ key: 'F3', shiftKey: true }), 'search.findPrev'],
  ];
  for (const [name, ev, command] of cases) {
    for (const [where, ctx] of contexts) {
      it(`${name} runs ${command} from ${where}`, () => {
        expect(resolveShortcut(ev, ctx)).toBe(command);
      });
    }
    it(`${name} never fires during IME composition`, () => {
      expect(resolveShortcut(ev, { ...GRID, inGrid: true, isComposing: true })).toBeNull();
    });
  }
});

describe('displayShortcut', () => {
  it('keeps Windows/Linux labels as written', () => {
    expect(displayShortcut('Ctrl+F', false)).toBe('Ctrl+F');
  });
  it('shows Cmd on macOS, with the Mac redo and replace keys', () => {
    expect(displayShortcut('Ctrl+F', true)).toBe('Cmd+F');
    expect(displayShortcut('Ctrl+Shift+S', true)).toBe('Cmd+Shift+S');
    expect(displayShortcut('Ctrl+Y', true)).toBe('Cmd+Shift+Z');
    expect(displayShortcut('Ctrl+H', true)).toBe('Cmd+Shift+H');
    expect(displayShortcut('Ctrl+Alt+PageDown', true)).toBe('Ctrl+Alt+PageDown');
    expect(displayShortcut('F3', true)).toBe('F3');
  });
  it('detects macOS from the navigator', () => {
    expect(isMacPlatform({ platform: 'MacIntel', userAgent: '' })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32', userAgent: '' })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe('resolveShortcut — F9 and worksheet switching', () => {
  it('F9 recalculates outside text fields only', () => {
    expect(resolveShortcut(key({ key: 'F9' }), GRID)).toBe('sheet.recalculate');
    expect(resolveShortcut(key({ key: 'F9' }), FIELD)).toBeNull();
  });
  it('Ctrl+Alt+PageDown / PageUp switch worksheets outside text fields', () => {
    const down = key({ key: 'PageDown', ctrlKey: true, altKey: true });
    const up = key({ key: 'PageUp', ctrlKey: true, altKey: true });
    expect(resolveShortcut(down, GRID)).toBe('worksheet.next');
    expect(resolveShortcut(up, GRID)).toBe('worksheet.prev');
    expect(resolveShortcut(down, FIELD)).toBeNull();
  });
  it('plain Ctrl+PageDown stays browser tab switching', () => {
    expect(resolveShortcut(key({ key: 'PageDown', ctrlKey: true }), GRID)).toBeNull();
  });
});

describe('resolveShortcut — sheet insert, shortcut list, clear formatting', () => {
  it("Shift+F11 inserts a worksheet outside text fields; plain F11 stays the browser's", () => {
    expect(resolveShortcut(key({ key: 'F11', shiftKey: true }), GRID)).toBe('worksheet.add');
    expect(resolveShortcut(key({ key: 'F11' }), GRID)).toBeNull();
    expect(resolveShortcut(key({ key: 'F11', shiftKey: true }), FIELD)).toBeNull();
  });

  it('Ctrl+/ (Cmd+/) opens the shortcut list anywhere', () => {
    expect(resolveShortcut(key({ key: '/', ctrlKey: true }), GRID)).toBe('help.shortcuts');
    expect(resolveShortcut(key({ key: '/', metaKey: true }), FIELD)).toBe('help.shortcuts');
  });

  it('Ctrl+\\ (or the yen key) clears formatting outside text fields', () => {
    expect(resolveShortcut(key({ key: '\\', ctrlKey: true }), GRID)).toBe('format.clear');
    expect(resolveShortcut(key({ key: '\u00a5', ctrlKey: true }), GRID)).toBe('format.clear');
    expect(resolveShortcut(key({ key: '\\', ctrlKey: true }), FIELD)).toBeNull();
  });
});

describe('resolveShortcut — number format presets', () => {
  it('maps Ctrl+Shift+1 / 4 / 5 by physical key, outside text fields only', () => {
    const shifted = (code: string, char: string) => key({ key: char, code, ctrlKey: true, shiftKey: true });
    expect(resolveShortcut(shifted('Digit1', '!'), GRID)).toBe('format.presetNumber');
    expect(resolveShortcut(shifted('Digit4', '$'), GRID)).toBe('format.presetCurrency');
    expect(resolveShortcut(shifted('Digit5', '%'), GRID)).toBe('format.presetPercent');
    expect(resolveShortcut(shifted('Digit1', '!'), FIELD)).toBeNull();
  });

  it('keeps the Control key in macOS labels (Cmd+Shift+4 / 5 are screenshots there)', () => {
    expect(displayShortcut('Ctrl+Shift+4', true)).toBe('Ctrl+Shift+4');
    expect(displayShortcut('Ctrl+Shift+5', true)).toBe('Ctrl+Shift+5');
  });
});

describe('resolveShortcut — F4 / F7 / F8 are not bound', () => {
  it('leaves F4, F7, Shift+F7, and F8 alone (New and Close Tab are menu-only)', () => {
    for (const k of [
      key({ key: 'F4' }),
      key({ key: 'F7' }),
      key({ key: 'F7', shiftKey: true }),
      key({ key: 'F8' }),
    ]) {
      expect(resolveShortcut(k, GRID)).toBeNull();
    }
  });
});
