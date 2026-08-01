// SPDX-License-Identifier: MIT
import type { Tab } from '../../app/app-state';
import type { ConvertReason } from '../../app/commands';
import { t } from '../../app/i18n';
import type { DelimiterId } from '../../core/byte-csv-parser';
import type { CsvExportOptions, CsvLineEnding } from '../../core/csv-export';
import type { EncodingId } from '../../core/encoding';
import { rsfMethodKey } from '../../core/rsf-codec';
import type { NcrCellReport, SaveOptions, UnrepresentableCell } from '../../core/serializer';
import { el } from '../dom';
import { cellList, dialogButton, openDialog } from './shared';

/**
 * File I/O and CSV/RSF conversion dialogs: save options, encoding/delimiter
 * reopen, RSF/CSV/XLSX save and export, and the NCR/unrepresentable-character
 * warnings that accompany them. Extracted from `Dialogs` as a cohesive slice
 * (see issue #133, mirroring `FileIoCommands` in `src/app/commands/file-io.ts`)
 * — `Dialogs` still implements the same `UiPort` dialog surface, delegating to
 * an instance of this class.
 */
export class FileIoDialogs {
  chooseSaveOptions(tab: Tab, downloadNote: string | null): Promise<SaveOptions | null> {
    const doc = tab.doc;
    if (doc.kind !== 'csv') {
      // Save-with-options applies only to byte-preserving CSV documents.
      return Promise.resolve(null);
    }
    return openDialog<SaveOptions | null>(t('dialog.saveOptions.title'), null, (body, buttons, close) => {
      const makeSelect = (
        labelText: string,
        options: Array<{ value: string; label: string }>,
      ): { row: HTMLElement; select: HTMLSelectElement } => {
        const select = el('select');
        for (const opt of options) {
          select.append(el('option', { text: opt.label, attrs: { value: opt.value } }));
        }
        const row = el('div', { className: 'form-row' }, [el('label', { text: labelText }, [select])]);
        return { row, select };
      };

      const keep = t('dialog.saveOptions.keep');
      const encoding = makeSelect(t('dialog.saveOptions.encoding'), [
        { value: 'keep', label: `${keep} (${t(`encoding.${doc.encoding}`)})` },
        { value: 'utf-8', label: t('encoding.utf-8') },
        { value: 'shift_jis', label: t('encoding.shift_jis') },
        { value: 'euc-jp', label: t('encoding.euc-jp') },
      ]);
      const bom = makeSelect(t('dialog.saveOptions.bom'), [
        {
          value: 'keep',
          label: `${keep} (${doc.bomLength > 0 ? t('status.bom.yes') : t('status.bom.no')})`,
        },
        { value: 'add', label: t('dialog.saveOptions.bom.add') },
        { value: 'remove', label: t('dialog.saveOptions.bom.remove') },
      ]);
      const lineEnding = makeSelect(t('dialog.saveOptions.lineEnding'), [
        { value: 'keep', label: keep },
        { value: 'crlf', label: 'CRLF (\\r\\n)' },
        { value: 'lf', label: 'LF (\\n)' },
        { value: 'cr', label: 'CR (\\r)' },
      ]);

      const reencodeWarning = el('p', {
        className: 'dialog-warning',
        text: t('dialog.saveOptions.reencodeWarning'),
      });
      reencodeWarning.hidden = true;
      const updateState = () => {
        const enc = encoding.select.value;
        const effective = enc === 'keep' ? doc.encoding : enc;
        bom.select.disabled = effective !== 'utf-8';
        reencodeWarning.hidden = enc === 'keep' || enc === doc.encoding;
      };
      encoding.select.addEventListener('change', updateState);
      updateState();

      body.append(encoding.row, bom.row, lineEnding.row, reencodeWarning);
      if (downloadNote) {
        body.append(el('p', { className: 'dialog-note', text: downloadNote }));
      }
      body.append(el('p', { className: 'dialog-note', text: t('dialog.saveOptions.injectionWarning') }));

      buttons.append(
        dialogButton(t('dialog.saveOptions.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.saveOptions.save'), true, true, () =>
          close({
            encoding: encoding.select.value as SaveOptions['encoding'],
            bom: bom.select.disabled ? 'keep' : (bom.select.value as SaveOptions['bom']),
            lineEnding: lineEnding.select.value as SaveOptions['lineEnding'],
          }),
        ),
      );
    });
  }

  confirmUnrepresentable(encodingLabel: string, cells: UnrepresentableCell[]): Promise<boolean> {
    return openDialog(t('dialog.unrepresentable.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.unrepresentable.message', { encoding: encodingLabel }) }));
      body.append(
        el('p', {
          className: 'dialog-note',
          text: t('dialog.unrepresentable.list', {
            list: cellList(cells, (i) => ` (${cells[i].chars.slice(0, 5).join(' ')})`),
          }),
        }),
      );
      buttons.append(
        dialogButton(t('dialog.unrepresentable.cancel'), true, true, () => close(false)),
        dialogButton(t('dialog.unrepresentable.continueNcr'), false, false, () => close(true)),
      );
    });
  }

  notifyNcr(reports: NcrCellReport[]): Promise<void> {
    const total = reports.reduce((sum, r) => sum + r.count, 0);
    return openDialog<void>(t('dialog.ncrDone.title'), undefined, (body, buttons, close) => {
      body.append(
        el('p', {
          text: t('dialog.ncrDone.message', {
            count: total,
            cells: reports.length,
            list: cellList(reports, (i) => `: ${reports[i].count}`),
          }),
        }),
      );
      buttons.append(dialogButton(t('dialog.ok'), true, true, () => close(undefined)));
    });
  }

  confirmUndecodableEdit(cells: Array<{ row: number; col: number }>): Promise<boolean> {
    return openDialog(t('dialog.undecodableEdit.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.undecodableEdit.message', { list: cellList(cells) }) }));
      buttons.append(
        dialogButton(t('dialog.undecodableEdit.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.undecodableEdit.continue'), true, false, () => close(true)),
      );
    });
  }

  chooseReopen(tab: Tab): Promise<{ encoding: EncodingId; delimiter: DelimiterId } | null> {
    const doc = tab.doc;
    if (doc.kind !== 'csv') {
      // Reinterpretation applies only to byte-preserving CSV documents.
      return Promise.resolve(null);
    }
    return openDialog<{ encoding: EncodingId; delimiter: DelimiterId } | null>(
      t('dialog.reopen.title'),
      null,
      (body, buttons, close) => {
        const encodingSelect = el('select');
        for (const enc of ['utf-8', 'shift_jis', 'euc-jp'] as EncodingId[]) {
          encodingSelect.append(el('option', { text: t(`encoding.${enc}`), attrs: { value: enc } }));
        }
        encodingSelect.value = doc.encoding;
        const delimiterSelect = el('select');
        for (const [value, key] of [
          [',', 'status.delimiter.comma'],
          [';', 'status.delimiter.semicolon'],
          ['\t', 'status.delimiter.tab'],
        ] as const) {
          delimiterSelect.append(el('option', { text: t(key), attrs: { value } }));
        }
        delimiterSelect.value = doc.delimiter;
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', { text: t('dialog.reopen.encoding') }, [encodingSelect]),
          ]),
          el('div', { className: 'form-row' }, [
            el('label', { text: t('dialog.reopen.delimiter') }, [delimiterSelect]),
          ]),
          el('p', {
            className: tab.doc.isDirty ? 'dialog-warning' : 'dialog-note',
            text: t('dialog.reopen.warning'),
          }),
        );
        buttons.append(
          dialogButton(t('dialog.reopen.cancel'), false, false, () => close(null)),
          dialogButton(t('dialog.reopen.apply'), true, true, () =>
            close({
              encoding: encodingSelect.value as EncodingId,
              delimiter: delimiterSelect.value as DelimiterId,
            }),
          ),
        );
      },
    );
  }

  /** Explain and confirm the explicit CSV -> RSF spreadsheet conversion. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean> {
    return openDialog(t('dialog.convert.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t(`dialog.convert.${reason}`, { name }) }));
      // The explicit command opens a new tab (source preserved); the implicit
      // conversions convert the current tab in place.
      const noteKey = reason === 'command' ? 'dialog.convert.commandNote' : 'dialog.convert.note';
      body.append(el('p', { className: 'dialog-warning', text: t(noteKey) }));
      buttons.append(
        dialogButton(t('dialog.convert.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.convert.ok'), true, true, () => close(true)),
      );
    });
  }

  /** Explain that spreadsheet documents are saved in the .rsf format. */
  explainRsfSave(name: string): Promise<boolean> {
    return openDialog(t('dialog.rsfSave.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.rsfSave.message', { name }) }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.rsfSave.note') }));
      buttons.append(
        dialogButton(t('dialog.rsfSave.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.rsfSave.ok'), true, true, () => close(true)),
      );
    });
  }

  /**
   * The RSF Save dialog: explains the `.rsf` format and lets the user pick a
   * compression method. `available` lists only the methods the current build
   * can actually write (Zstandard is recommended and preselected for new
   * documents; an existing document preselects its own method). Resolves with
   * the chosen method id, or null on cancel.
   */
  chooseRsfSave(
    name: string,
    current: number,
    available: number[],
    downloadNote: string | null,
  ): Promise<number | null> {
    return openDialog<number | null>(t('dialog.rsfSave.title'), null, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.rsfSave.message', { name }) }));

      const select = el('select', { attrs: { id: 'rsf-compression' } }) as HTMLSelectElement;
      for (const method of available) {
        const option = el('option', {
          text: t(`${rsfMethodKey(method)}.label`),
          attrs: { value: String(method) },
        });
        if (method === current) {
          option.selected = true;
        }
        select.append(option);
      }
      body.append(
        el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.rsfSave.compression'), attrs: { for: 'rsf-compression' } }, [select]),
        ]),
      );

      // A live description of the highlighted method (ratio/speed trade-off).
      const desc = el('p', { className: 'dialog-note', text: t(`${rsfMethodKey(current)}.desc`) });
      const updateDesc = () => {
        desc.textContent = t(`${rsfMethodKey(Number(select.value))}.desc`);
      };
      select.addEventListener('change', updateDesc);
      body.append(desc);

      body.append(el('p', { className: 'dialog-note', text: t('dialog.rsfSave.note') }));
      if (downloadNote) {
        body.append(el('p', { className: 'dialog-note', text: downloadNote }));
      }
      buttons.append(
        dialogButton(t('dialog.rsfSave.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.rsfSave.ok'), true, true, () => close(Number(select.value))),
      );
    });
  }

  /**
   * CSV export options: encoding, line-ending style, and BOM behavior, with
   * the lossy-conversion explanation. Exporting requires pressing the
   * explicit Export button (Cancel/Escape resolve null); the BOM control is
   * disabled — with an explanation — for encodings where a BOM does not
   * apply. Values are validated against the chosen encoding by the caller.
   */
  chooseExportCsv(name: string): Promise<CsvExportOptions | null> {
    return openDialog<CsvExportOptions | null>(t('dialog.exportCsv.title'), null, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.exportCsv.message', { name }) }));
      body.append(el('p', { className: 'dialog-warning', text: t('dialog.exportCsv.warning') }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.exportCsv.notPreserved') }));

      const makeSelect = (
        labelText: string,
        options: Array<{ value: string; label: string }>,
      ): { row: HTMLElement; select: HTMLSelectElement } => {
        const select = el('select');
        for (const opt of options) {
          select.append(el('option', { text: opt.label, attrs: { value: opt.value } }));
        }
        const row = el('div', { className: 'form-row' }, [el('label', { text: labelText }, [select])]);
        return { row, select };
      };

      const encoding = makeSelect(t('dialog.exportCsv.encoding'), [
        { value: 'utf-8', label: t('encoding.utf-8') },
        { value: 'shift_jis', label: t('encoding.shift_jis') },
        { value: 'euc-jp', label: t('encoding.euc-jp') },
      ]);
      const bom = makeSelect(t('dialog.exportCsv.bom'), [
        { value: 'omit', label: t('dialog.saveOptions.bom.remove') },
        { value: 'include', label: t('dialog.saveOptions.bom.add') },
      ]);
      const lineEnding = makeSelect(t('dialog.exportCsv.lineEnding'), [
        { value: 'crlf', label: 'CRLF (\\r\\n)' },
        { value: 'lf', label: 'LF (\\n)' },
        { value: 'cr', label: 'CR (\\r)' },
      ]);

      const bomNote = el('p', { className: 'dialog-note', text: t('dialog.exportCsv.bomNote') });
      const updateBom = () => {
        // A BOM applies only to UTF-8; the control is disabled (and ignored)
        // for the other encodings.
        bom.select.disabled = encoding.select.value !== 'utf-8';
      };
      encoding.select.addEventListener('change', updateBom);
      updateBom();

      body.append(encoding.row, bom.row, bomNote, lineEnding.row);
      body.append(el('p', { className: 'dialog-note', text: t('dialog.saveOptions.injectionWarning') }));

      buttons.append(
        dialogButton(t('dialog.exportCsv.cancel'), false, true, () => close(null)),
        dialogButton(t('dialog.exportCsv.ok'), true, false, () =>
          close({
            encoding: encoding.select.value as EncodingId,
            bom: !bom.select.disabled && bom.select.value === 'include',
            lineEnding: lineEnding.select.value as CsvLineEnding,
          }),
        ),
      );
    });
  }

  /** Explain and confirm the lossy XLSX export: calculated values only, every worksheet included. */
  confirmExportXlsx(name: string): Promise<boolean> {
    return openDialog(t('dialog.exportXlsx.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.exportXlsx.message', { name }) }));
      body.append(el('p', { className: 'dialog-warning', text: t('dialog.exportXlsx.warning') }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.exportXlsx.notPreserved') }));
      buttons.append(
        dialogButton(t('dialog.exportXlsx.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.exportXlsx.ok'), true, true, () => close(true)),
      );
    });
  }

  /**
   * Choose which worksheet a multi-worksheet workbook exports to CSV. The
   * dialog states that CSV holds exactly one worksheet and that formulas are
   * written as their calculated values, so the choice doubles as the informed
   * confirmation of what the export will and will not contain.
   */
  chooseExportSheet(sheets: Array<{ id: string; name: string }>, currentId: string): Promise<string | null> {
    return openDialog<string | null>(t('dialog.exportSheet.title'), null, (body, buttons, close) => {
      const selectId = 'export-sheet-select';
      const select = el('select', {
        attrs: { id: selectId, 'data-autofocus': 'true' },
      }) as HTMLSelectElement;
      for (const sheet of sheets) {
        const option = el('option', { text: sheet.name, attrs: { value: sheet.id } }) as HTMLOptionElement;
        if (sheet.id === currentId) {
          option.selected = true;
        }
        select.append(option);
      }
      body.append(
        el('p', { text: t('dialog.exportSheet.message', { n: sheets.length }) }),
        el('label', { text: t('dialog.exportSheet.label'), attrs: { for: selectId } }),
        select,
        el('p', { className: 'dialog-note', text: t('dialog.exportSheet.note') }),
      );
      buttons.append(
        dialogButton(t('dialog.exportSheet.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.exportSheet.ok'), true, false, () => close(select.value)),
      );
    });
  }
}
