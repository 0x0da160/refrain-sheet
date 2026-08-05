// SPDX-License-Identifier: MIT
import type { DiffDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import { type DiffOptions, type DiffResult, type DiffRow, type DiffRowType } from '../../core/diff-engine';
import { el } from '../dom';
import { dialogButton, openDialog } from './shared';

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

/** One checkbox + label row, appended to `into`; returns the checkbox. */
function columnCheckbox(
  into: HTMLElement,
  idPrefix: string,
  name: string,
  checked: boolean,
): HTMLInputElement {
  const id = `${idPrefix}-${name}`;
  const check = el('input', { attrs: { type: 'checkbox', id, value: name } }) as HTMLInputElement;
  check.checked = checked;
  into.append(
    el('div', { className: 'diff-column-item' }, [check, el('label', { text: name, attrs: { for: id } })]),
  );
  return check;
}

/**
 * The local two-tab compare panel: pick a baseline tab to compare the active
 * tab against, pick one or more key columns, and view every row classified
 * as added/modified/deleted/unchanged/key_invalid. Nothing here mutates
 * either source document — see `src/core/diff-engine.ts` for the engine and
 * docs/csv-diff-review-proposal.md for the scope this first slice
 * deliberately stays within (no rule engine, templates, approvals, or audit
 * export yet; results render as a plain, non-virtualized table).
 */
export class DiffDialogs {
  showDiff(input: DiffDialogInput): Promise<void> {
    return openDialog<void>(t('dialog.diff.title'), undefined, (body, buttons, close) => {
      body.classList.add('diff-dialog');
      body.append(el('p', { text: t('dialog.diff.intro') }));
      body.append(
        el('p', { className: 'dialog-note', text: t('dialog.diff.current', { name: input.currentTabName }) }),
      );

      // ----- Baseline tab picker -----
      const baselineLabel = el('label', {
        className: 'form-label',
        text: t('dialog.diff.baseline'),
        attrs: { for: 'diff-baseline-tab' },
      });
      const baselineSelect = el('select', { attrs: { id: 'diff-baseline-tab' } });
      for (const tabOption of input.tabs) {
        baselineSelect.append(el('option', { text: tabOption.name, attrs: { value: tabOption.id } }));
      }
      body.append(el('div', { className: 'form-row' }, [baselineLabel, baselineSelect]));

      // ----- Key / compare column pickers -----
      const keyLabel = el('p', { className: 'form-label', text: t('dialog.diff.keyColumns') });
      const keyList = el('div', {
        className: 'diff-column-list',
        attrs: { role: 'group', 'aria-label': t('dialog.diff.keyColumns') },
      });
      body.append(keyLabel, keyList);

      const compareDetails = el('details', { className: 'diff-compare-columns' });
      const compareBody = el('div', {
        className: 'diff-column-list',
        attrs: { role: 'group', 'aria-label': t('dialog.diff.compareColumns') },
      });
      compareDetails.append(el('summary', { text: t('dialog.diff.compareColumns') }), compareBody);
      body.append(compareDetails);

      let keyChecks: HTMLInputElement[] = [];
      let compareChecks: HTMLInputElement[] = [];

      const rebuildColumnLists = (): void => {
        const cols = mergedColumns(input.columnsForTab(baselineSelect.value), input.currentColumns);
        keyList.replaceChildren();
        compareBody.replaceChildren();
        keyChecks = cols.map((name) => columnCheckbox(keyList, 'diff-key', name, false));
        compareChecks = cols.map((name) => columnCheckbox(compareBody, 'diff-compare', name, true));
      };
      rebuildColumnLists();
      baselineSelect.addEventListener('change', rebuildColumnLists);

      // ----- Normalization options -----
      const trimCheck = el('input', {
        attrs: { type: 'checkbox', id: 'diff-normalize-trim' },
      }) as HTMLInputElement;
      const caseCheck = el('input', {
        attrs: { type: 'checkbox', id: 'diff-normalize-case' },
      }) as HTMLInputElement;
      body.append(
        el('div', { className: 'diff-normalize-options' }, [
          el('div', { className: 'diff-column-item' }, [
            trimCheck,
            el('label', { text: t('dialog.diff.normalizeTrim'), attrs: { for: 'diff-normalize-trim' } }),
          ]),
          el('div', { className: 'diff-column-item' }, [
            caseCheck,
            el('label', { text: t('dialog.diff.normalizeCase'), attrs: { for: 'diff-normalize-case' } }),
          ]),
        ]),
      );

      // ----- Filter (defaults to "changed only": unchanged rows are not the point of a diff) -----
      const filterLabel = el('label', {
        className: 'form-label',
        text: t('dialog.diff.filter'),
        attrs: { for: 'diff-filter' },
      });
      const filterSelect = el('select', { attrs: { id: 'diff-filter' } });
      filterSelect.append(
        el('option', { text: t('dialog.diff.filter.changed'), attrs: { value: 'changed' } }),
        el('option', { text: t('dialog.diff.filter.all'), attrs: { value: 'all' } }),
      );
      body.append(el('div', { className: 'form-row' }, [filterLabel, filterSelect]));

      // ----- Run / export -----
      const runRow = el('div', { className: 'form-row diff-run-row' });
      const exportButton = dialogButton(t('dialog.diff.exportCsv'), false, false, () => void doExport());
      exportButton.disabled = true;
      const runButton = dialogButton(t('dialog.diff.run'), true, false, () => runDiff());
      runRow.append(exportButton, runButton);
      body.append(runRow);

      // ----- Status (announced) and results -----
      const status = el('p', { className: 'diff-status', attrs: { role: 'status', 'aria-live': 'polite' } });
      body.append(status);
      const resultsWrap = el('div', { className: 'diff-results', attrs: { tabindex: '0' } });
      body.append(resultsWrap);

      const setStatus = (text: string, isError: boolean): void => {
        status.textContent = text;
        status.setAttribute('role', isError ? 'alert' : 'status');
      };

      let lastResult: DiffResult | null = null;

      const renderRow = (row: DiffRow, columns: string[]): HTMLElement => {
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
      };

      const renderResult = (result: DiffResult, filter: FilterMode): void => {
        resultsWrap.replaceChildren();
        const shown = filter === 'changed' ? result.rows.filter((r) => r.type !== 'unchanged') : result.rows;
        if (shown.length === 0) {
          setStatus(t('dialog.diff.status.noRows'), false);
          return;
        }
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
          tbody.append(renderRow(row, result.columns));
        }
        table.append(caption, el('thead', {}, [headRow]), tbody);
        resultsWrap.append(table);

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
          parts.push(
            t('dialog.diff.status.truncated', { shown: result.rows.length, matched: result.matchedRows }),
          );
        }
        if (result.baselineTruncated || result.currentTruncated) {
          parts.push(t('dialog.diff.status.sourceTruncated'));
        }
        setStatus(parts.join(' '), false);
      };

      filterSelect.addEventListener('change', () => {
        if (lastResult) renderResult(lastResult, filterSelect.value as FilterMode);
      });

      const runDiff = (): void => {
        resultsWrap.replaceChildren();
        lastResult = null;
        exportButton.disabled = true;
        const options: DiffOptions = {
          keyColumns: keyChecks.filter((c) => c.checked).map((c) => c.value),
          compareColumns: compareChecks.filter((c) => c.checked).map((c) => c.value),
          normalize: { trim: trimCheck.checked, caseInsensitive: caseCheck.checked },
        };
        const outcome = input.runDiff(baselineSelect.value, options);
        if (!outcome.ok) {
          setStatus(t(`diff.error.${outcome.error.code}`, outcome.error.params), true);
          return;
        }
        lastResult = outcome.result;
        exportButton.disabled = false;
        renderResult(outcome.result, filterSelect.value as FilterMode);
      };

      const doExport = async (): Promise<void> => {
        if (!lastResult) return;
        const ok = await input.exportCsv(lastResult);
        if (ok) setStatus(t('dialog.diff.status.exported'), false);
      };

      buttons.append(dialogButton(t('dialog.diff.close'), false, true, () => close(undefined)));
    });
  }
}
