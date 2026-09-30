// SPDX-License-Identifier: MIT
/**
 * Pieces of the object layer (`./object-layer.ts`) that stand on their own:
 * the right-click menu on a shape, and keeping the Alt key's release after
 * an Alt drag away from the browser.
 *
 * A collaborator of the grid (see `./core.ts`).
 */
import { t } from '../../app/i18n';
import type { CommandId } from '../../app/commands';
import type { Arrangement } from '../../core/workbook/object-arrange';
import { ContextMenu, type ContextMenuEntry } from '../context-menu';
import { AlignStartVertical, ImageDown, Layers } from 'lucide';
import type { GridCore } from './core';

/** The right-click menu on a picked object, at (`x`, `y`). */
export function openObjectMenu(core: GridCore, x: number, y: number): void {
  const item = (command: CommandId, labelKey: string): ContextMenuEntry => ({
    label: t(labelKey),
    disabled: !core.commands.isEnabled(command),
    onSelect: () => void core.commands.run(command),
  });
  core.pointer.closeContextMenu();
  const align = (how: Arrangement): ContextMenuEntry => item(`object.${how}`, `menu.insert.${how}`);
  // Grouped the way Insert > Arrange Objects is, so the menu stays short.
  core.contextMenu = ContextMenu.open(
    [
      item('edit.cut', 'menu.edit.cut'),
      item('edit.copy', 'menu.edit.copy'),
      item('edit.paste', 'menu.edit.paste'),
      'separator',
      {
        label: t('menu.insert.order'),
        icon: Layers,
        submenu: [
          item('object.bringToFront', 'menu.insert.bringToFront'),
          item('object.bringForward', 'menu.insert.bringForward'),
          item('object.sendBackward', 'menu.insert.sendBackward'),
          item('object.sendToBack', 'menu.insert.sendToBack'),
        ],
      },
      {
        label: t('menu.insert.align'),
        icon: AlignStartVertical,
        submenu: [
          ...(
            ['alignLeft', 'alignCenter', 'alignRight', 'alignTop', 'alignMiddle', 'alignBottom'] as const
          ).map(align),
          'separator',
          align('distributeHorizontally'),
          align('distributeVertically'),
        ],
      },
      item('object.group', 'menu.insert.group'),
      item('object.ungroup', 'menu.insert.ungroup'),
      'separator',
      {
        label: t('menu.insert.saveObjects'),
        icon: ImageDown,
        submenu: [
          item('object.saveAsPng', 'menu.insert.saveAsPng'),
          item('object.saveAsSvg', 'menu.insert.saveAsSvg'),
        ],
      },
      item('insert.objectList', 'menu.insert.objectList'),
      'separator',
      item('object.delete', 'menu.insert.deleteObject'),
    ],
    x,
    y,
    { onClose: () => (core.contextMenu = null) },
  );
}

let swallowTimer: ReturnType<typeof setTimeout> | null = null;

function swallowAltUp(event: KeyboardEvent): void {
  if (event.key === 'Alt') {
    event.preventDefault();
  }
  stopSwallowingAlt();
}

function stopSwallowingAlt(): void {
  document.removeEventListener('keyup', swallowAltUp, true);
  if (swallowTimer !== null) {
    clearTimeout(swallowTimer);
    swallowTimer = null;
  }
}

/**
 * After an Alt drag, the Alt key's coming release is the drag's: without
 * this, Windows browsers take it for their own menu and Firefox shows its
 * menu bar. Only the next release (within a few seconds) is kept.
 */
export function swallowNextAltUp(): void {
  stopSwallowingAlt();
  document.addEventListener('keyup', swallowAltUp, true);
  swallowTimer = setTimeout(stopSwallowingAlt, 3000);
}
