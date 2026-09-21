// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { el } from './dom';

/** How long to wait after the last keystroke before committing an undoable edit. */
const COMMIT_DEBOUNCE_MS = 600;

/**
 * The docked source surface for a plain-text worksheet (see
 * `Worksheet.kind`), hosted in the spreadsheet area in place of the grid
 * while such a worksheet is active. A stripped-down `JsonSheetView`/
 * `MarkdownSheetView`: the same debounced, undoable source textarea whose
 * text lives in cell (0, 0), but with **no preview panel and no Format
 * action** — unstructured text has nothing to render beyond the source
 * itself, and nothing to pretty-print.
 *
 * Unlike `JsonSheetView`/`YamlSheetView`/`MarkdownSheetView`, this view has
 * no `panelElement` — there is no side panel to host.
 */
export class TextSheetView {
  readonly element: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;

  /** The (tab, sheetId) the textarea currently reflects, so a pending debounced edit commits to the right place. */
  private bound: { tab: Tab; sheetId: string } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    const sourceLabel = el('label', {
      className: 'form-label',
      text: t('dialog.textEditor.source'),
      attrs: { for: 'text-sheet-source' },
    });
    this.textarea = el('textarea', {
      // Shares the JSON/Markdown source pane's style — see `json-sheet.ts`.
      className: 'text-sheet-source markdown-editor-source',
      attrs: { id: 'text-sheet-source', spellcheck: 'false' },
    }) as HTMLTextAreaElement;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, this.textarea]);
    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'text-sheet-view' }, [panes]);
    this.element.hidden = true;

    this.textarea.addEventListener('input', () => this.scheduleCommit());
    this.textarea.addEventListener('blur', () => this.flushCommit());
    // See `MarkdownSheetView`'s identical listener: flushes before the
    // global shortcut handler (main.ts) runs a command off the same keydown,
    // so a shortcut mid-debounce never misses the last burst of keystrokes.
    this.textarea.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey) {
        this.flushCommit();
      }
    });
  }

  /** True when the active worksheet is a plain-text sheet — the caller hides the grid exactly when this is true. */
  get active(): boolean {
    const tab = this.state.activeTab;
    return tab !== null && tab.doc.kind === 'rsf' && tab.doc.activeSheet.kind === 'text';
  }

  /** Show/hide and (re)populate from the active tab/worksheet. Call on every `tabs`/`active`/`sheets`/`doc` event. */
  refresh(): void {
    const tab = this.state.activeTab;
    if (tab === null || tab.doc.kind !== 'rsf' || tab.doc.activeSheet.kind !== 'text') {
      this.flushCommit();
      this.bound = null;
      this.element.hidden = true;
      return;
    }
    const doc = tab.doc;
    const sheet = doc.activeSheet;
    const isSameBinding = this.bound !== null && this.bound.tab === tab && this.bound.sheetId === sheet.id;
    if (!isSameBinding) {
      // Switching in from a different worksheet/tab: flush whatever the
      // previous binding owed it before loading this one's text.
      this.flushCommit();
      this.bound = { tab, sheetId: sheet.id };
      this.textarea.value = sheet.plainText;
    }
    this.textarea.readOnly = tab.readOnly;
    this.element.hidden = false;
  }

  /** Commit any pending debounced edit right now (blur, worksheet switch, tab close, before save). */
  flushCommit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    if (!this.bound) {
      return;
    }
    const { tab, sheetId } = this.bound;
    if (tab.doc.kind !== 'rsf' || tab.doc.activeSheet.id !== sheetId) {
      return;
    }
    const sheet = tab.doc.activeSheet;
    if (sheet.plainText !== this.textarea.value) {
      void this.commands.commitCellEdit(tab, 0, 0, this.textarea.value);
    }
  }

  private scheduleCommit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
    }
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      this.flushCommit();
    }, COMMIT_DEBOUNCE_MS);
  }
}
