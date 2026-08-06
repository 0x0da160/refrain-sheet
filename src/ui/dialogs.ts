// SPDX-License-Identifier: MIT
import type { Tab } from '../app/app-state';
import type {
  BordersDialogResult,
  CellCommentDialogInput,
  CellCommentDialogResult,
  ColorDialogResult,
  ConvertReason,
  DataValidationDialogInput,
  DataValidationDialogResult,
  DiffDialogInput,
  FilterDialogInput,
  FilterDialogResult,
  FlashFillPreview,
  NumberFormatDialogResult,
  RangeMoveConfirmInput,
  SortDialogInput,
  SortDialogResult,
  SqlQueryDialogInput,
  WorkbookReplaceConfirmInput,
} from '../app/commands';
import { t, type LocaleId } from '../app/i18n';
import type { DelimiterId } from '../core/byte-csv-parser';
import type { BorderLineStyle, BorderSide, BorderWidth, NumberFormat } from '../core/cell-style';
import type { CsvExportOptions } from '../core/csv-export';
import type { EncodingId } from '../core/encoding';
import type { NcrCellReport, SaveOptions, UnrepresentableCell } from '../core/serializer';
import type { ValidationSummary } from '../core/validation';
import { el } from './dom';
import { AppSettingsDialogs } from './dialogs/app-settings';
import { FileIoDialogs } from './dialogs/file-io';
import { FormatDialogs } from './dialogs/format';
import { SheetOpsDialogs } from './dialogs/sheet-ops';
import { SqlQueryDialogs } from './dialogs/sql';
import { DiffDialogs } from './dialogs/diff';
import { dialogButton, openDialog } from './dialogs/shared';

export class Dialogs {
  private readonly appSettings = new AppSettingsDialogs();
  private readonly fileIo = new FileIoDialogs();
  private readonly sheetOps = new SheetOpsDialogs();
  private readonly format = new FormatDialogs();
  private readonly sqlQuery = new SqlQueryDialogs();
  private readonly diff = new DiffDialogs();

  confirmValidation(name: string, summary: ValidationSummary): Promise<boolean> {
    return openDialog(t('dialog.validation.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.validation.intro', { name }) }));
      const table = el('table', { className: 'diag-table' });
      const head = el('tr', {}, [
        el('th', { text: t('dialog.validation.row') }),
        el('th', { text: t('dialog.validation.col') }),
        el('th', { text: t('dialog.validation.problem') }),
        el('th', { text: t('dialog.validation.description') }),
      ]);
      table.append(el('thead', {}, [head]));
      const tbody = el('tbody');
      for (const diag of summary.shown) {
        tbody.append(
          el('tr', {}, [
            el('td', { text: String(diag.row) }),
            el('td', { text: String(diag.column) }),
            el('td', { text: t(`diag.${diag.type}`) }),
            el('td', {
              text: t(`diagDesc.${diag.type}`, { expected: diag.expected ?? 0, actual: diag.actual ?? 0 }),
            }),
          ]),
        );
      }
      table.append(tbody);
      body.append(table);
      if (summary.truncated > 0) {
        body.append(
          el('p', {
            className: 'dialog-note',
            text: t('dialog.validation.truncated', { n: summary.truncated }),
          }),
        );
      }
      buttons.append(
        dialogButton(t('dialog.validation.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.validation.openAnyway'), true, true, () => close(true)),
      );
    });
  }

  confirmUnsaved(names: string[]): Promise<'save' | 'discard' | 'cancel'> {
    return openDialog<'save' | 'discard' | 'cancel'>(
      t('dialog.unsaved.title'),
      'cancel',
      (body, buttons, close) => {
        const message =
          names.length === 1
            ? t('dialog.unsaved.messageOne', { name: names[0] })
            : t('dialog.unsaved.messageMany', { n: names.length, names: names.join(', ') });
        body.append(el('p', { text: message }));
        buttons.append(
          dialogButton(t('dialog.unsaved.cancel'), false, false, () => close('cancel')),
          dialogButton(
            names.length === 1 ? t('dialog.unsaved.discard') : t('dialog.unsaved.discardAll'),
            false,
            false,
            () => close('discard'),
          ),
          dialogButton(t('dialog.unsaved.save'), true, true, () => close('save')),
        );
      },
    );
  }

  /** See `FileIoDialogs.chooseSaveOptions` for the full behavior contract. */
  chooseSaveOptions(tab: Tab, downloadNote: string | null): Promise<SaveOptions | null> {
    return this.fileIo.chooseSaveOptions(tab, downloadNote);
  }

  /** See `FileIoDialogs.confirmUnrepresentable` for the full behavior contract. */
  confirmUnrepresentable(encodingLabel: string, cells: UnrepresentableCell[]): Promise<boolean> {
    return this.fileIo.confirmUnrepresentable(encodingLabel, cells);
  }

  /** See `FileIoDialogs.notifyNcr` for the full behavior contract. */
  notifyNcr(reports: NcrCellReport[]): Promise<void> {
    return this.fileIo.notifyNcr(reports);
  }

  /** See `FileIoDialogs.confirmUndecodableEdit` for the full behavior contract. */
  confirmUndecodableEdit(cells: Array<{ row: number; col: number }>): Promise<boolean> {
    return this.fileIo.confirmUndecodableEdit(cells);
  }

  /** See `FileIoDialogs.chooseReopen` for the full behavior contract. */
  chooseReopen(tab: Tab): Promise<{ encoding: EncodingId; delimiter: DelimiterId } | null> {
    return this.fileIo.chooseReopen(tab);
  }

  /** Explain and confirm the explicit CSV -> RSF spreadsheet conversion. See `FileIoDialogs.confirmConvert`. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean> {
    return this.fileIo.confirmConvert(reason, name);
  }

  /** Explain that spreadsheet documents are saved in the .rsf format. See `FileIoDialogs.explainRsfSave`. */
  explainRsfSave(name: string): Promise<boolean> {
    return this.fileIo.explainRsfSave(name);
  }

  /** See `FileIoDialogs.chooseRsfSave` for the full behavior contract. */
  chooseRsfSave(
    name: string,
    current: number,
    available: number[],
    downloadNote: string | null,
  ): Promise<number | null> {
    return this.fileIo.chooseRsfSave(name, current, available, downloadNote);
  }

  /** See `FileIoDialogs.chooseExportCsv` for the full behavior contract. */
  chooseExportCsv(name: string): Promise<CsvExportOptions | null> {
    return this.fileIo.chooseExportCsv(name);
  }

  /** Explain and confirm the lossy XLSX export. See `FileIoDialogs.confirmExportXlsx`. */
  confirmExportXlsx(name: string): Promise<boolean> {
    return this.fileIo.confirmExportXlsx(name);
  }

  /**
   * The Flash Fill preview: the inferred operation, the affected range, the
   * change/overwrite counts, and a bounded before/after sample table. The
   * native <dialog> provides the focus trap and Escape-to-cancel; applying
   * requires pressing the explicit Apply button. All content is text-only.
   */
  confirmFlashFill(preview: FlashFillPreview): Promise<boolean> {
    return openDialog(t('dialog.flashFill.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.flashFill.op', { desc: preview.description }) }));
      body.append(
        el('p', {
          text: t('dialog.flashFill.summary', { range: preview.range, n: preview.changeCount }),
        }),
      );
      if (preview.overwriteCount > 0) {
        body.append(
          el('p', {
            className: 'dialog-warning',
            text: t('dialog.flashFill.overwriteWarning', { n: preview.overwriteCount }),
          }),
        );
      }
      const table = el('table', { className: 'diag-table' });
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: t('dialog.flashFill.col.cell') }),
            el('th', { text: t('dialog.flashFill.col.before') }),
            el('th', { text: t('dialog.flashFill.col.after') }),
          ]),
        ]),
      );
      const tbody = el('tbody');
      for (const row of preview.sample) {
        tbody.append(
          el('tr', {}, [
            el('td', { text: row.cell }),
            el('td', { text: row.before }),
            el('td', { text: row.after }),
          ]),
        );
      }
      table.append(tbody);
      body.append(table);
      if (preview.changeCount > preview.sample.length) {
        body.append(
          el('p', {
            className: 'dialog-note',
            text: t('dialog.flashFill.sampleNote', { n: preview.changeCount - preview.sample.length }),
          }),
        );
      }
      body.append(el('p', { className: 'dialog-note', text: t('dialog.flashFill.note') }));
      buttons.append(
        dialogButton(t('dialog.flashFill.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.flashFill.apply'), true, false, () => close(true)),
      );
    });
  }

  /** See `SheetOpsDialogs.chooseFilter` for the full behavior contract. */
  chooseFilter(input: FilterDialogInput): Promise<FilterDialogResult | null> {
    return this.sheetOps.chooseFilter(input);
  }

  /** See `SheetOpsDialogs.chooseSort` for the full behavior contract. */
  chooseSort(input: SortDialogInput): Promise<SortDialogResult | null> {
    return this.sheetOps.chooseSort(input);
  }

  /** See `SheetOpsDialogs.chooseDataValidation` for the full behavior contract. */
  chooseDataValidation(input: DataValidationDialogInput): Promise<DataValidationDialogResult | null> {
    return this.sheetOps.chooseDataValidation(input);
  }

  /** See `SheetOpsDialogs.chooseCellComment` for the full behavior contract. */
  chooseCellComment(input: CellCommentDialogInput): Promise<CellCommentDialogResult | null> {
    return this.sheetOps.chooseCellComment(input);
  }

  /** See `SheetOpsDialogs.chooseInsertShift` for the full behavior contract. */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null> {
    return this.sheetOps.chooseInsertShift(rows, cols);
  }

  /** See `SheetOpsDialogs.promptSheetName` for the full behavior contract. */
  promptSheetName(
    mode: 'add' | 'rename' | 'duplicate',
    current: string,
    validate: (name: string) => string | null,
  ): Promise<string | null> {
    return this.sheetOps.promptSheetName(mode, current, validate);
  }

  /** See `SheetOpsDialogs.confirmDeleteSheet` for the full behavior contract. */
  confirmDeleteSheet(name: string, referenceCount: number): Promise<boolean> {
    return this.sheetOps.confirmDeleteSheet(name, referenceCount);
  }

  /** See `SheetOpsDialogs.confirmRangeMoveOverwrite` for the full behavior contract. */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean> {
    return this.sheetOps.confirmRangeMoveOverwrite(input);
  }

  /** See `SheetOpsDialogs.promptMoveTarget` for the full behavior contract. */
  promptMoveTarget(
    source: string,
    suggestion: string,
    validate: (text: string) => string | null,
  ): Promise<string | null> {
    return this.sheetOps.promptMoveTarget(source, suggestion, validate);
  }

  /** See `SheetOpsDialogs.confirmReplaceAllWorkbook` for the full behavior contract. */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean> {
    return this.sheetOps.confirmReplaceAllWorkbook(input);
  }

  /** See `FormatDialogs.chooseTextColor` for the full behavior contract. */
  chooseTextColor(current: string | null): Promise<ColorDialogResult | null> {
    return this.format.chooseTextColor(current);
  }

  /** See `FormatDialogs.chooseBackgroundColor` for the full behavior contract. */
  chooseBackgroundColor(current: string | null): Promise<ColorDialogResult | null> {
    return this.format.chooseBackgroundColor(current);
  }

  /** See `FormatDialogs.chooseBorders` for the full behavior contract. */
  chooseBorders(
    current: Partial<Record<BorderSide, string>>,
    currentLineStyle: BorderLineStyle | null,
    currentWidth: BorderWidth | null,
  ): Promise<BordersDialogResult | null> {
    return this.format.chooseBorders(current, currentLineStyle, currentWidth);
  }

  /** See `FormatDialogs.chooseNumberFormat` for the full behavior contract. */
  chooseNumberFormat(current: NumberFormat | null): Promise<NumberFormatDialogResult | null> {
    return this.format.chooseNumberFormat(current);
  }

  /**
   * Choose which worksheet a multi-worksheet workbook exports to CSV. See
   * `FileIoDialogs.chooseExportSheet` for the full behavior contract.
   */
  chooseExportSheet(sheets: Array<{ id: string; name: string }>, currentId: string): Promise<string | null> {
    return this.fileIo.chooseExportSheet(sheets, currentId);
  }

  /** See `AppSettingsDialogs.chooseSettings` for the full behavior contract. */
  chooseSettings(currentMaxFileSize: number): Promise<number | null> {
    return this.appSettings.chooseSettings(currentMaxFileSize);
  }

  /** See `AppSettingsDialogs.chooseTimezone` for the full behavior contract. */
  chooseTimezone(current: string): Promise<string | null> {
    return this.appSettings.chooseTimezone(current);
  }

  /** See `AppSettingsDialogs.chooseDisplayLanguage` for the full behavior contract. */
  chooseDisplayLanguage(current: LocaleId): Promise<LocaleId | null> {
    return this.appSettings.chooseDisplayLanguage(current);
  }

  confirm(title: string, message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
    return openDialog(title, false, (body, buttons, close) => {
      body.append(el('p', { text: message }));
      buttons.append(
        dialogButton(cancelLabel, false, false, () => close(false)),
        dialogButton(okLabel, true, true, () => close(true)),
      );
    });
  }

  showMessage(title: string, message: string): Promise<void> {
    return openDialog<void>(title, undefined, (body, buttons, close) => {
      body.append(el('p', { text: message }));
      buttons.append(dialogButton(t('dialog.ok'), true, true, () => close(undefined)));
    });
  }

  /** See `AppSettingsDialogs.showAbout` for the full behavior contract. */
  showAbout(section: 'about' | 'shortcuts' = 'about'): Promise<void> {
    return this.appSettings.showAbout(section);
  }

  /** See `AppSettingsDialogs.showFormulaHelp` for the full behavior contract. */
  showFormulaHelp(): Promise<void> {
    return this.appSettings.showFormulaHelp();
  }

  /** See `SqlQueryDialogs.showSqlQuery` for the full behavior contract. */
  showSqlQuery(input: SqlQueryDialogInput): Promise<void> {
    return this.sqlQuery.showSqlQuery(input);
  }

  /** See `DiffDialogs.showDiff` for the full behavior contract. */
  showDiff(input: DiffDialogInput): Promise<void> {
    return this.diff.showDiff(input);
  }
}

/** Non-blocking toast notifications. */
export class Toasts {
  readonly element: HTMLElement;

  constructor() {
    this.element = el('div', { className: 'toasts', attrs: { 'aria-live': 'polite' } });
  }

  notify(text: string, kind: 'info' | 'warn' | 'error'): void {
    const toast = el('div', {
      className: kind === 'info' ? 'toast' : `toast ${kind}`,
      text,
      attrs: { role: kind === 'error' ? 'alert' : 'status' },
    });
    this.element.append(toast);
    setTimeout(() => toast.remove(), 7000);
  }
}
