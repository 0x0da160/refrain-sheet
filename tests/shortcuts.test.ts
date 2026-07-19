// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { resolveShortcut, SHORTCUT_DOCS, type ShortcutContext, type ShortcutKey } from '../src/app/shortcuts';
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
    expect(resolveShortcut(key({ key: 'F4' }), GRID)).toBe('file.new');
    expect(resolveShortcut(key({ key: 'F8' }), GRID)).toBe('file.closeTab');
  });

  it('maps editing commands only outside text fields', () => {
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true }), GRID)).toBe('edit.undo');
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true, shiftKey: true }), GRID)).toBe('edit.redo');
    expect(resolveShortcut(key({ key: 'y', ctrlKey: true }), GRID)).toBe('edit.redo');
    expect(resolveShortcut(key({ key: 'd', ctrlKey: true }), GRID)).toBe('edit.fillDown');
    // In a text field the editor/browser keep undo/redo/fill.
    expect(resolveShortcut(key({ key: 'z', ctrlKey: true }), FIELD)).toBeNull();
    expect(resolveShortcut(key({ key: 'd', ctrlKey: true }), FIELD)).toBeNull();
    expect(resolveShortcut(key({ key: 'F4' }), FIELD)).toBeNull();
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
    ['Ctrl+F (browser find)', key({ key: 'f', ctrlKey: true })],
    ['Ctrl+H (history)', key({ key: 'h', ctrlKey: true })],
    ['Ctrl+P (print)', key({ key: 'p', ctrlKey: true })],
    ['Ctrl+R (reload)', key({ key: 'r', ctrlKey: true })],
    ['Ctrl+L (address bar)', key({ key: 'l', ctrlKey: true })],
    ['Ctrl+Tab (tab switch)', key({ key: 'Tab', ctrlKey: true })],
    ['Ctrl+PageDown (tab switch)', key({ key: 'PageDown', ctrlKey: true })],
    ['Ctrl+PageUp (tab switch)', key({ key: 'PageUp', ctrlKey: true })],
    ['F3 (browser find next)', key({ key: 'F3' })],
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

describe('SHORTCUT_DOCS', () => {
  it('every documented shortcut has a description in both locales', () => {
    for (const { descKey } of SHORTCUT_DOCS) {
      expect(CATALOGS.en[descKey], `missing en ${descKey}`).toBeTruthy();
      expect(CATALOGS.ja[descKey], `missing ja ${descKey}`).toBeTruthy();
    }
  });

  it('does not advertise any browser-reserved accelerator', () => {
    const joined = SHORTCUT_DOCS.map((s) => s.keys).join(' | ');
    expect(joined).not.toMatch(/Ctrl\+F\b/);
    expect(joined).not.toMatch(/Ctrl\+H\b/);
    expect(joined).not.toMatch(/Ctrl\+N\b/);
    expect(joined).not.toMatch(/Ctrl\+W\b/);
    expect(joined).not.toMatch(/Ctrl\+Tab/);
  });
});
