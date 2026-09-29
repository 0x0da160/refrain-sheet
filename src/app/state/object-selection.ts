// SPDX-License-Identifier: MIT
import { isWorkbook } from '../../core/editor-document';
import type { AppState } from './index';
import type { Tab } from './types';

/**
 * The objects (shapes) picked on the active worksheet, by id, in the order
 * they were picked. View state, like the cell selection: never saved or
 * undone, and forgotten when another worksheet becomes active. Ids of
 * objects that no longer exist (deleted, or undone away) are left out.
 */
export class ObjectSelection {
  private readonly picks = new WeakMap<Tab, { sheetId: string; ids: string[] }>();

  constructor(private readonly state: AppState) {}

  selected(tab: Tab): readonly string[] {
    const picked = this.picks.get(tab);
    const doc = tab.doc;
    if (!picked || !isWorkbook(doc) || picked.sheetId !== doc.activeSheetId) {
      return [];
    }
    const ids = new Set(doc.objects.map((o) => o.id));
    return picked.ids.filter((id) => ids.has(id));
  }

  /** Pick objects of the active worksheet (an empty list picks none). */
  select(tab: Tab, ids: readonly string[]): void {
    const doc = tab.doc;
    const before = this.selected(tab).join('\n');
    if (ids.length === 0 || !isWorkbook(doc)) {
      this.picks.delete(tab);
    } else {
      this.picks.set(tab, { sheetId: doc.activeSheetId, ids: [...ids] });
    }
    if (before !== this.selected(tab).join('\n')) {
      this.state.emit('selection');
    }
  }
}
