// SPDX-License-Identifier: MIT
import { ArrowDown, ArrowUp, Settings2, X } from 'lucide';
import { t } from '../../app/i18n';
import { setToolbarItems } from '../../app/toolbar-prefs';
import { chosenToolbarCommands, toolbarLabel, type ToolbarCommand } from '../app-toolbar';
import { el } from '../dom';
import { createIcon } from '../icon';
import { dialogButton } from './shared';
import { openSidePanel, panelField, panelSection } from './side-panel';

/**
 * View > Customize Toolbar…: the toolbar's commands in order, each movable up
 * or down or removable, a list of every other command to add, and Reset for
 * the default set. Every change is saved (in this browser only) and shown on
 * the toolbar at once; the panel's × closes it.
 */
export function customizeToolbar(available: readonly ToolbarCommand[], onChange: () => void): Promise<null> {
  return openSidePanel<null>(
    { title: t('dialog.toolbar.title'), icon: Settings2, fallback: null },
    (body, buttons) => {
      const list = el('ol', {
        className: 'toolbar-customize-list',
        attrs: { 'aria-label': t('dialog.toolbar.items') },
      });
      const addSelect = el('select', { attrs: { id: 'toolbar-customize-add' } }) as HTMLSelectElement;
      const addButton = dialogButton(t('dialog.toolbar.add'), false, false, () => {
        const id = addSelect.value;
        if (id !== '') {
          save([...current().map((command) => command.id), id], id);
        }
      });
      const current = (): ToolbarCommand[] => chosenToolbarCommands(available);
      /** Save a new order and redraw, keeping focus on `focusId`'s row when given. */
      const save = (ids: readonly string[] | null, focusId?: string, control = 'label'): void => {
        setToolbarItems(ids);
        onChange();
        draw();
        const row = focusId && list.querySelector<HTMLElement>(`[data-command="${focusId}"]`);
        (row ? row.querySelector<HTMLElement>(`[data-control="${control}"]`) : addSelect)?.focus();
      };
      const draw = (): void => {
        const chosen = current();
        const ids = chosen.map((command) => command.id as string);
        list.replaceChildren(
          ...chosen.map((command, i) => {
            const move = (to: number, control: string): void => {
              const next = [...ids];
              next.splice(i, 1);
              next.splice(to, 0, command.id);
              save(next, command.id, control);
            };
            const label = toolbarLabel(command.item);
            const tool = (
              icon: typeof X,
              text: string,
              control: string,
              onClick: () => void,
              off = false,
            ) => {
              const button = el('button', {
                className: 'toolbar-customize-tool',
                attrs: {
                  type: 'button',
                  title: text,
                  'aria-label': `${text}: ${label}`,
                  'data-control': control,
                },
              }) as HTMLButtonElement;
              button.append(createIcon(icon, 'toolbar-customize-icon', 14));
              button.disabled = off;
              button.addEventListener('click', onClick);
              return button;
            };
            return el('li', { className: 'toolbar-customize-row', attrs: { 'data-command': command.id } }, [
              createIcon(command.icon, 'toolbar-customize-icon', 16),
              el('span', {
                className: 'toolbar-customize-label',
                text: label,
                attrs: { tabindex: '-1', 'data-control': 'label' },
              }),
              tool(ArrowUp, t('dialog.toolbar.moveUp'), 'up', () => move(i - 1, 'up'), i === 0),
              tool(
                ArrowDown,
                t('dialog.toolbar.moveDown'),
                'down',
                () => move(i + 1, 'down'),
                i === chosen.length - 1,
              ),
              tool(X, t('dialog.toolbar.remove'), 'remove', () =>
                save(
                  ids.filter((id) => id !== command.id),
                  ids[i + 1] ?? ids[i - 1],
                  'remove',
                ),
              ),
            ]);
          }),
        );
        if (chosen.length === 0) {
          list.append(el('li', { className: 'dialog-note', text: t('dialog.toolbar.empty') }));
        }
        // Every command not on the toolbar, grouped by the menu it is in.
        const groups = new Map<string, HTMLOptGroupElement>();
        for (const command of available) {
          if (ids.includes(command.id)) {
            continue;
          }
          let group = groups.get(command.menuKey);
          if (!group) {
            group = el('optgroup') as HTMLOptGroupElement;
            group.label = t(command.menuKey);
            groups.set(command.menuKey, group);
          }
          group.append(el('option', { text: toolbarLabel(command.item), attrs: { value: command.id } }));
        }
        addSelect.replaceChildren(...groups.values());
        addButton.disabled = groups.size === 0;
      };
      draw();
      body.append(
        el('p', { className: 'dialog-note', text: t('dialog.toolbar.note') }),
        panelSection(t('dialog.toolbar.items'), [list]),
        panelSection(null, [
          panelField(t('dialog.toolbar.addLabel'), addSelect),
          el('div', { className: 'toolbar-customize-add' }, [addButton]),
        ]),
      );
      buttons.append(dialogButton(t('dialog.toolbar.reset'), false, false, () => save(null)));
    },
  );
}
