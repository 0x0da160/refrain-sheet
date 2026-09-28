// SPDX-License-Identifier: MIT
/** The application state's data shapes: tabs, selections, and change events. */
import type { EditorDocument } from '../../core/editor-document';
import type { History } from '../../core/workbook/history';
import type { FreezePanes } from '../../core/workbook/worksheet';
import type { FileStamp } from '../file-access';
import type { TextFileFormat } from '../../core/interchange/text-file';

export interface Selection {
  row: number;
  col: number;
}

/**
 * How the current selection was made, so the grid can render it distinctly:
 * a cell/range selection, a whole-row selection (from row headers), or a
 * whole-column selection (from column headers). It does not change the
 * selected rectangle — copy/paste/fill/statistics all use `selectedRange`.
 */
export type SelectionKind = 'cell' | 'row' | 'col';

/**
 * A formula editor (the formula bar) that can receive cell/range references
 * from the grid by pointer. While `isCapturing()` is true, clicking or
 * dragging cells in the grid inserts a reference at the caret instead of
 * moving the selection. `beginRef` marks the insertion point, `setRef`
 * replaces the pending reference text (so a drag keeps rewriting one span),
 * and `endRef` finalizes it.
 */
export interface FormulaRefTarget {
  isCapturing(): boolean;
  beginRef(): void;
  setRef(text: string): void;
  endRef(): void;
}

export interface Tab {
  id: string;
  name: string;
  doc: EditorDocument;
  history: History;
  handle: FileSystemFileHandle | null;
  /**
   * How `handle`'s file looked on disk when this tab opened or last saved it.
   * A save that finds a different stamp asks before overwriting, so an edit
   * saved from another browser tab or another app is never silently lost.
   * Null when there is no handle or the stamp is unknown (no check is made).
   */
  diskStamp: FileStamp | null;
  /** Active cell. */
  selection: Selection | null;
  /** Selection anchor for rectangular ranges (null: single-cell selection). */
  anchor: Selection | null;
  /** How the selection was made (drives distinct rendering). */
  selectionKind: SelectionKind;
  /** The "must be saved as .rsf" explanation was already shown for this tab. */
  rsfSaveExplained: boolean;
  /**
   * The Google Drive file this tab is associated with, set when the document
   * was opened from Drive or saved to it. Lets a later save overwrite the same
   * file instead of creating a duplicate. Null for any tab that has never
   * touched Drive — which is every tab in the offline build.
   */
  drive: { fileId: string; name: string } | null;
  /**
   * Per-column pixel widths for this open document during the session,
   * expressed at 100% zoom. A missing or zero entry means the default width.
   * Stored on the tab so resizing a plain CSV never mutates its bytes; RSF
   * documents persist these in their container on save.
   */
  colWidths: number[];
  /**
   * Effective spreadsheet zoom percent for this tab, resolved worksheet >
   * file > browser (`state/view-layers.ts`), falling back to the value last
   * used in this browser. Zooming never mutates document content and never
   * marks a document dirty; an RSF file's file/worksheet levels are persisted
   * in its container on the next save.
   */
  zoom: number;
  /**
   * Whether long cells wrap onto several visual lines in this tab. Resolved
   * like zoom (worksheet > file > browser), and each worksheet of a workbook
   * remembers its own. Purely visual — for a plain CSV it is local application
   * state that never touches the file's bytes.
   */
  wrapCells: boolean;
  /**
   * The column where an uninterrupted "type → Tab → type → Tab → … → Enter"
   * entry pass began, so Enter can return to it instead of merely moving one
   * row down from wherever the last Tab landed (matching Excel/Sheets/Calc).
   * Null when no such pass is in progress. Set on the first Tab of a pass;
   * cleared by `setSelection` on any selection change that is not part of
   * that pass (a click, an arrow key, opening a menu, and so on).
   */
  tabEntryCol: number | null;
  /**
   * Rows/columns frozen at a selected cell (View > Sticky Up to Selected
   * Cell), or null to follow the application-level sticky first row / first
   * column preferences. Session-only view state, remembered per worksheet of
   * a workbook, never written to the file.
   */
  freeze: FreezePanes | null;
  /**
   * Read-only protection: while true, every mutating command that would
   * touch document content, structure, or the undo history is refused (see
   * `AppState.refuseReadOnlyWrite`). Defaults to true whenever an existing
   * file is opened, and false for a newly created blank document; the user
   * toggles it explicitly afterward (File > Protect Document, or the status
   * bar control) and the choice is session-only — never persisted to the
   * saved file, and reset to the default the next time the file is opened.
   * Purely a UI guard, not a security boundary: it protects against
   * accidental edits, not a hostile actor.
   */
  readOnly: boolean;
  /**
   * True only for a CSV tab created by `File > New CSV` (`FileIoCommands.newCsvDocument`)
   * that has never been saved (to disk or Drive) since. There is no on-disk
   * byte layout to protect yet, so structural edits (row/column insert and
   * delete) are allowed directly on the CSV document as an exception to the
   * usual "convert to RSF first" rule (#479) — see the `csvStructure` history
   * operation. Set back to `false` by the first successful save, after which
   * the normal explicit-conversion requirement applies again.
   */
  neverSaved: boolean;
  /**
   * Set when the tab was opened from a Markdown, JSON, YAML, or text file:
   * how that file's bytes are laid out, so a save writes the editor's text
   * back into the same file (see `core/interchange/text-file.ts`). Null for
   * every other tab.
   */
  textFile: TextFileFormat | null;
}

/**
 * State change kinds. `sheets` covers the *worksheets inside* the active RSF
 * workbook (added, renamed, reordered, or switched) and is deliberately
 * distinct from `tabs`, which covers the open documents in the application tab
 * strip — the two strips are independent surfaces.
 */
export type StateEventType = 'tabs' | 'active' | 'doc' | 'selection' | 'view' | 'sheets';
