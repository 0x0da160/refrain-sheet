// SPDX-License-Identifier: MIT
import { moveFormulaAxis, movedAxisIndex, sheetNameKey } from '../../core/formula';
import type {
  CellChange,
  CommentChange,
  HistoryEntry,
  Operation,
  StyleChange,
} from '../../core/workbook/history';
import {
  moveValidations,
  shiftValidationsForDelete,
  shiftValidationsForInsert,
  type CellValidation,
} from '../../core/workbook/data-validation';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import { showsSheet } from '../../core/workbook/sheet-charts';
import {
  moveObjects,
  shiftObjectsForDelete,
  shiftObjectsForInsert,
  type SheetObject,
} from '../../core/workbook/sheet-objects';
import { rowHeightsAt } from '../../core/workbook/row-heights';
import { colWidthsAt } from './col-widths';

/**
 * Charts elsewhere that show this worksheet keep their ranges through a
 * move (the cells stay within the worksheet's rows and columns); these
 * snapshots put them back as they were on undo.
 */
function chartedSnapshots(doc: RsfDocument, sheetId: string): Operation[] {
  return doc.sheets
    .filter((other) => other.id !== sheetId && showsSheet(other.objects, [sheetId]))
    .map((other): Operation => ({
      type: 'objects',
      before: other.objects,
      after: other.objects,
      sheetId: other.id,
    }));
}

/**
 * Plan moving whole rows or columns of the active worksheet — `count` of
 * them starting at `from` — to the boundary `to` (a position in the current
 * layout: moving columns B:C to `to = 5` puts them just before the current
 * column F). A reorder, not an overwrite: the rows/columns passed over close
 * the gap, every formula reference follows the cell it pointed at, and the
 * moved cells keep their values, styles, comments, and widths or heights.
 * Null when the move is out of range or drops the span back onto itself.
 *
 * Recorded with the existing operations so undo/redo needs nothing new: the
 * formula rewrites in the pre-move layout, then clearing the source's
 * styles/comments (so undoing the delete gets them back), deleting the
 * source span, inserting it at the destination, and restoring its styles
 * and comments there. Data-validation rules move with their rows or
 * columns the same way. `leading` (e.g. the filter-clear operations) goes
 * first.
 */
export function planAxisMove(
  doc: RsfDocument,
  colWidths: readonly number[],
  leading: Operation[],
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): HistoryEntry | null {
  const length = axis === 'row' ? doc.rowCount : doc.columnCount;
  if (count < 1 || from < 0 || from + count > length || to < 0 || to > length) {
    return null;
  }
  if (to >= from && to <= from + count) {
    return null; // a drop back onto itself
  }
  const sheet = doc.activeSheet;
  const sheetId = sheet.id;
  const targetKey = sheetNameKey(sheet.name);
  const shouldMapCoords = (name: string | null): boolean => name !== null && sheetNameKey(name) === targetKey;
  const rewrite = (src: string, home: string): string =>
    moveFormulaAxis(src, axis, from, count, to, { homeSheet: home, shouldMapCoords });
  const inSpan = (row: number, col: number): boolean => {
    const v = axis === 'row' ? row : col;
    return v >= from && v < from + count;
  };

  const active: CellChange[] = [];
  const rewritten = new Map<string, string>();
  for (const { row, col, src } of sheet.listFormulaCells()) {
    const after = rewrite(src, sheet.name);
    if (after !== src) {
      active.push({ row, col, before: src, after });
      rewritten.set(`${row},${col}`, after);
    }
  }
  const others: Operation[] = [];
  for (const other of doc.sheets) {
    if (other.id === sheetId) {
      continue;
    }
    const changes: CellChange[] = [];
    for (const { row, col, src } of other.listFormulaCells()) {
      const after = rewrite(src, other.name);
      if (after !== src) {
        changes.push({ row, col, before: src, after });
      }
    }
    if (changes.length > 0) {
      others.push({ type: 'cells', changes, sheetId: other.id });
    }
  }

  // The moved span's values as they stand after the formula rewrites, in
  // the row-major (rows) or column-major (cols) shape the ops carry.
  const valueAt = (row: number, col: number): string =>
    rewritten.get(`${row},${col}`) ?? doc.getValue(row, col);
  const data: string[][] =
    axis === 'row'
      ? Array.from({ length: count }, (_, i) =>
          Array.from({ length: doc.columnCount }, (_, c) => valueAt(from + i, c)),
        )
      : Array.from({ length: count }, (_, i) =>
          Array.from({ length: doc.rowCount }, (_, r) => valueAt(r, from + i)),
        );

  const dest = to > from ? to - count : to;
  const moved = (row: number, col: number): { row: number; col: number } =>
    axis === 'row'
      ? { row: movedAxisIndex(row, from, count, to), col }
      : { row, col: movedAxisIndex(col, from, count, to) };
  const clearStyles: StyleChange[] = [];
  const placeStyles: StyleChange[] = [];
  for (const [row, col, style] of sheet.collectStyles()) {
    if (inSpan(row, col)) {
      clearStyles.push({ row, col, before: style, after: null });
      placeStyles.push({ ...moved(row, col), before: null, after: style });
    }
  }
  const clearComments: CommentChange[] = [];
  const placeComments: CommentChange[] = [];
  for (const [row, col, text] of sheet.collectComments()) {
    if (inSpan(row, col)) {
      clearComments.push({ row, col, before: text, after: null });
      placeComments.push({ ...moved(row, col), before: null, after: text });
    }
  }
  const widths = axis === 'col' ? { widths: colWidthsAt(colWidths, from, count) } : {};
  const heights = axis === 'row' ? { heights: rowHeightsAt(sheet.rowHeights, from, count) } : {};

  // The rules as they stand, restored first on undo; after the insert, the
  // moved rules are put where their rows or columns went.
  const rules = sheet.validations;
  const objects = sheet.objects;
  const charted = chartedSnapshots(doc, sheetId);
  const ops: Operation[] = [
    ...leading,
    { type: 'validations', before: rules, after: rules, sheetId },
    { type: 'objects', before: objects, after: objects, sheetId },
    ...charted,
    { type: 'cells', changes: active, sheetId },
    ...others,
    { type: 'styles', changes: clearStyles, sheetId },
    { type: 'comments', changes: clearComments, sheetId },
    axis === 'row'
      ? { type: 'rows', action: 'delete', index: from, count, data, sheetId, ...heights }
      : { type: 'cols', action: 'delete', index: from, count, data, sheetId, ...widths },
    axis === 'row'
      ? { type: 'rows', action: 'insert', index: dest, count, data, sheetId, ...heights }
      : { type: 'cols', action: 'insert', index: dest, count, data, sheetId, ...widths },
    { type: 'styles', changes: placeStyles, sheetId },
    { type: 'comments', changes: placeComments, sheetId },
    {
      type: 'validations',
      before: structuralMove(rules, axis, from, count, to),
      after: moveValidations(rules, axis, from, count, to),
      sheetId,
    },
    {
      type: 'objects',
      before: objectsAfterDeleteInsert(sheet, axis, from, count, to),
      after: moveObjects(objects, axis, from, count, to),
      sheetId,
    },
    ...charted,
  ];
  return { label: axis === 'row' ? 'history.moveRows' : 'history.moveCols', sheetId, ops };
}

/** Where the delete and insert of a move leave the rules on their own. */
function structuralMove(
  rules: readonly CellValidation[],
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): CellValidation[] {
  const dest = to > from ? to - count : to;
  return shiftValidationsForInsert(shiftValidationsForDelete(rules, axis, from, count), axis, dest, count);
}

/** Where the delete and insert of a move leave the objects on their own. */
function objectsAfterDeleteInsert(
  sheet: { objects: readonly SheetObject[]; rowCount: number; columnCount: number },
  axis: 'row' | 'col',
  from: number,
  count: number,
  to: number,
): SheetObject[] {
  const dest = to > from ? to - count : to;
  const limit = (axis === 'row' ? sheet.rowCount : sheet.columnCount) - count;
  return shiftObjectsForInsert(
    shiftObjectsForDelete(sheet.objects, axis, from, count, limit),
    axis,
    dest,
    count,
  );
}
