// SPDX-License-Identifier: MIT
import { ArrowDown, ArrowUp, GripVertical, PanelBottom } from 'lucide';
import { t } from '../../app/i18n';
import {
  getStatusItemOrder,
  getStatusItemPlace,
  setStatusItemOrder,
  setStatusItemPlace,
  STATUS_ITEM_PLACES,
  type StatusItemId,
  type StatusItemPlace,
} from '../../app/status-bar-prefs';
import { el } from '../dom';
import { createIcon } from '../icon';
import { installTooltips } from '../tooltip';
import { dialogButton } from './shared';
import { openSidePanel, panelSection } from './side-panel';

type Groups = Record<StatusItemPlace, StatusItemId[]>;

/** The items in each place, each in the user's order. */
function currentGroups(): Groups {
  const order = getStatusItemOrder();
  const groups: Groups = { bar: [], details: [], hidden: [] };
  for (const id of order) {
    groups[getStatusItemPlace(id)].push(id);
  }
  return groups;
}

/** Save every item's place and the order, as `groups` lists them. */
function saveGroups(groups: Groups): void {
  for (const place of STATUS_ITEM_PLACES) {
    for (const id of groups[place]) {
      setStatusItemPlace(id, place);
    }
  }
  setStatusItemOrder(STATUS_ITEM_PLACES.flatMap((place) => groups[place]));
}

/** Where a dragged item would land: a place and an index in its list. */
interface DropTarget {
  place: StatusItemPlace;
  index: number;
}

/**
 * View > Customize Status Bar…: the items in three lists — shown in the bar,
 * shown behind the bar's Details button, and not shown. Dragging an item by
 * its grip moves it within a list or to another one; the bar and Details
 * show their items in the order listed. Up/Down and each item's place list
 * do the same from the keyboard. Every change is saved (in this browser
 * only) and shown at once; the panel's × closes it.
 */
export function customizeStatusBar(onChange: () => void): Promise<null> {
  return openSidePanel<null>(
    { title: t('dialog.statusBar.title'), icon: PanelBottom, fallback: null },
    (body, buttons) => {
      const list = (place: StatusItemPlace): HTMLElement =>
        el('ol', {
          className: 'toolbar-customize-list status-customize-list',
          attrs: { 'data-place': place, 'aria-label': t(`dialog.statusBar.place.${place}`) },
        });
      const lists: Record<StatusItemPlace, HTMLElement> = {
        bar: list('bar'),
        details: list('details'),
        hidden: list('hidden'),
      };

      /** Save `groups`, redraw, and put the keyboard back on `focusId`'s `control`. */
      const save = (groups: Groups | null, focusId?: StatusItemId, control = 'label'): void => {
        if (groups) {
          saveGroups(groups);
        } else {
          for (const id of getStatusItemOrder()) {
            setStatusItemPlace(id, 'bar');
          }
          setStatusItemOrder(null);
        }
        onChange();
        draw();
        if (focusId) {
          body.querySelector<HTMLElement>(`[data-item="${focusId}"] [data-control="${control}"]`)?.focus();
        }
      };

      const draw = (): void => {
        const groups = currentGroups();
        for (const place of STATUS_ITEM_PLACES) {
          const ids = groups[place];
          lists[place].replaceChildren(
            ...ids.map((id, i) => itemRow({ groups, place, id, i, count: ids.length, lists, save })),
            ...(ids.length === 0
              ? [
                  el('li', {
                    className: 'dialog-note status-customize-empty',
                    text: t('dialog.statusBar.empty'),
                  }),
                ]
              : []),
          );
        }
      };

      draw();
      installTooltips(body);
      body.append(
        el('p', { className: 'dialog-note', text: t('dialog.statusBar.note') }),
        ...STATUS_ITEM_PLACES.map((place) =>
          panelSection(t(`dialog.statusBar.place.${place}`), [lists[place]]),
        ),
      );
      buttons.append(dialogButton(t('dialog.statusBar.reset'), false, false, () => save(null)));
    },
  );
}

/** What one item's row needs: where it is, and how to save a move. */
interface RowContext {
  groups: Groups;
  place: StatusItemPlace;
  id: StatusItemId;
  i: number;
  count: number;
  lists: Record<StatusItemPlace, HTMLElement>;
  save: (groups: Groups, focusId: StatusItemId, control?: string) => void;
}

/** `groups` with `id` taken out and put at `target`. */
function moved(groups: Groups, id: StatusItemId, target: DropTarget): Groups {
  const next: Groups = {
    bar: groups.bar.filter((x) => x !== id),
    details: groups.details.filter((x) => x !== id),
    hidden: groups.hidden.filter((x) => x !== id),
  };
  next[target.place].splice(Math.min(target.index, next[target.place].length), 0, id);
  return next;
}

/** An item's row: grip, name, Up/Down, and the list of places. */
function itemRow({ groups, place, id, i, count, lists, save }: RowContext): HTMLElement {
  const label = t(`dialog.statusBar.item.${id}`);
  const tool = (icon: typeof ArrowUp, text: string, control: string, to: number, off: boolean) => {
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
    button.addEventListener('click', () => save(moved(groups, id, { place, index: to }), id, control));
    return button;
  };
  const select = el(
    'select',
    {
      attrs: {
        id: `status-item-${id}`,
        'aria-label': `${t('dialog.statusBar.placeLabel')}: ${label}`,
        'data-control': 'place',
      },
    },
    STATUS_ITEM_PLACES.map((p) =>
      el('option', { text: t(`dialog.statusBar.place.${p}`), attrs: { value: p } }),
    ),
  ) as HTMLSelectElement;
  select.value = place;
  select.addEventListener('change', () => {
    const to = select.value as StatusItemPlace;
    save(moved(groups, id, { place: to, index: groups[to].length }), id, 'place');
  });
  const grip = el('span', {
    className: 'toolbar-customize-grip',
    attrs: { 'aria-hidden': 'true', 'data-tooltip': t('dialog.toolbar.drag') },
  });
  grip.append(createIcon(GripVertical, 'toolbar-customize-icon', 14));
  grip.addEventListener('pointerdown', (event) =>
    dragItem(lists, event, (target) => save(moved(groups, id, target), id)),
  );
  return el('li', { className: 'toolbar-customize-row', attrs: { 'data-item': id } }, [
    grip,
    el('span', {
      className: 'toolbar-customize-label',
      text: label,
      attrs: { tabindex: '-1', 'data-control': 'label' },
    }),
    tool(ArrowUp, t('dialog.toolbar.moveUp'), 'up', i - 1, i === 0),
    tool(ArrowDown, t('dialog.toolbar.moveDown'), 'down', i + 1, i === count - 1),
    select,
  ]);
}

/**
 * Drag an item by its grip: the row follows the pointer, a line marks
 * where it will land (in its own list or another), and releasing calls
 * `drop` with that place (Escape leaves it where it was).
 */
function dragItem(
  lists: Record<StatusItemPlace, HTMLElement>,
  event: PointerEvent,
  drop: (target: DropTarget) => void,
): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  const grip = event.currentTarget as HTMLElement;
  const row = grip.closest<HTMLElement>('.toolbar-customize-row')!;
  grip.setPointerCapture?.(event.pointerId);
  row.classList.add('dragging');
  const startY = event.clientY;
  let target: DropTarget | null = null;
  const marks = (): HTMLElement[] =>
    Object.values(lists).flatMap((list) => [
      list,
      ...list.querySelectorAll<HTMLElement>('.toolbar-customize-row'),
    ]);
  const clearMarks = (): void => {
    for (const node of marks()) {
      node.classList.remove('drop-before', 'drop-after', 'drop-into');
    }
  };
  /** The list under `y` (or the nearest one), and the row before which the item would go. */
  const targetAt = (y: number): DropTarget => {
    let best: { place: StatusItemPlace; distance: number } | null = null;
    for (const place of Object.keys(lists) as StatusItemPlace[]) {
      const box = lists[place].getBoundingClientRect();
      const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
      if (!best || distance < best.distance) {
        best = { place, distance };
      }
    }
    const place = best!.place;
    const rows = [...lists[place].querySelectorAll<HTMLElement>('.toolbar-customize-row')].filter(
      (r) => r !== row,
    );
    const index = rows.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return { place, index: index < 0 ? rows.length : index };
  };
  const mark = (): void => {
    clearMarks();
    if (!target) {
      return;
    }
    const rows = [...lists[target.place].querySelectorAll<HTMLElement>('.toolbar-customize-row')].filter(
      (r) => r !== row,
    );
    if (rows.length === 0) {
      lists[target.place].classList.add('drop-into');
    } else if (target.index < rows.length) {
      rows[target.index]!.classList.add('drop-before');
    } else {
      rows[rows.length - 1]!.classList.add('drop-after');
    }
  };
  const move = (e: PointerEvent): void => {
    row.style.translate = `0 ${e.clientY - startY}px`;
    target = targetAt(e.clientY);
    mark();
  };
  const finish = (commit: boolean): void => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key, true);
    row.classList.remove('dragging');
    row.style.translate = '';
    clearMarks();
    if (commit && target) {
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
