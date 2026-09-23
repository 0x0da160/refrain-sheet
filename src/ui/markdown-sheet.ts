// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { parseMarkdown } from '../core/markdown';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  releaseSidePanel,
  currentSidePanelPlacement,
} from './dialogs/shared';
import { Eye } from 'lucide';
import { el } from './dom';
import { syncScroll } from './editor-preview-perf';
import { renderMarkdownBlocks } from './markdown-render';

/** How long to wait after the last keystroke before committing an undoable edit. */
const COMMIT_DEBOUNCE_MS = 600;

/**
 * The docked source surface for a Markdown worksheet (see `Worksheet.kind`),
 * hosted in the spreadsheet area in place of the grid while such a worksheet
 * is active. Renders its preview via the safe AST renderer in
 * `markdown-render.ts` (#433/#502).
 *
 * The rendered preview (`panelElement`) is a separate, persistent dockable
 * `.side-panel` — the same `buildSidePanelChrome`/`applySidePanelPosition`/
 * `currentSidePanelPlacement` machinery the Filter/Sort/Format/SQL Query
 * panels and the comments panel use (`src/ui/dialogs/shared.ts`,
 * `ui/comments-panel.ts`) — toggled by `previewToggle`, rather than a fixed
 * inline split, per the Issue's request to dock the preview like the Filter
 * panel. The caller must append `panelElement` into the app shell alongside
 * `element` (see `main.ts`), not inside it.
 *
 * The document's Markdown source lives in cell (0, 0) of the worksheet (see
 * `Worksheet.markdown`), so editing it is an ordinary `commitCellEdit` — the
 * same atomic, undoable `HistoryEntry` a grid cell edit produces — debounced
 * so a burst of keystrokes becomes one history entry rather than one per
 * keystroke, and always flushed immediately on blur or before this view
 * hands off to a different worksheet/tab.
 *
 * The source textarea and the preview pane keep their scroll positions in
 * sync proportionally in both directions (`syncScroll`, see
 * `editor-preview-perf.ts`) — unlike the JSON/YAML source views, the preview
 * render itself is not coalesced/size-gated here, since re-parsing Markdown
 * on every keystroke has not shown the same cost.
 */
export class MarkdownSheetView {
  readonly element: HTMLElement;
  readonly panelElement: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  private readonly previewToggle: HTMLButtonElement;

  /** The (tab, sheetId) the textarea currently reflects, so a pending debounced edit commits to the right place. */
  private bound: { tab: Tab; sheetId: string } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the preview panel should be open while this view is active; toggled by `previewToggle`, not persisted across reloads. */
  private previewVisible = true;

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
      // `markdown-editor-source` is the shared style (flex sizing, font,
      // border) for the Markdown source pane — without it this textarea
      // keeps its intrinsic browser-default size instead of filling its
      // pane (#486).
      className: 'markdown-sheet-source markdown-editor-source',
      attrs: { id: 'markdown-sheet-source', spellcheck: 'false' },
    }) as HTMLTextAreaElement;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, this.textarea]);

    this.previewToggle = el('button', { attrs: { type: 'button' } }) as HTMLButtonElement;
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [this.previewToggle]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'markdown-sheet-view' }, [toolbar, panes]);
    this.element.hidden = true;

    // The preview's own dockable panel — built exactly like `CommentsPanel`
    // (persistent, created once, toggled open/closed) rather than a
    // transient `openSidePanel` call, since it must stay open and live-update
    // while the user keeps typing in the source textarea above.
    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    this.panelElement = el('div', {
      className: 'side-panel markdown-preview-panel',
      attrs: { role: 'complementary', 'aria-label': t('dialog.markdownEditor.preview') },
    });
    const previewChrome = buildSidePanelChrome(this.panelElement, {
      icon: Eye,
      title: t('dialog.markdownEditor.preview'),
      closeLabel: t('dialog.markdownEditor.hidePreview'),
      onClose: () => this.setPreviewVisible(false),
    });
    const body = el('div', { className: 'dialog-body' }, [this.preview]);
    this.panelElement.append(previewChrome.heading, body, previewChrome.resizeHandle);
    this.panelElement.hidden = true;

    this.updatePreviewToggle();
    syncScroll(this.textarea, this.preview);

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

  /** Open/close the preview panel; toggled by `previewToggle` and its own close button. */
  private setPreviewVisible(visible: boolean): void {
    this.previewVisible = visible;
    this.updatePanelVisibility();
    this.updatePreviewToggle();
  }

  /** Reconciles the panel's actual open/closed state with `previewVisible && active`. */
  private updatePanelVisibility(): void {
    const shouldShow = this.previewVisible && this.active;
    if (shouldShow === !this.panelElement.hidden) {
      return;
    }
    if (shouldShow) {
      this.panelElement.hidden = false;
      // Applied on open rather than at construction time (mirrors
      // `CommentsPanel.open()`): reserving app-edge space for a closed panel
      // would shrink the sheet even while nothing is shown (#399).
      const { position, size } = currentSidePanelPlacement();
      applySidePanelPosition(this.panelElement, position, size);
    } else {
      this.panelElement.hidden = true;
      releaseSidePanel(this.panelElement);
    }
  }

  private updatePreviewToggle(): void {
    this.previewToggle.textContent = this.previewVisible
      ? t('dialog.markdownEditor.hidePreview')
      : t('dialog.markdownEditor.showPreview');
    this.previewToggle.setAttribute('aria-pressed', String(this.previewVisible));
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
      this.updatePanelVisibility();
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
    this.updatePanelVisibility();
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
