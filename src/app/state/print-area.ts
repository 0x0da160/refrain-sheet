// SPDX-License-Identifier: MIT
/**
 * The active sheet's print area (File > Print Area, and the "Print area"
 * choice of File > Print…). An `.rsf` worksheet keeps it in the file and
 * changes it through an undoable history entry; a CSV table has nowhere to
 * keep it, so its tab remembers it until the tab is closed.
 */
import { isCsv, isWorkbook } from '../../core/editor-document';
import type { PrintArea } from '../../core/print-layout';
import { clipPrintArea, printAreasEqual } from '../../core/workbook/print-area';
import type { AppState } from './index';
import type { Tab } from './types';

/** The active sheet's print area, cut to the sheet; null when none is set. */
export function printAreaOf(tab: Tab): PrintArea | null {
  const doc = tab.doc;
  const area = isWorkbook(doc) ? doc.activeSheet.printArea : isCsv(doc) ? (tab.printArea ?? null) : null;
  return area ? clipPrintArea(area, doc.rowCount, doc.columnCount) : null;
}

/** Whether the active sheet can hold a print area: a CSV table or a grid worksheet. */
export function canHoldPrintArea(tab: Tab): boolean {
  return isCsv(tab.doc) || (isWorkbook(tab.doc) && tab.doc.activeSheet.kind === 'grid');
}

/**
 * Set (or clear, with null) the active sheet's print area. Returns false
 * when nothing changed or the change was refused (a protected file, a
 * locked sheet).
 */
export function setPrintArea(state: AppState, tab: Tab, area: PrintArea | null): boolean {
  const doc = tab.doc;
  const next = area ? clipPrintArea(area, doc.rowCount, doc.columnCount) : null;
  if (!canHoldPrintArea(tab) || (area && !next)) {
    return false;
  }
  if (isWorkbook(doc)) {
    const sheetId = doc.activeSheetId;
    return state.pushEntry(tab, {
      label: next ? 'history.setPrintArea' : 'history.clearPrintArea',
      sheetId,
      ops: [{ type: 'printArea', before: doc.activeSheet.printArea, after: next, sheetId }],
    });
  }
  if (printAreasEqual(tab.printArea ?? null, next)) {
    return false;
  }
  tab.printArea = next;
  state.emit('view');
  return true;
}

/**
 * The selection as a block of document rows and columns. While the sheet
 * is sorted, the selected rows are wherever the sort put them, so the block
 * reaches from the first of them to the last.
 */
export function selectionPrintArea(state: AppState, tab: Tab): PrintArea | null {
  const range = state.selectedRange(tab);
  if (!range) {
    return null;
  }
  let top = Infinity;
  let bottom = -Infinity;
  for (let slot = range.top; slot <= range.bottom; slot++) {
    const row = state.docRow(tab, slot);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
  }
  return { top, left: range.left, bottom, right: range.right };
}
