// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import {
  compileQuery,
  replaceAllInValue,
  searchDocument,
  type CompiledQuery,
  type SearchResult,
} from '../core/search';
import { el } from './dom';
import type { Grid } from './grid';

/**
 * Find & Replace bar. Normal and regex search over current cell values with
 * match counts updated as you type, Next/Previous with wrap-around, and
 * atomic Replace All. Invalid regular expressions never crash the app; the
 * compilation error is shown inline.
 */
export class FindBar {
  readonly element: HTMLElement;
  private readonly findInput: HTMLInputElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly caseBox: HTMLInputElement;
  private readonly regexBox: HTMLInputElement;
  private readonly countEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly replaceRow: HTMLElement[];
  private readonly labels = new Map<string, { node: HTMLElement; key: string }>();
  private result: SearchResult | null = null;
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
    const replaceAllBtn = button('find.replaceAll', () => this.replaceAll());
    const closeBtn = button('find.close', () => this.close());

    this.replaceRow = [
      el('label', {}, [label('find.replace', 'lbl-replace'), this.replaceInput]),
      replaceBtn,
      replaceAllBtn,
    ];

    this.element = el('div', { className: 'find-bar', attrs: { role: 'search' } }, [
      el('label', {}, [label('find.find', 'lbl-find'), this.findInput]),
      prevBtn,
      nextBtn,
      el('label', {}, [this.caseBox, label('find.matchCase', 'lbl-case')]),
      el('label', {}, [this.regexBox, label('find.regex', 'lbl-regex')]),
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
    if (this.isOpen) {
      this.scheduleRecompute();
    }
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

  private recompute(): void {
    const tab = this.state.activeTab;
    this.errorEl.textContent = '';
    this.result = null;
    this.current = -1;
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
    this.result = searchDocument(tab.doc, query);
    if (this.result.cellCount === 0) {
      this.countEl.textContent = t('find.none');
    } else {
      this.countEl.textContent = t('find.count', {
        matches: this.result.matchCount,
        cells: this.result.cellCount,
      });
    }
    if (this.result.aborted) {
      this.errorEl.textContent = t('find.aborted');
    }
  }

  /** Move to the next/previous matching cell with wrap-around. */
  next(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open(false);
      return;
    }
    if (!this.result) {
      this.recompute();
    }
    const result = this.result;
    if (!result || result.cells.length === 0) return;
    const tab = this.state.activeTab;
    if (!tab) return;
    if (this.current < 0 && tab.selection) {
      // Start from the selection: first match at or after it.
      const { row, col } = tab.selection;
      const at = result.cells.findIndex((m) => m.row > row || (m.row === row && m.col >= col));
      this.current = at >= 0 ? at - direction : result.cells.length - direction;
    }
    this.current = (this.current + direction + result.cells.length) % result.cells.length;
    const match = result.cells[this.current];
    this.grid.reveal(match.row, match.col);
  }

  /** Replace every occurrence in the currently selected matching cell, then advance. */
  private replaceCurrent(): void {
    const tab = this.state.activeTab;
    if (!tab) return;
    if (!this.result) this.recompute();
    const query = this.compile();
    if (!query.ok || !this.result || this.result.cells.length === 0) return;
    const sel = tab.selection;
    const onMatch = sel && this.result.cells.some((m) => m.row === sel.row && m.col === sel.col);
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

  private replaceAll(): void {
    const query = this.compile();
    if (!query.ok) return;
    const { count, cells } = this.commands.replaceAll(query, this.replaceInput.value);
    this.countEl.textContent = t('find.replacedAll', { count, cells });
    this.result = null;
    this.current = -1;
  }
}
