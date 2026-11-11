// SPDX-License-Identifier: MIT
/**
 * The open document tab a drag carries. The tab strip starts the drag, and the
 * worksheet strip may take the tab: dropped there, the file is added to the
 * workbook as a sheet. Browsers hide drag data from `dragover`, so the id is
 * kept here rather than read back from `dataTransfer`.
 */
let draggedTabId: string | null = null;

/** Record which document tab a drag carries, or clear it with null. */
export function setDraggedTabId(id: string | null): void {
  draggedTabId = id;
}

/** The document tab a drag carries, or null when the drag carries none. */
export function getDraggedTabId(): string | null {
  return draggedTabId;
}
