// SPDX-License-Identifier: MIT
import type { Tab } from '../app/app-state';
import type { ConvertReason, FlashFillPreview } from '../app/commands';
import { t } from '../app/i18n';
import { SHORTCUT_DOCS } from '../app/shortcuts';
import { FUNCTION_INFOS } from '../core/formula';
import {
  bytesToMiB,
  miBToBytes,
  clampMaxFileSize,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
} from '../app/settings';
import type { DelimiterId } from '../core/byte-csv-parser';
import type { CsvExportOptions, CsvLineEnding } from '../core/csv-export';
import type { EncodingId } from '../core/encoding';
import { rsfMethodKey } from '../core/rsf-codec';
import type { NcrCellReport, SaveOptions, UnrepresentableCell } from '../core/serializer';
import type { ValidationSummary } from '../core/validation';
import { APP_VERSION_DISPLAY } from '../app/version';
import { el } from './dom';

function cellName(row: number, col: number): string {
  return `R${row + 1}C${col + 1}`;
}

function cellList(cells: Array<{ row: number; col: number }>, extra?: (i: number) => string): string {
  const shown = cells.slice(0, 10).map((c, i) => cellName(c.row, c.col) + (extra ? extra(i) : ''));
  return shown.join(', ') + (cells.length > 10 ? ` … (+${cells.length - 10})` : '');
}

type DialogBuilder<T> = (body: HTMLElement, buttons: HTMLElement, close: (value: T) => void) => void;

/**
 * Modal dialogs built on the native <dialog> element, which provides the
 * focus trap and Escape handling. All content is added via textContent.
 */
function openDialog<T>(title: string, fallback: T, build: DialogBuilder<T>): Promise<T> {
  return new Promise((resolve) => {
    const dialog = el('dialog', { attrs: { 'aria-labelledby': 'dialog-title' } });
    const heading = el('h2', { className: 'dialog-title', text: title, attrs: { id: 'dialog-title' } });
    const body = el('div', { className: 'dialog-body' });
    const buttons = el('div', { className: 'dialog-buttons' });
    dialog.append(heading, body, buttons);

    let settled = false;
    const finish = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      resolve(value);
    };
    // Escape triggers 'cancel'; some environments never fire 'close', so the
    // promise is settled directly rather than from the 'close' event.
    dialog.addEventListener('cancel', () => finish(fallback));
    dialog.addEventListener('close', () => finish(fallback));
    build(body, buttons, finish);
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  });
}

function dialogButton(
  label: string,
  primary: boolean,
  autofocus: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = el('button', {
    className: primary ? 'primary' : '',
    text: label,
    attrs: { type: 'button', ...(autofocus ? { 'data-autofocus': 'true' } : {}) },
  });
  button.addEventListener('click', onClick);
  return button;
}

export class Dialogs {
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

  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null> {
    return openDialog<'right' | 'down' | null>(
      t('dialog.insertCells.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.insertCells.message', { rows, cols }) }));
        body.append(el('p', { className: 'dialog-note', text: t('dialog.insertCells.note') }));
        buttons.append(
          dialogButton(t('dialog.insertCells.cancel'), false, true, () => close(null)),
          dialogButton(t('dialog.insertCells.right'), false, false, () => close('right')),
          dialogButton(t('dialog.insertCells.down'), true, false, () => close('down')),
        );
      },
    );
  }

  /**
   * Edit local settings. Currently the maximum file-size limit (in MiB).
   * Returns the chosen limit in bytes, or null when cancelled. The value is
   * clamped into the supported range before being returned.
   */
  chooseSettings(currentMaxFileSize: number): Promise<number | null> {
    return openDialog<number | null>(t('dialog.settings.title'), null, (body, buttons, close) => {
      const minMiB = bytesToMiB(MIN_MAX_FILE_SIZE);
      const maxMiB = bytesToMiB(MAX_MAX_FILE_SIZE);
      const input = el('input', {
        attrs: {
          type: 'number',
          min: String(minMiB),
          max: String(maxMiB),
          step: '1',
          'data-autofocus': 'true',
          'aria-describedby': 'settings-maxsize-help',
        },
      });
      input.value = String(bytesToMiB(currentMaxFileSize));

      body.append(
        el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.settings.maxFileSize') }, [
            input,
            el('span', { className: 'form-unit', text: t('dialog.settings.mib') }),
          ]),
        ]),
        el('p', {
          className: 'dialog-note',
          text: t('dialog.settings.range', { min: minMiB, max: maxMiB }),
          attrs: { id: 'settings-maxsize-help' },
        }),
        el('p', { className: 'dialog-note', text: t('dialog.settings.note') }),
        el('p', { className: 'dialog-note', text: t('dialog.settings.local') }),
      );

      buttons.append(
        dialogButton(t('dialog.settings.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.settings.save'), true, false, () => {
          const mib = Number(input.value);
          if (!Number.isFinite(mib) || mib <= 0) {
            close(null);
            return;
          }
          close(clampMaxFileSize(miBToBytes(mib)));
        }),
      );
    });
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

  showAbout(): Promise<void> {
    return openDialog<void>(t('dialog.about.title'), undefined, (body, buttons, close) => {
      body.append(
        el('p', {
          className: 'about-version',
          text: t('dialog.about.version', { version: APP_VERSION_DISPLAY }),
        }),
      );
      body.append(el('p', { text: t('dialog.about.tagline') }));
      body.append(el('p', { text: t('dialog.about.body') }));
      body.append(el('h3', { text: t('dialog.about.shortcuts') }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.about.shortcutsNote') }));
      const table = el('table', { className: 'shortcut-table' });
      for (const { keys, descKey } of SHORTCUT_DOCS) {
        table.append(el('tr', {}, [el('td', { text: keys }), el('td', { text: t(descKey) })]));
      }
      body.append(table);
      body.append(el('h3', { text: t('dialog.about.appearance') }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.about.appearanceNote') }));
      body.append(el('p', { className: 'dialog-note', text: 'MIT License — Copyright (c) 2026 0x0da160' }));
      buttons.append(dialogButton(t('dialog.close'), true, true, () => close(undefined)));
    });
  }

  /**
   * Offline, searchable formula & function help. Function entries are built
   * from `FUNCTION_INFOS` (the same source autocomplete and the evaluator use),
   * so the help can never list a function that is not implemented. Fully
   * keyboard operable via the native <dialog>; the search box filters both the
   * reference sections and the function rows.
   */
  showFormulaHelp(): Promise<void> {
    return openDialog<void>(t('dialog.formulaHelp.title'), undefined, (body, buttons, close) => {
      body.classList.add('formula-help');
      body.append(el('p', { text: t('dialog.formulaHelp.intro') }));

      // ----- Search box -----
      const search = el('input', {
        className: 'formula-help-search',
        attrs: {
          type: 'search',
          'data-autofocus': 'true',
          placeholder: t('dialog.formulaHelp.search'),
          'aria-label': t('dialog.formulaHelp.search'),
        },
      });
      body.append(el('div', { className: 'form-row' }, [search]));

      // Each entry is a searchable block; `text` is matched case-insensitively.
      const entries: Array<{ el: HTMLElement; text: string }> = [];
      const section = (headingKey: string, ...blocks: HTMLElement[]): HTMLElement => {
        const sec = el('section', { className: 'help-section' }, [
          el('h3', { text: t(headingKey) }),
          ...blocks,
        ]);
        entries.push({ el: sec, text: sec.textContent?.toLowerCase() ?? '' });
        return sec;
      };
      const p = (key: string): HTMLElement => el('p', { text: t(key) });
      const code = (text: string): HTMLElement => el('code', { className: 'help-code', text });
      const codeList = (samples: string[]): HTMLElement =>
        el(
          'p',
          { className: 'help-examples' },
          samples.flatMap((s, i) => (i === 0 ? [code(s)] : [document.createTextNode(' '), code(s)])),
        );

      body.append(section('dialog.formulaHelp.section.syntax', p('dialog.formulaHelp.syntaxBody')));
      body.append(
        section(
          'dialog.formulaHelp.section.references',
          p('dialog.formulaHelp.referencesBody'),
          codeList(['A1', 'B2', 'AA10', '$A$1', '$A1', 'A$1']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.ranges',
          p('dialog.formulaHelp.rangesBody'),
          codeList(['A1:B10', 'A:A', 'A:C', '1:1', '2:10']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.operators',
          p('dialog.formulaHelp.operatorsBody'),
          codeList(['+', '-', '*', '/', '( )', '=', '<>', '<', '>', '<=', '>=']),
        ),
      );

      // ----- Functions table (from the shared source of truth) -----
      const funcSection = el('section', { className: 'help-section' }, [
        el('h3', { text: t('dialog.formulaHelp.section.functions') }),
      ]);
      const table = el('table', { className: 'help-fn-table' });
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: t('dialog.formulaHelp.col.function') }),
            el('th', { text: t('dialog.formulaHelp.col.description') }),
            el('th', { text: t('dialog.formulaHelp.col.example') }),
          ]),
        ]),
      );
      const tbody = el('tbody');
      const fnRows: Array<{ row: HTMLElement; text: string }> = [];
      for (const info of FUNCTION_INFOS) {
        const desc = t(`formula.fn.${info.name}`);
        const row = el('tr', {}, [
          el('td', {}, [code(info.signature)]),
          el('td', { text: desc }),
          el('td', {}, [code(info.example)]),
        ]);
        tbody.append(row);
        fnRows.push({ row, text: `${info.name} ${info.signature} ${desc} ${info.example}`.toLowerCase() });
      }
      table.append(tbody);
      funcSection.append(table);
      body.append(funcSection);

      // ----- Errors -----
      const errorList = el('ul', { className: 'help-errors' });
      const errors: Array<[string, string]> = [
        ['#ERROR!', 'dialog.formulaHelp.err.error'],
        ['#NAME?', 'dialog.formulaHelp.err.name'],
        ['#VALUE!', 'dialog.formulaHelp.err.value'],
        ['#DIV/0!', 'dialog.formulaHelp.err.div0'],
        ['#REF!', 'dialog.formulaHelp.err.ref'],
        ['#CYCLE!', 'dialog.formulaHelp.err.cycle'],
      ];
      for (const [errCode, descKey] of errors) {
        errorList.append(el('li', {}, [code(errCode), document.createTextNode(` — ${t(descKey)}`)]));
      }
      body.append(
        section('dialog.formulaHelp.section.errors', p('dialog.formulaHelp.errorsIntro'), errorList),
      );

      body.append(
        section('dialog.formulaHelp.section.autocomplete', p('dialog.formulaHelp.autocompleteBody')),
      );

      const noResults = el('p', { className: 'dialog-note', text: t('dialog.formulaHelp.noResults') });
      noResults.hidden = true;
      body.append(noResults);

      const applyFilter = (): void => {
        const q = search.value.trim().toLowerCase();
        let anyVisible = false;
        for (const entry of entries) {
          const show = q === '' || entry.text.includes(q);
          entry.el.hidden = !show;
          anyVisible = anyVisible || show;
        }
        let anyRow = false;
        for (const { row, text } of fnRows) {
          const show = q === '' || text.includes(q);
          row.hidden = !show;
          anyRow = anyRow || show;
        }
        funcSection.hidden = !anyRow;
        anyVisible = anyVisible || anyRow;
        noResults.hidden = anyVisible;
      };
      search.addEventListener('input', applyFilter);

      buttons.append(dialogButton(t('dialog.close'), true, false, () => close(undefined)));
    });
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
