// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { tokenizeCode } from '../core/syntax-highlight';
import {
  applySidePanelPosition,
  buildSidePanelDock,
  clearAppEdgeReservation,
  currentSidePanelPlacement,
} from './dialogs/shared';
import { el } from './dom';
import { createIcon } from './icon';
import { X } from 'lucide';

/** How long to wait after the last keystroke before committing an undoable edit. */
const COMMIT_DEBOUNCE_MS = 600;

/** Render JSON source text as DOM nodes, one `<span class="tok-*">` per highlighted token. */
function renderJsonPreview(text: string): Array<Node | string> {
  return tokenizeCode(text, 'json').map((token) =>
    token.type === 'text'
      ? document.createTextNode(token.text)
      : el('span', { className: `tok-${token.type}`, text: token.text }),
  );
}

/**
 * The docked source surface for a JSON worksheet (see `Worksheet.kind`),
 * hosted in the spreadsheet area in place of the grid while such a worksheet
 * is active. Mirrors `MarkdownSheetView` (#481/#502) — a docked, dockable
 * preview panel plus a debounced, undoable source textarea whose text lives
 * in cell (0, 0) — but the preview is a single syntax-highlighted `<pre>`
 * block (`src/core/syntax-highlight.ts`'s `tokenizeCode`) rather than a
 * rendered document, and the toolbar adds an explicit "Format" action that
 * pretty-prints valid JSON in place (never automatically, and never on
 * save — see issue #529) and leaves invalid JSON untouched, reporting the
 * parse error via `Commands.notify` instead.
 *
 * The caller must append `panelElement` into the app shell alongside
 * `element` (see `main.ts`), not inside it.
 */
export class JsonSheetView {
  readonly element: HTMLElement;
  readonly panelElement: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  private readonly previewToggle: HTMLButtonElement;
  private readonly formatButton: HTMLButtonElement;

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
      text: t('dialog.jsonEditor.source'),
      attrs: { for: 'json-sheet-source' },
    });
    this.textarea = el('textarea', {
      // Shares the Markdown source pane's style (flex sizing, font, border) —
      // see `markdown-sheet.ts` for why the class is required rather than
      // relying on the textarea's intrinsic default size.
      className: 'json-sheet-source markdown-editor-source',
      attrs: { id: 'json-sheet-source', spellcheck: 'false' },
    }) as HTMLTextAreaElement;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, this.textarea]);

    this.previewToggle = el('button', { attrs: { type: 'button' } }) as HTMLButtonElement;
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
    this.formatButton = el('button', {
      className: 'json-sheet-format',
      attrs: { type: 'button' },
      text: t('dialog.jsonEditor.format'),
    }) as HTMLButtonElement;
    this.formatButton.addEventListener('click', () => this.format());
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [
      this.previewToggle,
      this.formatButton,
    ]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'json-sheet-view' }, [toolbar, panes]);
    this.element.hidden = true;

    // The preview's own dockable panel — same `buildSidePanelDock` machinery
    // the Markdown worksheet's preview and the Filter/Sort/Comments panels
    // use — rather than a transient `openSidePanel` call, since it stays
    // open and live-updates while the user keeps typing above.
    const previewTitle = el('span', { text: t('dialog.jsonEditor.preview') });
    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    this.panelElement = el('div', {
      className: 'side-panel json-preview-panel',
      attrs: { role: 'complementary', 'aria-label': t('dialog.jsonEditor.preview') },
    });
    const { positionSwitcher, resizeHandle } = buildSidePanelDock(this.panelElement);
    const closeBtn = el('button', {
      className: 'markdown-preview-panel-close',
      attrs: { type: 'button', 'aria-label': t('dialog.jsonEditor.hidePreview') },
    });
    closeBtn.append(createIcon(X, 'markdown-preview-panel-close-icon', 14));
    closeBtn.addEventListener('click', () => this.setPreviewVisible(false));
    const heading = el('div', { className: 'dialog-title side-panel-title' }, [
      previewTitle,
      el('div', { className: 'side-panel-title-actions' }, [positionSwitcher, closeBtn]),
    ]);
    const body = el('div', { className: 'dialog-body' }, [this.preview]);
    this.panelElement.append(heading, body, resizeHandle);
    this.panelElement.hidden = true;

    this.updatePreviewToggle();

    this.textarea.addEventListener('input', () => {
      this.renderPreview();
      this.scheduleCommit();
    });
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
      const { position, size } = currentSidePanelPlacement();
      applySidePanelPosition(this.panelElement, position, size);
    } else {
      this.panelElement.hidden = true;
      clearAppEdgeReservation();
    }
  }

  private updatePreviewToggle(): void {
    this.previewToggle.textContent = this.previewVisible
      ? t('dialog.jsonEditor.hidePreview')
      : t('dialog.jsonEditor.showPreview');
    this.previewToggle.setAttribute('aria-pressed', String(this.previewVisible));
  }

  /** True when the active worksheet is a JSON sheet — the caller hides the grid exactly when this is true. */
  get active(): boolean {
    const tab = this.state.activeTab;
    return tab !== null && tab.doc.kind === 'rsf' && tab.doc.activeSheet.kind === 'json';
  }

  /** Show/hide and (re)populate from the active tab/worksheet. Call on every `tabs`/`active`/`sheets`/`doc` event. */
  refresh(): void {
    const tab = this.state.activeTab;
    if (tab === null || tab.doc.kind !== 'rsf' || tab.doc.activeSheet.kind !== 'json') {
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
      this.textarea.value = sheet.jsonText;
      this.renderPreview();
    }
    this.textarea.readOnly = tab.readOnly;
    this.formatButton.disabled = tab.readOnly;
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
    if (sheet.jsonText !== this.textarea.value) {
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
    this.preview.replaceChildren(el('pre', {}, [el('code', {}, renderJsonPreview(this.textarea.value))]));
  }

  /**
   * Explicit, button-triggered pretty-print (issue #529) — never automatic
   * and never run on save. Invalid JSON is left completely untouched; the
   * parse error is reported via `Commands.notify` rather than blocking or
   * guessing at a fix.
   */
  private format(): void {
    if (!this.bound || this.textarea.readOnly) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.textarea.value);
    } catch (error) {
      this.commands.notify(
        t('dialog.jsonEditor.invalidJson', { error: error instanceof Error ? error.message : String(error) }),
        'error',
      );
      return;
    }
    const formatted = JSON.stringify(parsed, null, 2);
    if (formatted === this.textarea.value) {
      return;
    }
    this.textarea.value = formatted;
    this.renderPreview();
    this.flushCommit();
  }
}
