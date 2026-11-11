// SPDX-License-Identifier: MIT
/**
 * Adding a document tab to a workbook as a sheet. A CSV table becomes a grid
 * sheet; a Markdown, JSON, YAML or plain-text document becomes a sheet of its
 * kind. A tab dropped on the worksheet strip of a workbook is added this way
 * (see `ui/sheet-bar-drop.ts`).
 */
import type { LosslessDocument } from '../../core/csv/lossless-document';
import { isCsv, isWorkbook, type EditorDocument } from '../../core/editor-document';
import { isValidSheetName } from '../../core/formula';
import { textFileBaseName, type TextFileKind } from '../../core/interchange/text-file';
import { MAX_WORKSHEETS } from '../../core/workbook/rsf-document';
import type { AppState, Tab } from '../state';
import { defaultSheetName } from '../state/defaults';
import { t } from '../i18n';
import type { UiPort } from '../ui-port';

/** The rows of a CSV table as text, row by row: the form a new sheet takes (see `RsfDocument.fromLossless`). */
export function csvRows(csv: LosslessDocument): string[][] {
  const rows: string[][] = [];
  for (let r = 0; r < csv.rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < csv.fieldCount(r); c++) {
      row.push(csv.getValue(r, c));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * A file's name as a sheet's name: the name without the extension its kind
 * gives it (`.md`, `.json`, …), and without `.csv` or `.tsv`.
 */
export function sheetNameBase(fileName: string): string {
  return textFileBaseName(fileName)
    .replace(/\.(csv|tsv)$/i, '')
    .trim();
}

/** What a document tab contributes to a workbook as a sheet: a grid of rows, or one text document of a kind. */
type SheetContent = { kind: 'grid'; rows: string[][] } | { kind: TextFileKind; text: string };

/**
 * The content a document adds to a workbook as a sheet, or null for a
 * spreadsheet file. A CSV table is a grid; a Markdown, JSON, YAML or plain-text
 * document, whether opened from its file or made as a single text sheet, is
 * its text.
 */
function sheetContentOf(doc: EditorDocument): SheetContent | null {
  if (isCsv(doc)) {
    return { kind: 'grid', rows: csvRows(doc) };
  }
  if (isWorkbook(doc) && doc.sheetCount === 1) {
    const sheet = doc.sheets[0];
    if (sheet.kind !== 'grid') {
      return { kind: sheet.kind, text: sheet.getValue(0, 0) };
    }
  }
  return null;
}

/**
 * Add the content of the document tab `source` to the workbook `target` as a
 * new sheet named after the file, as one undoable step. The dropped tab stays
 * open, and its file is never written. A spreadsheet file is not added: its
 * sheets refer to one another by name, which the workbook it joins would not
 * keep. Returns true when a sheet was added.
 */
export function addSheetFromTab(state: AppState, ui: UiPort, target: Tab, source: Tab): boolean {
  const doc = target.doc;
  if (source === target || !isWorkbook(doc)) {
    return false;
  }
  if (doc.sheetCount >= MAX_WORKSHEETS) {
    ui.notify(t('notify.sheetLimit', { max: MAX_WORKSHEETS }), 'warn');
    return false;
  }
  const content = sheetContentOf(source.doc);
  if (content === null) {
    ui.notify(t('notify.tabNotSheet', { name: source.name }), 'warn');
    return false;
  }
  const base = sheetNameBase(source.name);
  const name = doc.uniqueSheetName(base && isValidSheetName(base) ? base : defaultSheetName());
  // A protected or locked-out target refuses the step itself (see `AppState.pushEntry`).
  const sheet =
    content.kind === 'grid'
      ? state.addSheetFromValues(target, name, content.rows)
      : state.addDocumentSheet(target, content.kind, name, content.text);
  if (!sheet) {
    return false;
  }
  ui.notify(t('notify.tabAddedAsSheet', { name: sheet.name, file: source.name }), 'info');
  return true;
}
