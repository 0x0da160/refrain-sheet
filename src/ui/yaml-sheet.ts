// SPDX-License-Identifier: MIT
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
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

/** Render YAML source text as DOM nodes, one `<span class="tok-*">` per highlighted token. */
function renderYamlPreview(text: string): Array<Node | string> {
  return tokenizeCode(text, 'yaml').map((token) =>
    token.type === 'text'
      ? document.createTextNode(token.text)
      : el('span', { className: `tok-${token.type}`, text: token.text }),
  );
}

/**
 * The docked source surface for a YAML worksheet (see `Worksheet.kind`),
 * hosted in the spreadsheet area in place of the grid while such a worksheet
 * is active. Mirrors `JsonSheetView` exactly — same docked, dockable preview
 * panel, same debounced/undoable source textarea whose text lives in cell
 * (0, 0), same explicit "Format" action (never on save by itself — see
 * issue #529) and the same per-file "auto-format on commit" checkbox
 * (`RsfDocument.autoFormatSource`, default off, applying the same
 * pretty-print automatically each time an edit commits — see
 * `tryFormatYaml`) — but parses/pretty-prints via the `yaml` package instead
 * of `JSON.parse`/`JSON.stringify` (see `knowledge/operations/security-threat-model.md` § Dependency
 * policy for why this one dependency was added), and highlights with the
 * `yaml` language spec (`src/core/syntax-highlight.ts`) instead of `json`.
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
export class YamlSheetView {
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
      id: 'yaml-sheet-source',
      className: 'yaml-sheet-source',
      label: t('dialog.yamlEditor.source'),
      indentUnit: '  ',
    });
    this.textarea = this.editor.textarea;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [this.textarea]);

    this.previewToggle = el('button', { attrs: { type: 'button' } }) as HTMLButtonElement;
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
    this.formatButton = el('button', {
      className: 'yaml-sheet-format',
      attrs: { type: 'button' },
      text: t('dialog.yamlEditor.format'),
    }) as HTMLButtonElement;
    this.formatButton.addEventListener('click', () => this.format());
    this.autoFormatCheckbox = el('input', {
      attrs: { type: 'checkbox', id: 'yaml-sheet-auto-format' },
    }) as HTMLInputElement;
    this.autoFormatCheckbox.addEventListener('change', () => this.setAutoFormatSource());
    const autoFormatLabel = el(
      'label',
      { className: 'markdown-editor-toolbar-checkbox', attrs: { for: 'yaml-sheet-auto-format' } },
      [this.autoFormatCheckbox, el('span', { text: t('dialog.yamlEditor.autoFormat') })],
    );
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [
      this.previewToggle,
      this.formatButton,
      autoFormatLabel,
    ]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'yaml-sheet-view' }, [toolbar, panes]);
    this.element.hidden = true;

    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    this.panelElement = el('div', {
      className: 'side-panel json-preview-panel',
      attrs: { role: 'complementary', 'aria-label': t('dialog.yamlEditor.preview') },
    });
    const previewChrome = buildSidePanelChrome(this.panelElement, {
      icon: Eye,
      title: t('dialog.yamlEditor.preview'),
      closeLabel: t('dialog.yamlEditor.hidePreview'),
      onClose: () => this.setPreviewVisible(false),
    });
    const body = el('div', { className: 'dialog-body' }, [this.preview]);
    this.panelElement.append(previewChrome.heading, body, previewChrome.resizeHandle);
    this.panelElement.hidden = true;

    this.updatePreviewToggle();
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
      ? t('dialog.yamlEditor.hidePreview')
      : t('dialog.yamlEditor.showPreview');
    this.previewToggle.setAttribute('aria-pressed', String(this.previewVisible));
  }

  /** True when the active worksheet is a YAML sheet — the caller hides the grid exactly when this is true. */
  get active(): boolean {
    const tab = this.state.activeTab;
    return tab !== null && tab.doc.kind === 'rsf' && tab.doc.activeSheet.kind === 'yaml';
  }

  /** Show/hide and (re)populate from the active tab/worksheet. Call on every `tabs`/`active`/`sheets`/`doc` event. */
  refresh(): void {
    const tab = this.state.activeTab;
    if (tab === null || tab.doc.kind !== 'rsf' || tab.doc.activeSheet.kind !== 'yaml') {
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
      this.editor.setValue(sheet.yamlText);
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
   * source is reformatted in place first — best-effort: invalid (or empty)
   * YAML is left exactly as typed (see `tryFormatYaml`), but the edit itself
   * is never blocked on that, so the raw text still commits.
   */
  flushCommit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    this.previewRenderer.cancel();
    if (!this.bound) {
      return;
    }
    const { tab, sheetId } = this.bound;
    if (tab.doc.kind !== 'rsf' || tab.doc.activeSheet.id !== sheetId) {
      return;
    }
    const sheet = tab.doc.activeSheet;
    if (sheet.yamlText === this.textarea.value) {
      return;
    }
    if (tab.doc.autoFormatSource) {
      this.tryFormatYaml();
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

  private renderPreview(): void {
    const text = this.textarea.value;
    if (isLargePreviewSource(text)) {
      this.preview.replaceChildren(
        el('p', { className: 'dialog-note', text: t('dialog.yamlEditor.previewTooLarge') }),
      );
      return;
    }
    this.preview.replaceChildren(el('pre', {}, [el('code', {}, renderYamlPreview(text))]));
  }

  /**
   * Try to pretty-print the textarea's current YAML in place, updating the
   * preview when the text actually changes. Returns whether the text
   * parsed as valid, formattable YAML (an empty document counts as
   * "nothing to do", not an error — it parses to `null`, but there is
   * nothing useful to pretty-print, so a blank sheet stays blank instead of
   * gaining a literal "null"). Invalid YAML is left completely untouched
   * and its parse error reported via `Commands.notify` rather than guessed
   * at. Shared by the explicit Format button and auto-format-on-commit (see
   * `flushCommit`), so both apply the identical rule (issue #529, extended
   * by #557 to YAML).
   */
  private tryFormatYaml(): boolean {
    if (this.textarea.value.trim() === '') {
      return true;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(this.textarea.value);
    } catch (error) {
      this.commands.notify(
        t('dialog.yamlEditor.invalidYaml', {
          error: error instanceof YAMLParseError ? error.message : String(error),
        }),
        'error',
      );
      return false;
    }
    const formatted = stringifyYaml(parsed);
    if (formatted !== this.textarea.value) {
      this.textarea.value = formatted;
      this.renderPreview();
    }
    return true;
  }

  /**
   * Explicit, button-triggered pretty-print (issue #529, extended by #557 to
   * YAML) — never run on save by itself; only actually commits when the
   * reformat changed something.
   */
  private format(): void {
    if (!this.bound || this.textarea.readOnly) {
      return;
    }
    const before = this.textarea.value;
    if (this.tryFormatYaml() && this.textarea.value !== before) {
      this.flushCommit();
    }
  }
}
