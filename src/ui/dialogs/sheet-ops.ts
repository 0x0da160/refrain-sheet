// SPDX-License-Identifier: MIT
import type { RangeMoveConfirmInput, WorkbookReplaceConfirmInput } from '../../app/commands';
import type { ColorDialogResult } from '../../app/ui-port';
import { t } from '../../app/i18n';
import { MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import type { WorksheetKind } from '../../core/workbook/worksheet';
import { ensureSwatchList, SHEET_TAB_PRESETS } from '../document-colors';
import { el } from '../dom';
import { createIcon } from '../icon';
import { FileCode, FileJson, FileText, FileType, Table, type IconNode } from 'lucide';
import { dialogButton, helpDetails, openDialog, submitOnEnter } from './shared';

/**
 * Worksheet-kind picker options for `promptSheetName`'s `mode === 'add'`
 * radio group — same icon set as the worksheet tab strip (`ui/sheet-bar.ts`)
 * so a worksheet's kind reads the same wherever it appears.
 */
const WORKSHEET_KIND_OPTIONS: ReadonlyArray<{ kind: WorksheetKind; labelKey: string; icon: IconNode }> = [
  { kind: 'grid', labelKey: 'sheets.kind.grid', icon: Table },
  { kind: 'markdown', labelKey: 'sheets.kind.markdown', icon: FileText },
  { kind: 'json', labelKey: 'sheets.kind.json', icon: FileJson },
  { kind: 'yaml', labelKey: 'sheets.kind.yaml', icon: FileCode },
  { kind: 'text', labelKey: 'sheets.kind.text', icon: FileType },
];

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
   * The Tab Color dialog: one button per ready-made color (a radio-like
   * group, `aria-pressed` on the chosen one) and a native color picker for
   * any other color. Choosing a ready-made color fills the picker, so the
   * picker always shows what Apply will set. "No Color" removes it.
   */
  chooseSheetTabColor(current: string | null): Promise<ColorDialogResult | null> {
    return openDialog<ColorDialogResult | null>(t('dialog.tabColor.title'), null, (body, buttons, close) => {
      const picker = el('input', {
        className: 'panel-swatch',
        attrs: {
          type: 'color',
          id: 'sheet-tab-color-input',
          value: current ?? SHEET_TAB_PRESETS[0].color,
          list: ensureSwatchList(),
        },
      }) as HTMLInputElement;
      const presets: HTMLButtonElement[] = [];
      // With no color yet, the picker's starting value is only a suggestion,
      // so no ready-made color shows as chosen until the user picks one.
      let chosen = current !== null;
      const markPressed = (): void => {
        for (const preset of presets) {
          const pressed = chosen && preset.dataset.color === picker.value.toLowerCase();
          preset.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        }
      };
      for (const { family, color } of SHEET_TAB_PRESETS) {
        const button = el('button', {
          className: 'tab-color-preset',
          attrs: { type: 'button', 'data-color': color, 'aria-label': t(`dialog.tabColor.${family}`) },
        }) as HTMLButtonElement;
        button.title = t(`dialog.tabColor.${family}`);
        button.style.backgroundColor = color;
        button.addEventListener('click', () => {
          picker.value = color;
          chosen = true;
          markPressed();
        });
        presets.push(button);
      }
      picker.addEventListener('input', () => {
        chosen = true;
        markPressed();
      });
      markPressed();
      body.append(
        el(
          'div',
          {
            className: 'tab-color-presets',
            attrs: { role: 'group', 'aria-label': t('dialog.tabColor.presets') },
          },
          presets,
        ),
        el('div', { className: 'tab-color-custom' }, [
          el('label', { text: t('dialog.tabColor.custom'), attrs: { for: 'sheet-tab-color-input' } }),
          picker,
        ]),
      );
      buttons.append(
        dialogButton(t('dialog.tabColor.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.tabColor.clear'), false, false, () => close({ action: 'clear' })),
        dialogButton(t('dialog.tabColor.apply'), true, true, () =>
          close({ action: 'apply', color: picker.value.toLowerCase() }),
        ),
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
        body.append(helpDetails(t('dialog.insertCells.note')));
        buttons.append(
          dialogButton(t('dialog.insertCells.cancel'), false, true, () => close(null)),
          dialogButton(t('dialog.insertCells.right'), false, false, () => close('right')),
          dialogButton(t('dialog.insertCells.down'), true, false, () => close('down')),
        );
      },
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
    kindOptions?: { initialKind: WorksheetKind; suggestName: (kind: WorksheetKind) => string },
  ): Promise<{ name: string; kind: WorksheetKind } | null> {
    return openDialog<{ name: string; kind: WorksheetKind } | null>(
      t(`dialog.sheetName.title.${mode}`),
      null,
      (body, buttons, close) => {
        let selectedKind: WorksheetKind = kindOptions?.initialKind ?? 'grid';
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
          const groupName = 'sheet-kind-picker';
          const labels: HTMLElement[] = [];
          const updateSelectedClass = (): void => {
            for (const label of labels) {
              label.classList.toggle('selected', label.dataset.kind === selectedKind);
            }
          };
          const radios = WORKSHEET_KIND_OPTIONS.map(({ kind, labelKey, icon }) => {
            const radioId = `${groupName}-${kind}`;
            const radio = el('input', {
              attrs: { type: 'radio', name: groupName, id: radioId, value: kind },
            }) as HTMLInputElement;
            radio.checked = kind === selectedKind;
            radio.addEventListener('change', () => {
              if (!radio.checked) {
                return;
              }
              selectedKind = kind;
              updateSelectedClass();
              if (!nameTouchedByUser) {
                input.value = kindOptions.suggestName(kind);
                refresh();
              }
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
          body.append(
            el(
              'div',
              {
                className: 'form-row sheet-kind-picker',
                attrs: { role: 'radiogroup', 'aria-label': t('dialog.sheetName.kind') },
              },
              radios,
            ),
          );
        }

        body.append(
          el('label', { text: t('dialog.sheetName.label'), attrs: { for: inputId } }),
          input,
          el('p', { className: 'dialog-note', text: t('dialog.sheetName.rules') }),
          error,
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
    );
  }

  /**
   * Confirm deleting a worksheet that holds content or is referenced by
   * formulas. The message states — truthfully — how many formulas elsewhere in
   * the workbook will become #REF!, because deletion never silently redirects
   * references to another worksheet.
   */
  confirmDeleteSheet(name: string, referenceCount: number): Promise<boolean> {
    return openDialog<boolean>(t('dialog.deleteSheet.title'), false, (body, buttons, close) => {
      body.append(el('p', { text: t('dialog.deleteSheet.message', { name }) }));
      if (referenceCount > 0) {
        body.append(
          el('p', {
            className: 'dialog-note warn',
            text: t('dialog.deleteSheet.references', { n: referenceCount }),
          }),
        );
      }
      body.append(el('p', { className: 'dialog-note', text: t('dialog.deleteSheet.undo') }));
      buttons.append(
        dialogButton(t('dialog.deleteSheet.cancel'), false, true, () => close(false)),
        dialogButton(t('dialog.deleteSheet.ok'), true, false, () => close(true)),
      );
    });
  }

  /**
   * Confirm a range move whose destination already holds data. The destination
   * range and the exact number of cells that would be replaced are both stated,
   * and Cancel is the default action, so data is never replaced by accident.
   */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean> {
    return openDialog<boolean>(t('dialog.moveRange.overwriteTitle'), false, (body, buttons, close) => {
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
    });
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
    return openDialog<string | null>(t('dialog.moveRange.title'), null, (body, buttons, close) => {
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
        el('label', { attrs: { for: inputId }, text: t('dialog.moveRange.label') }),
        input,
        error,
        el('p', { className: 'dialog-note', text: t('dialog.moveRange.hint') }),
      );
      buttons.append(
        dialogButton(t('dialog.moveRange.cancel'), false, true, () => close(null)),
        ok,
      );
      refresh();
    });
  }

  /**
   * "Go to Cell…": ask for a cell reference to jump the selection to.
   * Validation runs on every keystroke and is shown in a live region; OK
   * stays disabled while the entry is unusable. Enter confirms and Escape
   * cancels, and neither fires while an IME composition is in progress.
   */
  promptGoToCell(suggestion: string, validate: (text: string) => string | null): Promise<string | null> {
    return openDialog<string | null>(t('dialog.goToCell.title'), null, (body, buttons, close) => {
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
      body.append(
        el('label', { attrs: { for: inputId }, text: t('dialog.goToCell.label') }),
        input,
        error,
        el('p', { className: 'dialog-note', text: t('dialog.goToCell.hint') }),
      );
      buttons.append(
        dialogButton(t('dialog.goToCell.cancel'), false, true, () => close(null)),
        ok,
      );
      refresh();
    });
  }

  /**
   * Confirm a workbook-wide Replace All. The scope is stated explicitly — a
   * replace that reaches worksheets the user is not looking at must never be
   * a surprise — together with exactly how much it would change. Cancel is the
   * default action, and nothing is mutated until this resolves true.
   */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean> {
    return openDialog<boolean>(t('dialog.replaceWorkbook.title'), false, (body, buttons, close) => {
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
    });
  }
}
