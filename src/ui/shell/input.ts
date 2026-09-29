// SPDX-License-Identifier: MIT
/**
 * Window-level input: native clipboard events, keyboard shortcuts, file drag
 * and drop, and the leave-page confirmation.
 */
import type { Commands } from '../../app/commands';
import { t } from '../../app/i18n';
import { getShiftPasteMode } from '../../app/settings';
import { resolveShortcut } from '../../app/shortcuts';
import type { AppState } from '../../app/state';
import type { DropOverlay } from './layout';
import type { Surfaces } from './surfaces';

/** Ctrl+X / Ctrl+C / Ctrl+V via the native cut/copy/paste events, while the grid or an object over it has the keyboard. */
export function installClipboardEvents(s: Surfaces): void {
  document.addEventListener('copy', (event) => {
    if (s.grid.isNavigating() || s.grid.hasObjectFocus()) {
      s.clipboard.handleCopyEvent(event);
    }
  });
  document.addEventListener('cut', (event) => {
    if (s.grid.isNavigating() || s.grid.hasObjectFocus()) {
      s.clipboard.handleCutEvent(event);
    }
  });
  document.addEventListener('paste', (event) => {
    if (s.grid.isNavigating() || s.grid.hasObjectFocus()) {
      s.clipboard.handlePasteEvent(event);
    }
  });
}

/**
 * Keyboard shortcuts through the shared command layer. Routing lives in the
 * pure `resolveShortcut` (unit-tested): it returns a command only for
 * recognized, non-reserved accelerators and never during IME composition. We
 * preventDefault only when a command is resolved and the event is cancelable,
 * so browser/OS/AT shortcuts are never suppressed.
 */
export function installShortcuts(commands: Commands, s: Surfaces): void {
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    // The grid's hidden IME sink is a textarea, but while the grid is merely
    // navigated (no cell editor open) it is not a text-editing surface —
    // grid accelerators (Undo/Redo/Fill Down/Select All) must keep working.
    const inTextField =
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true) &&
      !s.grid.isNavigating();
    const command = resolveShortcut(
      {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
      {
        inTextField,
        isComposing: event.isComposing,
        // Select All is only owned while the grid itself is focused (never a
        // text field or the rest of the page — the browser keeps Ctrl+A there).
        inGrid: s.grid.isNavigating(),
        shiftPaste: getShiftPasteMode(),
      },
    );
    if (!command) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    void commands.run(command);
  });
}

/** Whole-window file drag & drop with visual feedback. */
export function installFileDrop(commands: Commands, drop: DropOverlay): void {
  let dragDepth = 0;
  const setOverlay = (active: boolean): void => {
    drop.overlay.classList.toggle('active', active);
    if (active) {
      drop.message.textContent = t('drop.hint');
    }
  };
  window.addEventListener('dragenter', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      dragDepth += 1;
      setOverlay(true);
    }
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setOverlay(false);
    }
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    setOverlay(false);
    const { files, handles } = droppedFiles(event);
    if (files.length === 0) return;
    void Promise.all(handles).then((resolved) => commands.openDroppedFiles(files, resolved));
  });
}

/** The dropped files and, where the browser offers them, writable handles for overwrite saves. */
function droppedFiles(event: DragEvent): {
  files: File[];
  handles: Array<Promise<FileSystemFileHandle | null>>;
} {
  const items = Array.from(event.dataTransfer?.items ?? []);
  const files: File[] = [];
  const handles: Array<Promise<FileSystemFileHandle | null>> = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file);
    const getHandle = (
      item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }
    ).getAsFileSystemHandle;
    // Must be called synchronously inside the drop event to obtain a
    // writable handle for overwrite saves (Chromium only).
    handles.push(
      typeof getHandle === 'function'
        ? getHandle
            .call(item)
            .then((h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null))
            .catch(() => null)
        : Promise.resolve(null),
    );
  }
  return { files, handles };
}

/**
 * Leave-page confirmation. Browsers do not allow custom dialogs during
 * unload; the standard confirmation is used when any tab has unsaved changes.
 */
export function installLeaveConfirmation(state: AppState, s: Surfaces): void {
  window.addEventListener('beforeunload', (event) => {
    // A pending debounced Markdown/JSON/YAML/text-sheet edit has not yet
    // marked its document dirty — flush it first so an edit made in the last
    // moment before closing is never silently lost nor missed by the dirty
    // check below.
    s.markdownSheetView.flushCommit();
    s.jsonSheetView.flushCommit();
    s.yamlSheetView.flushCommit();
    s.textSheetView.flushCommit();
    if (state.tabs.some((tab) => tab.doc.isDirty)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
