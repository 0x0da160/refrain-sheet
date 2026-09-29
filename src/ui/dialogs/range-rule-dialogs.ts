// SPDX-License-Identifier: MIT
/**
 * Dialogs that edit a rule attached to the selected range: sort keys, data
 * validation (delegated to `data-validation-dialog.ts`), and the cell comment.
 */
import type {
  ApplyHandler,
  CellCommentDialogInput,
  CellCommentDialogResult,
  DataValidationDialogInput,
  DataValidationDialogResult,
  SortDialogInput,
  SortDialogResult,
} from '../../app/commands';
import { t } from '../../app/i18n';
import { MAX_COMMENT_LENGTH } from '../../core/workbook/cell-comment';
import { MAX_SHEET_SORT_KEYS, type SortKey } from '../../core/workbook/sort';
import { el } from '../dom';
import { createIcon } from '../icon';
import { ArrowDownAZ, Trash2 } from 'lucide';
import { chooseDataValidation } from './data-validation-dialog';
import { dialogButton, helpDetails, openDialog } from './shared';
import { panelCheck, panelSection } from './side-panel';
import { openSidePanel } from './side-panel';

export class RangeRuleDialogs {
  /**
   * The accessible sort dialog: a header-row assumption (editable only when
   * creating the sort — an active sort's range/header are fixed until it is
   * cleared, mirroring `chooseFilter`'s header-row lock) and a compound list
   * of sort levels (column + ascending/descending), each addable/removable
   * up to {@link MAX_SHEET_SORT_KEYS}, always keeping at least one level.
   * Resolves with the chosen action or null (cancel).
   */
  chooseSort(
    input: SortDialogInput,
    onApply?: ApplyHandler<SortDialogResult>,
  ): Promise<SortDialogResult | null> {
    return openSidePanel<SortDialogResult | null>(
      { title: t('dialog.sort.title'), icon: ArrowDownAZ, fallback: null, onApply },
      (body, buttons, apply) => {
        const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        headerCheck.checked = input.headerRow;
        headerCheck.disabled = input.hasActiveSort;
        const intro: Node[] = [
          el('p', { className: 'panel-lead', text: t('dialog.sort.range', { range: input.rangeLabel }) }),
          panelCheck(headerCheck, t('dialog.sort.headerRow')),
        ];
        if (input.hasActiveSort) {
          intro.push(el('p', { className: 'dialog-note', text: t('dialog.sort.headerLocked') }));
        }
        body.append(panelSection(null, intro));

        const keysHost = el('div', { className: 'sort-keys panel-stack' });
        const keysSection = panelSection(t('dialog.sort.keys'), [keysHost]);
        body.append(keysSection);

        type Row = { col: HTMLSelectElement; dir: HTMLSelectElement; wrap: HTMLElement };
        const rows: Row[] = [];

        const addBtn = el('button', {
          className: 'panel-button',
          text: t('dialog.sort.addKey'),
          attrs: { type: 'button' },
        }) as HTMLButtonElement;

        const refreshRemoveButtons = (): void => {
          for (const row of rows) {
            const removeBtn = row.wrap.querySelector<HTMLButtonElement>('.sort-remove');
            if (removeBtn) {
              removeBtn.disabled = rows.length <= 1;
            }
          }
        };

        const makeRow = (key?: SortKey): void => {
          const colSelect = el('select', {
            attrs: { 'aria-label': t('dialog.sort.column') },
          }) as HTMLSelectElement;
          for (const column of input.columns) {
            colSelect.append(
              el('option', {
                text: column.header ? `${column.letter} — ${column.header}` : column.letter,
                attrs: { value: String(column.col) },
              }),
            );
          }
          const dirSelect = el('select', {
            attrs: { 'aria-label': t('dialog.sort.direction') },
          }) as HTMLSelectElement;
          dirSelect.append(
            el('option', { text: t('dialog.sort.ascending'), attrs: { value: 'asc' } }),
            el('option', { text: t('dialog.sort.descending'), attrs: { value: 'desc' } }),
          );
          if (key) {
            colSelect.value = String(key.col);
            dirSelect.value = key.ascending ? 'asc' : 'desc';
          }
          const removeBtn = el('button', {
            className: 'panel-button panel-icon-button sort-remove',
            attrs: {
              type: 'button',
              'aria-label': t('dialog.sort.removeKey'),
              title: t('dialog.sort.removeKey'),
            },
          }) as HTMLButtonElement;
          removeBtn.append(createIcon(Trash2, 'panel-button-icon', 14));
          const wrap = el('div', { className: 'sort-key-row' }, [colSelect, dirSelect, removeBtn]);
          removeBtn.addEventListener('click', () => {
            const i = rows.findIndex((r) => r.wrap === wrap);
            if (i < 0) {
              return;
            }
            rows.splice(i, 1);
            wrap.remove();
            refreshRemoveButtons();
            addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
          });
          keysHost.append(wrap);
          rows.push({ col: colSelect, dir: dirSelect, wrap });
        };

        for (const key of input.existingKeys) {
          makeRow(key);
        }
        if (rows.length === 0) {
          makeRow();
        }
        refreshRemoveButtons();

        addBtn.addEventListener('click', () => {
          if (rows.length < MAX_SHEET_SORT_KEYS) {
            makeRow();
            refreshRemoveButtons();
          }
          addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
        });
        addBtn.disabled = rows.length >= MAX_SHEET_SORT_KEYS;
        keysSection.append(
          el('div', { className: 'panel-row' }, [addBtn]),
          el('p', { className: 'dialog-note', text: t('dialog.sort.note') }),
          helpDetails(t('dialog.sort.help')),
        );

        if (input.hasActiveSort) {
          buttons.append(
            dialogButton(t('dialog.sort.clear'), false, false, () => apply({ action: 'clear' })),
          );
        }
        buttons.append(
          dialogButton(t('dialog.sort.apply'), true, false, () => {
            const keys: SortKey[] = rows.map((row) => ({
              col: Number(row.col.value),
              ascending: row.dir.value === 'asc',
            }));
            apply({ action: 'apply', headerRow: headerCheck.checked, keys });
          }),
        );
      },
    );
  }

  /** The data-validation side panel (`data-validation-dialog.ts`). */
  chooseDataValidation(
    input: DataValidationDialogInput,
    onApply?: ApplyHandler<DataValidationDialogResult>,
  ): Promise<DataValidationDialogResult | null> {
    return chooseDataValidation(input, onApply);
  }

  /**
   * The accessible cell-comment dialog for the active cell: a single free-text
   * note, capped at {@link MAX_COMMENT_LENGTH}. Mirrors the data-validation panel's
   * Apply/Clear/Cancel layout: a Clear button appears only when the cell
   * already carries a comment. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseCellComment(input: CellCommentDialogInput): Promise<CellCommentDialogResult | null> {
    return openDialog<CellCommentDialogResult | null>(
      t('dialog.cellComment.title'),
      null,
      (body, buttons, close) => {
        body.append(el('p', { text: t('dialog.cellComment.cell', { cell: input.cellLabel }) }));

        const textArea = el('textarea', {
          className: 'cell-comment-text',
          attrs: {
            rows: '6',
            maxlength: String(MAX_COMMENT_LENGTH),
            'aria-label': t('dialog.cellComment.label'),
            'data-autofocus': 'true',
          },
        }) as HTMLTextAreaElement;
        textArea.value = input.existing ?? '';
        body.append(
          el('div', { className: 'form-row' }, [
            el('label', { text: t('dialog.cellComment.label') }),
            textArea,
          ]),
        );

        buttons.append(dialogButton(t('dialog.cellComment.cancel'), false, true, () => close(null)));
        if (input.existing !== null) {
          buttons.append(
            dialogButton(t('dialog.cellComment.clear'), false, false, () => close({ action: 'clear' })),
          );
        }
        buttons.append(
          dialogButton(t('dialog.cellComment.apply'), true, false, () =>
            close({ action: 'apply', text: textArea.value }),
          ),
        );
      },
    );
  }
}
