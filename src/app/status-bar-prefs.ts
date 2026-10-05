// SPDX-License-Identifier: MIT
/**
 * Where each status bar item shows (View > Customize Status Bar…): in the
 * bar, behind the bar's Details button, or not at all, and in what order. Kept in this
 * browser's `localStorage` only, never in a file. Items that are warnings or
 * controls (structure problems, unreadable characters, unsaved changes,
 * protection, zoom, full screen) are always in the bar and are not listed.
 */
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';

const KEY = 'refrain-csv-html.statusItems';
const ORDER_KEY = 'refrain-csv-html.statusOrder';

/** The status bar items whose place can be chosen, in the order the bar shows them. */
export const STATUS_ITEMS = [
  'kind',
  'encoding',
  'delimiter',
  'lineEndings',
  'size',
  'gridSize',
  'formulas',
  'edits',
  'filter',
  'sort',
  'engine',
  'selection',
  'version',
] as const;

export type StatusItemId = (typeof STATUS_ITEMS)[number];

/** In the bar, behind Details, or not shown. */
export type StatusItemPlace = 'bar' | 'details' | 'hidden';

export const STATUS_ITEM_PLACES: readonly StatusItemPlace[] = ['bar', 'details', 'hidden'];

function stored(): Partial<Record<StatusItemId, StatusItemPlace>> {
  const raw = safeStorageGet(KEY);
  if (raw === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }
    const out: Partial<Record<StatusItemId, StatusItemPlace>> = {};
    for (const id of STATUS_ITEMS) {
      const place = (value as Record<string, unknown>)[id];
      if (place === 'details' || place === 'hidden') {
        out[id] = place;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Where `id` shows; every item is in the bar until moved. */
export function getStatusItemPlace(id: StatusItemId): StatusItemPlace {
  return stored()[id] ?? 'bar';
}

export function setStatusItemPlace(id: StatusItemId, place: StatusItemPlace): void {
  const next = stored();
  if (place === 'bar') {
    delete next[id];
  } else {
    next[id] = place;
  }
  if (Object.keys(next).length === 0) {
    safeStorageRemove(KEY);
  } else {
    safeStorageSet(KEY, JSON.stringify(next));
  }
}

/**
 * Every item in the order the user arranged them (the bar and Details show
 * theirs in this order). Items never placed keep their default position
 * relative to the ones before them; anything unreadable is ignored.
 */
export function getStatusItemOrder(): StatusItemId[] {
  let stored: unknown;
  try {
    stored = JSON.parse(safeStorageGet(ORDER_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  const known = new Set<string>(STATUS_ITEMS);
  const order: StatusItemId[] = [];
  if (Array.isArray(stored)) {
    for (const id of stored) {
      if (typeof id === 'string' && known.has(id) && !order.includes(id as StatusItemId)) {
        order.push(id as StatusItemId);
      }
    }
  }
  // An item missing from the stored order goes right after the item before it in the default order.
  STATUS_ITEMS.forEach((id, index) => {
    if (!order.includes(id)) {
      const before = STATUS_ITEMS.slice(0, index)
        .reverse()
        .find((prev) => order.includes(prev));
      order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
    }
  });
  return order;
}

/** Save the order (`null`: back to the default). */
export function setStatusItemOrder(order: readonly StatusItemId[] | null): void {
  if (order === null || order.join() === STATUS_ITEMS.join()) {
    safeStorageRemove(ORDER_KEY);
  } else {
    safeStorageSet(ORDER_KEY, JSON.stringify(order));
  }
}
