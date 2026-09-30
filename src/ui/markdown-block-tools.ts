// SPDX-License-Identifier: MIT
/**
 * The hover tools beside each block of the Markdown visual editor
 * (`markdown-visual.ts`): a grip to drag the block elsewhere, and buttons
 * to move it up or down, add a paragraph below it, or delete it. They sit
 * outside the editable text (`contenteditable="false"`), so nothing typed or
 * selected ever reaches them.
 */
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, type IconNode } from 'lucide';
import { t } from '../app/i18n';
import { el } from './dom';
import { createIcon } from './icon';

/** What a block's tools do; the editor looks up which block from the row they sit in. */
export type BlockAction = 'up' | 'down' | 'add' | 'delete';

/** The tools for one block row: `act` runs a button, `drag` starts a drag from the grip. */
export function buildBlockTools(
  act: (action: BlockAction) => void,
  drag: (event: DragEvent) => void,
): HTMLElement[] {
  const grip = el('span', {
    className: 'markdown-block-grip',
    attrs: { draggable: 'true', title: t('dialog.markdownEditor.dragBlock'), 'aria-hidden': 'true' },
  });
  grip.append(createIcon(GripVertical, '', 14));
  grip.addEventListener('dragstart', drag);
  const button = (icon: IconNode, labelKey: string, action: BlockAction): HTMLButtonElement => {
    const label = t(labelKey);
    const node = el('button', {
      className: `markdown-block-tool markdown-block-${action}`,
      attrs: { type: 'button', title: label, 'aria-label': label },
    }) as HTMLButtonElement;
    node.append(createIcon(icon, '', 14));
    // Pressing a tool must not move the caret out of the text first.
    node.addEventListener('mousedown', (event) => event.preventDefault());
    node.addEventListener('click', () => act(action));
    return node;
  };
  const buttons = el('div', { className: 'markdown-block-tools', attrs: { contenteditable: 'false' } }, [
    button(ArrowUp, 'dialog.markdownEditor.moveBlockUp', 'up'),
    button(ArrowDown, 'dialog.markdownEditor.moveBlockDown', 'down'),
    button(Plus, 'dialog.markdownEditor.addBlock', 'add'),
    button(Trash2, 'dialog.markdownEditor.deleteBlock', 'delete'),
  ]);
  const gutter = el('div', { className: 'markdown-block-gutter', attrs: { contenteditable: 'false' } }, [
    grip,
  ]);
  return [gutter, buttons];
}
