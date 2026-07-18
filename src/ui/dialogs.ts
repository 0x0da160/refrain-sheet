// SPDX-License-Identifier: MIT
import type { Tab } from '../app/app-state';
import type { ConvertReason } from '../app/commands';
import { t } from '../app/i18n';
import {
  bytesToMiB,
  miBToBytes,
  clampMaxFileSize,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
} from '../app/settings';
import type { DelimiterId } from '../core/byte-csv-parser';
import type { EncodingId } from '../core/encoding';
import type { NcrCellReport, SaveOptions, UnrepresentableCell } from '../core/serializer';
import type { ValidationSummary } from '../core/validation';
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

  /** Explain and confirm the explicit CSV -> RCSV spreadsheet conversion. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean> {
    return openDialog(t('dialog.convert.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t(`dialog.convert.${reason}`, { name }) }));
      body.append(el('p', { className: 'dialog-warning', text: t('dialog.convert.note') }));
      buttons.append(
        dialogButton(t('dialog.convert.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.convert.ok'), true, true, () => close(true)),
      );
    });
  }

  /** Explain that spreadsheet documents are saved in the .rcsv format. */
  explainRcsvSave(name: string): Promise<boolean> {
    return openDialog(t('dialog.rcsvSave.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.rcsvSave.message', { name }) }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.rcsvSave.note') }));
      buttons.append(
        dialogButton(t('dialog.rcsvSave.cancel'), false, false, () => close(false)),
        dialogButton(t('dialog.rcsvSave.ok'), true, true, () => close(true)),
      );
    });
  }

  /** Confirm the explicitly lossy CSV export of an RCSV document. */
  confirmExportCsv(name: string): Promise<boolean> {
    return openDialog(t('dialog.exportCsv.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.exportCsv.message', { name }) }));
      body.append(el('p', { className: 'dialog-warning', text: t('dialog.exportCsv.warning') }));
      buttons.append(
        dialogButton(t('dialog.exportCsv.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.exportCsv.ok'), true, false, () => close(true)),
      );
    });
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
      body.append(el('p', { text: t('dialog.about.tagline') }));
      body.append(el('p', { text: t('dialog.about.body') }));
      body.append(el('h3', { text: t('dialog.about.shortcuts') }));
      const table = el('table', { className: 'shortcut-table' });
      const rows: Array<[string, string]> = [
        ['Ctrl+O / Cmd+O', t('shortcut.open')],
        ['Ctrl+S / Cmd+S', t('shortcut.save')],
        ['Ctrl+W / Cmd+W', t('shortcut.closeTab')],
        ['Ctrl+Tab, Ctrl+PageDown / PageUp', t('shortcut.switchTab')],
        ['Ctrl+Z / Cmd+Z', t('shortcut.undo')],
        ['Ctrl+Y, Ctrl+Shift+Z / Cmd+Shift+Z', t('shortcut.redo')],
        ['Ctrl+C / Cmd+C', t('shortcut.copy')],
        ['Ctrl+V / Cmd+V', t('shortcut.paste')],
        ['Shift+Arrows', t('shortcut.extendSelection')],
        ['Ctrl+F / Cmd+F', t('shortcut.find')],
        ['Ctrl+H / Cmd+H', t('shortcut.replace')],
        ['F2', t('shortcut.editCell')],
        ['Enter', t('shortcut.commitDown')],
        ['Esc', t('shortcut.cancelEdit')],
      ];
      for (const [keys, desc] of rows) {
        table.append(el('tr', {}, [el('td', { text: keys }), el('td', { text: desc })]));
      }
      body.append(table);
      body.append(el('p', { className: 'dialog-note', text: 'MIT License — Copyright (c) 2026 0x0da160' }));
      buttons.append(dialogButton(t('dialog.close'), true, true, () => close(undefined)));
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
