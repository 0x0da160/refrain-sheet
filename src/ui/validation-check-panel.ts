// SPDX-License-Identifier: MIT
import { isWorkbook } from '../core/editor-document';
import { ListChecks } from 'lucide';
import type { AppState } from '../app/state';
import { t } from '../app/i18n';
import {
  checkValidations,
  MAX_VALIDATION_ISSUES,
  type ValidationIssue,
} from '../core/workbook/validation-check';
import { cellLabel } from '../core/formula';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  releaseSidePanel,
  currentSidePanelPlacement,
  type SidePanelChrome,
} from './dialogs/side-panel';
import { clearChildren, el } from './dom';
import type { Grid } from './grid';

type CheckScope = 'sheet' | 'workbook';

/** The longest cell value an entry shows before cutting it off with "…". */
const MAX_SHOWN_VALUE = 80;

/**
 * Data > Check Data…: every cell whose value breaks its data-validation rule
 * (`checkValidations`, `src/core/workbook/validation-check.ts`), on the
 * active worksheet or across the file. Built exactly like `CommentsPanel`:
 * a dockable side panel created once and opened/closed, closed only from
 * its header ×, and re-checked whenever the document changes, so a fixed
 * cell drops off the list as soon as it is fixed.
 *
 * Clicking an entry selects and reveals its cell (switching worksheets
 * first); that is a view change only, never an undoable edit.
 */
export class ValidationCheckPanel {
  readonly element: HTMLElement;
  private readonly chrome: SidePanelChrome;
  private readonly scopeLabelEl: HTMLElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly messageEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly noteEl: HTMLElement;

  constructor(
    private readonly state: AppState,
    private readonly grid: Grid,
  ) {
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

    this.messageEl = el('p', { className: 'comments-empty', attrs: { role: 'status' } });
    this.listEl = el('ul', { className: 'comments-list' });
    this.noteEl = el('p', { className: 'dialog-note' });

    this.element = el('div', {
      className: 'side-panel comments-panel validation-check-panel',
      attrs: { role: 'complementary', 'aria-label': t('panel.checkData.title') },
    });
    this.chrome = buildSidePanelChrome(this.element, {
      icon: ListChecks,
      title: t('panel.checkData.title'),
      closeLabel: t('panel.checkData.close'),
      onClose: () => this.close(),
    });
    const body = el('div', { className: 'dialog-body' }, [
      scopeLabel,
      this.messageEl,
      this.listEl,
      this.noteEl,
    ]);
    this.element.append(this.chrome.heading, body, this.chrome.resizeHandle);
    this.element.hidden = true;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    if (this.isOpen) {
      this.render();
      return;
    }
    this.element.hidden = false;
    // Applied on open, not at construction: a closed panel reserves no space.
    const { position, size } = currentSidePanelPlacement();
    applySidePanelPosition(this.element, position, size);
    this.render();
  }

  close(): void {
    this.element.hidden = true;
    releaseSidePanel(this.element);
  }

  /** The effective scope (never `workbook` for a plain CSV document). */
  private get scope(): CheckScope {
    return this.scopeSelect.value === 'workbook' && isWorkbook(this.state.activeTab?.doc)
      ? 'workbook'
      : 'sheet';
  }

  /** Re-translate labels (locale change) and re-check (document change). */
  refresh(): void {
    this.chrome.relabel(t('panel.checkData.title'), t('panel.checkData.close'));
    this.element.setAttribute('aria-label', t('panel.checkData.title'));
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
    const inWorkbook = isWorkbook(tab?.doc);
    this.scopeSelect.disabled = !inWorkbook;
    if (!inWorkbook) {
      this.scopeSelect.value = 'sheet';
    }

    clearChildren(this.listEl);
    this.noteEl.textContent = '';
    if (!tab || !isWorkbook(tab.doc)) {
      this.messageEl.textContent = t('panel.checkData.csvOnly');
      return;
    }
    const doc = tab.doc;
    const sheets = this.scope === 'workbook' ? doc.sheets : [doc.activeSheet];
    if (sheets.every((sheet) => sheet.validations.length === 0)) {
      this.messageEl.textContent = t('panel.checkData.noRules');
      return;
    }
    const { issues, truncated } = checkValidations(sheets);
    this.messageEl.textContent =
      issues.length === 0 ? t('panel.checkData.allValid') : t('panel.checkData.count', { n: issues.length });
    for (const issue of issues) {
      this.listEl.append(this.buildItem(issue));
    }
    if (truncated) {
      this.noteEl.textContent = t('panel.checkData.truncated', { n: MAX_VALIDATION_ISSUES });
    }
  }

  private buildItem(issue: ValidationIssue): HTMLElement {
    const ref = cellLabel(issue.row, issue.col);
    const header: Array<Node | string> = [el('span', { className: 'comment-item-ref', text: ref })];
    if (this.scope === 'workbook') {
      header.push(el('span', { className: 'comment-item-sheet', text: issue.sheetName }));
    }
    const reason = t(`validation.problem.${issue.problem}`);
    const shown =
      issue.value.length > MAX_SHOWN_VALUE ? `${issue.value.slice(0, MAX_SHOWN_VALUE)}…` : issue.value;
    const item = el(
      'li',
      {
        className: 'comment-item',
        attrs: {
          role: 'button',
          tabindex: '0',
          'aria-label':
            this.scope === 'workbook'
              ? t('panel.checkData.jumpToSheet', { cell: ref, sheet: issue.sheetName, reason })
              : t('panel.checkData.jumpTo', { cell: ref, reason }),
        },
      },
      [
        el('div', { className: 'comment-item-header' }, header),
        el('div', {
          className: 'comment-item-text',
          text: issue.value === '' ? reason : t('panel.checkData.entry', { value: shown, reason }),
        }),
      ],
    );
    const activate = () => this.jumpTo(issue);
    item.addEventListener('click', activate);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    return item;
  }

  /** A view change only: never pushed onto the undo history. */
  private jumpTo(issue: ValidationIssue): void {
    const tab = this.state.activeTab;
    if (!tab || !isWorkbook(tab.doc)) {
      return;
    }
    if (tab.doc.activeSheetId !== issue.sheetId) {
      this.state.setActiveSheet(tab, issue.sheetId);
    }
    this.grid.reveal(issue.row, issue.col);
  }
}
