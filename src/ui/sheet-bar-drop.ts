// SPDX-License-Identifier: MIT
/**
 * A document tab dropped on the worksheet strip of a workbook. The strip takes
 * the tab as a copy, marked while the drag is over it, and the drop adds the
 * tab's content to the workbook as a sheet (`Commands.addTabAsSheet`). The
 * drag starts on the tab strip (see `tab-drag.ts`); the worksheet strip's own
 * reordering of its sheets stays in `SheetBar`.
 */
import type { AppState } from '../app/state';
import type { Commands } from '../app/commands';
import { isWorkbook } from '../core/editor-document';
import { getDraggedTabId, setDraggedTabId } from './tab-drag';

/** The class the worksheet strip carries while a document tab would be dropped on it. */
const DROP_MERGE_CLASS = 'drop-merge';

/**
 * The document tab a drop on the strip would add as a sheet: the tab being
 * dragged, when the active tab is a workbook other than that tab. Null otherwise.
 */
function droppableTabId(state: AppState): string | null {
  const dragged = getDraggedTabId();
  const target = state.activeTab;
  return dragged !== null && target !== null && dragged !== target.id && isWorkbook(target.doc)
    ? dragged
    : null;
}

/**
 * Let the worksheet strip take a document tab dragged onto it as a sheet of the
 * active workbook. `ownDragActive` says whether the drag is the strip's own
 * sheet reordering, which is left to the strip.
 */
export function attachTabDrop(
  strip: HTMLElement,
  state: AppState,
  commands: Commands,
  ownDragActive: () => boolean,
): void {
  strip.addEventListener('dragover', (event: DragEvent) => {
    if (ownDragActive() || droppableTabId(state) === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    strip.classList.add(DROP_MERGE_CLASS);
  });
  // A drag that leaves the strip, or is cancelled over it, clears the mark. Moving onto
  // one of the strip's own tabs is still over the strip.
  strip.addEventListener('dragleave', (event: DragEvent) => {
    if (!strip.contains(event.relatedTarget as Node | null)) {
      strip.classList.remove(DROP_MERGE_CLASS);
    }
  });
  strip.addEventListener('drop', (event: DragEvent) => {
    const sourceId = droppableTabId(state);
    if (ownDragActive() || sourceId === null) {
      return;
    }
    event.preventDefault();
    strip.classList.remove(DROP_MERGE_CLASS);
    setDraggedTabId(null);
    // Deferred a tick, like the other drops on the strip: adding a sheet re-renders
    // the strip while the drag is still under way.
    queueMicrotask(() => {
      commands.addTabAsSheet(sourceId);
    });
  });
}
