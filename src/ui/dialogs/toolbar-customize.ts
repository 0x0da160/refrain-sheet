// SPDX-License-Identifier: MIT
import { ArrowDown, ArrowUp, GripVertical, Settings2, X } from 'lucide';
import { t } from '../../app/i18n';
import { setToolbarItems } from '../../app/toolbar-prefs';
import { chosenToolbarCommands, toolbarLabel, type ToolbarCommand } from '../app-toolbar';
import { el } from '../dom';
import { createIcon } from '../icon';
import { installTooltips } from '../tooltip';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';
import { formField, formSection } from './form-layout';

/**
 * View > Customize Toolbar…: the toolbar's commands in order, each movable up
 * or down (with its buttons, or by dragging its grip) or removable, a list of every other command to add, and Reset for
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
      installTooltips(list);
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
              dragGrip(list, i, (to) => move(to, 'label')),
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
        formSection(t('dialog.toolbar.items'), [list]),
        formSection(null, [
          formField(t('dialog.toolbar.addLabel'), addSelect),
          el('div', { className: 'toolbar-customize-add' }, [addButton]),
        ]),
      );
      buttons.append(dialogButton(t('dialog.toolbar.reset'), false, false, () => save(null)));
    },
  );
}

/** The grip at the start of row `index` that drags it (see {@link dragRow}). */
function dragGrip(list: HTMLElement, index: number, drop: (to: number) => void): HTMLElement {
  const grip = el('span', {
    className: 'toolbar-customize-grip',
    attrs: { 'aria-hidden': 'true', 'data-tooltip': t('dialog.toolbar.drag') },
  });
  grip.append(createIcon(GripVertical, 'toolbar-customize-icon', 14));
  grip.addEventListener('pointerdown', (event) => dragRow(list, event, index, drop));
  return grip;
}

/**
 * Drag a row of `list` by its grip: the row follows the pointer, a line marks
 * where it will land, and releasing calls `drop` with its new index (Escape
 * leaves it where it was). The Up/Down buttons stay the keyboard way to do
 * the same.
 */
function dragRow(list: HTMLElement, event: PointerEvent, from: number, drop: (to: number) => void): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  const rows = [...list.querySelectorAll<HTMLElement>('.toolbar-customize-row')];
  const row = rows[from];
  const grip = event.currentTarget as HTMLElement;
  grip.setPointerCapture?.(event.pointerId);
  row.classList.add('dragging');
  const startY = event.clientY;
  let to = from;
  // The first row whose middle is below the pointer takes the dragged row's place.
  const targetAt = (y: number): number => {
    const index = rows.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    const at = index < 0 ? rows.length : index;
    return at > from ? at - 1 : at;
  };
  const mark = (): void => {
    rows.forEach((r, k) => {
      r.classList.toggle('drop-before', k !== from && k === to && to < from);
      r.classList.toggle('drop-after', k !== from && k === to && to > from);
    });
  };
  const move = (e: PointerEvent): void => {
    row.style.translate = `0 ${e.clientY - startY}px`;
    to = targetAt(e.clientY);
    mark();
  };
  const finish = (commit: boolean): void => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
    row.classList.remove('dragging');
    row.style.translate = '';
    const target = to;
    to = from;
    mark();
    if (commit && target !== from) {
      drop(target);
    }
  };
  const up = (): void => finish(true);
  const cancel = (): void => finish(false);
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Cancels the drag only, not the panel.
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key, true);
}
