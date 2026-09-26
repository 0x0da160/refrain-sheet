// SPDX-License-Identifier: MIT
import { Search } from 'lucide';
import type { AppState } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { cellLabel } from '../core/formula';
import {
  compileQuery,
  MAX_PATTERN_LENGTH,
  replaceAllInValue,
  searchDocument,
  searchWorkbook,
  type CompiledQuery,
  type SearchScope,
  type SheetCellMatch,
} from '../core/search';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  currentSidePanelPlacement,
  panelCheck,
  panelField,
  releaseSidePanel,
  type SidePanelChrome,
} from './dialogs/shared';
import { clearChildren, el, focusWithoutKeyboard } from './dom';
import type { Grid } from './grid';

/** The most rows the "Find All" list renders; the count line still reports every match. */
const FIND_ALL_LIST_LIMIT = 1000;

/** Longest cell text shown per row of the "Find All" list. */
const RESULT_TEXT_LIMIT = 120;

/**
 * Find & Replace panel: one dockable side panel (the same `.side-panel`
 * chrome and docking as the comments and Filter/Sort panels) that holds both
 * the find and the replace fields. Normal and regex search with match counts
 * updated as you type, Find Next/Previous with wrap-around, Find All with a
 * clickable result list, and atomic Replace All. Invalid regular expressions
 * never crash the app; the compilation error is shown inline.
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
 *
 * Jumping to a match (Next/Previous or a result row) is a view change only —
 * never a document mutation — so it is never pushed onto the undo history.
 */
export class FindBar {
  readonly element: HTMLElement;
  private readonly chrome: SidePanelChrome;
  private readonly findInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly caseBox: HTMLInputElement;
  private readonly regexBox: HTMLInputElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly countEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly resultsNoteEl: HTMLElement;
  /** Every translatable node: re-labelled on a locale change. */
  private readonly labels: Array<{ node: HTMLElement; key: string; title?: boolean }> = [];
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
  /** True once Find All was pressed: the list then tracks the query live. */
  private listing = false;
  private debounceTimer: number | undefined;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly grid: Grid,
  ) {
    this.findInput = el('input', { className: 'find-input', attrs: { type: 'text' } });
    this.replaceInput = el('input', { className: 'replace-input', attrs: { type: 'text' } });
    this.caseBox = el('input', { attrs: { type: 'checkbox' } });
    this.regexBox = el('input', { attrs: { type: 'checkbox' } });
    this.scopeSelect = el('select', { className: 'find-scope' });
    this.scopeSelect.append(
      el('option', { attrs: { value: 'sheet' } }),
      el('option', { attrs: { value: 'workbook' } }),
    );
    this.countEl = el('p', { className: 'find-count', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.errorEl = el('p', { className: 'find-error', attrs: { role: 'alert' } });
    this.resultsNoteEl = el('p', { className: 'find-results-note' });
    this.resultsEl = el('ul', { className: 'find-results' });
    this.resultsEl.hidden = true;
    this.resultsNoteEl.hidden = true;

    const button = (key: string, onClick: () => void, className: string): HTMLButtonElement => {
      const node = el('button', { className, attrs: { type: 'button' } });
      this.labels.push({ node, key, title: false });
      node.addEventListener('click', onClick);
      return node;
    };
    const text = (key: string): HTMLElement => {
      const node = el('span');
      this.labels.push({ node, key });
      return node;
    };

    const findField = panelField('', this.findInput);
    const replaceField = panelField('', this.replaceInput);
    const scopeField = panelField('', this.scopeSelect);
    const fieldLabel = (field: HTMLElement, key: string) =>
      this.labels.push({ node: field.querySelector<HTMLElement>('.panel-field-label')!, key });
    fieldLabel(findField, 'find.find');
    fieldLabel(replaceField, 'find.replace');
    fieldLabel(scopeField, 'find.scope');
    const caseCheck = panelCheck(this.caseBox, '');
    const regexCheck = panelCheck(this.regexBox, '');
    caseCheck.lastElementChild!.replaceWith(text('find.matchCase'));
    regexCheck.lastElementChild!.replaceWith(text('find.regex'));

    const findButtons = el('div', { className: 'panel-row find-actions' }, [
      button('find.prev', () => this.next(-1), 'find-prev'),
      button('find.next', () => this.next(1), 'find-next primary'),
      button('find.findAll', () => this.findAll(), 'find-all'),
    ]);
    const replaceButtons = el('div', { className: 'panel-row find-actions' }, [
      button('find.replaceOne', () => this.replaceCurrent(), 'find-replace'),
      button('find.replaceAll', () => void this.replaceAll(), 'find-replace-all'),
    ]);

    this.element = el('div', {
      className: 'side-panel find-panel',
      attrs: { role: 'search' },
    });
    this.chrome = buildSidePanelChrome(this.element, {
      icon: Search,
      title: t('find.panelTitle'),
      closeLabel: t('find.close'),
      onClose: () => this.close(),
    });
    const body = el('div', { className: 'dialog-body side-panel-form find-panel-body' }, [
      findField,
      findButtons,
      replaceField,
      replaceButtons,
      el('div', { className: 'panel-choices panel-choices-inline' }, [caseCheck, regexCheck]),
      scopeField,
      this.countEl,
      this.errorEl,
      this.resultsNoteEl,
      this.resultsEl,
    ]);
    this.element.append(this.chrome.heading, body, this.chrome.resizeHandle);
    this.element.setAttribute('aria-labelledby', this.chrome.titleId);
    this.element.hidden = true;
    this.relabel();

    const requestRecompute = () => this.scheduleRecompute();
    this.findInput.addEventListener('input', requestRecompute);
    this.caseBox.addEventListener('change', requestRecompute);
    this.regexBox.addEventListener('change', requestRecompute);
    this.scopeSelect.addEventListener('change', requestRecompute);
    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        this.next(event.shiftKey ? -1 : 1);
      }
    });
    this.replaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        this.replaceCurrent();
      }
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        this.close();
      }
    });
  }

  /**
   * Open (or re-focus) the panel. `replaceMode` puts the caret in the replace
   * field once there is something to find; both fields are always shown.
   */
  open(replaceMode: boolean): void {
    const wasOpen = this.isOpen;
    this.element.hidden = false;
    if (!wasOpen) {
      // Applied on open rather than at construction (the panel starts hidden),
      // so a closed panel never reserves app-edge space.
      const { position, size } = currentSidePanelPlacement();
      applySidePanelPosition(this.element, position, size);
    }
    const target = replaceMode && this.findInput.value !== '' ? this.replaceInput : this.findInput;
    focusWithoutKeyboard(target);
    target.select();
    this.scheduleRecompute();
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }
    this.element.hidden = true;
    releaseSidePanel(this.element);
    this.state.emit('view');
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Re-translate labels (locale change) and recompute counts (document change). */
  refresh(): void {
    this.relabel();
    this.updateScopeAvailability();
    if (this.isOpen) {
      this.scheduleRecompute();
    }
  }

  private relabel(): void {
    this.chrome.relabel(t('find.panelTitle'), t('find.close'));
    for (const { node, key } of this.labels) {
      node.textContent = t(key);
    }
    this.findInput.placeholder = t('find.find');
    this.replaceInput.placeholder = t('find.replace');
    this.scopeSelect.options[0].textContent = t('find.scope.sheet');
    this.scopeSelect.options[1].textContent = t('find.scope.workbook');
    this.resultsEl.setAttribute('aria-label', t('find.results'));
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
      this.renderResults();
      return;
    }
    const query = this.compile();
    if (!query.ok) {
      this.countEl.textContent = '';
      if (this.findInput.value.length > MAX_PATTERN_LENGTH) {
        this.errorEl.textContent = t('find.tooLong', { max: MAX_PATTERN_LENGTH });
      } else if (query.error !== 'empty') {
        this.errorEl.textContent = t('find.invalidRegex', { error: query.error });
      }
      this.renderResults();
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
    this.renderResults();
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
   * Find All: list every matching cell. The list then follows the query as it
   * changes, until the panel closes or the query is cleared.
   */
  findAll(): void {
    if (!this.isOpen) {
      this.open(false);
    }
    this.listing = true;
    this.recompute();
  }

  private renderResults(): void {
    clearChildren(this.resultsEl);
    const show = this.listing && this.findInput.value !== '' && this.matches.length > 0;
    this.resultsEl.hidden = !show;
    this.resultsNoteEl.hidden = true;
    if (!show) {
      return;
    }
    const tab = this.state.activeTab;
    const doc = tab?.doc;
    const workbook = this.scope === 'workbook';
    const shown = this.matches.slice(0, FIND_ALL_LIST_LIMIT);
    shown.forEach((match, index) => {
      const ref = cellLabel(match.row, match.col);
      let value = '';
      if (doc) {
        const sheet = doc.kind === 'rsf' && match.sheetId !== '' ? doc.sheetById(match.sheetId) : null;
        value = sheet ? sheet.getValue(match.row, match.col) : doc.getValue(match.row, match.col);
      }
      const snippet = value.length > RESULT_TEXT_LIMIT ? `${value.slice(0, RESULT_TEXT_LIMIT)}…` : value;
      const header: Node[] = [el('span', { className: 'find-result-ref', text: ref })];
      if (workbook && match.sheetName !== '') {
        header.push(el('span', { className: 'find-result-sheet', text: match.sheetName }));
      }
      const item = el(
        'li',
        {
          className: 'find-result',
          attrs: {
            role: 'button',
            tabindex: '0',
            'aria-label':
              workbook && match.sheetName !== ''
                ? t('find.resultJumpSheet', { cell: ref, sheet: match.sheetName })
                : t('find.resultJump', { cell: ref }),
          },
        },
        [
          el('div', { className: 'find-result-header' }, header),
          el('div', { className: 'find-result-text', text: snippet }),
        ],
      );
      const activate = () => this.goTo(index);
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
      this.resultsEl.append(item);
    });
    if (this.matches.length > FIND_ALL_LIST_LIMIT) {
      this.resultsNoteEl.textContent = t('find.resultsTruncated', {
        shown: FIND_ALL_LIST_LIMIT,
        total: this.matches.length,
      });
      this.resultsNoteEl.hidden = false;
    }
    this.markCurrentResult();
  }

  private markCurrentResult(): void {
    const items = this.resultsEl.children;
    for (let i = 0; i < items.length; i++) {
      const isCurrent = i === this.current;
      items[i].classList.toggle('current', isCurrent);
      if (isCurrent) {
        items[i].setAttribute('aria-current', 'true');
      } else {
        items[i].removeAttribute('aria-current');
      }
    }
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

  /** Recompute when any recorded match went stale; false if nothing is left. */
  private ensureLive(): boolean {
    if (this.matches.length === 0) {
      this.recompute();
    }
    if (!this.matches.every((match) => this.isLive(match))) {
      this.recompute();
    }
    return this.matches.length > 0;
  }

  /** Select and reveal the match at `index` (a Find All row). */
  private goTo(index: number): void {
    const target = this.matches[index];
    if (!target || !this.ensureLive()) {
      return;
    }
    // A recompute may have reordered the list: find the same cell again.
    const found = this.matches.findIndex(
      (m) => m.sheetId === target.sheetId && m.row === target.row && m.col === target.col,
    );
    if (found < 0) {
      return;
    }
    this.current = found;
    this.reveal(this.matches[found], false);
  }

  /**
   * Move to the next/previous matching cell, wrapping across worksheets.
   * `notice` prefixes the status line when the caller needs to explain *why*
   * navigation happened (e.g. Replace was pressed off a match) — this keeps
   * that case visibly distinct from an ordinary Next/Previous move.
   */
  next(direction: 1 | -1, notice = ''): void {
    if (!this.isOpen) {
      this.open(false);
      return;
    }
    const tab = this.state.activeTab;
    if (!tab || !this.ensureLive()) {
      return;
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
    this.reveal(this.matches[this.current], wrapped, notice);
  }

  private reveal(match: SheetCellMatch, wrapped: boolean, notice = ''): void {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    if (match.sheetId !== '' && tab.doc.kind === 'rsf' && tab.doc.activeSheetId !== match.sheetId) {
      // Cross-worksheet navigation: activate the sheet first, then reveal.
      this.state.setActiveSheet(tab, match.sheetId);
    }
    this.grid.reveal(match.row, match.col);
    this.renderCount(notice + this.positionSuffix(match, wrapped));
    this.markCurrentResult();
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
      // Nothing to replace here: say so explicitly rather than moving the
      // selection exactly as a successful replace would, which reads as a
      // silent no-op edit.
      this.next(1, t('find.notOnMatch'));
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
    this.clearResult();
    this.renderResults();
    this.countEl.textContent =
      scope === 'workbook'
        ? t('find.replacedAllWorkbook', {
            count: report.count,
            cells: report.cells,
            sheets: report.sheets,
          }) + (report.skipped > 0 ? t('find.replaceSkipped', { n: report.skipped }) : '')
        : t('find.replacedAll', { count: report.count, cells: report.cells });
  }
}
