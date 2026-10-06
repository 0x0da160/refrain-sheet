// SPDX-License-Identifier: MIT
import type { DiffDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import type { DiffOptions, DiffResult, DiffRow, DiffRowType } from '../../core/diff-engine';
import { GitCompare } from 'lucide';
import { el } from '../dom';
import { formCheck, formField, formSection } from './form-layout';
import { dialogButton } from './shared';
import { openSidePanel } from './side-panel';

const ROW_BADGE_CLASS: Record<DiffRowType, string> = {
  unchanged: 'diff-badge diff-badge-unchanged',
  modified: 'diff-badge diff-badge-modified',
  added: 'diff-badge diff-badge-added',
  deleted: 'diff-badge diff-badge-deleted',
  key_invalid: 'diff-badge diff-badge-key-invalid',
};

type FilterMode = 'changed' | 'all';

/** Baseline tab's columns, then any current-only columns — mirrors `computeDiff`'s own schema merge. */
function mergedColumns(baselineColumns: string[], currentColumns: string[]): string[] {
  const seen = new Set(baselineColumns.map((c) => c.toUpperCase()));
  const extra = currentColumns.filter((c) => !seen.has(c.toUpperCase()));
  return [...baselineColumns, ...extra];
}

/** One checkbox per column, put in `into`; returns the checkboxes. */
function columnChecks(into: HTMLElement, names: string[], checked: boolean): HTMLInputElement[] {
  into.replaceChildren();
  return names.map((name) => {
    const check = el('input', { attrs: { type: 'checkbox', value: name } }) as HTMLInputElement;
    check.checked = checked;
    into.append(formCheck(check, name));
    return check;
  });
}

/** The controls a comparison reads, built into the panel body. */
interface DiffControls {
  baselineSelect: HTMLSelectElement;
  filterSelect: HTMLSelectElement;
  options: () => DiffOptions;
}

function diffControls(body: HTMLElement, input: DiffDialogInput): DiffControls {
  const baselineSelect = el('select') as HTMLSelectElement;
  for (const tabOption of input.tabs) {
    baselineSelect.append(el('option', { text: tabOption.name, attrs: { value: tabOption.id } }));
  }
  const columnGroup = (labelKey: string): HTMLElement =>
    el('div', {
      className: 'form-choices form-choices-inline',
      attrs: { role: 'group', 'aria-label': t(labelKey) },
    });
  const keyList = columnGroup('dialog.diff.keyColumns');
  const compareList = columnGroup('dialog.diff.compareColumns');
  let keyChecks: HTMLInputElement[] = [];
  let compareChecks: HTMLInputElement[] = [];
  const rebuildColumnLists = (): void => {
    const cols = mergedColumns(input.columnsForTab(baselineSelect.value), input.currentColumns);
    keyChecks = columnChecks(keyList, cols, false);
    compareChecks = columnChecks(compareList, cols, true);
  };
  rebuildColumnLists();
  baselineSelect.addEventListener('change', rebuildColumnLists);

  const trimCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const caseCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  const filterSelect = el('select') as HTMLSelectElement;
  filterSelect.append(
    el('option', { text: t('dialog.diff.filter.changed'), attrs: { value: 'changed' } }),
    el('option', { text: t('dialog.diff.filter.all'), attrs: { value: 'all' } }),
  );
  body.append(
    formSection(null, [
      el('p', { text: t('dialog.diff.intro') }),
      el('p', { className: 'dialog-note', text: t('dialog.diff.current', { name: input.currentTabName }) }),
      formField(t('dialog.diff.baseline'), baselineSelect),
      el('div', { className: 'form-field' }, [
        el('span', { className: 'form-field-label', text: t('dialog.diff.keyColumns') }),
        keyList,
      ]),
      el('details', { className: 'diff-compare-columns' }, [
        el('summary', { text: t('dialog.diff.compareColumns') }),
        compareList,
      ]),
      el('div', { className: 'form-choices' }, [
        formCheck(trimCheck, t('dialog.diff.normalizeTrim')),
        formCheck(caseCheck, t('dialog.diff.normalizeCase')),
      ]),
      formField(t('dialog.diff.filter'), filterSelect),
    ]),
  );
  return {
    baselineSelect,
    filterSelect,
    options: () => ({
      keyColumns: keyChecks.filter((c) => c.checked).map((c) => c.value),
      compareColumns: compareChecks.filter((c) => c.checked).map((c) => c.value),
      normalize: { trim: trimCheck.checked, caseInsensitive: caseCheck.checked },
    }),
  };
}

/**
 * The local two-tab compare panel, a side panel beside the sheet (design
 * system D-46): pick a baseline tab to compare the active tab against, pick
 * one or more key columns, and view every row classified as
 * added/modified/deleted/unchanged/key_invalid. Compare and Export Diff as
 * CSV sit in the footer, and the panel stays open so a comparison can be
 * adjusted and run again. Nothing here mutates either source document —
 * see `src/core/diff-engine.ts` for the engine and
 * docs/proposals/csv-diff-review.md for the scope this first slice
 * deliberately stays within (results render as a plain, non-virtualized
 * table).
 */
export class DiffDialogs {
  showDiff(input: DiffDialogInput): Promise<void> {
    return openSidePanel<void>(
      { title: t('dialog.diff.title'), icon: GitCompare, fallback: undefined, key: 'data.compareDiff' },
      (body, buttons) => {
        body.classList.add('diff-panel');
        const controls = diffControls(body, input);
        const status = el('p', {
          className: 'diff-status',
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const resultsWrap = el('div', { className: 'diff-results', attrs: { tabindex: '0' } });
        body.append(formSection(null, [status, resultsWrap]));

        const setStatus = (text: string, isError: boolean): void => {
          status.textContent = text;
          status.setAttribute('role', isError ? 'alert' : 'status');
        };
        let lastResult: DiffResult | null = null;
        const renderResult = (result: DiffResult, filter: FilterMode): void => {
          resultsWrap.replaceChildren();
          const shown =
            filter === 'changed' ? result.rows.filter((r) => r.type !== 'unchanged') : result.rows;
          if (shown.length === 0) {
            setStatus(t('dialog.diff.status.noRows'), false);
            return;
          }
          resultsWrap.append(diffTable(result, shown));
          setStatus(diffStatusText(result), false);
        };
        controls.filterSelect.addEventListener('change', () => {
          if (lastResult) renderResult(lastResult, controls.filterSelect.value as FilterMode);
        });

        const exportButton = dialogButton(t('dialog.diff.exportCsv'), false, false, () => void doExport());
        exportButton.disabled = true;
        const runDiff = (): void => {
          resultsWrap.replaceChildren();
          lastResult = null;
          exportButton.disabled = true;
          const outcome = input.runDiff(controls.baselineSelect.value, controls.options());
          if (!outcome.ok) {
            setStatus(t(`diff.error.${outcome.error.code}`, outcome.error.params), true);
            return;
          }
          lastResult = outcome.result;
          exportButton.disabled = false;
          renderResult(outcome.result, controls.filterSelect.value as FilterMode);
        };
        const doExport = async (): Promise<void> => {
          if (!lastResult) return;
          const ok = await input.exportCsv(lastResult);
          if (ok) setStatus(t('dialog.diff.status.exported'), false);
        };
        buttons.append(exportButton, dialogButton(t('dialog.diff.run'), true, false, runDiff));
      },
    );
  }
}

/** One result row: its type badge (with the reason as a tooltip) and cells, changed cells marked. */
function diffRowElement(row: DiffRow, columns: string[]): HTMLElement {
  const badge = el('span', { className: ROW_BADGE_CLASS[row.type], text: t(`diff.type.${row.type}`) });
  if (row.reason) {
    badge.title = t(`diff.reason.${row.reason}`);
  }
  const cells = columns.map((_, i) => {
    const changed = row.changedColumns.includes(i);
    const shown = (row.after ?? row.before)?.[i] ?? '';
    const text =
      changed && row.before && row.after
        ? t('dialog.diff.cell.changed', { before: row.before[i], after: row.after[i] })
        : shown;
    const cell = el('td', { text });
    if (changed) cell.classList.add('diff-cell-changed');
    return cell;
  });
  return el('tr', { className: `diff-row diff-row-${row.type}` }, [el('td', {}, [badge]), ...cells]);
}

/** The results table for the rows being shown. */
function diffTable(result: DiffResult, shown: DiffRow[]): HTMLElement {
  const table = el('table', { className: 'diag-table diff-table' });
  const caption = el('caption', {
    className: 'visually-hidden',
    text: t('dialog.diff.tableCaption', { rows: shown.length, cols: result.columns.length }),
  });
  const headRow = el('tr', {}, [
    el('th', { text: t('dialog.diff.column.type'), attrs: { scope: 'col' } }),
    ...result.columns.map((name) => el('th', { text: name, attrs: { scope: 'col' } })),
  ]);
  const tbody = el('tbody');
  for (const row of shown) {
    tbody.append(diffRowElement(row, result.columns));
  }
  table.append(caption, el('thead', {}, [headRow]), tbody);
  return table;
}

/** The announced summary: counts, and whether results or sources were truncated. */
function diffStatusText(result: DiffResult): string {
  const parts: string[] = [
    t('dialog.diff.status.counts', {
      added: result.counts.added,
      modified: result.counts.modified,
      deleted: result.counts.deleted,
      unchanged: result.counts.unchanged,
      keyInvalid: result.counts.keyInvalid,
    }),
  ];
  if (result.truncated) {
    parts.push(t('dialog.diff.status.truncated', { shown: result.rows.length, matched: result.matchedRows }));
  }
  if (result.baselineTruncated || result.currentTruncated) {
    parts.push(t('dialog.diff.status.sourceTruncated'));
  }
  return parts.join(' ');
}
