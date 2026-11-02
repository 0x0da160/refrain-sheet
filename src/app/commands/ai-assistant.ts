// SPDX-License-Identifier: MIT
/**
 * The command side of View ▸ AI Assistant: what the panel may read from the
 * active sheet, and the one way it may change it. The panel never touches
 * the document itself — it gets a text view of the sheet for the model, and
 * hands an approved plan back here, where it becomes one ordinary,
 * singly-undoable `bulkEdit` (the same path Paste and Replace All use).
 */
import { buildAiSheetContext } from '../../core/ai-prompt';
import type { AiPlanChange } from '../../core/ai-plan';
import { isCsv } from '../../core/editor-document';
import type { CellChange } from '../../core/workbook/history';
import type { AppState, Tab } from '../state';
import type { AiAssistantInput } from '../ui-port';
import { isGridSurface } from './shared';

/** The active tab when it shows a sheet of cells (CSV or an RSF grid sheet), else null. */
function cellTab(state: AppState): Tab | null {
  const tab = state.activeTab;
  if (!tab || !isGridSurface(tab)) {
    return null;
  }
  if (!isCsv(tab.doc) && tab.doc.activeSheet.paper !== undefined) {
    return null; // a grid-paper sheet's squares hold no values
  }
  return tab;
}

/** The sheet as the model sees it, read at the moment of the question. */
export function aiSheetContext(state: AppState): string | null {
  const tab = cellTab(state);
  if (!tab) {
    return null;
  }
  const doc = tab.doc;
  const range = state.selectedRange(tab);
  // A workbook sheet is allocated larger than its data; describe only the used part.
  const extent = isCsv(doc) ? { rows: doc.rowCount, cols: doc.columnCount } : doc.activeSheet.usedExtent();
  return buildAiSheetContext({
    name: isCsv(doc) ? tab.name : doc.activeSheet.name,
    rowCount: extent.rows,
    columnCount: extent.cols,
    getValue: (row, col) => doc.getValue(row, col),
    getDisplayValue: (row, col) => doc.getDisplayValue(row, col),
    active: tab.selection,
    range,
  });
}

/**
 * Apply an approved plan to the active sheet as one undoable edit. A cell
 * outside the sheet is skipped rather than growing it, so the change is
 * exactly the list the user approved; the usual write guards (protection,
 * locked sheets, sorted views, spills, validation) still apply.
 */
export function applyAiPlan(
  state: AppState,
  changes: readonly AiPlanChange[],
): { applied: number; skipped: number } {
  const tab = cellTab(state);
  if (!tab) {
    return { applied: 0, skipped: changes.length };
  }
  const doc = tab.doc;
  const cellChanges: CellChange[] = [];
  let skipped = 0;
  for (const { row, col, value } of changes) {
    if (isCsv(doc)) {
      if (!doc.getField(row, col)) {
        skipped++;
        continue;
      }
      const current = doc.getValue(row, col);
      if (value === current) {
        continue;
      }
      const before = doc.isEdited(row, col) ? current : null;
      const after = value === doc.getOriginalValue(row, col) ? null : value;
      cellChanges.push({ row, col, before, after });
      continue;
    }
    if (row < 0 || row >= doc.rowCount || col < 0 || col >= doc.columnCount) {
      skipped++;
      continue;
    }
    const before = doc.getValue(row, col);
    if (before !== value) {
      cellChanges.push({ row, col, before, after: value });
    }
  }
  if (cellChanges.length === 0) {
    return { applied: 0, skipped };
  }
  const applied = state.bulkEdit(tab, cellChanges, 'history.aiAssistant');
  return { applied: applied ? cellChanges.length : 0, skipped: applied ? skipped : changes.length };
}

/** What View ▸ AI Assistant hands the panel. */
export function aiAssistantInput(state: AppState): AiAssistantInput {
  return {
    sheetContext: () => aiSheetContext(state),
    applyChanges: (changes) => applyAiPlan(state, changes),
  };
}
