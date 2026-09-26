// SPDX-License-Identifier: MIT
import type { AppState, Tab } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { tokenizeCode } from '../core/syntax-highlight';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  releaseSidePanel,
  currentSidePanelPlacement,
} from './dialogs/shared';
import { Eye } from 'lucide';
import { el } from './dom';
import { SourceEditor } from './source-editor';
import { CoalescedRenderer, isLargePreviewSource, syncScroll } from './editor-preview-perf';

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
 * pretty-prints valid JSON in place (never on save by itself — see issue
 * #529) and leaves invalid JSON untouched, reporting the parse error via
 * `Commands.notify` instead. A per-file "auto-format on commit" checkbox
 * (`RsfDocument.autoFormatSource`, default off) applies the same
 * pretty-print automatically each time an edit commits — still never
 * mid-keystroke, and still never guessing at invalid input, matching
 * `tryFormatJson`'s rule for both the button and the checkbox.
 *
 * The preview re-render itself is debounced and rAF-coalesced (a
 * `CoalescedRenderer`, see `editor-preview-perf.ts`) rather than run
 * synchronously on every `input` event, and skips tokenization above a size
 * threshold (`isLargePreviewSource`) in favor of a plain notice — highlighting
 * a very large document is not worth the main-thread stall. The source
 * textarea and the preview pane also keep their scroll positions in sync
 * proportionally in both directions (`syncScroll`).
 *
 * The caller must append `panelElement` into the app shell alongside
 * `element` (see `main.ts`), not inside it.
 */
export class JsonSheetView {
  readonly element: HTMLElement;
  readonly panelElement: HTMLElement;
  /** The editing surface (see `SourceEditor`); `textarea` is its element. */
  readonly editor: SourceEditor;
  private readonly textarea: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  private readonly previewToggle: HTMLButtonElement;
  private readonly formatButton: HTMLButtonElement;
  private readonly autoFormatCheckbox: HTMLInputElement;
  /** Coalesces the preview re-render triggered by every `input` event (see `editor-preview-perf.ts`). */
  private readonly previewRenderer = new CoalescedRenderer(() => this.renderPreview());

  /** The (tab, sheetId) the textarea currently reflects, so a pending debounced edit commits to the right place. */
  private bound: { tab: Tab; sheetId: string } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the preview panel should be open while this view is active; toggled by `previewToggle`, not persisted across reloads. */
  private previewVisible = true;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.editor = new SourceEditor({
      id: 'json-sheet-source',
      className: 'json-sheet-source',
      label: t('dialog.jsonEditor.source'),
      indentUnit: '  ',
    });
    this.textarea = this.editor.textarea;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [this.textarea]);

    this.previewToggle = el('button', { attrs: { type: 'button' } }) as HTMLButtonElement;
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
    this.formatButton = el('button', {
      className: 'json-sheet-format',
      attrs: { type: 'button' },
      text: t('dialog.jsonEditor.format'),
    }) as HTMLButtonElement;
    this.formatButton.addEventListener('click', () => this.format());
    this.autoFormatCheckbox = el('input', {
      attrs: { type: 'checkbox', id: 'json-sheet-auto-format' },
    }) as HTMLInputElement;
    this.autoFormatCheckbox.addEventListener('change', () => this.setAutoFormatSource());
    const autoFormatLabel = el(
      'label',
      { className: 'markdown-editor-toolbar-checkbox', attrs: { for: 'json-sheet-auto-format' } },
      [this.autoFormatCheckbox, el('span', { text: t('dialog.jsonEditor.autoFormat') })],
    );
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [
      this.previewToggle,
      this.formatButton,
      autoFormatLabel,
    ]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'json-sheet-view' }, [toolbar, panes]);
    this.element.hidden = true;

    // The preview's own dockable panel — same `buildSidePanelChrome` machinery
    // the Markdown worksheet's preview and the Filter/Sort/Comments panels
    // use — rather than a transient `openSidePanel` call, since it stays
    // open and live-updates while the user keeps typing above.
    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    this.panelElement = el('div', {
      className: 'side-panel json-preview-panel',
      attrs: { role: 'complementary', 'aria-label': t('dialog.jsonEditor.preview') },
    });
    const previewChrome = buildSidePanelChrome(this.panelElement, {
      icon: Eye,
      title: t('dialog.jsonEditor.preview'),
      closeLabel: t('dialog.jsonEditor.hidePreview'),
      onClose: () => this.setPreviewVisible(false),
    });
    const body = el('div', { className: 'dialog-body' }, [this.preview]);
    this.panelElement.append(previewChrome.heading, body, previewChrome.resizeHandle);
    this.panelElement.hidden = true;

    this.updatePreviewToggle();
    // Proportional two-way scroll sync between the source and its preview
    // (#557) — see `editor-preview-perf.ts`'s `syncScroll`.
    syncScroll(this.textarea, this.preview);

    this.textarea.addEventListener('input', () => {
      this.previewRenderer.schedule();
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
      releaseSidePanel(this.panelElement);
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
      this.editor.setValue(sheet.jsonText);
      this.renderPreview();
    }
    this.textarea.readOnly = tab.readOnly;
    this.formatButton.disabled = tab.readOnly;
    this.autoFormatCheckbox.checked = doc.autoFormatSource;
    this.autoFormatCheckbox.disabled = tab.readOnly;
    this.element.hidden = false;
    this.updatePanelVisibility();
  }

  /**
   * Toggle this file's auto-format-on-commit setting (default off; see
   * `RsfDocument.setAutoFormatSource`). A per-file setting persisted in the
   * saved container, not itself an undoable cell edit — like the version
   * history toggles it sits alongside, it marks the document dirty without
   * touching the evaluation memo.
   */
  private setAutoFormatSource(): void {
    if (!this.bound) {
      return;
    }
    const { tab } = this.bound;
    if (tab.doc.kind !== 'rsf') {
      return;
    }
    tab.doc.setAutoFormatSource(this.autoFormatCheckbox.checked);
    this.state.emit('doc');
  }

  /**
   * Commit any pending debounced edit right now (blur, worksheet switch, tab
   * close, before save). When auto-format-on-commit is on for this file, the
   * source is reformatted in place first — best-effort: invalid JSON is left
   * exactly as typed and its parse error reported (see `tryFormatJson`), but
   * the edit itself is never blocked on that, so the raw text still commits.
   */
  flushCommit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    // Any preview render still coalescing from the last few keystrokes is
    // moot the instant we commit — cancel it rather than let it redundantly
    // repaint moments later.
    this.previewRenderer.cancel();
    if (!this.bound) {
      return;
    }
    const { tab, sheetId } = this.bound;
    if (tab.doc.kind !== 'rsf' || tab.doc.activeSheet.id !== sheetId) {
      return;
    }
    const sheet = tab.doc.activeSheet;
    if (sheet.jsonText === this.textarea.value) {
      return;
    }
    if (tab.doc.autoFormatSource) {
      this.tryFormatJson();
    }
    void this.commands.commitCellEdit(tab, 0, 0, this.textarea.value);
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

  /**
   * Paint the preview immediately. Above `LARGE_PREVIEW_SOURCE_LENGTH`,
   * skips tokenization entirely and shows a plain explanation instead —
   * syntax-highlighting a document that large is not worth the main-thread
   * stall, and the reason is stated rather than left mysterious (#557). This
   * always runs synchronously; per-keystroke calls go through
   * `previewRenderer.schedule()` instead (see the constructor's `input`
   * listener), which coalesces bursts down to this one.
   */
  private renderPreview(): void {
    const text = this.textarea.value;
    if (isLargePreviewSource(text)) {
      this.preview.replaceChildren(
        el('p', { className: 'dialog-note', text: t('dialog.jsonEditor.previewTooLarge') }),
      );
      return;
    }
    this.preview.replaceChildren(el('pre', {}, [el('code', {}, renderJsonPreview(text))]));
  }

  /**
   * Try to pretty-print the textarea's current JSON in place, updating the
   * preview when the text actually changes. Returns whether the text parsed
   * as valid JSON (regardless of whether reformatting changed anything) —
   * invalid JSON is left completely untouched and its parse error reported
   * via `Commands.notify` rather than guessed at. Shared by the explicit
   * Format button and auto-format-on-commit (see `flushCommit`), so both
   * apply the identical "never guess at invalid input" rule (issue #529).
   */
  private tryFormatJson(): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.textarea.value);
    } catch (error) {
      this.commands.notify(
        t('dialog.jsonEditor.invalidJson', { error: error instanceof Error ? error.message : String(error) }),
        'error',
      );
      return false;
    }
    const formatted = JSON.stringify(parsed, null, 2);
    if (formatted !== this.textarea.value) {
      this.textarea.value = formatted;
      this.renderPreview();
    }
    return true;
  }

  /**
   * Explicit, button-triggered pretty-print (issue #529) — never run on
   * save by itself; only actually commits when the reformat changed
   * something (pressing Format on already-formatted JSON is a no-op, not a
   * spurious dirty mark).
   */
  private format(): void {
    if (!this.bound || this.textarea.readOnly) {
      return;
    }
    const before = this.textarea.value;
    if (this.tryFormatJson() && this.textarea.value !== before) {
      this.flushCommit();
    }
  }
}
