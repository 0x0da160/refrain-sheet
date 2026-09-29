// SPDX-License-Identifier: MIT
/**
 * The version-history preview's "what changed" bar: the cells of the shown
 * sheet whose value or formula changed, and those whose formatting alone
 * changed, since the version saved before it (`diffVersions`), highlighted
 * in the grid; the sheets added, removed or renamed; a switch to hide the
 * highlight; and a button that steps through the changed cells. It only
 * shows: nothing is restored or saved from here.
 */
import type { AppState } from '../../app/state';
import { t } from '../../app/i18n';
import { cellKey, type VersionDiff } from '../../core/workbook/version-diff';
import type { RsfDocument } from '../../core/workbook/rsf-document';
import { el } from '../dom';
import type { Grid } from '../grid';
import { dialogButton } from './shared';

export interface VersionChangesBar {
  element: HTMLElement;
  /** Re-read the shown sheet (after switching sheets). */
  render(): void;
}

/**
 * The bar for `doc` (the previewed version) against the version before it
 * (`diff`, saved `previousWhen`), or a note that there is none.
 */
export function versionChangesBar(
  state: AppState,
  grid: Grid,
  doc: RsfDocument,
  diff: VersionDiff | null,
  previousWhen: string | null,
): VersionChangesBar {
  const element = el('div', { className: 'version-changes', attrs: { role: 'status' } });
  if (!diff || previousWhen === null) {
    element.append(el('p', { className: 'dialog-note', text: t('versionChanges.oldest') }));
    return { element, render: () => undefined };
  }

  const show = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
  show.checked = true;
  const sheetLine = el('span', { className: 'version-changes-sheet' });
  const next = dialogButton(t('versionChanges.next'), false, false, () => goToNext());
  const legend = el('span', { className: 'version-changes-legend' }, [
    el('span', { className: 'version-changes-swatch diff-value', attrs: { 'aria-hidden': 'true' } }),
    t('versionChanges.legendValue'),
    el('span', { className: 'version-changes-swatch diff-format', attrs: { 'aria-hidden': 'true' } }),
    t('versionChanges.legendFormat'),
  ]);
  element.append(
    el('p', { className: 'version-changes-lead', text: t('versionChanges.since', { when: previousWhen }) }),
    el('div', { className: 'version-changes-row' }, [
      sheetLine,
      next,
      el('label', { className: 'version-changes-toggle' }, [
        show,
        el('span', { text: t('versionChanges.show') }),
      ]),
      legend,
    ]),
  );
  const fileLines = [
    ...diff.added.map((name) => t('versionChanges.added', { name })),
    ...diff.removed.map((name) => t('versionChanges.removed', { name })),
    ...diff.renamed.map(({ from, to }) => t('versionChanges.renamed', { from, to })),
  ];
  if (fileLines.length > 0) {
    element.append(
      el(
        'ul',
        { className: 'version-changes-sheets' },
        fileLines.map((text) => el('li', { text })),
      ),
    );
  }

  const changes = () => diff.sheets.get(doc.activeSheetId) ?? null;
  const marker = (row: number, col: number): 'value' | 'format' | null =>
    changes()?.cells.get(cellKey(row, col)) ?? null;

  /** The shown sheet's changed cells in reading order. */
  const ordered = (): Array<[number, number]> =>
    [...(changes()?.cells.keys() ?? [])]
      .map((key) => key.split(':').map(Number) as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const goToNext = (): void => {
    const cells = ordered();
    if (cells.length === 0) {
      return;
    }
    const at = state.activeTab?.selection;
    const after = at ? cells.find(([r, c]) => r > at.row || (r === at.row && c > at.col)) : undefined;
    const [row, col] = after ?? cells[0];
    grid.reveal(row, col);
  };

  const render = (): void => {
    const current = changes();
    const isNew = !current;
    sheetLine.textContent = isNew
      ? t('versionChanges.sheetAdded')
      : current.text
        ? t('versionChanges.textChanged')
        : current.values + current.formats === 0
          ? t('versionChanges.none')
          : t('versionChanges.counts', { values: current.values, formats: current.formats });
    next.disabled = !current || current.cells.size === 0;
    grid.setCellMarker(show.checked ? marker : null);
  };
  show.addEventListener('change', render);
  render();
  return { element, render };
}
