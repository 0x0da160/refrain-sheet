// SPDX-License-Identifier: MIT
import { copyRows, parseClipboardText, rangeToMatrix, rangeToTsv } from '../core/clipboard';
import type { AppState, Selection } from './app-state';
import type { Commands } from './commands';
import { t } from './i18n';

/**
 * Copy/paste for cell ranges.
 *
 * Copies produce tab-separated, newline-separated text (display values) so
 * ranges can be pasted into spreadsheet software. An internal clipboard
 * additionally keeps the raw cell inputs and the copy origin, so pasting
 * within the app preserves formulas and adjusts their relative references;
 * when the system clipboard text no longer matches the internal copy, the
 * pasted text is used as-is.
 *
 * The `copy`/`paste` DOM events (Ctrl+C / Ctrl+V) are the primary path —
 * they work in every browser including file:// contexts. The async
 * navigator.clipboard API is used for the menu commands where available.
 */
export class ClipboardController {
  private internal: { text: string; matrix: string[][]; origin: Selection } | null = null;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
    private readonly notify: (text: string, kind: 'info' | 'warn' | 'error') => void,
  ) {}

  /**
   * Copy the selected range, remembering raw inputs internally. Returns the
   * TSV text. Rows hidden by an active filter are excluded (documented: a
   * copy contains exactly the rows visible on screen; the copied visible
   * rows form one contiguous block for pasting).
   */
  copyText(): string | null {
    const tab = this.state.activeTab;
    if (!tab) {
      return null;
    }
    const range = this.state.selectedRange(tab);
    if (!range) {
      return null;
    }
    const rows = copyRows(range, this.state.hiddenRows(tab));
    if (rows.length === 0) {
      return null;
    }
    const text = rangeToTsv(tab.doc, range, rows);
    this.internal = {
      text,
      matrix: rangeToMatrix(tab.doc, range, rows),
      origin: { row: range.top, col: range.left },
    };
    return text;
  }

  /** Ctrl+C / Cmd+C: write TSV into the clipboard event. */
  handleCopyEvent(event: ClipboardEvent): boolean {
    const text = this.copyText();
    if (text === null || !event.clipboardData) {
      return false;
    }
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    return true;
  }

  /** Ctrl+V / Cmd+V: paste the clipboard event text. */
  handlePasteEvent(event: ClipboardEvent): boolean {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text === '') {
      return false;
    }
    event.preventDefault();
    void this.pasteText(text);
    return true;
  }

  /** Paste text at the active cell (internal matrix when it matches the copy). */
  async pasteText(text: string): Promise<void> {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    if (this.internal && this.internal.text === text) {
      await this.commands.applyPaste(tab, this.internal.matrix, this.internal.origin);
      return;
    }
    const matrix = parseClipboardText(text);
    await this.commands.applyPaste(tab, matrix, null);
  }

  /**
   * The most recently copied rectangular range, for Insert Copied Cells…
   * Prefers the internal clipboard (raw inputs + origin, so formulas adjust);
   * falls back to parsing the system clipboard text (origin unknown).
   */
  async getCopied(): Promise<{ matrix: string[][]; origin: Selection | null } | null> {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (this.internal && (text === null || text === '' || text === this.internal.text)) {
      return { matrix: this.internal.matrix, origin: this.internal.origin };
    }
    if (text !== null && text !== '') {
      const matrix = parseClipboardText(text);
      return matrix.length > 0 ? { matrix, origin: null } : null;
    }
    return null;
  }

  /** Menu Copy: async clipboard API with a graceful message when blocked. */
  async copyViaApi(): Promise<void> {
    const text = this.copyText();
    if (text === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.notify(t('notify.copied'), 'info');
    } catch {
      // The internal clipboard still works for in-app paste.
      this.notify(t('notify.clipboardBlocked'), 'warn');
    }
  }

  /** Menu Paste: async clipboard API, falling back to the internal clipboard. */
  async pasteViaApi(): Promise<void> {
    const tab = this.state.activeTab;
    if (!tab) {
      return;
    }
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (text !== null && text !== '') {
      await this.pasteText(text);
      return;
    }
    if (this.internal) {
      await this.commands.applyPaste(tab, this.internal.matrix, this.internal.origin);
      return;
    }
    this.notify(t('notify.pasteBlocked'), 'warn');
  }
}
