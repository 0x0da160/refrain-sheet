// SPDX-License-Identifier: MIT
import { parse as parseYaml, stringify as stringifyYaml, YAMLParseError } from 'yaml';
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
 * (0, 0), same explicit "Format" action (never automatic, never on save —
 * see issue #529) — but parses/pretty-prints via the `yaml` package instead
 * of `JSON.parse`/`JSON.stringify` (see `docs/security.md` § Dependency
 * policy for why this one dependency was added), and highlights with the
 * `yaml` language spec (`src/core/syntax-highlight.ts`) instead of `json`.
 *
 * The caller must append `panelElement` into the app shell alongside
 * `element` (see `main.ts`), not inside it.
 */
export class YamlSheetView {
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
      text: t('dialog.yamlEditor.source'),
      attrs: { for: 'yaml-sheet-source' },
    });
    this.textarea = el('textarea', {
      // Shares the JSON/Markdown source pane's style — see `json-sheet.ts`.
      className: 'yaml-sheet-source markdown-editor-source',
      attrs: { id: 'yaml-sheet-source', spellcheck: 'false' },
    }) as HTMLTextAreaElement;
    const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, this.textarea]);

    this.previewToggle = el('button', { attrs: { type: 'button' } }) as HTMLButtonElement;
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(!this.previewVisible));
    this.formatButton = el('button', {
      className: 'yaml-sheet-format',
      attrs: { type: 'button' },
      text: t('dialog.yamlEditor.format'),
    }) as HTMLButtonElement;
    this.formatButton.addEventListener('click', () => this.format());
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [
      this.previewToggle,
      this.formatButton,
    ]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [sourcePane]);

    this.element = el('div', { className: 'yaml-sheet-view' }, [toolbar, panes]);
    this.element.hidden = true;

    const previewTitle = el('span', { text: t('dialog.yamlEditor.preview') });
    this.preview = el('div', {
      className: 'markdown-editor-preview',
      attrs: { 'aria-live': 'polite' },
    });
    this.panelElement = el('div', {
      className: 'side-panel json-preview-panel',
      attrs: { role: 'complementary', 'aria-label': t('dialog.yamlEditor.preview') },
    });
    const { positionSwitcher, resizeHandle, maximizeToggle } = buildSidePanelDock(this.panelElement);
    const closeBtn = el('button', {
      className: 'markdown-preview-panel-close',
      attrs: { type: 'button', 'aria-label': t('dialog.yamlEditor.hidePreview') },
    });
    closeBtn.append(createIcon(X, 'markdown-preview-panel-close-icon', 14));
    closeBtn.addEventListener('click', () => this.setPreviewVisible(false));
    const heading = el('div', { className: 'dialog-title side-panel-title' }, [
      previewTitle,
      el('div', { className: 'side-panel-title-actions' }, [positionSwitcher, maximizeToggle, closeBtn]),
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
      this.textarea.value = sheet.yamlText;
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
    if (sheet.yamlText !== this.textarea.value) {
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
    this.preview.replaceChildren(el('pre', {}, [el('code', {}, renderYamlPreview(this.textarea.value))]));
  }

  /**
   * Explicit, button-triggered pretty-print (issue #529, extended by #557 to
   * YAML) — never automatic and never run on save. Invalid YAML is left
   * completely untouched; the parse error is reported via `Commands.notify`
   * rather than blocking or guessing at a fix.
   */
  private format(): void {
    if (!this.bound || this.textarea.readOnly || this.textarea.value.trim() === '') {
      // An empty document is valid YAML (parses to `null`), but there is
      // nothing useful to pretty-print — leave a blank sheet blank instead
      // of writing out a literal "null".
      return;
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
      return;
    }
    const formatted = stringifyYaml(parsed);
    if (formatted === this.textarea.value) {
      return;
    }
    this.textarea.value = formatted;
    this.renderPreview();
    this.flushCommit();
  }
}
