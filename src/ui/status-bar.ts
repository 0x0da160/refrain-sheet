// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import { t } from '../app/i18n';
import { computeSelectionStats, type SelectionStats } from '../core/stats';
import { el, clearChildren } from './dom';

function formatStat(n: number): string {
  if (Number.isInteger(n)) {
    return n.toLocaleString('en-US');
  }
  return Number(n.toFixed(10)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/**
 * Status bar: current encoding interpretation, BOM state, delimiter,
 * line-ending style, file size, undecodable-byte warning, structural
 * problems, edit count, and the selected cell.
 */
export class StatusBar {
  readonly element: HTMLElement;

  constructor(
    private readonly state: AppState,
    private readonly onShowProblems: () => void,
  ) {
    this.element = el('div', { className: 'status-bar', attrs: { role: 'status' } });
    this.render();
  }

  render(): void {
    clearChildren(this.element);
    const tab = this.state.activeTab;
    if (!tab) {
      this.element.append(el('span', { text: t('app.subtitle') }));
      return;
    }
    const doc = tab.doc;

    if (doc.kind === 'rcsv') {
      this.element.append(el('span', { className: 'doc-kind', text: t('status.doc.rcsv') }));
      this.element.append(
        el('span', { text: t('status.gridSize', { rows: doc.rowCount, cols: doc.columnCount }) }),
      );
      const formulas = doc.countFormulaCells();
      if (formulas > 0) {
        this.element.append(el('span', { text: t('status.formulas', { n: formulas }) }));
      }
      if (doc.isDirty) {
        this.element.append(el('span', { text: t('status.unsaved') }));
      }
      this.appendSelection(tab);
      return;
    }

    this.element.append(el('span', { className: 'doc-kind', text: t('status.doc.csv') }));
    const encodingLabel = t(`encoding.${doc.encoding}`);
    const bomLabel =
      doc.encoding === 'utf-8' ? `, ${doc.bomLength > 0 ? t('status.bom.yes') : t('status.bom.no')}` : '';
    this.element.append(el('span', { text: `${t('status.encoding')}: ${encodingLabel}${bomLabel}` }));

    const delimiterKey =
      doc.delimiter === ','
        ? 'status.delimiter.comma'
        : doc.delimiter === ';'
          ? 'status.delimiter.semicolon'
          : 'status.delimiter.tab';
    this.element.append(el('span', { text: `${t('status.delimiter')}: ${t(delimiterKey)}` }));

    const { crlf, lf, cr } = doc.lineEndings;
    const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
    let leLabel: string;
    if (kinds === 0) leLabel = t('status.lineEndings.none');
    else if (kinds > 1) leLabel = t('status.lineEndings.mixed');
    else leLabel = crlf > 0 ? 'CRLF' : lf > 0 ? 'LF' : 'CR';
    if (doc.rowCount > 0 && !doc.hasFinalNewline && kinds > 0) {
      leLabel += ` (${t('status.noFinalNewline')})`;
    }
    this.element.append(el('span', { text: `${t('status.lineEndings')}: ${leLabel}` }));

    this.element.append(
      el('span', { text: t('status.size', { size: doc.bytes.length.toLocaleString('en-US') }) }),
    );

    if (doc.diagnostics.length > 0) {
      const problems = el('button', {
        className: 'status-problems',
        text: t('status.problems', { n: doc.diagnostics.length }),
        attrs: { type: 'button' },
      });
      problems.addEventListener('click', this.onShowProblems);
      this.element.append(problems);
    }

    const hasUndecodable = doc.hasUndecodableAnywhere();
    if (hasUndecodable) {
      this.element.append(el('span', { className: 'warn', text: t('status.undecodable') }));
    }

    if (doc.editCount > 0) {
      this.element.append(el('span', { text: t('status.edits', { n: doc.editCount }) }));
    }

    this.element.append(
      el('span', {
        className: 'engine-tag',
        text: t('status.engine', { engine: doc.engineName.toUpperCase() }),
        attrs: { title: t('status.engineTitle') },
      }),
    );

    this.appendSelection(tab);
  }

  /**
   * Append the active-cell reference and, when more than one cell is selected,
   * the selection statistics (count, non-empty, numeric, sum, and — when any
   * numeric cell is present — average/min/max).
   */
  private appendSelection(tab: Tab): void {
    if (!tab.selection) {
      return;
    }
    this.element.append(this.selectionLabel(tab.selection.row, tab.selection.col));

    const range = this.state.selectedRange(tab);
    if (!range) {
      return;
    }
    const area = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    if (area <= 1) {
      return;
    }
    const doc = tab.doc;
    const readDisplay = (r: number, c: number): string =>
      doc.kind === 'rcsv' ? doc.getDisplayValue(r, c) : doc.getValue(r, c);
    const stats = computeSelectionStats(range, readDisplay, (r) => doc.fieldCount(r));
    for (const span of this.statsSpans(stats)) {
      this.element.append(span);
    }
  }

  private statsSpans(stats: SelectionStats): HTMLElement[] {
    const spans: HTMLElement[] = [
      el('span', { className: 'sel-stat', text: t('status.sel.count', { n: stats.count }) }),
      el('span', { className: 'sel-stat', text: t('status.sel.nonEmpty', { n: stats.nonEmpty }) }),
      el('span', { className: 'sel-stat', text: t('status.sel.numeric', { n: stats.numeric }) }),
      el('span', { className: 'sel-stat', text: t('status.sel.sum', { v: formatStat(stats.sum) }) }),
    ];
    if (stats.numeric > 0 && stats.average !== null && stats.min !== null && stats.max !== null) {
      spans.push(
        el('span', { className: 'sel-stat', text: t('status.sel.avg', { v: formatStat(stats.average) }) }),
        el('span', { className: 'sel-stat', text: t('status.sel.min', { v: formatStat(stats.min) }) }),
        el('span', { className: 'sel-stat', text: t('status.sel.max', { v: formatStat(stats.max) }) }),
      );
    }
    return spans;
  }

  private selectionLabel(row: number, col: number): HTMLElement {
    return el('span', { text: t('status.cell', { row: row + 1, col: col + 1 }) });
  }
}
