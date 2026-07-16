// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import { t } from '../app/i18n';
import { el, clearChildren } from './dom';

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

    const hasUndecodable = doc.records.some((r) => r.fields.some((f) => f.hasUndecodable));
    if (hasUndecodable) {
      this.element.append(el('span', { className: 'warn', text: t('status.undecodable') }));
    }

    if (doc.editCount > 0) {
      this.element.append(el('span', { text: t('status.edits', { n: doc.editCount }) }));
    }

    if (tab.selection) {
      this.element.append(
        el('span', { text: t('status.cell', { row: tab.selection.row + 1, col: tab.selection.col + 1 }) }),
      );
    }
  }
}
