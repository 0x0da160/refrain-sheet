// SPDX-License-Identifier: MIT
import { MessageSquare, X } from 'lucide';
import type { AppState } from '../app/app-state';
import { t } from '../app/i18n';
import { collectSheetComments, collectWorkbookComments, type CommentEntry } from '../core/cell-comment';
import { cellLabel } from '../core/formula';
import { clearChildren, el } from './dom';
import type { Grid } from './grid';
import { createIcon } from './icon';

type CommentScope = 'sheet' | 'workbook';

/**
 * Right-side panel listing cell comments, with a scope toggle between the
 * active worksheet and the whole workbook (see #375, the UI half of #364 —
 * persistence itself shipped in #371). Clicking an entry selects and reveals
 * its cell, switching worksheets first if the entry belongs to a different
 * one; like `FindBar.next()`'s cross-sheet navigation and `Grid.reveal()`
 * itself, this is a view change only — not a document mutation — so it is
 * never pushed onto the undo history.
 *
 * Comments only exist on RSF workbooks (see `cell-comment.ts`): a plain CSV
 * tab shows an explanation instead of a list, mirroring `FindBar`'s
 * `find.scope.csvOnly` treatment.
 */
export class CommentsPanel {
  readonly element: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly scopeLabelEl: HTMLElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly messageEl: HTMLElement;
  private readonly listEl: HTMLElement;

  constructor(
    private readonly state: AppState,
    private readonly grid: Grid,
  ) {
    this.titleEl = el('span', { className: 'comments-panel-title' }, [
      createIcon(MessageSquare, 'comments-panel-title-icon', 14),
      t('panel.comments.title'),
    ]);

    this.scopeSelect = el('select', { className: 'comments-scope' });
    this.scopeSelect.append(
      el('option', { text: t('find.scope.sheet'), attrs: { value: 'sheet' } }),
      el('option', { text: t('find.scope.workbook'), attrs: { value: 'workbook' } }),
    );
    this.scopeSelect.addEventListener('change', () => this.render());
    this.scopeLabelEl = el('span', { text: t('find.scope') });
    const scopeLabel = el('label', { className: 'comments-scope-label' }, [
      this.scopeLabelEl,
      this.scopeSelect,
    ]);

    this.closeBtn = el('button', {
      className: 'comments-panel-close',
      attrs: { type: 'button', 'aria-label': t('panel.comments.close') },
    });
    this.closeBtn.append(createIcon(X, 'comments-panel-close-icon', 14));
    this.closeBtn.addEventListener('click', () => this.close());

    this.messageEl = el('p', { className: 'comments-empty' });
    this.listEl = el('ul', { className: 'comments-list' });

    this.element = el(
      'div',
      {
        className: 'comments-panel',
        attrs: { role: 'complementary', 'aria-label': t('panel.comments.title') },
      },
      [
        el('div', { className: 'comments-panel-header' }, [this.titleEl, this.closeBtn]),
        scopeLabel,
        this.messageEl,
        this.listEl,
      ],
    );
    this.element.hidden = true;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    this.element.hidden = false;
    this.render();
  }

  close(): void {
    this.element.hidden = true;
  }

  /** The effective scope (never `workbook` for a plain CSV document). */
  private get scope(): CommentScope {
    return this.scopeSelect.value === 'workbook' && this.state.activeTab?.doc.kind === 'rsf'
      ? 'workbook'
      : 'sheet';
  }

  /** Re-translate labels (locale change) and recompute the list (document change). */
  refresh(): void {
    this.titleEl.textContent = '';
    this.titleEl.append(
      createIcon(MessageSquare, 'comments-panel-title-icon', 14),
      t('panel.comments.title'),
    );
    this.element.setAttribute('aria-label', t('panel.comments.title'));
    this.closeBtn.setAttribute('aria-label', t('panel.comments.close'));
    this.scopeLabelEl.textContent = t('find.scope');
    this.scopeSelect.options[0].textContent = t('find.scope.sheet');
    this.scopeSelect.options[1].textContent = t('find.scope.workbook');
    this.render();
  }

  render(): void {
    if (!this.isOpen) {
      return;
    }
    const tab = this.state.activeTab;
    const isWorkbook = tab?.doc.kind === 'rsf';
    this.scopeSelect.disabled = !isWorkbook;
    this.scopeSelect.title = isWorkbook ? '' : t('find.scope.csvOnly');
    if (!isWorkbook) {
      this.scopeSelect.value = 'sheet';
    }

    clearChildren(this.listEl);
    if (!tab || tab.doc.kind !== 'rsf') {
      this.messageEl.textContent = t('panel.comments.csvOnly');
      this.messageEl.hidden = false;
      return;
    }
    const doc = tab.doc;
    const entries =
      this.scope === 'workbook' ? collectWorkbookComments(doc.sheets) : collectSheetComments(doc.activeSheet);
    if (entries.length === 0) {
      this.messageEl.textContent = t('panel.comments.empty');
      this.messageEl.hidden = false;
      return;
    }
    this.messageEl.hidden = true;
    for (const entry of entries) {
      this.listEl.append(this.buildItem(entry));
    }
  }

  private buildItem(entry: CommentEntry): HTMLElement {
    const ref = cellLabel(entry.row, entry.col);
    const header: Array<Node | string> = [el('span', { className: 'comment-item-ref', text: ref })];
    if (this.scope === 'workbook') {
      header.push(el('span', { className: 'comment-item-sheet', text: entry.sheetName }));
    }
    const item = el(
      'li',
      {
        className: 'comment-item',
        attrs: {
          role: 'button',
          tabindex: '0',
          'aria-label':
            this.scope === 'workbook'
              ? t('panel.comments.jumpToSheet', { cell: ref, sheet: entry.sheetName })
              : t('panel.comments.jumpTo', { cell: ref }),
        },
      },
      [
        el('div', { className: 'comment-item-header' }, header),
        el('div', { className: 'comment-item-text', text: entry.text }),
      ],
    );
    const activate = () => this.jumpTo(entry);
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    return item;
  }

  /**
   * Not a document mutation — pure selection/navigation, exactly like
   * `FindBar.next()`'s cross-worksheet jump — so it is never pushed onto the
   * undo history and never marks the document dirty.
   */
  private jumpTo(entry: CommentEntry): void {
    const tab = this.state.activeTab;
    if (!tab || tab.doc.kind !== 'rsf') {
      return;
    }
    if (tab.doc.activeSheetId !== entry.sheetId) {
      this.state.setActiveSheet(tab, entry.sheetId);
    }
    this.grid.reveal(entry.row, entry.col);
  }
}
