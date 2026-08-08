// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Viewport-aware placement (`positionPopup`) and the shared `ContextMenu`
 * surface: flip/clamp near edges, scrollable when taller than the viewport,
 * keyboard navigation and dismissal, submenu open/flip, and the View-menu
 * Spreadsheet Zoom submenu wiring.
 */
import { Grid3x3, PaintBucket } from 'lucide';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { positionPopup } from '../src/ui/popup';
import { ContextMenu, closeAllContextMenus } from '../src/ui/context-menu';
import { defaultMenus, type MenuChecks, type MenuDef, type MenuItemDef } from '../src/ui/menu-bar';

function sizedMenu(width: number, height: number): HTMLElement {
  const node = document.createElement('div');
  node.style.position = 'fixed';
  // jsdom has no layout; stub the measured rect.
  node.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect;
  document.body.append(node);
  return node;
}

beforeEach(() => {
  document.body.textContent = '';
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  // No visualViewport in jsdom by default → the innerWidth/innerHeight path.
});

describe('positionPopup', () => {
  it('places a menu at the pointer when it fits', () => {
    const node = sizedMenu(180, 200);
    const r = positionPopup(node, { kind: 'point', x: 100, y: 100 });
    expect(r.left).toBe(100);
    expect(r.top).toBe(100);
    expect(r.flippedX).toBe(false);
  });

  it('flips horizontally and vertically near the far corner', () => {
    const node = sizedMenu(180, 200);
    const r = positionPopup(node, { kind: 'point', x: 990, y: 790 });
    // Mirrored to open up-and-left so it stays fully visible.
    expect(r.flippedX).toBe(true);
    expect(r.flippedY).toBe(true);
    expect(r.left).toBe(990 - 180);
    expect(r.top).toBe(790 - 200);
  });

  it('clamps into the viewport when neither side fits', () => {
    const node = sizedMenu(180, 200);
    const r = positionPopup(node, { kind: 'point', x: 950, y: 100 });
    // 950 + 180 overflows and 950 - 180 = 770 fits, so it flips left here;
    // the key property is that it never exceeds the right edge.
    expect(r.left + 180).toBeLessThanOrEqual(1000);
  });

  it('caps the height and makes the surface scrollable when taller than the viewport', () => {
    const node = sizedMenu(180, 2000);
    const r = positionPopup(node, { kind: 'point', x: 100, y: 100 });
    expect(r.scrollable).toBe(true);
    expect(node.style.overflowY).toBe('auto');
    expect(node.style.maxHeight).not.toBe('');
  });

  it('opens a submenu beside its parent and mirrors when it would overflow', () => {
    const node = sizedMenu(180, 200);
    // Parent near the right edge → the submenu flips to the parent's left.
    const r = positionPopup(node, {
      kind: 'beside',
      rect: { left: 850, top: 100, right: 990, bottom: 130 },
    });
    expect(r.flippedX).toBe(true);
  });
});

describe('ContextMenu', () => {
  it('opens, focuses the first enabled item, and closes on Escape', () => {
    const onSelect = vi.fn();
    const menu = ContextMenu.open(
      [{ label: 'One', onSelect }, 'separator', { label: 'Two', disabled: true }],
      100,
      100,
    );
    const items = document.querySelectorAll('.context-menu .menu-item');
    expect(items.length).toBe(2);
    expect(document.activeElement).toBe(items[0]);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.context-menu')).toBeNull();
    void menu;
  });

  it('runs a selected item after closing', () => {
    const onSelect = vi.fn();
    ContextMenu.open([{ label: 'Go', onSelect }], 10, 10);
    (document.querySelector('.context-menu .menu-item') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('opens a submenu on ArrowRight', () => {
    ContextMenu.open(
      [
        {
          label: 'More',
          submenu: [{ label: 'Nested', onSelect: vi.fn() }],
        },
      ],
      10,
      10,
    );
    const parent = document.querySelector('.context-menu .menu-item') as HTMLButtonElement;
    parent.focus();
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const submenus = document.querySelectorAll('.context-menu.submenu');
    expect(submenus.length).toBe(1);
    expect(submenus[0].textContent).toContain('Nested');
  });

  it('renders a shortcut hint next to an item that has one, and an empty one otherwise', () => {
    ContextMenu.open(
      [
        { label: 'Copy', shortcut: 'Ctrl+C', onSelect: vi.fn() },
        { label: 'Copy as image', onSelect: vi.fn() },
      ],
      10,
      10,
    );
    const shortcuts = document.querySelectorAll('.context-menu .menu-item .shortcut');
    expect(shortcuts[0].textContent).toBe('Ctrl+C');
    expect(shortcuts[1].textContent).toBe('');
  });

  it('renders a submenu arrow instead of a shortcut span for a submenu parent', () => {
    ContextMenu.open([{ label: 'More', submenu: [{ label: 'Nested', onSelect: vi.fn() }] }], 10, 10);
    const parent = document.querySelector('.context-menu .menu-item') as HTMLButtonElement;
    expect(parent.querySelector('.shortcut')).toBeNull();
    expect(parent.querySelector('.submenu-arrow')).not.toBeNull();
  });

  it('closeAllContextMenus dismisses every open menu', () => {
    ContextMenu.open([{ label: 'A' }], 10, 10);
    expect(document.querySelector('.context-menu')).not.toBeNull();
    closeAllContextMenus();
    expect(document.querySelector('.context-menu')).toBeNull();
  });
});

describe('ContextMenu toolbar (#240)', () => {
  it('renders a toolbar row above the item list, reflecting checked/disabled state', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [
        { icon: 'B', label: 'Bold', checked: true, onSelect: vi.fn() },
        { icon: 'I', label: 'Italic', disabled: true, onSelect: vi.fn() },
      ],
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('.context-menu-toolbar .toolbar-item');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-label')).toBe('Bold');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].classList.contains('active')).toBe(true);
    expect(buttons[1].disabled).toBe(true);
    // A separator sits between the toolbar and the item list below it.
    expect(document.querySelector('.context-menu > .menu-separator')).not.toBeNull();
  });

  it('renders a Lucide IconNode toolbar item as an SVG, distinct per icon (#294)', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [
        { icon: PaintBucket, label: 'Background color', onSelect: vi.fn() },
        { icon: Grid3x3, label: 'Borders', onSelect: vi.fn() },
      ],
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('.context-menu-toolbar .toolbar-item');
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      expect(button.textContent).toBe('');
      const svg = button.querySelector('svg.toolbar-item-icon');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    }
    // The two icons must render visibly different markup, not the same glyph twice.
    expect(buttons[0].innerHTML).not.toBe(buttons[1].innerHTML);
  });

  it('shows disabledReason as the tooltip when disabled, falling back to label otherwise', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [
        { icon: 'B', label: 'Bold', disabled: true, disabledReason: 'Needs RSF', onSelect: vi.fn() },
        { icon: 'I', label: 'Italic', onSelect: vi.fn() },
      ],
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('.context-menu-toolbar .toolbar-item');
    expect(buttons[0].title).toBe('Needs RSF');
    expect(buttons[1].title).toBe('Italic');
  });

  it('omits the separator when the toolbar has no items below it', () => {
    ContextMenu.open([], 10, 10, { toolbar: [{ icon: 'B', label: 'Bold', onSelect: vi.fn() }] });
    expect(document.querySelector('.context-menu > .menu-separator')).toBeNull();
  });

  it('focuses the first enabled toolbar button on open, skipping the list', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [{ icon: 'B', label: 'Bold', onSelect: vi.fn() }],
    });
    expect(document.activeElement).toBe(document.querySelector('.toolbar-item'));
  });

  it('runs onSelect and closes the menu when a toolbar button is clicked', () => {
    const onSelect = vi.fn();
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [{ icon: 'B', label: 'Bold', onSelect }],
    });
    (document.querySelector('.toolbar-item') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('moves focus between toolbar buttons with ArrowRight/ArrowLeft and closes on Escape', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [
        { icon: 'B', label: 'Bold', onSelect: vi.fn() },
        { icon: 'I', label: 'Italic', onSelect: vi.fn() },
      ],
    });
    const buttons = document.querySelectorAll<HTMLButtonElement>('.toolbar-item');
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('moves focus from the toolbar into the item list on ArrowDown', () => {
    ContextMenu.open([{ label: 'Copy', onSelect: vi.fn() }], 10, 10, {
      toolbar: [{ icon: 'B', label: 'Bold', onSelect: vi.fn() }],
    });
    const toolbarButton = document.querySelector('.toolbar-item') as HTMLButtonElement;
    toolbarButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('.menu-item'));
  });
});

describe('View menu Spreadsheet Zoom submenu', () => {
  const checks = (): MenuChecks => ({
    wrap: () => false,
    stickyFirstRow: () => false,
    stickyFirstColumn: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    zoom: () => 100,
    editHints: () => true,
    formatActive: () => false,
  });

  it('nests every zoom control under a Spreadsheet Zoom submenu', () => {
    const view = defaultMenus(checks()).find((m) => m.labelKey === 'menu.view') as MenuDef;
    const items = view.items.filter((i): i is MenuItemDef => i !== 'separator');
    const zoom = items.find((i) => i.labelKey === 'menu.view.zoom');
    expect(zoom).toBeDefined();
    expect(zoom!.submenu).toBeDefined();
    const sub = zoom!.submenu!.filter((i): i is MenuItemDef => i !== 'separator');
    // Zoom In / Out / Reset plus the presets all live in the submenu, and the
    // top level no longer carries a bare zoom command.
    expect(sub.some((i) => i.command === 'view.zoom.in')).toBe(true);
    expect(sub.some((i) => i.command === 'view.zoom.reset')).toBe(true);
    expect(sub.some((i) => i.command === 'view.zoom.100')).toBe(true);
    expect(items.some((i) => i.command === 'view.zoom.in')).toBe(false);
  });
});
