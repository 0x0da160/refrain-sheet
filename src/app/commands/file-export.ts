// SPDX-License-Identifier: MIT
/**
 * The explicit, confirmed lossy exports of a document: CSV (with encoding,
 * delimiter, quoting, line-ending and BOM choices), XLSX, and JSON; and the
 * text of one Markdown, JSON, YAML or text sheet as a file of its own. The
 * source document is never modified.
 */
import { isWorkbook } from '../../core/editor-document';
import {
  buildCsvExportBytes,
  newCsvExportScan,
  scanCsvExportRow,
  type CsvExportScan,
} from '../../core/interchange/csv-export';
import { forEachIndexSliced } from '../../core/scheduler';
import type { NcrCellReport } from '../../core/csv/serializer';
import { buildXlsxExport, type XlsxSheetInput } from '../../core/interchange/xlsx-export';
import { buildJsonExport } from '../../core/interchange/json-export';
import type { Tab } from '../state';
import { saveBytesAs, type SavePickerKind } from '../file-access';
import { t } from '../i18n';
import { LARGE_OP_CELLS, pct, withBusyIfLarge } from './shared';

import type { FileIoCommands } from './file-io';

/** A text sheet's file extension and save-picker kind, by sheet kind. */
const TEXT_SHEET_FILES: Partial<Record<string, { ext: string; kind: SavePickerKind }>> = {
  markdown: { ext: 'md', kind: 'markdown' },
  json: { ext: 'json', kind: 'json' },
  yaml: { ext: 'yaml', kind: 'yaml' },
  text: { ext: 'txt', kind: 'text' },
};

export class FileExporting {
  constructor(private readonly core: FileIoCommands) {}

  /**
   * Explicit, confirmed lossy CSV export of an RSF document. The options
   * dialog (encoding, line endings, BOM) doubles as the confirmation; the
   * displayed values are then validated against the chosen encoding in a
   * time-sliced scan behind the progress indicator. Unrepresentable
   * characters cancel the export by default — continuing uses the documented
   * numeric-character-reference replacement and reports the affected cells.
   * Nothing in this flow ever mutates the source document or marks it saved.
   */
  async exportCsv(tab: Tab): Promise<boolean> {
    if (!isWorkbook(tab.doc)) {
      return false;
    }
    const doc = tab.doc;
    // CSV holds exactly one worksheet. A multi-worksheet workbook therefore
    // requires an explicit choice — the export never silently takes the active
    // worksheet — and the dialog states that only that worksheet is written and
    // that formulas become their calculated values. A Markdown or JSON
    // worksheet has no CSV analog (there is no grid to write), so both are
    // excluded from the choice entirely, exactly like the sheet limit above.
    const exportable = doc.sheets.filter((s) => s.kind === 'grid');
    if (exportable.length === 0) {
      this.core.ui.notify(t('notify.noExportableSheet'), 'warn');
      return false;
    }
    let sheetId = exportable.some((s) => s.id === doc.activeSheetId) ? doc.activeSheetId : exportable[0].id;
    if (exportable.length > 1) {
      const chosen = await this.core.ui.chooseExportSheet(
        exportable.map((s) => ({ id: s.id, name: s.name })),
        sheetId,
      );
      if (chosen === null || tab.doc !== doc) {
        return false;
      }
      sheetId = chosen;
    }
    const sheet = doc.sheetById(sheetId);
    if (!sheet) {
      return false;
    }
    const options = await this.core.ui.chooseExportCsv(tab.name, doc.delimiter);
    if (!options || tab.doc !== doc) {
      return false;
    }
    const base = tab.name.replace(/\.(rsf|rcsv)$/i, '');
    // A multi-worksheet workbook names the exported worksheet in the file name
    // so several exports from one workbook do not collide.
    const name = (doc.sheetCount > 1 ? `${base}-${sheet.name}` : base) + '.csv';
    const label = t('loading.exporting', { name });
    const large = sheet.rowCount * sheet.columnCount > LARGE_OP_CELLS;

    // Sliced, read-only scan of the chosen worksheet's displayed (calculated)
    // values. Aborts — producing nothing — if the tab's document changes.
    const scanValues = async (allowNcr: boolean): Promise<CsvExportScan | null> => {
      const scan = newCsvExportScan();
      const completed = await forEachIndexSliced(
        sheet.rowCount,
        (r) => {
          const values: string[] = [];
          for (let c = 0; c < sheet.columnCount; c++) {
            values.push(doc.getSheetDisplayValue(sheetId, r, c));
          }
          scanCsvExportRow(scan, r, values, options.encoding, allowNcr);
        },
        {
          onProgress: (done, total) =>
            this.core.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc,
        },
      );
      return completed && tab.doc === doc ? scan : null;
    };

    let scan = await withBusyIfLarge(large, this.core.ui, label, () => scanValues(false));
    if (!scan) {
      return false;
    }
    let ncrReports: NcrCellReport[] = [];
    if (scan.unrepresentable.length > 0) {
      const proceed = await this.core.ui.confirmUnrepresentable(
        t(`encoding.${options.encoding}`),
        scan.unrepresentable,
      );
      if (!proceed) {
        return false; // cancel by default; the document is untouched
      }
      scan = await withBusyIfLarge(large, this.core.ui, label, () => scanValues(true));
      if (!scan) {
        return false;
      }
      ncrReports = scan.ncrReplacements;
    }
    const rows = scan.rows;
    const bytes = await withBusyIfLarge(large, this.core.ui, label, () =>
      buildCsvExportBytes(rows, doc.delimiter, options),
    );
    const written = await this.core.runSaveStep(name, () => saveBytesAs(this.core.dom, name, bytes, 'csv'));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    this.core.ui.notify(
      outcome.mode === 'overwrite'
        ? t('notify.exportedCsv', { name })
        : t('notify.exportedCsvDownload', { name: outcome.downloadName ?? name }),
      'info',
    );
    if (ncrReports.length > 0) {
      await this.core.ui.notifyNcr(ncrReports);
    }
    return true;
  }

  /**
   * Explicit, confirmed lossy XLSX export. Unlike CSV (which holds only one
   * worksheet, forcing `chooseExportSheet`), XLSX natively holds several, so
   * an RSF workbook exports every worksheet, in tab order; a CSV-kind tab —
   * which always has exactly one sheet — exports as a single-sheet workbook.
   * Cells carry only their calculated/display values, matching CSV export's
   * documented conversion. Nothing in this flow ever mutates the source
   * document or marks it saved.
   */
  async exportXlsx(tab: Tab): Promise<boolean> {
    const doc = tab.doc;
    const confirmed = await this.core.ui.confirmExportXlsx(tab.name);
    if (!confirmed || tab.doc !== doc) {
      return false;
    }
    const base = tab.name.replace(/\.(rsf|rcsv|csv|tsv|txt)$/i, '');
    const name = `${base}.xlsx`;
    const label = t('loading.exporting', { name });

    const plans = isWorkbook(doc)
      ? doc.sheets.map((s) => ({
          name: s.name,
          rowCount: s.rowCount,
          columnCount: s.columnCount,
          getValue: (r: number, c: number) => doc.getSheetDisplayValue(s.id, r, c),
        }))
      : [
          {
            name: base,
            rowCount: doc.rowCount,
            columnCount: doc.columnCount,
            getValue: (r: number, c: number) => doc.getDisplayValue(r, c),
          },
        ];
    const totalRows = plans.reduce((sum, p) => sum + p.rowCount, 0);
    const large = plans.reduce((sum, p) => sum + p.rowCount * p.columnCount, 0) > LARGE_OP_CELLS;

    // Sliced, read-only scan of every planned worksheet's displayed
    // (calculated) values. Aborts — producing nothing — if the tab's
    // document changes.
    const scanSheets = async (): Promise<XlsxSheetInput[] | null> => {
      const sheets: XlsxSheetInput[] = [];
      let doneRows = 0;
      for (const plan of plans) {
        const rows: string[][] = [];
        const completed = await forEachIndexSliced(
          plan.rowCount,
          (r) => {
            const values: string[] = [];
            for (let c = 0; c < plan.columnCount; c++) {
              values.push(plan.getValue(r, c));
            }
            rows.push(values);
          },
          {
            onProgress: (done) =>
              this.core.ui.setBusy(
                `${label} (${pct(doneRows + done, totalRows)}%)`,
                pct(doneRows + done, totalRows),
              ),
            shouldStop: () => tab.doc !== doc,
          },
        );
        if (!completed || tab.doc !== doc) {
          return null;
        }
        doneRows += plan.rowCount;
        sheets.push({ name: plan.name, rows });
      }
      return sheets;
    };

    const sheets = await withBusyIfLarge(large, this.core.ui, label, scanSheets);
    if (!sheets) {
      return false;
    }
    const bytes = await withBusyIfLarge(large, this.core.ui, label, () => buildXlsxExport(sheets));
    const written = await this.core.runSaveStep(name, () => saveBytesAs(this.core.dom, name, bytes, 'xlsx'));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    this.core.ui.notify(
      outcome.mode === 'overwrite'
        ? t('notify.exportedXlsx', { name })
        : t('notify.exportedXlsxDownload', { name: outcome.downloadName ?? name }),
      'info',
    );
    return true;
  }

  /**
   * Explicit, confirmed lossy JSON export. Unlike XLSX (which natively holds
   * every worksheet), a plain JSON document has no worksheet concept, so —
   * like CSV export — an RSF workbook with more than one worksheet requires
   * an explicit choice (`chooseExportSheet`) rather than exporting every
   * worksheet. The chosen worksheet's first row supplies the JSON object
   * field names; every following row becomes one record (see
   * `buildJsonExport`). Cells carry only their calculated/display values.
   * Nothing in this flow ever mutates the source document or marks it saved.
   */
  async exportJson(tab: Tab): Promise<boolean> {
    const doc = tab.doc;
    let rowCount: number;
    let columnCount: number;
    let getValue: (r: number, c: number) => string;
    let base: string;

    if (isWorkbook(doc)) {
      const exportable = doc.sheets.filter((s) => s.kind === 'grid');
      if (exportable.length === 0) {
        this.core.ui.notify(t('notify.noExportableSheet'), 'warn');
        return false;
      }
      let sheetId = exportable.some((s) => s.id === doc.activeSheetId) ? doc.activeSheetId : exportable[0].id;
      if (exportable.length > 1) {
        const chosen = await this.core.ui.chooseExportSheet(
          exportable.map((s) => ({ id: s.id, name: s.name })),
          sheetId,
        );
        if (chosen === null || tab.doc !== doc) {
          return false;
        }
        sheetId = chosen;
      }
      const sheet = doc.sheetById(sheetId);
      if (!sheet) {
        return false;
      }
      rowCount = sheet.rowCount;
      columnCount = sheet.columnCount;
      getValue = (r, c) => doc.getSheetDisplayValue(sheetId, r, c);
      base = tab.name.replace(/\.(rsf|rcsv)$/i, '') + (doc.sheetCount > 1 ? `-${sheet.name}` : '');
    } else {
      rowCount = doc.rowCount;
      columnCount = doc.columnCount;
      getValue = (r, c) => doc.getDisplayValue(r, c);
      base = tab.name.replace(/\.(rsf|rcsv|csv|tsv|txt)$/i, '');
    }

    const confirmed = await this.core.ui.confirmExportJson(tab.name);
    if (!confirmed || tab.doc !== doc) {
      return false;
    }

    const name = `${base}.json`;
    const label = t('loading.exporting', { name });
    const large = rowCount * columnCount > LARGE_OP_CELLS;

    // Sliced, read-only scan of the chosen worksheet's displayed (calculated)
    // values. Aborts — producing nothing — if the tab's document changes.
    const scanRows = async (): Promise<string[][] | null> => {
      const rows: string[][] = [];
      const completed = await forEachIndexSliced(
        rowCount,
        (r) => {
          const values: string[] = [];
          for (let c = 0; c < columnCount; c++) {
            values.push(getValue(r, c));
          }
          rows.push(values);
        },
        {
          onProgress: (done, total) =>
            this.core.ui.setBusy(`${label} (${pct(done, total)}%)`, pct(done, total)),
          shouldStop: () => tab.doc !== doc,
        },
      );
      return completed && tab.doc === doc ? rows : null;
    };

    const rows = await withBusyIfLarge(large, this.core.ui, label, scanRows);
    if (!rows) {
      return false;
    }
    const bytes = await withBusyIfLarge(large, this.core.ui, label, () => buildJsonExport(rows));
    const written = await this.core.runSaveStep(name, () => saveBytesAs(this.core.dom, name, bytes, 'json'));
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    this.core.ui.notify(
      outcome.mode === 'overwrite'
        ? t('notify.exportedJson', { name })
        : t('notify.exportedJsonDownload', { name: outcome.downloadName ?? name }),
      'info',
    );
    return true;
  }

  /**
   * The active Markdown, JSON, YAML or text sheet's text as a file of its
   * own (`<sheet name>.md` / `.json` / `.yaml` / `.txt`), UTF-8 without a
   * BOM, exactly as the sheet holds it. Nothing is lost, so there is no
   * confirmation; the picker opens straight from the menu click.
   */
  async exportSheetText(tab: Tab): Promise<boolean> {
    if (!isWorkbook(tab.doc)) {
      return false;
    }
    const sheet = tab.doc.activeSheet;
    const file = TEXT_SHEET_FILES[sheet.kind];
    if (!file) {
      return false;
    }
    const base = sheet.name.replace(/\.(md|markdown|json|ya?ml|txt)$/i, '');
    const name = `${base}.${file.ext}`;
    const bytes = new TextEncoder().encode(sheet.getValue(0, 0));
    const written = await this.core.runSaveStep(name, () =>
      saveBytesAs(this.core.dom, name, bytes, file.kind),
    );
    if (!written.ok) {
      return false;
    }
    const outcome = written.value;
    this.core.ui.notify(
      outcome.mode === 'overwrite'
        ? t('notify.exportedSheetText', { name })
        : t('notify.exportedSheetTextDownload', { name: outcome.downloadName ?? name }),
      'info',
    );
    return true;
  }
}
