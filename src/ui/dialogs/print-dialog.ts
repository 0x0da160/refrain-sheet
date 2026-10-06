// SPDX-License-Identifier: MIT
/**
 * The File > Print… side panel: what to print (the sheet, the selection,
 * a print area typed as a range, or the whole file) and how the page is set up.
 * Print hands the result to `onPrint` and leaves the panel open, so a
 * second print (another range, another paper) needs no reopening; only its
 * header × closes it.
 */
import { t } from '../../app/i18n';
import {
  MAX_PRINT_SCALE,
  MAX_ROWS_PER_PAGE,
  MIN_PRINT_SCALE,
  PAPER_SIZES,
  type PrintScope,
  type PrintSettings,
} from '../../core/print-layout';
import { el } from '../dom';
import { Printer } from 'lucide';
import { parsePrintArea } from '../../core/workbook/print-area';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';
import { formCheck, formField, formSection, formGrid } from './form-layout';

export interface PrintPanelInput {
  settings: PrintSettings;
  /** Whether the document has several sheets to print ("Entire file"). */
  canPrintFile: boolean;
  /** Whether the active sheet takes a print area (a CSV table or a grid sheet). */
  canPrintArea: boolean;
  /** The print area to start from (`"A1:F40"`): the sheet's own, else the selection. */
  area: string;
  /** Whether printing a typed area also sets it (false on a protected file or locked sheet). */
  keepsArea: boolean;
}

export function openPrintPanel(
  input: PrintPanelInput,
  onPrint: (settings: PrintSettings, area: string) => void,
): Promise<null> {
  const areaInput = el('input', {
    attrs: { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'A1:F40' },
  }) as HTMLInputElement;
  return openSidePanel<PrintSettings | null>(
    {
      title: t('dialog.print.title'),
      icon: Printer,
      fallback: null,
      onApply: (settings) => onPrint(settings, areaInput.value),
    },
    (body, buttons, apply) => {
      const s = input.settings;
      const { scope, areaField } = scopeFields(input, areaInput);
      const paper = choice(
        PAPER_SIZES.map((size) => [size, t(`dialog.print.paper.${size}`)]),
        s.paper,
      );
      const orientation = choice(
        [
          ['portrait', t('dialog.print.portrait')],
          ['landscape', t('dialog.print.landscape')],
        ],
        s.orientation,
      );
      const fit = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      fit.checked = s.scale === 'fit';
      const percent = el('input', {
        attrs: { type: 'number', min: String(MIN_PRINT_SCALE), max: String(MAX_PRINT_SCALE), step: '5' },
      }) as HTMLInputElement;
      percent.value = String(s.scale === 'fit' ? 100 : s.scale);
      const gridlines = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      gridlines.checked = s.gridlines;
      const headings = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      headings.checked = s.headings;
      const repeat = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
      repeat.checked = s.repeatFirstRow;
      const rowsPerPage = el('input', {
        attrs: { type: 'number', min: '0', max: String(MAX_ROWS_PER_PAGE), step: '1' },
      }) as HTMLInputElement;
      rowsPerPage.value = String(s.rowsPerPage);

      body.append(
        formSection(null, [formField(t('dialog.print.scope'), scope), areaField]),
        formSection(t('dialog.print.page'), [
          formGrid([
            formField(t('dialog.print.paper'), paper),
            formField(t('dialog.print.orientation'), orientation),
          ]),
          formCheck(fit, t('dialog.print.fitWidth')),
          formField(t('dialog.print.scale'), percent),
          formField(t('dialog.print.rowsPerPage'), rowsPerPage, t('dialog.print.rowsPerPageHint')),
        ]),
        formSection(t('dialog.print.show'), [
          formCheck(gridlines, t('dialog.print.gridlines')),
          formCheck(headings, t('dialog.print.headings')),
          formCheck(repeat, t('dialog.print.repeatFirstRow')),
        ]),
        el('p', { className: 'dialog-note', text: t('dialog.print.pdfHint') }),
      );
      const error = el('p', { className: 'dialog-error', attrs: { role: 'status', 'aria-live': 'polite' } });
      body.append(error);

      const read = (): PrintSettings | null => {
        const pct = Number(percent.value);
        const rows = rowsPerPage.value.trim() === '' ? 0 : Number(rowsPerPage.value);
        const pctOk = Number.isInteger(pct) && pct >= MIN_PRINT_SCALE && pct <= MAX_PRINT_SCALE;
        const rowsOk = Number.isInteger(rows) && rows >= 0 && rows <= MAX_ROWS_PER_PAGE;
        const areaOk = scope.value !== 'area' || parsePrintArea(areaInput.value) !== null;
        if ((!fit.checked && !pctOk) || !rowsOk || !areaOk) {
          return null;
        }
        return {
          scope: scope.value as PrintScope,
          paper: paper.value as PrintSettings['paper'],
          orientation: orientation.value as PrintSettings['orientation'],
          scale: fit.checked ? 'fit' : pct,
          gridlines: gridlines.checked,
          headings: headings.checked,
          repeatFirstRow: repeat.checked,
          rowsPerPage: rows,
        };
      };
      const printBtn = dialogButton(t('dialog.print.print'), true, false, () => {
        const settings = read();
        if (settings) {
          apply(settings);
        }
      });
      const refresh = (): void => {
        percent.disabled = fit.checked;
        areaField.hidden = scope.value !== 'area';
        const ok = read() !== null;
        printBtn.disabled = !ok;
        const areaBad = scope.value === 'area' && parsePrintArea(areaInput.value) === null;
        error.textContent = ok
          ? ''
          : areaBad
            ? t('dialog.print.areaInvalid')
            : t('dialog.print.invalid', { min: MIN_PRINT_SCALE, max: MAX_PRINT_SCALE });
      };
      for (const control of [fit, percent, rowsPerPage, scope, areaInput]) {
        control.addEventListener('input', refresh);
        control.addEventListener('change', refresh);
      }
      refresh();
      buttons.append(printBtn);
    },
  ).then(() => null);
}

function choice<T extends string>(options: Array<[T, string]>, value: T): HTMLSelectElement {
  const select = el('select') as HTMLSelectElement;
  for (const [key, label] of options) {
    select.append(el('option', { text: label, attrs: { value: key } }));
  }
  select.value = value;
  return select;
}

/** "What to print", and the range "Print area" prints (shown only for that choice). */
function scopeFields(
  input: PrintPanelInput,
  areaInput: HTMLInputElement,
): { scope: HTMLSelectElement; areaField: HTMLElement } {
  const scopes: Array<[PrintScope, string]> = [
    ['sheet', t('dialog.print.scope.sheet')],
    ['selection', t('dialog.print.scope.selection')],
  ];
  if (input.canPrintArea) {
    scopes.push(['area', t('dialog.print.scope.area')]);
  }
  if (input.canPrintFile) {
    scopes.push(['file', t('dialog.print.scope.file')]);
  }
  const wanted = input.settings.scope;
  const scope = choice(scopes, scopes.some(([key]) => key === wanted) ? wanted : 'sheet');
  areaInput.value = input.area;
  const hint = t(input.keepsArea ? 'dialog.print.areaHint' : 'dialog.print.areaHintOnce');
  return { scope, areaField: formField(t('dialog.print.area'), areaInput, hint) };
}
