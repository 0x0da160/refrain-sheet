// SPDX-License-Identifier: MIT
/**
 * What changed between two saved versions of a file (Sheet > File Version
 * History… > Preview): per worksheet, the cells whose input (value or
 * formula) changed and the cells whose formatting alone changed, plus the
 * worksheets added, removed and renamed. Worksheets are matched by their id,
 * which a file keeps across saves, so a rename is not an add and a remove.
 *
 * Work is linear in the stored cells and styles of both versions.
 */
import { cellStylesEqual, type CellStyle } from './cell-style';
import type { RsfWorkbookData, RsfWorksheetData } from './rsf-codec';

/** How one cell changed: its input (value or formula), or only its formatting. */
type CellChangeKind = 'value' | 'format';

interface SheetChanges {
  /** Changed cells, keyed by {@link cellKey}. */
  cells: Map<string, CellChangeKind>;
  /** Cells whose input changed (added, edited or cleared). */
  values: number;
  /** Cells whose formatting alone changed. */
  formats: number;
  /** A Markdown, JSON, YAML or text sheet whose text changed. */
  text: boolean;
}

export interface VersionDiff {
  /** Changes per worksheet id, for worksheets in both versions. */
  sheets: Map<string, SheetChanges>;
  /** Names of worksheets only in the newer version. */
  added: string[];
  /** Names of worksheets only in the older version. */
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
}

/** The key of one cell in {@link SheetChanges.cells}. */
export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** What changed from `before` to `after`. */
export function diffVersions(before: RsfWorkbookData, after: RsfWorkbookData): VersionDiff {
  const older = new Map(before.sheets.map((sheet) => [sheet.id, sheet]));
  const newer = new Set(after.sheets.map((sheet) => sheet.id));
  const diff: VersionDiff = {
    sheets: new Map(),
    added: [],
    removed: before.sheets.filter((sheet) => !newer.has(sheet.id)).map((sheet) => sheet.name),
    renamed: [],
  };
  for (const sheet of after.sheets) {
    const old = older.get(sheet.id);
    if (!old) {
      diff.added.push(sheet.name);
      continue;
    }
    if (old.name !== sheet.name) {
      diff.renamed.push({ from: old.name, to: sheet.name });
    }
    diff.sheets.set(sheet.id, diffSheet(old, sheet));
  }
  return diff;
}

function diffSheet(before: RsfWorksheetData, after: RsfWorksheetData): SheetChanges {
  const changes: SheetChanges = { cells: new Map(), values: 0, formats: 0, text: false };
  if ((before.kind ?? 'grid') !== 'grid' || (after.kind ?? 'grid') !== 'grid') {
    changes.text = sourceText(before) !== sourceText(after) || before.kind !== after.kind;
    return changes;
  }
  const oldValues = byCell(before.cells);
  const newValues = byCell(after.cells);
  for (const [key, value] of newValues) {
    if (oldValues.get(key) !== value) {
      changes.cells.set(key, 'value');
    }
  }
  for (const key of oldValues.keys()) {
    if (!newValues.has(key)) {
      changes.cells.set(key, 'value');
    }
  }
  const oldStyles = byCell(before.styles ?? []);
  const newStyles = byCell(after.styles ?? []);
  const styleChanged = (key: string): void => {
    if (!changes.cells.has(key) && !cellStylesEqual(oldStyles.get(key) ?? null, newStyles.get(key) ?? null)) {
      changes.cells.set(key, 'format');
    }
  };
  newStyles.forEach((_, key) => styleChanged(key));
  oldStyles.forEach((_, key) => styleChanged(key));
  for (const kind of changes.cells.values()) {
    if (kind === 'value') {
      changes.values++;
    } else {
      changes.formats++;
    }
  }
  return changes;
}

function byCell<T extends string | CellStyle>(entries: ReadonlyArray<[number, number, T]>): Map<string, T> {
  return new Map(entries.map(([row, col, value]) => [cellKey(row, col), value]));
}

function sourceText(sheet: RsfWorksheetData): string {
  return sheet.cells.find(([row, col]) => row === 0 && col === 0)?.[2] ?? '';
}
