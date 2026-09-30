// SPDX-License-Identifier: MIT
import { isWorkbook } from '../core/editor-document';
import type { AppState, Tab } from '../app/state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import {
  getMarkdownTheme,
  MARKDOWN_THEMES,
  setMarkdownTheme,
  type MarkdownTheme,
} from '../app/markdown-theme';
import { parseMarkdown } from '../core/markdown';
import {
  applySidePanelPosition,
  buildSidePanelChrome,
  releaseSidePanel,
  currentSidePanelPlacement,
} from './dialogs/side-panel';
import { Bold, Code, Eye, Italic } from 'lucide';
import { el } from './dom';
import { SourceEditor } from './source-editor';
import { syncScroll } from './editor-preview-perf';
import { renderMarkdownBlocks } from './markdown-render';
import { createIcon } from './icon';
import {
  blockKind,
  MARKDOWN_BLOCK_KINDS,
  MarkdownVisualEditor,
  type MarkdownBlockKind,
} from './markdown-visual';

/** Source shows the Markdown text; visual shows it formatted and edits it in place. */
type MarkdownMode = 'source' | 'visual';

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
 * panels and the comments panel use (`src/ui/dialogs/side-panel.ts`,
 * `ui/comments-panel.ts`) — opened by `previewToggle`, rather than a fixed
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
 * Visual mode (`MarkdownVisualEditor`) swaps the textarea for the formatted
 * document, edited in place; each edit writes the Markdown text back into
 * the textarea and commits through the same debounce, so what is saved is
 * always the Markdown text. The preview panel is hidden while it is on.
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
  /** The editing surface (see `SourceEditor`); `textarea` is its element. */
  readonly editor: SourceEditor;
  private readonly textarea: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  private readonly previewToggle: HTMLButtonElement;
  private readonly sourcePane: HTMLElement;
  private readonly visual = new MarkdownVisualEditor();
  private readonly modeButtons: Record<MarkdownMode, HTMLButtonElement>;
  private readonly formatTools: HTMLElement;
  private readonly blockKindSelect: HTMLSelectElement;
  private readonly themeSelect: HTMLSelectElement;
  private mode: MarkdownMode = 'source';

  /** The (tab, sheetId) the textarea currently reflects, so a pending debounced edit commits to the right place. */
  private bound: { tab: Tab; sheetId: string } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the preview panel should be open while this view is active; opened by `previewToggle` and closed by its header ×, not persisted across reloads. */
  private previewVisible = true;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.editor = new SourceEditor({
      id: 'markdown-sheet-source',
      className: 'markdown-sheet-source',
      label: t('dialog.markdownEditor.source'),
      indentUnit: '\t',
    });
    this.textarea = this.editor.textarea;
    this.sourcePane = el('div', { className: 'markdown-editor-pane' }, [this.textarea]);
    const visualPane = el('div', { className: 'markdown-editor-pane markdown-visual-pane' }, [
      this.visual.element,
    ]);

    this.previewToggle = el('button', {
      className: 'markdown-preview-toggle',
      attrs: { type: 'button' },
    }) as HTMLButtonElement;
    // Opens only: the preview panel closes from its header × alone.
    this.previewToggle.addEventListener('click', () => this.setPreviewVisible(true));

    this.modeButtons = { source: this.modeButton('source'), visual: this.modeButton('visual') };
    const modeGroup = el(
      'div',
      {
        className: 'markdown-mode-switch',
        attrs: { role: 'group', 'aria-label': t('dialog.markdownEditor.mode') },
      },
      [this.modeButtons.source, this.modeButtons.visual],
    );
    this.blockKindSelect = this.buildBlockKindSelect();
    this.formatTools = el('div', { className: 'markdown-visual-tools' }, [
      this.blockKindSelect,
      this.formatButton(Bold, t('dialog.markdownEditor.bold'), 'strong'),
      this.formatButton(Italic, t('dialog.markdownEditor.italic'), 'em'),
      this.formatButton(Code, t('dialog.markdownEditor.code'), 'code'),
    ]);
    this.themeSelect = this.buildThemeSelect();
    const toolbar = el('div', { className: 'markdown-editor-toolbar' }, [
      modeGroup,
      this.formatTools,
      this.previewToggle,
      el('label', { className: 'markdown-theme-field' }, [
        el('span', { text: t('dialog.markdownEditor.theme') }),
        this.themeSelect,
      ]),
    ]);

    const panes = el('div', { className: 'markdown-editor-panes' }, [this.sourcePane, visualPane]);

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
    this.applyTheme(getMarkdownTheme());

    this.visual.onChange = (source) => {
      this.editor.setValue(source);
      this.renderPreview();
      this.scheduleCommit();
    };
    this.visual.onFocusBlock = (block) => {
      const kind = block ? blockKind(block) : null;
      this.blockKindSelect.value = kind ?? '';
      this.blockKindSelect.disabled = kind === null || this.textarea.readOnly;
    };
    this.visual.element.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !this.visual.element.contains(event.relatedTarget)) {
        this.flushCommit();
      }
    });
    // Same early flush as the textarea's, for shortcuts pressed while editing visually.
    this.visual.element.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey) {
        this.flushCommit();
      }
    });
    this.applyMode();

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

  private modeButton(mode: MarkdownMode): HTMLButtonElement {
    const button = el('button', {
      className: 'markdown-mode-button',
      text: t(`dialog.markdownEditor.mode.${mode}`),
      attrs: { type: 'button' },
    }) as HTMLButtonElement;
    button.addEventListener('click', () => this.setMode(mode));
    return button;
  }

  private buildBlockKindSelect(): HTMLSelectElement {
    const select = el('select', {
      className: 'markdown-block-kind',
      attrs: { 'aria-label': t('dialog.markdownEditor.blockKind') },
    }) as HTMLSelectElement;
    select.append(el('option', { text: '', attrs: { value: '', hidden: '' } }));
    for (const kind of MARKDOWN_BLOCK_KINDS) {
      select.append(el('option', { text: t(`dialog.markdownEditor.kind.${kind}`), attrs: { value: kind } }));
    }
    select.disabled = true;
    // Keep the caret's block: choosing from the menu must not lose it.
    select.addEventListener('change', () => {
      if (select.value !== '') {
        this.visual.setBlockKind(select.value as MarkdownBlockKind);
      }
    });
    return select;
  }

  /** The display theme picker: how the preview and the Formatted editor look (see `markdown-themes.css`). */
  private buildThemeSelect(): HTMLSelectElement {
    const select = el('select', { className: 'markdown-theme-select' }) as HTMLSelectElement;
    for (const theme of MARKDOWN_THEMES) {
      select.append(
        el('option', { text: t(`dialog.markdownEditor.theme.${theme}`), attrs: { value: theme } }),
      );
    }
    select.value = getMarkdownTheme();
    select.addEventListener('change', () => {
      const theme = select.value as MarkdownTheme;
      setMarkdownTheme(theme);
      this.applyTheme(theme);
    });
    return select;
  }

  private applyTheme(theme: MarkdownTheme): void {
    for (const surface of [this.preview, this.visual.element]) {
      if (theme === 'standard') {
        surface.removeAttribute('data-md-theme');
      } else {
        surface.dataset.mdTheme = theme;
      }
    }
  }

  private formatButton(icon: typeof Bold, label: string, kind: 'strong' | 'em' | 'code'): HTMLButtonElement {
    const button = el('button', {
      className: 'markdown-format-button',
      attrs: { type: 'button', 'aria-label': label, title: label },
    }) as HTMLButtonElement;
    button.append(createIcon(icon, 'markdown-format-icon', 16));
    // Pressing the button must not take the selection out of the text.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => this.visual.toggleInline(kind));
    return button;
  }

  /** Switch between the Markdown text and the formatted, editable document. */
  setMode(mode: MarkdownMode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    if (mode === 'visual') {
      this.visual.load(this.textarea.value);
      this.visual.setReadOnly(this.textarea.readOnly);
    }
    this.applyMode();
    this.updatePanelVisibility();
    (mode === 'visual' ? this.visual.element : this.textarea).focus();
  }

  private applyMode(): void {
    const visual = this.mode === 'visual';
    this.sourcePane.hidden = visual;
    (this.visual.element.parentElement as HTMLElement).hidden = !visual;
    this.formatTools.hidden = !visual;
    this.previewToggle.hidden = visual;
    for (const [mode, button] of Object.entries(this.modeButtons)) {
      button.setAttribute('aria-pressed', String(mode === this.mode));
    }
  }

  /** Open/close the preview panel: `previewToggle` opens it, its header × closes it. */
  private setPreviewVisible(visible: boolean): void {
    this.previewVisible = visible;
    this.updatePanelVisibility();
    this.updatePreviewToggle();
  }

  /** Reconciles the panel's actual open/closed state with `previewVisible && active`. */
  private updatePanelVisibility(): void {
    const shouldShow = this.previewVisible && this.active && this.mode === 'source';
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
    this.previewToggle.textContent = t('dialog.markdownEditor.showPreview');
    // Disabled while the preview is open instead of turning into a Hide
    // button, so it never closes the panel.
    this.previewToggle.disabled = this.previewVisible;
  }

  /** True when the active worksheet is a Markdown sheet — the caller hides the grid exactly when this is true. */
  get active(): boolean {
    const tab = this.state.activeTab;
    return tab !== null && isWorkbook(tab.doc) && tab.doc.activeSheet.kind === 'markdown';
  }

  /** Show/hide and (re)populate from the active tab/worksheet. Call on every `tabs`/`active`/`sheets`/`doc` event. */
  refresh(): void {
    const tab = this.state.activeTab;
    if (tab === null || !isWorkbook(tab.doc) || tab.doc.activeSheet.kind !== 'markdown') {
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
      this.load(sheet.markdownText);
    } else if (this.commitTimer === null && sheet.markdownText !== this.textarea.value) {
      // Changed from elsewhere (Undo, Redo, Replace All) with no edit of ours pending.
      this.load(sheet.markdownText);
    }
    // A locked worksheet is read-only here too, not only a protected file:
    // typing would otherwise be refused only when the edit is committed.
    const readOnly = tab.readOnly || sheet.locked;
    if (this.textarea.readOnly !== readOnly) {
      this.visual.setReadOnly(readOnly);
    }
    this.textarea.readOnly = readOnly;
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
    if (!isWorkbook(tab.doc) || tab.doc.activeSheet.id !== sheetId) {
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

  private load(text: string): void {
    this.editor.setValue(text);
    this.renderPreview();
    if (this.mode === 'visual') {
      this.visual.load(text);
      this.visual.setReadOnly(this.textarea.readOnly);
    }
  }

  private renderPreview(): void {
    this.preview.replaceChildren(...renderMarkdownBlocks(parseMarkdown(this.textarea.value)));
  }
}
