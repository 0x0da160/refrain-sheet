// SPDX-License-Identifier: MIT
/**
 * The column-filter side panel: text/number conditions and their AND/OR
 * combination, and a searchable checklist of the column's values, applied
 * live while the panel stays open.
 */
import type { ApplyHandler, FilterDialogInput, FilterDialogResult } from '../../app/commands';
import { t } from '../../app/i18n';
import {
  FILTER_NUMBER_OPS,
  FILTER_TEXT_OPS,
  MAX_FILTER_CONDITIONS,
  type ColumnFilter,
  type FilterCondition,
  type FilterNumberOp,
  type FilterTextOp,
} from '../../core/workbook/filter';
import { el } from '../dom';
import { Filter } from 'lucide';
import { dialogButton, helpDetails, openSidePanel, panelCheck, panelSection } from './shared';

export class FilterDialog {
  /**
   * The accessible column-filter popover, anchored beside the triggering
   * column's header. Presents the filtered range and the header-row
   * assumption (editable only when creating the filter — an active filter's
   * range/header are fixed until all filters are cleared), an AND/OR-combined
   * list of comparison conditions, and a searchable, bounded checkbox list of
   * the column's distinct displayed values with select-all/deselect-all
   * (acting on the currently search-narrowed values, like the individual
   * checkboxes). All content is text-only. Resolves with the chosen action
   * or null (cancel).
   */
  chooseFilter(
    input: FilterDialogInput,
    onApply?: ApplyHandler<FilterDialogResult>,
  ): Promise<FilterDialogResult | null> {
    return openSidePanel<FilterDialogResult | null>(
      { title: t('dialog.filter.title'), icon: Filter, fallback: null, onApply },
      (body, buttons, apply) => {
        const headerCheck = buildIntro(input, body);
        // Reassigned once the Apply button exists; the condition rows call it
        // through this closure so field wiring can stay top-to-bottom.
        let refresh: () => void = () => {};
        const conditions = buildConditions(input, body, () => refresh());
        const values = buildValueList(input, body);
        body.append(
          panelSection(null, [
            helpDetails(
              t('dialog.filter.combineNote'),
              t('dialog.filter.crossNote', { n: input.otherColumns }),
            ),
          ]),
        );
        const error = el('p', {
          className: 'dialog-error',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        body.append(error);
        const buildColumn = (): ColumnFilter | null => {
          const chosen = conditions.conditions();
          const selected = values.selected();
          if (chosen.length === 0 && selected === null) {
            return null; // no criteria: clears this column
          }
          return { col: input.col, join: conditions.join(), conditions: chosen, values: selected };
        };
        const applyBtn = dialogButton(t('dialog.filter.apply'), true, false, () =>
          apply({ action: 'apply', headerRow: headerCheck.checked, column: buildColumn() }),
        );
        refresh = (): void => {
          const hasIncomplete = conditions.hasIncomplete();
          error.textContent = hasIncomplete ? t('dialog.filter.conditionIncomplete') : '';
          applyBtn.disabled = hasIncomplete;
        };
        refresh();
        if (input.existing) {
          buttons.append(
            dialogButton(t('dialog.filter.clearColumn'), false, false, () =>
              apply({ action: 'clearColumn' }),
            ),
          );
        }
        if (input.hasActiveFilter) {
          buttons.append(
            dialogButton(t('dialog.filter.clearAll'), false, false, () => apply({ action: 'clearAll' })),
          );
        }
        buttons.append(applyBtn);
      },
    );
  }
}

/** The range description and the header-row assumption (editable only while creating the filter). */
function buildIntro(input: FilterDialogInput, body: HTMLElement): HTMLInputElement {
  const intro: Node[] = [
    el('p', {
      className: 'panel-lead',
      text: t('dialog.filter.range', { range: input.rangeLabel, col: input.colLetter }),
    }),
  ];
  if (input.header) {
    intro.push(
      el('p', { className: 'dialog-note', text: t('dialog.filter.header', { header: input.header }) }),
    );
  }
  const headerCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  headerCheck.checked = input.headerRow;
  headerCheck.disabled = input.hasActiveFilter;
  intro.push(panelCheck(headerCheck, t('dialog.filter.headerRow')));
  if (input.hasActiveFilter) {
    intro.push(el('p', { className: 'dialog-note', text: t('dialog.filter.headerLocked') }));
  }
  body.append(panelSection(null, intro));
  return headerCheck;
}

interface ConditionRow {
  op: HTMLSelectElement;
  value: HTMLInputElement;
  value2: HTMLInputElement;
  touched: boolean;
}

const isNumberOp = (op: string): boolean => (FILTER_NUMBER_OPS as readonly string[]).includes(op);
const noValueOp = (op: string): boolean => op === 'blank' || op === 'notBlank';

/**
 * An untouched, freshly-added row is silently ignored (not an error) when
 * left blank — that is how "no condition on this row" is expressed. Once the
 * user has interacted with it (changed the operator or typed a value), an
 * incomplete value becomes a real error rather than being dropped without
 * feedback (see #296). A row that started from an already-saved condition
 * begins touched, so editing it into an incomplete state is flagged
 * immediately too.
 */
function rowIncomplete(row: ConditionRow): boolean {
  const op = row.op.value;
  if (noValueOp(op)) {
    return false;
  }
  if (isNumberOp(op)) {
    const trimmed = row.value.value.trim();
    return trimmed === '' || !Number.isFinite(Number(trimmed));
  }
  return row.value.value === '';
}

/** The condition a row expresses, or null when it is incomplete (unused). */
function rowCondition(row: ConditionRow): FilterCondition | null {
  const op = row.op.value;
  if (noValueOp(op)) {
    return { kind: 'text', op: op as FilterTextOp, value: '' };
  }
  if (rowIncomplete(row)) {
    return null; // untouched and blank: not an error, just unused
  }
  if (!isNumberOp(op)) {
    return { kind: 'text', op: op as FilterTextOp, value: row.value.value };
  }
  const cond: FilterCondition = {
    kind: 'number',
    op: op as FilterNumberOp,
    value: Number(row.value.value.trim()),
  };
  if (op === 'numBetween') {
    const n2 = Number(row.value2.value.trim());
    if (Number.isFinite(n2)) {
      cond.value2 = n2;
    }
  }
  return cond;
}

/** The AND/OR-combined condition rows. */
function buildConditions(
  input: FilterDialogInput,
  body: HTMLElement,
  changed: () => void,
): { conditions: () => FilterCondition[]; join: () => 'and' | 'or'; hasIncomplete: () => boolean } {
  const joinWrap = el('div', {
    className: 'panel-choices panel-choices-inline',
    attrs: { role: 'radiogroup' },
  });
  const joinAnd = el('input', { attrs: { type: 'radio', name: 'filter-join' } }) as HTMLInputElement;
  const joinOr = el('input', { attrs: { type: 'radio', name: 'filter-join' } }) as HTMLInputElement;
  const existingJoin = input.existing?.join ?? 'and';
  joinAnd.checked = existingJoin === 'and';
  joinOr.checked = existingJoin === 'or';
  joinWrap.append(
    panelCheck(joinAnd, t('dialog.filter.joinAnd')),
    panelCheck(joinOr, t('dialog.filter.joinOr')),
  );
  const conditionsHost = el('div', { className: 'filter-conditions panel-stack' });
  const conditionsSection = panelSection(t('dialog.filter.conditions'), [joinWrap, conditionsHost]);
  body.append(conditionsSection);

  const rows: ConditionRow[] = [];
  const addRow = (cond?: FilterCondition): void => {
    const { row, element } = conditionRow(cond, changed);
    conditionsHost.append(element);
    rows.push(row);
  };
  for (const cond of input.existing?.conditions ?? []) {
    addRow(cond);
  }
  if (rows.length === 0) {
    addRow();
  }
  const addBtn = el('button', {
    className: 'panel-button',
    text: t('dialog.filter.addCondition'),
    attrs: { type: 'button' },
  });
  addBtn.addEventListener('click', () => {
    if (rows.length < MAX_FILTER_CONDITIONS) {
      addRow();
    }
    addBtn.disabled = rows.length >= MAX_FILTER_CONDITIONS;
    changed();
  });
  addBtn.disabled = rows.length >= MAX_FILTER_CONDITIONS;
  conditionsSection.append(el('div', { className: 'panel-row' }, [addBtn]));
  return {
    conditions: () => rows.map(rowCondition).filter((cond): cond is FilterCondition => cond !== null),
    join: () => (joinOr.checked ? 'or' : 'and'),
    hasIncomplete: () => rows.some((row) => row.touched && rowIncomplete(row)),
  };
}

/** One condition row: operator, value, and (for "between") a second value. */
function conditionRow(
  cond: FilterCondition | undefined,
  changed: () => void,
): { row: ConditionRow; element: HTMLElement } {
  const allOps: Array<{ value: string; label: string }> = [
    ...FILTER_TEXT_OPS.map((op) => ({ value: op, label: t(`filter.op.${op}`) })),
    ...FILTER_NUMBER_OPS.map((op) => ({ value: op, label: t(`filter.op.${op}`) })),
  ];
  const op = el('select', { attrs: { 'aria-label': t('dialog.filter.condition') } }) as HTMLSelectElement;
  for (const o of allOps) {
    op.append(el('option', { text: o.label, attrs: { value: o.value } }));
  }
  const value = el('input', {
    attrs: { type: 'text', 'aria-label': t('dialog.filter.value') },
  }) as HTMLInputElement;
  const value2 = el('input', {
    attrs: { type: 'text', 'aria-label': t('dialog.filter.value2') },
  }) as HTMLInputElement;
  if (cond) {
    op.value = cond.op;
    if (cond.kind === 'text') {
      value.value = cond.value;
    } else {
      value.value = String(cond.value);
      if (cond.value2 !== undefined) {
        value2.value = String(cond.value2);
      }
    }
  }
  const row: ConditionRow = { op, value, value2, touched: cond !== undefined };
  const sync = (): void => {
    value.hidden = noValueOp(op.value);
    value2.hidden = op.value !== 'numBetween';
  };
  op.addEventListener('change', () => {
    row.touched = true;
    sync();
    changed();
  });
  for (const field of [value, value2]) {
    field.addEventListener('input', () => {
      row.touched = true;
      changed();
    });
  }
  sync();
  return { row, element: el('div', { className: 'filter-condition-row' }, [op, value, value2]) };
}

/** Values shown at once in the checklist; the rest are counted, not rendered. */
const VALUE_DISPLAY_CAP = 200;

/**
 * The searchable, bounded checklist of the column's distinct values.
 * `selected()` is null when every value is allowed.
 */
function buildValueList(input: FilterDialogInput, body: HTMLElement): { selected: () => string[] | null } {
  const allValuesCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  allValuesCheck.checked = input.existing?.values == null;
  const search = el('input', {
    attrs: {
      type: 'search',
      placeholder: t('dialog.filter.searchValues'),
      'aria-label': t('dialog.filter.searchValues'),
    },
  }) as HTMLInputElement;
  const selectAllBtn = el('button', {
    className: 'panel-button',
    text: t('dialog.filter.selectAllValues'),
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const deselectAllBtn = el('button', {
    className: 'panel-button',
    text: t('dialog.filter.deselectAllValues'),
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  const valueList = el('div', { className: 'filter-value-list', attrs: { role: 'group' } });
  const valuesSection = panelSection(t('dialog.filter.values'), [
    panelCheck(allValuesCheck, t('dialog.filter.allValues')),
    search,
    el('div', { className: 'panel-row' }, [selectAllBtn, deselectAllBtn]),
    valueList,
  ]);
  if (input.valuesTruncated) {
    valuesSection.append(el('p', { className: 'dialog-note', text: t('dialog.filter.valuesTruncated') }));
  }
  body.append(valuesSection);
  const checkedValues = new Set<string>(input.existing?.values ?? input.values);
  // The currently search-narrowed values (not just the ones actually rendered
  // under VALUE_DISPLAY_CAP), kept in sync by renderValues() so
  // select-all/deselect-all act on the narrowed set, not the column's full
  // (possibly much larger) value set.
  let currentMatches: string[] = input.values;
  const renderValues = (): void => {
    const term = search.value.toLowerCase();
    currentMatches = input.values.filter((v) => v.toLowerCase().includes(term));
    selectAllBtn.disabled = allValuesCheck.checked;
    deselectAllBtn.disabled = allValuesCheck.checked;
    valueList.replaceChildren(...valueItems(currentMatches, checkedValues, allValuesCheck.checked));
  };
  selectAllBtn.addEventListener('click', () => {
    for (const v of currentMatches) {
      checkedValues.add(v);
    }
    renderValues();
  });
  deselectAllBtn.addEventListener('click', () => {
    for (const v of currentMatches) {
      checkedValues.delete(v);
    }
    renderValues();
  });
  allValuesCheck.addEventListener('change', renderValues);
  search.addEventListener('input', renderValues);
  renderValues();
  return { selected: () => (allValuesCheck.checked ? null : [...checkedValues].sort()) };
}

/** Checkbox items for the matching values (capped), plus a "more" note. */
function valueItems(matches: string[], checkedValues: Set<string>, allValues: boolean): HTMLElement[] {
  const shown = matches.slice(0, VALUE_DISPLAY_CAP);
  const children: HTMLElement[] = shown.map((v) => {
    const cb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    cb.checked = checkedValues.has(v);
    cb.disabled = allValues;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        checkedValues.add(v);
      } else {
        checkedValues.delete(v);
      }
    });
    return el('label', { className: 'filter-value' }, [
      cb,
      el('span', { text: v === '' ? t('dialog.filter.blankValue') : v }),
    ]);
  });
  if (matches.length > shown.length) {
    children.push(
      el('p', {
        className: 'dialog-note',
        text: t('dialog.filter.valuesMore', { n: matches.length - shown.length }),
      }),
    );
  }
  return children;
}
