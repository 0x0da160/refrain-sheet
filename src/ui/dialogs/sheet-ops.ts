// SPDX-License-Identifier: MIT
import type { RangeMoveConfirmInput, WorkbookReplaceConfirmInput } from '../../app/commands';
import type { ColorDialogResult, SheetNameResult } from '../../app/ui-port';
import { t } from '../../app/i18n';
import { MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import type { AddSheetKind } from '../../core/workbook/grid-paper';
import { MAX_ROW_HEIGHT, MIN_ROW_HEIGHT } from '../../core/workbook/row-heights';
import { buildColorPicker } from '../color-picker';
import { el } from '../dom';
import { createIcon } from '../icon';
import {
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  Grid3x3,
  Table,
  type IconNode,
} from 'lucide';
import { formField, formFieldWithStatus } from './form-layout';
import { atStart, dialogButton, helpDetails, openDialog, submitOnEnter } from './shared';

/**
 * Worksheet-kind picker options for `promptSheetName`'s `mode === 'add'`
 * radio group — same icon set as the worksheet tab strip (`ui/sheet-bar.ts`)
 * so a worksheet's kind reads the same wherever it appears.
 */
const WORKSHEET_KIND_OPTIONS: ReadonlyArray<{ kind: AddSheetKind; labelKey: string; icon: IconNode }> = [
  { kind: 'grid', labelKey: 'sheets.kind.grid', icon: Table },
  { kind: 'csv', labelKey: 'sheets.kind.csv', icon: FileSpreadsheet },
  { kind: 'paper', labelKey: 'sheets.kind.paper', icon: Grid3x3 },
  { kind: 'markdown', labelKey: 'sheets.kind.markdown', icon: FileText },
  { kind: 'json', labelKey: 'sheets.kind.json', icon: FileJson },
  { kind: 'yaml', labelKey: 'sheets.kind.yaml', icon: FileCode },
  { kind: 'text', labelKey: 'sheets.kind.text', icon: FileType },
];

/** The Add Sheet dialog's sheet kinds, as a radio group of pills; `choose` gets each new pick. */
function kindPicker(initial: AddSheetKind, choose: (kind: AddSheetKind) => void): HTMLElement {
  const groupName = 'sheet-kind-picker';
  let selected = initial;
  const labels: HTMLElement[] = [];
  const updateSelectedClass = (): void => {
    for (const label of labels) {
      label.classList.toggle('selected', label.dataset.kind === selected);
    }
  };
  const radios = WORKSHEET_KIND_OPTIONS.map(({ kind, labelKey, icon }) => {
    const radioId = `${groupName}-${kind}`;
    const radio = el('input', {
      attrs: { type: 'radio', name: groupName, id: radioId, value: kind },
    }) as HTMLInputElement;
    radio.checked = kind === selected;
    radio.addEventListener('change', () => {
      if (!radio.checked) {
        return;
      }
      selected = kind;
      updateSelectedClass();
      choose(kind);
    });
    const label = el(
      'label',
      {
        className: 'sheet-kind-picker-option',
        attrs: { for: radioId, 'data-kind': kind },
      },
      [radio, createIcon(icon, 'sheet-kind-picker-icon', 16), el('span', { text: t(labelKey) })],
    );
    labels.push(label);
    return label;
  });
  updateSelectedClass();
  return el(
    'div',
    {
      className: 'sheet-kind-picker',
      attrs: { role: 'radiogroup', 'aria-label': t('dialog.sheetName.kind') },
    },
    radios,
  );
}

/** The Add Sheet dialog's way to fill new sheets from CSV files instead (the file chooser opens next). */
function fromCsvButton(choose: () => void): HTMLElement {
  const button = el('button', { className: 'sheet-kind-csv', attrs: { type: 'button' } }, [
    createIcon(FileSpreadsheet, 'sheet-kind-picker-icon', 16),
    el('span', { text: t('dialog.sheetName.fromCsv') }),
  ]);
  button.addEventListener('click', choose);
  return el('div', { className: 'form-inline' }, [button]);
}

/**
 * Sheet/range/filter dialogs: the column-filter popover, insert-shift
 * direction prompt, sheet name/move/delete prompts, and the range-move/
 * replace-all confirmations. Extracted from `Dialogs` as a cohesive slice
 * (see issue #181, following the `FileIoDialogs` split from #133) —
 * `Dialogs` still implements the same `UiPort` dialog surface, delegating to
 * an instance of this class.
 */
export class SheetOpsDialogs {
  /**
   * The Tab Color dialog: the shared color picker (color-picker.ts). Picking
   * a color applies it and closes; "No color" removes it; Cancel keeps it.
   */
  chooseSheetTabColor(current: string | null): Promise<ColorDialogResult | null> {
    return openDialog<ColorDialogResult | null>(
      t('dialog.tabColor.title'),
      null,
      (body, buttons, close) => {
        const picker = buildColorPicker({
          current,
          noneLabel: t('colorPicker.none'),
          onPick: (color) => close(color === null ? { action: 'clear' } : { action: 'apply', color }),
        });
        picker.id = 'sheet-tab-color-picker';
        body.append(picker);
        buttons.append(dialogButton(t('dialog.tabColor.cancel'), false, false, () => close(null)));
      },
      'sm',
    );
  }

  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null> {
    return openDialog<'right' | 'down' | null>(
      t('dialog.insertCells.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.insertCells.message', { rows, cols }) }));
        body.append(helpDetails(t('dialog.insertCells.note')));
        buttons.append(
          atStart(dialogButton(t('dialog.insertCells.right'), false, false, () => close('right'))),
          dialogButton(t('dialog.insertCells.cancel'), false, true, () => close(null)),
          dialogButton(t('dialog.insertCells.down'), true, false, () => close('down')),
        );
      },
      'sm',
    );
  }

  /**
   * Ask for a worksheet name (add / rename / duplicate), and — for
   * `mode === 'add'` only, when `kindOptions` is supplied — a worksheet-kind
   * picker rendered above the name field. Validation runs as the user types
   * and again on submit, reporting the problem inline through a live region
   * rather than silently refusing, and the confirm button stays disabled
   * while the name is unacceptable. Enter confirms and Escape cancels — both
   * ignored while an IME composition is in progress, so committing a
   * Japanese candidate with Enter never submits the dialog by accident.
   *
   * Switching the kind picker re-suggests the name via
   * `kindOptions.suggestName(kind)`, but only until the user types something
   * of their own — tracked by a simple "has the user touched the name field"
   * flag, so a deliberate custom name is never overwritten by a later kind
   * change.
   */
  promptSheetName(
    mode: 'add' | 'rename' | 'duplicate',
    current: string,
    validate: (name: string) => string | null,
    kindOptions?: { initialKind: AddSheetKind; suggestName: (kind: AddSheetKind) => string },
  ): Promise<SheetNameResult | null> {
    return openDialog<SheetNameResult | null>(
      t(`dialog.sheetName.title.${mode}`),
      null,
      (body, buttons, close) => {
        let selectedKind: AddSheetKind = kindOptions?.initialKind ?? 'grid';
        let nameTouchedByUser = false;

        const inputId = 'sheet-name-input';
        const errorId = 'sheet-name-error';
        const input = el('input', {
          className: 'sheet-name-input',
          attrs: {
            type: 'text',
            id: inputId,
            value: current,
            maxlength: String(MAX_SHEET_NAME_LENGTH),
            'aria-describedby': errorId,
            'data-autofocus': 'true',
          },
        }) as HTMLInputElement;
        input.value = current;
        const error = el('p', {
          className: 'dialog-error',
          attrs: { id: errorId, role: 'status', 'aria-live': 'polite' },
        });

        const okButton = dialogButton(t(`dialog.sheetName.ok.${mode}`), true, false, () => submit());
        const refresh = (): boolean => {
          const message = validate(input.value);
          error.textContent = message ?? '';
          okButton.disabled = message !== null;
          return message === null;
        };
        const submit = (): void => {
          if (refresh()) {
            close({ name: input.value.trim(), kind: selectedKind });
          }
        };

        if (mode === 'add' && kindOptions) {
          const picker = kindPicker(selectedKind, (kind) => {
            selectedKind = kind;
            if (!nameTouchedByUser) {
              input.value = kindOptions.suggestName(kind);
              refresh();
            }
          });
          body.append(
            picker,
            fromCsvButton(() => close({ name: '', kind: 'grid', fromCsv: true })),
          );
        }

        body.append(
          formFieldWithStatus(t('dialog.sheetName.label'), input, error, t('dialog.sheetName.rules')),
        );

        // Composition state is tracked explicitly: `isComposing` is not set on
        // the keydown that commits a candidate in every browser.
        let composing = false;
        input.addEventListener('compositionstart', () => {
          composing = true;
        });
        input.addEventListener('compositionend', () => {
          composing = false;
          nameTouchedByUser = true;
          refresh();
        });
        input.addEventListener('input', () => {
          nameTouchedByUser = true;
          if (!composing) {
            refresh();
          }
        });
        submitOnEnter(input, submit);
        refresh();
        buttons.append(
          dialogButton(t('dialog.sheetName.cancel'), false, false, () => close(null)),
          okButton,
        );
      },
      kindOptions ? 'md' : 'sm',
    );
  }

  /**
   * Confirm deleting a worksheet that holds content or is referenced by
   * formulas. The message states — truthfully — how many formulas elsewhere in
   * the workbook will become #REF!, because deletion never silently redirects
   * references to another worksheet, and how many charts elsewhere show it
   * (they keep the data they show now).
   */
  confirmDeleteSheet(name: string, referenceCount: number, chartCount = 0): Promise<boolean> {
    return openDialog<boolean>(
      t('dialog.deleteSheet.title'),
      false,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.deleteSheet.message', { name }) }));
        if (referenceCount > 0) {
          body.append(
            el('p', {
              className: 'dialog-note warn',
              text: t('dialog.deleteSheet.references', { n: referenceCount }),
            }),
          );
        }
        if (chartCount > 0) {
          body.append(
            el('p', {
              className: 'dialog-note warn',
              text: t('dialog.deleteSheet.charts', { n: chartCount }),
            }),
          );
        }
        body.append(el('p', { className: 'dialog-note', text: t('dialog.deleteSheet.undo') }));
        buttons.append(
          dialogButton(t('dialog.deleteSheet.cancel'), false, true, () => close(false)),
          dialogButton(t('dialog.deleteSheet.ok'), true, false, () => close(true)),
        );
      },
      'sm',
    );
  }

  /**
   * Confirm a range move whose destination already holds data. The destination
   * range and the exact number of cells that would be replaced are both stated,
   * and Cancel is the default action, so data is never replaced by accident.
   */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean> {
    return openDialog<boolean>(
      t('dialog.moveRange.overwriteTitle'),
      false,
      (body, buttons, close) => {
        body.append(
          el('p', {
            text: t('dialog.moveRange.overwriteMessage', {
              target: input.target,
              n: input.overwriteCount,
            }),
          }),
          el('p', { className: 'dialog-note', text: t('dialog.moveRange.overwriteUndo') }),
        );
        buttons.append(
          dialogButton(t('dialog.moveRange.cancel'), false, true, () => close(false)),
          dialogButton(t('dialog.moveRange.overwriteOk'), true, false, () => close(true)),
        );
      },
      'sm',
    );
  }

  /**
   * Ask where to move the selected cells — the keyboard path to the same move
   * the drag gesture performs. Validation runs on every keystroke and is shown
   * in a live region; OK stays disabled while the entry is unusable. Enter
   * confirms and Escape cancels, and neither fires while an IME composition is
   * in progress.
   */
  promptMoveTarget(
    source: string,
    suggestion: string,
    validate: (text: string) => string | null,
  ): Promise<string | null> {
    return openDialog<string | null>(
      t('dialog.moveRange.title'),
      null,
      (body, buttons, close) => {
        const inputId = 'move-target-input';
        const input = el('input', {
          className: 'move-target-input',
          attrs: { type: 'text', id: inputId, 'data-autofocus': 'true', autocomplete: 'off' },
        }) as HTMLInputElement;
        input.value = suggestion;
        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const submit = (): void => {
          if (!ok.disabled) {
            close(input.value.trim());
          }
        };
        const ok = dialogButton(t('dialog.moveRange.ok'), true, false, submit);
        const refresh = (): void => {
          const message = validate(input.value);
          error.textContent = message ?? '';
          ok.disabled = message !== null;
          input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
        };
        let composing = false;
        input.addEventListener('compositionstart', () => (composing = true));
        input.addEventListener('compositionend', () => {
          composing = false;
          refresh();
        });
        input.addEventListener('input', () => {
          if (!composing) refresh();
        });
        submitOnEnter(input, submit);
        body.append(
          el('p', { text: t('dialog.moveRange.message', { source }) }),
          formFieldWithStatus(t('dialog.moveRange.label'), input, error, t('dialog.moveRange.hint')),
        );
        buttons.append(
          dialogButton(t('dialog.moveRange.cancel'), false, true, () => close(null)),
          ok,
        );
        refresh();
      },
      'sm',
    );
  }

  /**
   * "Go to Cell…": ask for a cell reference to jump the selection to.
   * Validation runs on every keystroke and is shown in a live region; OK
   * stays disabled while the entry is unusable. Enter confirms and Escape
   * cancels, and neither fires while an IME composition is in progress.
   */
  promptGoToCell(suggestion: string, validate: (text: string) => string | null): Promise<string | null> {
    return openDialog<string | null>(
      t('dialog.goToCell.title'),
      null,
      (body, buttons, close) => {
        const inputId = 'go-to-cell-input';
        const input = el('input', {
          className: 'move-target-input',
          attrs: { type: 'text', id: inputId, 'data-autofocus': 'true', autocomplete: 'off' },
        }) as HTMLInputElement;
        input.value = suggestion;
        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const submit = (): void => {
          if (!ok.disabled) {
            close(input.value.trim());
          }
        };
        const ok = dialogButton(t('dialog.goToCell.ok'), true, false, submit);
        const refresh = (): void => {
          const message = validate(input.value);
          error.textContent = message ?? '';
          ok.disabled = message !== null;
          input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
        };
        let composing = false;
        input.addEventListener('compositionstart', () => (composing = true));
        input.addEventListener('compositionend', () => {
          composing = false;
          refresh();
        });
        input.addEventListener('input', () => {
          if (!composing) refresh();
        });
        submitOnEnter(input, submit);
        body.append(formFieldWithStatus(t('dialog.goToCell.label'), input, error, t('dialog.goToCell.hint')));
        buttons.append(
          dialogButton(t('dialog.goToCell.cancel'), false, true, () => close(null)),
          ok,
        );
        refresh();
      },
      'sm',
    );
  }

  /**
   * Format > Row Height…: a height in px for the selected rows. Resolves
   * with the height, `'auto'` to give the rows back their automatic height,
   * or null when cancelled.
   */
  promptRowHeight(current: number): Promise<number | 'auto' | null> {
    return openDialog<number | 'auto' | null>(
      t('dialog.rowHeight.title'),
      null,
      (body, buttons, close) => {
        const inputId = 'row-height-input';
        const input = el('input', {
          attrs: {
            type: 'number',
            id: inputId,
            min: String(MIN_ROW_HEIGHT),
            max: String(MAX_ROW_HEIGHT),
            step: '1',
            inputmode: 'numeric',
            'data-autofocus': 'true',
          },
        }) as HTMLInputElement;
        input.value = String(current);
        const value = (): number | null => {
          const n = Number(input.value);
          return input.value.trim() !== '' && Number.isFinite(n) && n >= MIN_ROW_HEIGHT && n <= MAX_ROW_HEIGHT
            ? Math.round(n)
            : null;
        };
        const submit = (): void => {
          const n = value();
          if (n !== null) {
            close(n);
          }
        };
        const ok = dialogButton(t('dialog.rowHeight.ok'), true, false, submit);
        input.addEventListener('input', () => {
          ok.disabled = value() === null;
          input.setAttribute('aria-invalid', ok.disabled ? 'true' : 'false');
        });
        submitOnEnter(input, submit);
        body.append(
          formField(
            t('dialog.rowHeight.label'),
            input,
            t('dialog.rowHeight.hint', { min: MIN_ROW_HEIGHT, max: MAX_ROW_HEIGHT }),
          ),
        );
        buttons.append(
          atStart(dialogButton(t('dialog.rowHeight.auto'), false, false, () => close('auto'))),
          dialogButton(t('dialog.rowHeight.cancel'), false, true, () => close(null)),
          ok,
        );
      },
      'sm',
    );
  }

  /**
   * Confirm a workbook-wide Replace All. The scope is stated explicitly — a
   * replace that reaches worksheets the user is not looking at must never be
   * a surprise — together with exactly how much it would change. Cancel is the
   * default action, and nothing is mutated until this resolves true.
   */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean> {
    return openDialog<boolean>(
      t('dialog.replaceWorkbook.title'),
      false,
      (body, buttons, close) => {
        body.append(
          el('p', {
            text: t('dialog.replaceWorkbook.message', {
              matches: input.matches,
              cells: input.cells,
              sheets: input.sheets,
              total: input.totalSheets,
            }),
          }),
          el('p', { className: 'dialog-note', text: t('dialog.replaceWorkbook.scope') }),
          el('p', { className: 'dialog-note', text: t('dialog.replaceWorkbook.undo') }),
        );
        buttons.append(
          dialogButton(t('dialog.replaceWorkbook.cancel'), false, true, () => close(false)),
          dialogButton(t('dialog.replaceWorkbook.ok'), true, false, () => close(true)),
        );
      },
      'sm',
    );
  }
}
