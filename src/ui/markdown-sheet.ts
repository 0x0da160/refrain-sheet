// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { parseMarkdown } from '../core/markdown';
import { el } from './dom';
import { renderMarkdownBlocks } from './markdown-render';

/** How long to wait after the last keystroke before committing an undoable edit. */
const COMMIT_DEBOUNCE_MS = 600;

/**
 * The docked source/preview surface for a Markdown worksheet (see
 * `Worksheet.kind`), hosted in the spreadsheet area in place of the grid
 * while such a worksheet is active — the Issue's explicit request, as
 * opposed to the standalone side-panel Markdown editor (#433,
 * `dialogs/markdown-editor.ts`), which this reuses the safe AST renderer
 * from (`markdown-render.ts`) but is otherwise unrelated.
 *
 * The document's Markdown source lives in cell (0, 0) of the worksheet (see
 * `Worksheet.markdown`), so editing it is an ordinary `commitCellEdit` — the
 * same atomic, undoable `HistoryEntry` a grid cell edit produces — debounced
 * so a burst of keystrokes becomes one history entry rather than one per
 * keystroke, and always flushed immediately on blur or before this view
 * hands off to a different worksheet/tab.
 */
export class MarkdownSheetView {
  readonly element: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly preview: HTMLElement;

  /** The (tab, sheetId) the textarea currently reflects, so a pending debounced edit commits to the right place. */
  private bound: { tab: Tab; sheetId: string } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    const sourceLabel = el('label', {
      className: 'form-label',
      text: t('dialog.markdownEditor.source'),
      attrs: { for: 'markdown-sheet-source' },
    });
    this.textarea = el('textarea', {
      className: 'markdown-sheet-source',
      attrs: { id: 'markdown-sheet-source', spellcheck: 'false' },
    }) as HTMLTextAreaElement;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, this.textarea]);

    const previewLabel = el('div', { className: 'form-label', text: t('dialog.markdownEditor.preview') });
    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    const previewPane = el('div', { className: 'markdown-editor-pane' }, [previewLabel, this.preview]);

    this.element = el('div', { className: 'markdown-sheet-view markdown-editor-panes' }, [
      sourcePane,
      previewPane,
    ]);
    this.element.hidden = true;

    this.textarea.addEventListener('input', () => {
      this.renderPreview();
      this.scheduleCommit();
    });
    this.textarea.addEventListener('blur', () => this.flushCommit());
    // Flush before the global shortcut handler (main.ts) runs a command (Save,
    // Close Tab, Undo, …) off a keydown fired from this textarea, so a
    // shortcut triggered mid-debounce never misses the last burst of
    // keystrokes or silently discards it (e.g. closing the tab before the
    // debounce would otherwise fire). This listener runs first because it is
    // bound directly on the event target; the global one is on `window` and
    // sees the same event only after it bubbles there. Every accelerator this
    // app recognizes is Ctrl/Cmd-modified (see `resolveShortcut`), so that is
    // the cheap, sufficient signal — plain typing never sets these modifiers.
    this.textarea.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey) {
        this.flushCommit();
      }
    });
  }

  /** True when the active worksheet is a Markdown sheet — the caller hides the grid exactly when this is true. */
  get active(): boolean {
    const tab = this.state.activeTab;
    return tab !== null && tab.doc.kind === 'rsf' && tab.doc.activeSheet.kind === 'markdown';
  }

  /** Show/hide and (re)populate from the active tab/worksheet. Call on every `tabs`/`active`/`sheets`/`doc` event. */
  refresh(): void {
    const tab = this.state.activeTab;
    if (tab === null || tab.doc.kind !== 'rsf' || tab.doc.activeSheet.kind !== 'markdown') {
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
      this.textarea.value = sheet.markdownText;
      this.renderPreview();
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
    if (sheet.markdownText !== this.textarea.value) {
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

  private renderPreview(): void {
    this.preview.replaceChildren(...renderMarkdownBlocks(parseMarkdown(this.textarea.value)));
  }
}
