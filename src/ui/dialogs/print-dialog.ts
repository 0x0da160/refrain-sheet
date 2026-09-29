// SPDX-License-Identifier: MIT
/**
 * The File > Print… side panel: what to print and how the page is set up.
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
import { dialogButton } from './shared';
import { openSidePanel, panelCheck, panelField, panelSection } from './side-panel';

export interface PrintPanelInput {
  settings: PrintSettings;
  /** Whether the document has several sheets to print ("Entire file"). */
  canPrintFile: boolean;
}

export function openPrintPanel(
  input: PrintPanelInput,
  onPrint: (settings: PrintSettings) => void,
): Promise<null> {
  return openSidePanel<PrintSettings | null>(
    { title: t('dialog.print.title'), icon: Printer, fallback: null, onApply: onPrint },
    (body, buttons, apply) => {
      const s = input.settings;
      const choice = <T extends string>(options: Array<[T, string]>, value: T): HTMLSelectElement => {
        const select = el('select') as HTMLSelectElement;
        for (const [key, label] of options) {
          select.append(el('option', { text: label, attrs: { value: key } }));
        }
        select.value = value;
        return select;
      };

      const scopes: Array<[PrintScope, string]> = [
        ['sheet', t('dialog.print.scope.sheet')],
        ['selection', t('dialog.print.scope.selection')],
      ];
      if (input.canPrintFile) {
        scopes.push(['file', t('dialog.print.scope.file')]);
      }
      const scope = choice(scopes, s.scope === 'file' && !input.canPrintFile ? 'sheet' : s.scope);
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
        panelSection(null, [panelField(t('dialog.print.scope'), scope)]),
        panelSection(t('dialog.print.page'), [
          el('div', { className: 'panel-grid' }, [
            panelField(t('dialog.print.paper'), paper),
            panelField(t('dialog.print.orientation'), orientation),
          ]),
          panelCheck(fit, t('dialog.print.fitWidth')),
          panelField(t('dialog.print.scale'), percent),
          panelField(t('dialog.print.rowsPerPage'), rowsPerPage, t('dialog.print.rowsPerPageHint')),
        ]),
        panelSection(t('dialog.print.show'), [
          panelCheck(gridlines, t('dialog.print.gridlines')),
          panelCheck(headings, t('dialog.print.headings')),
          panelCheck(repeat, t('dialog.print.repeatFirstRow')),
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
        if ((!fit.checked && !pctOk) || !rowsOk) {
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
        const ok = read() !== null;
        printBtn.disabled = !ok;
        error.textContent = ok
          ? ''
          : t('dialog.print.invalid', { min: MIN_PRINT_SCALE, max: MAX_PRINT_SCALE });
      };
      for (const control of [fit, percent, rowsPerPage]) {
        control.addEventListener('input', refresh);
        control.addEventListener('change', refresh);
      }
      refresh();
      buttons.append(printBtn);
    },
  ).then(() => null);
}
