// SPDX-License-Identifier: MIT
/**
 * The SQL panel's query builder (Data > Run SQL Query… > Build a Query):
 * pick columns, add conditions, group and total, sort, and limit without
 * typing SQL. Every change writes the matching query into the panel's query
 * box (`buildSqlQuery`), where it can still be edited by hand and is run
 * with Run like any typed query. Nothing here reads or changes the sheet.
 */
import { Plus, Trash2 } from 'lucide';
import { t } from '../../app/i18n';
import {
  buildSqlQuery,
  EMPTY_SQL_BUILDER_SPEC,
  SQL_AGGREGATES,
  SQL_BUILDER_MAX_LIMIT,
  SQL_FILTER_OPERATORS,
  sqlBuilderOutputColumns,
  sqlOperatorTakesValue,
  type SqlAggregate,
  type SqlBuilderSpec,
  type SqlFilterOperator,
} from '../../core/sql-builder';
import { el } from '../dom';
import { createIcon } from '../icon';
import { panelCheck, panelField } from './side-panel';

/** The most conditions, and the most totals, one builder holds. */
const MAX_BUILDER_ROWS = 20;

export interface SqlBuilderView {
  element: HTMLElement;
  /** Switch to another source's columns, dropping choices that name a column it lacks. */
  setColumns(columns: string[]): void;
}

function select(label: string, options: Array<[string, string]>, value: string): HTMLSelectElement {
  const box = el('select', { attrs: { 'aria-label': label } }) as HTMLSelectElement;
  for (const [optionValue, text] of options) {
    box.append(el('option', { text, attrs: { value: optionValue } }));
  }
  box.value = value;
  return box;
}

function iconButton(label: string, icon: typeof Plus, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    className: 'panel-button panel-icon-button',
    attrs: { type: 'button', 'aria-label': label, title: label },
  }) as HTMLButtonElement;
  button.append(createIcon(icon, 'panel-button-icon', 14));
  button.addEventListener('click', onClick);
  return button;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    className: 'panel-button sql-builder-add',
    text: label,
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  button.addEventListener('click', onClick);
  return button;
}

/** A builder that calls `onQuery` with the new query after every change. */
export function sqlQueryBuilder(initialColumns: string[], onQuery: (query: string) => void): SqlBuilderView {
  let columns = initialColumns;
  const spec: SqlBuilderSpec = {
    ...EMPTY_SQL_BUILDER_SPEC,
    columns: [],
    filters: [],
    groupBy: [],
    totals: [],
  };
  const body = el('div', { className: 'sql-builder-body' });
  const element = el('details', { className: 'sql-builder', attrs: { open: '' } }, [
    el('summary', { text: t('dialog.sqlQuery.builder.title') }),
    body,
  ]);

  const emit = (): void => onQuery(buildSqlQuery(spec, columns));
  const changed = (): void => {
    emit();
    render();
  };

  const render = (): void => {
    const focusedKey =
      document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    body.replaceChildren(
      el('p', { className: 'dialog-note', text: t('dialog.sqlQuery.builder.intro') }),
      columnsPart(columns, spec, changed),
      filtersPart(columns, spec, emit, changed),
      totalsPart(columns, spec, changed),
      sortPart(columns, spec, changed),
      limitPart(spec, emit),
    );
    // Re-rendering replaces the controls; keep keyboard focus on the one used.
    if (focusedKey) {
      body.querySelector<HTMLElement>(`[data-key="${focusedKey}"]`)?.focus();
    }
  };

  render();
  return {
    element,
    setColumns(next) {
      columns = next;
      const has = (column: string): boolean => next.includes(column);
      spec.columns = spec.columns.filter(has);
      spec.filters = spec.filters.filter((filter) => has(filter.column));
      spec.groupBy = spec.groupBy.filter(has);
      spec.totals = spec.totals.filter((total) => total.column === null || has(total.column));
      render();
    },
  };
}

/** Tag a control so focus can return to it after a re-render. */
function keyed<T extends HTMLElement>(control: T, key: string): T {
  control.dataset.key = key;
  return control;
}

/** Which columns to show (none ticked shows them all). */
function columnsPart(columns: string[], spec: SqlBuilderSpec, changed: () => void): HTMLElement {
  const grouped = spec.groupBy.length > 0 || spec.totals.length > 0;
  const list = el('div', { className: 'sql-builder-columns', attrs: { role: 'group' } });
  columns.forEach((column, i) => {
    const box = keyed(el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement, `col-${i}`);
    box.checked = spec.columns.includes(column);
    box.disabled = grouped;
    box.addEventListener('change', () => {
      spec.columns = columns.filter((name) => (name === column ? box.checked : spec.columns.includes(name)));
      changed();
    });
    list.append(panelCheck(box, column));
  });
  const hint = grouped
    ? t('dialog.sqlQuery.builder.columnsGrouped')
    : t('dialog.sqlQuery.builder.columnsHint');
  const field = el('fieldset', { className: 'sql-builder-part' }, [
    el('legend', { className: 'panel-field-label', text: t('dialog.sqlQuery.builder.columns') }),
    list,
    el('p', { className: 'dialog-note panel-field-hint', text: hint }),
  ]);
  return field;
}

/** The conditions a row must meet, and whether all or any must. */
function filtersPart(
  columns: string[],
  spec: SqlBuilderSpec,
  emit: () => void,
  changed: () => void,
): HTMLElement {
  const part = el('fieldset', { className: 'sql-builder-part' }, [
    el('legend', { className: 'panel-field-label', text: t('dialog.sqlQuery.builder.filters') }),
  ]);
  if (spec.filters.length > 1) {
    const match = keyed(
      select(
        t('dialog.sqlQuery.builder.match'),
        [
          ['all', t('dialog.sqlQuery.builder.matchAll')],
          ['any', t('dialog.sqlQuery.builder.matchAny')],
        ],
        spec.match,
      ),
      'match',
    );
    match.addEventListener('change', () => {
      spec.match = match.value === 'any' ? 'any' : 'all';
      emit();
    });
    part.append(match);
  }
  spec.filters.forEach((filter, i) => {
    const column = keyed(
      select(
        t('dialog.sqlQuery.builder.filterColumn'),
        columns.map((name) => [name, name]),
        filter.column,
      ),
      `filter-col-${i}`,
    );
    const op = keyed(
      select(
        t('dialog.sqlQuery.builder.operator'),
        SQL_FILTER_OPERATORS.map((id) => [id, t(`dialog.sqlQuery.builder.op.${id}`)]),
        filter.op,
      ),
      `filter-op-${i}`,
    );
    const value = keyed(
      el('input', {
        className: 'sql-builder-value',
        attrs: { type: 'text', 'aria-label': t('dialog.sqlQuery.builder.value') },
      }) as HTMLInputElement,
      `filter-value-${i}`,
    );
    value.value = filter.value;
    value.hidden = !sqlOperatorTakesValue(filter.op);
    column.addEventListener('change', () => {
      filter.column = column.value;
      emit();
    });
    op.addEventListener('change', () => {
      filter.op = op.value as SqlFilterOperator;
      value.hidden = !sqlOperatorTakesValue(filter.op);
      emit();
    });
    value.addEventListener('input', () => {
      filter.value = value.value;
      emit();
    });
    const remove = iconButton(t('dialog.sqlQuery.builder.removeFilter'), Trash2, () => {
      spec.filters.splice(i, 1);
      changed();
    });
    part.append(el('div', { className: 'sql-builder-row' }, [column, op, value, remove]));
  });
  const add = keyed(
    textButton(t('dialog.sqlQuery.builder.addFilter'), () => {
      spec.filters.push({ column: columns[0], op: 'eq', value: '' });
      changed();
    }),
    'add-filter',
  );
  add.prepend(createIcon(Plus, 'panel-button-icon', 14));
  add.disabled = columns.length === 0 || spec.filters.length >= MAX_BUILDER_ROWS;
  part.append(add);
  return part;
}

/** Group rows by a column, and the totals computed per group. */
function totalsPart(columns: string[], spec: SqlBuilderSpec, changed: () => void): HTMLElement {
  const none: Array<[string, string]> = [['', t('dialog.sqlQuery.builder.none')]];
  const group = keyed(
    select(
      t('dialog.sqlQuery.builder.groupBy'),
      [...none, ...columns.map((name): [string, string] => [name, name])],
      spec.groupBy[0] ?? '',
    ),
    'group',
  );
  group.addEventListener('change', () => {
    spec.groupBy = group.value === '' ? [] : [group.value];
    changed();
  });
  const part = el('fieldset', { className: 'sql-builder-part' }, [
    el('legend', { className: 'panel-field-label', text: t('dialog.sqlQuery.builder.summarize') }),
    panelField(t('dialog.sqlQuery.builder.groupBy'), group),
  ]);
  spec.totals.forEach((total, i) => {
    const fn = keyed(
      select(
        t('dialog.sqlQuery.builder.function'),
        SQL_AGGREGATES.map((id) => [id, t(`dialog.sqlQuery.builder.fn.${id}`)]),
        total.fn,
      ),
      `total-fn-${i}`,
    );
    const rowsOption: Array<[string, string]> =
      total.fn === 'count' ? [['', t('dialog.sqlQuery.builder.allRows')]] : [];
    const column = keyed(
      select(
        t('dialog.sqlQuery.builder.totalColumn'),
        [...rowsOption, ...columns.map((name): [string, string] => [name, name])],
        total.column ?? '',
      ),
      `total-col-${i}`,
    );
    fn.addEventListener('change', () => {
      total.fn = fn.value as SqlAggregate;
      if (total.fn !== 'count' && total.column === null) {
        total.column = columns[0] ?? null;
      }
      changed();
    });
    column.addEventListener('change', () => {
      total.column = column.value === '' ? null : column.value;
      changed();
    });
    const remove = iconButton(t('dialog.sqlQuery.builder.removeTotal'), Trash2, () => {
      spec.totals.splice(i, 1);
      changed();
    });
    part.append(el('div', { className: 'sql-builder-row' }, [fn, column, remove]));
  });
  const add = keyed(
    textButton(t('dialog.sqlQuery.builder.addTotal'), () => {
      spec.totals.push({ fn: 'count', column: null });
      changed();
    }),
    'add-total',
  );
  add.prepend(createIcon(Plus, 'panel-button-icon', 14));
  add.disabled = spec.totals.length >= MAX_BUILDER_ROWS;
  part.append(add);
  return part;
}

/** Sort by one output column, either way. */
function sortPart(columns: string[], spec: SqlBuilderSpec, changed: () => void): HTMLElement {
  const outputs = sqlBuilderOutputColumns(spec, columns);
  if (spec.sort && !outputs.includes(spec.sort.column)) {
    spec.sort = null;
  }
  const by = keyed(
    select(
      t('dialog.sqlQuery.builder.sortBy'),
      [['', t('dialog.sqlQuery.builder.none')], ...outputs.map((name): [string, string] => [name, name])],
      spec.sort?.column ?? '',
    ),
    'sort',
  );
  const direction = keyed(
    select(
      t('dialog.sqlQuery.builder.sortDirection'),
      [
        ['asc', t('dialog.sort.ascending')],
        ['desc', t('dialog.sort.descending')],
      ],
      spec.sort?.descending ? 'desc' : 'asc',
    ),
    'sort-dir',
  );
  direction.disabled = !spec.sort;
  const update = (): void => {
    spec.sort = by.value === '' ? null : { column: by.value, descending: direction.value === 'desc' };
    changed();
  };
  by.addEventListener('change', update);
  direction.addEventListener('change', update);
  return el('div', { className: 'panel-field' }, [
    el('span', { className: 'panel-field-label', text: t('dialog.sqlQuery.builder.sortBy') }),
    el('div', { className: 'sql-builder-row' }, [by, direction]),
  ]);
}

/** Show at most this many rows (blank shows all). */
function limitPart(spec: SqlBuilderSpec, emit: () => void): HTMLElement {
  const limit = keyed(
    el('input', {
      className: 'sql-builder-limit',
      attrs: { type: 'number', min: '1', max: String(SQL_BUILDER_MAX_LIMIT), step: '1' },
    }) as HTMLInputElement,
    'limit',
  );
  limit.value = spec.limit === null ? '' : String(spec.limit);
  limit.addEventListener('input', () => {
    const n = Number(limit.value);
    spec.limit = limit.value.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
    emit();
  });
  return panelField(t('dialog.sqlQuery.builder.limit'), limit, t('dialog.sqlQuery.builder.limitHint'));
}
