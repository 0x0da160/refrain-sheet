// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import {
  compileQuery,
  replaceAllInValue,
  searchDocument,
  searchWorkbook,
  type CompiledQuery,
  type SearchScope,
  type SheetCellMatch,
} from '../core/search';
import { el } from './dom';
import type { Grid } from './grid';

/**
 * Find & Replace bar. Normal and regex search with match counts updated as you
 * type, Next/Previous with wrap-around, and atomic Replace All. Invalid
 * regular expressions never crash the app; the compilation error is shown
 * inline.
 *
 * **Scope.** An RSF workbook can be searched one worksheet at a time (the
 * default — the sheet you are looking at) or across every worksheet in
 * workbook order. Plain CSV is a single-sheet document, so the selector is
 * disabled there with a localized explanation. In workbook scope, Next and
 * Previous activate the worksheet a match lives on before revealing it, and
 * the status line names that worksheet; wrapping past the last match back to
 * the first is announced explicitly, so crossing a worksheet boundary is never
 * silent.
 *
 * **What is searched.** Always the cell *input*: the formula expression for a
 * formula cell, never its calculated result. A replacement can therefore only
 * rewrite text the user actually typed — it can never overwrite a computed
 * value with a literal.
 *
 * **Staleness.** Results carry each match's stable worksheet id, never an index
 * or a name, and every navigation re-checks that the worksheet still exists and
 * that the cell is still in range. A worksheet renamed, reordered, or deleted
 * after a search can therefore never send navigation to the wrong place: the
 * search simply recomputes.
 */
export class FindBar {
  readonly element: HTMLElement;
  private readonly findInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly caseBox: HTMLInputElement;
  private readonly regexBox: HTMLInputElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly scopeLabel: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly replaceRow: HTMLElement[];
  private readonly labels = new Map<string, { node: HTMLElement; key: string }>();
  /**
   * Matches of the last computed search, always in workbook order. Single-sheet
   * results are represented the same way (one worksheet), so navigation and
   * replacement have exactly one code path.
   */
  private matches: SheetCellMatch[] = [];
  private matchCount = 0;
  private sheetCount = 0;
  private aborted = false;
  private current = -1;
  private debounceTimer: number | undefined;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly grid: Grid,
  ) {
    this.findInput = el('input', { attrs: { type: 'text' } });
    this.replaceInput = el('input', { attrs: { type: 'text' } });
    this.caseBox = el('input', { attrs: { type: 'checkbox' } });
    this.regexBox = el('input', { attrs: { type: 'checkbox' } });
    this.scopeSelect = el('select', { className: 'find-scope' });
    this.scopeSelect.append(
      el('option', { text: t('find.scope.sheet'), attrs: { value: 'sheet' } }),
      el('option', { text: t('find.scope.workbook'), attrs: { value: 'workbook' } }),
    );
    this.countEl = el('span', { className: 'find-count', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.errorEl = el('span', { className: 'find-error', attrs: { role: 'alert' } });

    const label = (key: string, id: string): HTMLElement => {
      const node = el('span', { text: t(key) });
      this.labels.set(id, { node, key });
      return node;
    };
    const button = (key: string, onClick: () => void): HTMLButtonElement => {
      const node = el('button', { attrs: { type: 'button' } }, [label(key, `btn-${key}`)]);
      node.addEventListener('click', onClick);
      return node;
    };

    const prevBtn = button('find.prev', () => this.next(-1));
    const nextBtn = button('find.next', () => this.next(1));
    const replaceBtn = button('find.replaceOne', () => this.replaceCurrent());
    const replaceAllBtn = button('find.replaceAll', () => void this.replaceAll());
    const closeBtn = button('find.close', () => this.close());

    this.replaceRow = [
      el('label', {}, [label('find.replace', 'lbl-replace'), this.replaceInput]),
      replaceBtn,
      replaceAllBtn,
    ];
    this.scopeLabel = el('label', {}, [label('find.scope', 'lbl-scope'), this.scopeSelect]);

    this.element = el('div', { className: 'find-bar', attrs: { role: 'search' } }, [
      el('label', {}, [label('find.find', 'lbl-find'), this.findInput]),
      prevBtn,
      nextBtn,
      el('label', {}, [this.caseBox, label('find.matchCase', 'lbl-case')]),
      el('label', {}, [this.regexBox, label('find.regex', 'lbl-regex')]),
      this.scopeLabel,
      ...this.replaceRow,
      this.countEl,
      closeBtn,
      this.errorEl,
    ]);
    this.element.hidden = true;

    const requestRecompute = () => this.scheduleRecompute();
    this.findInput.addEventListener('input', requestRecompute);
    this.caseBox.addEventListener('change', requestRecompute);
    this.regexBox.addEventListener('change', requestRecompute);
    this.scopeSelect.addEventListener('change', requestRecompute);
    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.next(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
    this.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.replaceCurrent();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  open(replaceMode: boolean): void {
    this.element.hidden = false;
    for (const node of this.replaceRow) {
      node.hidden = !replaceMode;
    }
    this.findInput.focus();
    this.findInput.select();
    this.scheduleRecompute();
  }

  close(): void {
    this.element.hidden = true;
    this.state.emit('view');
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Re-translate labels (locale change) and recompute counts (document change). */
  refresh(): void {
    for (const { node, key } of this.labels.values()) {
      node.textContent = t(key);
    }
    this.findInput.setAttribute('aria-label', t('find.find'));
    this.replaceInput.setAttribute('aria-label', t('find.replace'));
    this.scopeSelect.options[0].textContent = t('find.scope.sheet');
    this.scopeSelect.options[1].textContent = t('find.scope.workbook');
    this.updateScopeAvailability();
    if (this.isOpen) {
      this.scheduleRecompute();
    }
  }

  /**
   * Workbook scope exists only for RSF workbooks; a plain CSV is a single-sheet
   * byte-preserving document, so the control is disabled with a localized
   * explanation rather than silently missing.
   */
  private updateScopeAvailability(): void {
    const isWorkbook = this.state.activeTab?.doc.kind === 'rsf';
    this.scopeSelect.disabled = !isWorkbook;
    this.scopeSelect.title = isWorkbook ? '' : t('find.scope.csvOnly');
    if (!isWorkbook) {
      this.scopeSelect.value = 'sheet';
    }
  }

  /** The effective scope (never `workbook` for a plain CSV document). */
  private get scope(): SearchScope {
    return this.scopeSelect.value === 'workbook' && this.state.activeTab?.doc.kind === 'rsf'
      ? 'workbook'
      : 'sheet';
  }

  private compile(): CompiledQuery {
    return compileQuery({
      text: this.findInput.value,
      matchCase: this.caseBox.checked,
      regex: this.regexBox.checked,
    });
  }

  private scheduleRecompute(): void {
    window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.recompute(), 120);
  }

  private clearResult(): void {
    this.matches = [];
    this.matchCount = 0;
    this.sheetCount = 0;
    this.aborted = false;
    this.current = -1;
  }

  private recompute(): void {
    const tab = this.state.activeTab;
    this.errorEl.textContent = '';
    this.clearResult();
    this.updateScopeAvailability();
    if (!tab || this.findInput.value === '') {
      this.countEl.textContent = '';
      return;
    }
    const query = this.compile();
    if (!query.ok) {
      this.countEl.textContent = '';
      if (query.error !== 'empty') {
        this.errorEl.textContent = t('find.invalidRegex', { error: query.error });
      }
      return;
    }
    const doc = tab.doc;
    if (this.scope === 'workbook' && doc.kind === 'rsf') {
      const result = searchWorkbook(doc.sheets, query);
      this.matches = result.cells;
      this.matchCount = result.matchCount;
      this.sheetCount = result.sheetCount;
      this.aborted = result.aborted;
    } else {
      const result = searchDocument(doc, query);
      const sheetId = doc.kind === 'rsf' ? doc.activeSheetId : '';
      const sheetName = doc.kind === 'rsf' ? doc.activeSheet.name : '';
      this.matches = result.cells.map((cell) => ({ ...cell, sheetId, sheetName }));
      this.matchCount = result.matchCount;
      this.sheetCount = result.cellCount > 0 ? 1 : 0;
      this.aborted = result.aborted;
    }
    this.renderCount();
    if (this.aborted) {
      this.errorEl.textContent = t('find.aborted');
    }
  }

  /** The match count line, naming the worksheet span in workbook scope. */
  private renderCount(extra = ''): void {
    if (this.matches.length === 0) {
      this.countEl.textContent = t('find.none') + extra;
      return;
    }
    const base =
      this.scope === 'workbook'
        ? t('find.countWorkbook', {
            matches: this.matchCount,
            cells: this.matches.length,
            sheets: this.sheetCount,
          })
        : t('find.count', { matches: this.matchCount, cells: this.matches.length });
    this.countEl.textContent = base + extra;
  }

  /**
   * True when a recorded match still points at a live cell. Worksheets are
   * resolved by their stable id, so a rename or reorder is harmless and a
   * deletion is detected rather than followed.
   */
  private isLive(match: SheetCellMatch): boolean {
    const tab = this.state.activeTab;
    if (!tab) {
      return false;
    }
    const doc = tab.doc;
    if (doc.kind !== 'rsf') {
      return match.row < doc.rowCount && match.col < doc.fieldCount(match.row);
    }
    const sheet = match.sheetId === '' ? doc.activeSheet : doc.sheetById(match.sheetId);
    return sheet !== undefined && sheet !== null && sheet.contains(match.row, match.col);
  }

  /** Move to the next/previous matching cell, wrapping across worksheets. */
  next(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open(false);
      return;
    }
    if (this.matches.length === 0) {
      this.recompute();
    }
    const tab = this.state.activeTab;
    if (!tab || this.matches.length === 0) {
      return;
    }
    // A worksheet may have been renamed, reordered, or deleted since the scan:
    // recompute rather than navigate to something that is no longer there.
    if (!this.matches.every((match) => this.isLive(match))) {
      this.recompute();
      if (this.matches.length === 0) {
        return;
      }
    }
    if (this.current < 0 && tab.selection) {
      // Start from the selection: the first match at or after it, on the
      // active worksheet, so "Next" continues from where the user is looking.
      const activeId = tab.doc.kind === 'rsf' ? tab.doc.activeSheetId : '';
      const { row, col } = tab.selection;
      const at = this.matches.findIndex(
        (m) =>
          (m.sheetId === activeId || m.sheetId === '') && (m.row > row || (m.row === row && m.col >= col)),
      );
      this.current = at >= 0 ? at - direction : this.matches.length - direction;
    }
    const nextIndex = this.current + direction;
    const wrapped = nextIndex < 0 || nextIndex >= this.matches.length;
    this.current = (nextIndex + this.matches.length) % this.matches.length;
    const match = this.matches[this.current];
    if (match.sheetId !== '' && tab.doc.kind === 'rsf' && tab.doc.activeSheetId !== match.sheetId) {
      // Cross-worksheet navigation: activate the sheet first, then reveal.
      this.state.setActiveSheet(tab, match.sheetId);
    }
    this.grid.reveal(match.row, match.col);
    this.renderCount(this.positionSuffix(match, wrapped));
  }

  /** " — 3 of 12 on Sheet2" / " (wrapped to the first match)". */
  private positionSuffix(match: SheetCellMatch, wrapped: boolean): string {
    const position =
      this.scope === 'workbook' && match.sheetName !== ''
        ? t('find.positionSheet', {
            index: this.current + 1,
            total: this.matches.length,
            sheet: match.sheetName,
          })
        : t('find.position', { index: this.current + 1, total: this.matches.length });
    return position + (wrapped ? t('find.wrapped') : '');
  }

  /** Replace every occurrence in the currently selected matching cell, then advance. */
  private replaceCurrent(): void {
    const tab = this.state.activeTab;
    if (!tab) return;
    if (this.matches.length === 0) this.recompute();
    const query = this.compile();
    if (!query.ok || this.matches.length === 0) return;
    const sel = tab.selection;
    const activeId = tab.doc.kind === 'rsf' ? tab.doc.activeSheetId : '';
    const onMatch =
      sel &&
      this.matches.some(
        (m) => m.row === sel.row && m.col === sel.col && (m.sheetId === '' || m.sheetId === activeId),
      );
    if (!sel || !onMatch) {
      this.next(1);
      return;
    }
    const replaced = replaceAllInValue(tab.doc.getValue(sel.row, sel.col), query, this.replaceInput.value);
    if (replaced.count > 0) {
      this.state.editCell(tab, sel.row, sel.col, replaced.value, 'history.replaceCell');
    }
    this.recompute();
    this.next(1);
  }

  private async replaceAll(): Promise<void> {
    const query = this.compile();
    if (!query.ok) return;
    const scope = this.scope;
    const report = await this.commands.replaceAll(query, this.replaceInput.value, scope);
    if (!report.confirmed) {
      this.countEl.textContent = t('find.replaceCancelled');
      return;
    }
    this.countEl.textContent =
      scope === 'workbook'
        ? t('find.replacedAllWorkbook', {
            count: report.count,
            cells: report.cells,
            sheets: report.sheets,
          }) + (report.skipped > 0 ? t('find.replaceSkipped', { n: report.skipped }) : '')
        : t('find.replacedAll', { count: report.count, cells: report.cells });
    this.clearResult();
  }
}
