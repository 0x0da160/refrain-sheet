// SPDX-License-Identifier: MIT
import type { CommandId, Commands } from '../app/commands';
import { t } from '../app/i18n';
import { el, clearChildren } from './dom';

interface ToolDef {
  labelKey: string;
  command: CommandId;
  shortcut?: string;
}

const TOOLS: Array<ToolDef | 'separator'> = [
  { labelKey: 'menu.file.open', command: 'file.open', shortcut: 'Ctrl+O' },
  { labelKey: 'menu.file.save', command: 'file.save', shortcut: 'Ctrl+S' },
  { labelKey: 'menu.file.saveOptions', command: 'file.saveOptions', shortcut: 'Ctrl+Shift+S' },
  'separator',
  { labelKey: 'menu.edit.undo', command: 'edit.undo', shortcut: 'Ctrl+Z' },
  { labelKey: 'menu.edit.redo', command: 'edit.redo', shortcut: 'Ctrl+Y' },
  'separator',
  { labelKey: 'menu.search.find', command: 'search.find', shortcut: 'Ctrl+F' },
  { labelKey: 'menu.search.replace', command: 'search.replace', shortcut: 'Ctrl+H' },
];

/** Toolbar with prominent buttons for common actions. Runs the same commands as the menus. */
export class Toolbar {
  readonly element: HTMLElement;

  constructor(private readonly commands: Commands) {
    this.element = el('div', { className: 'toolbar', attrs: { role: 'toolbar' } });
    this.render();
  }

  render(): void {
    clearChildren(this.element);
    this.element.setAttribute('aria-label', t('toolbar.label'));
    for (const tool of TOOLS) {
      if (tool === 'separator') {
        this.element.append(el('span', { className: 'sep', attrs: { 'aria-hidden': 'true' } }));
        continue;
      }
      const label = t(tool.labelKey).replace(/…$/, '');
      const button = el('button', {
        text: label,
        attrs: {
          type: 'button',
          title: tool.shortcut ? `${label} (${tool.shortcut})` : label,
        },
      });
      button.disabled = !this.commands.isEnabled(tool.command);
      button.addEventListener('click', () => void this.commands.run(tool.command));
      this.element.append(button);
    }
  }
}
