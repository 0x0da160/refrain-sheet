// SPDX-License-Identifier: MIT
/**
 * Row heights on an RSF sheet of cells: Format > Row Height… and the row
 * header's draggable bottom edge. Like column widths they are view state
 * kept in the file: they never change cell data and are not undo steps.
 */
import { isWorkbook } from '../../core/editor-document';
import { DEFAULT_ROW_HEIGHT, withRowHeights } from '../../core/workbook/row-heights';
import type { EditDialogsPort } from '../ui-port';
import type { AppState, Tab } from '../state';

/**
 * Set `rows` (document rows) to `height` px at 100% zoom, or back to their
 * automatic height when `height` is null. False on anything but a sheet of
 * cells.
 */
export function setRowHeights(
  state: AppState,
  tab: Tab,
  rows: Iterable<number>,
  height: number | null,
): boolean {
  const doc = tab.doc;
  if (!isWorkbook(doc) || doc.activeSheet.kind !== 'grid' || doc.activeSheet.paper !== undefined) {
    return false;
  }
  const sheet = doc.activeSheet;
  const next = withRowHeights(sheet.rowHeights, rows, height);
  if (
    next.size === sheet.rowHeights.size &&
    [...next].every(([row, px]) => sheet.rowHeights.get(row) === px)
  ) {
    return false;
  }
  sheet.rowHeights = next;
  state.emit('view');
  return true;
}

/** Format > Row Height…: ask for a height for the selected rows (the visible ones) and apply it. */
export async function promptRowHeight(state: AppState, ui: EditDialogsPort, tab: Tab): Promise<boolean> {
  const doc = tab.doc;
  const range = state.selectedRange(tab);
  if (!isWorkbook(doc) || !range) {
    return false;
  }
  const hidden = state.hiddenRows(tab);
  const rows: number[] = [];
  for (let slot = range.top; slot <= range.bottom; slot++) {
    if (!hidden?.has(slot)) {
      rows.push(state.docRow(tab, slot));
    }
  }
  const current = doc.activeSheet.rowHeights.get(rows[0] ?? range.top) ?? DEFAULT_ROW_HEIGHT;
  const answer = await ui.promptRowHeight(current);
  if (answer === null) {
    return false;
  }
  return setRowHeights(state, tab, rows, answer === 'auto' ? null : answer);
}
