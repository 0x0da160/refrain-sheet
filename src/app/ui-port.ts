// SPDX-License-Identifier: MIT
/**
 * The contract between the command layer and the UI (`UiPort`), plus the
 * input/result shapes of every dialog it drives. Types only: `src/app/`
 * depends on this interface, and `src/ui/` implements it (see `main.ts`),
 * which is what keeps the app layer from importing the UI layer. Re-exported
 * from `commands.ts` for existing importers.
 */
import type { DelimiterId } from '../core/byte-csv-parser';
import type { BorderLineStyle, BorderSide, BorderWidth, NumberFormat } from '../core/cell-style';
import type { CsvExportOptions } from '../core/csv-export';
import type { EncodingId } from '../core/encoding';
import type { ConditionalFormatRule } from '../core/conditional-format';
import type { ValidationRule } from '../core/data-validation';
import type { DiffOptions, DiffResult } from '../core/diff-engine';
import type { ColumnFilter } from '../core/filter';
import type { SortKey } from '../core/sort';
import type { NcrCellReport, SaveOptions, UnrepresentableCell } from '../core/serializer';
import type { ValidationSummary } from '../core/validation';
import type { RsfHistorySnapshot } from '../core/rsf-codec';
import type { WorksheetKind } from '../core/worksheet';
import type { Tab } from './app-state';
import type { LocaleId } from './i18n';
import type { SqlRunOutcome, SqlSource } from './commands/sql';
import type { DiffRunOutcome, DiffTabOption } from './commands/diff';
import type { FlashFillPreview } from './commands/paste-fill';

/**
 * Applies a side panel's result while the panel stays open — Apply never closes
 * a panel; only its Close button does). A panel given one calls it for every Apply/Clear the user
 * presses and resolves its own promise with null only once the user closes
 * it; a UI that cannot keep a panel open may instead resolve the promise with
 * the result, which the command then applies exactly as before.
 */
export type ApplyHandler<R> = (result: R) => Promise<unknown> | unknown;

/**
 * Everything the SQL query dialog needs. `sources` is the fixed, pre-computed
 * list of pickable data sources; `runQuery` is a live callback (like
 * `UiPort.promptSheetName`'s `validate`) so the dialog can run the same query
 * against different sources, or edit and re-run it, without a round trip
 * through `Commands.run` for every keystroke.
 */
export interface SqlQueryDialogInput {
  sources: SqlSource[];
  runQuery: (sourceId: string, query: string) => Promise<SqlRunOutcome>;
  /** Column names for a source, for the query editor's input suggestions. */
  columns: (sourceId: string) => string[];
}

/**
 * Everything the two-tab compare dialog needs. `currentTabName` is always the
 * active tab (fixed for the dialog's lifetime); `tabs` lists every other open
 * tab, pickable as the baseline ("before") side — see `src/core/diff-engine.ts`
 * and `src/app/commands/diff.ts` for the engine and adapter.
 */
export interface DiffDialogInput {
  currentTabName: string;
  /** Column names for the active (current) tab, for the key/compare pickers. */
  currentColumns: string[];
  tabs: DiffTabOption[];
  /** Column names for a candidate baseline tab, by id. */
  columnsForTab: (tabId: string) => string[];
  runDiff: (baselineTabId: string, options: DiffOptions) => DiffRunOutcome;
  /** Export the shown diff rows as a CSV file. Returns false if the user cancels the save. */
  exportCsv: (result: DiffResult) => Promise<boolean>;
}

/**
 * Why a CSV document needs converting to an RSF spreadsheet document.
 * `command` is the explicit `Convert to RSF…` menu command (which opens a new
 * tab); the others are implicit conversions triggered by an edit that a
 * byte-preserving CSV cannot represent (they convert the current tab in place).
 */
export type ConvertReason =
  | 'formula'
  | 'paste'
  | 'structure'
  | 'fill'
  | 'command'
  | 'filter'
  | 'sort'
  | 'validation'
  | 'conditionalFormat'
  | 'comment'
  | 'move';

/**
 * Resolution of the Sheet ▸ File Version History… dialog (see
 * `UiPort.chooseVersionHistory`): either the enabled/cap settings were
 * confirmed, or a specific snapshot's Restore action was chosen.
 */
/** One row of the File > Open Recent… list (see `chooseRecentFile`). */
export interface RecentFileChoice {
  id: string;
  name: string;
  /** Epoch milliseconds of the last open or save. */
  openedAt: number;
}

export type VersionHistoryChoice =
  | { kind: 'save'; enabled: boolean; maxOverride: number | null | undefined }
  | { kind: 'restore'; index: number };

/** The summary shown before a range move replaces existing destination cells. */
export interface RangeMoveConfirmInput {
  /** Destination rectangle in A1 notation ("C4:E9"). */
  target: string;
  /** Non-empty destination cells that would be replaced. */
  overwriteCount: number;
  /** Cells being moved. */
  movedCells: number;
}

/** The summary shown before a workbook-wide Replace All mutates anything. */
export interface WorkbookReplaceConfirmInput {
  /** Worksheets that contain at least one match. */
  sheets: number;
  /** Cells that contain at least one match. */
  cells: number;
  /** Total replacements that would be made. */
  matches: number;
  /** Worksheets in the workbook (context for "3 of 12"). */
  totalSheets: number;
}

/**
 * Everything the filter dialog needs to edit one column's criteria. The
 * command layer prepares it (including the bounded distinct-value list,
 * enumerated in time slices for large ranges) so the dialog itself stays a
 * pure presentation surface.
 */
export interface FilterDialogInput {
  /** Absolute document column index being edited. */
  col: number;
  /** Column letter (A, B, …) for labels. */
  colLetter: string;
  /** The column's header text (empty when the range has no header row). */
  header: string;
  /** Human-readable A1 range of the filter, e.g. "A1:D200". */
  rangeLabel: string;
  /** Whether the range's first row is treated as a header. */
  headerRow: boolean;
  /** True when a filter already exists (its range/header are then fixed). */
  hasActiveFilter: boolean;
  /** Existing criteria for this column, or null. */
  existing: ColumnFilter | null;
  /** Count of *other* columns that also carry criteria. */
  otherColumns: number;
  /** Bounded, sorted list of distinct displayed values in the data rows. */
  values: string[];
  /** True when the column holds more distinct values than `values` lists. */
  valuesTruncated: boolean;
}

/** What the filter dialog resolved to (null = cancelled, nothing changes). */
export type FilterDialogResult =
  | { action: 'apply'; headerRow: boolean; column: ColumnFilter | null }
  | { action: 'clearColumn' }
  | { action: 'clearAll' };

/**
 * Everything the header-row column menu needs: the compact popover a filter
 * button on a header cell opens, offering a one-click sort by that column and
 * a searchable checklist of the column's values. The command layer prepares
 * it (the distinct values of the rows the *other* columns' criteria leave
 * visible, enumerated in time slices for large ranges) so the popover itself
 * stays a pure presentation surface — mirrors `FilterDialogInput`.
 */
export interface ColumnMenuInput {
  /** Absolute document column index. */
  col: number;
  /** Column letter (A, B, …) for labels. */
  colLetter: string;
  /** The column's header text. */
  header: string;
  /**
   * Where to place the popover (viewport coordinates of the button that
   * opened it), or null to place it near the top-left of the viewport.
   */
  anchor: { left: number; top: number; right: number; bottom: number } | null;
  /** Bounded, sorted list of distinct displayed values. */
  values: string[];
  /** True when the column holds more distinct values than `values` lists. */
  valuesTruncated: boolean;
  /** The values currently allowed for this column, or null when all are. */
  selected: string[] | null;
  /** True when this column also carries comparison conditions (edited in the Filter panel). */
  hasConditions: boolean;
  /** True when this column carries any criteria at all. */
  hasColumnFilter: boolean;
  /** This column's direction in the active sort, or null when it is not the sort key. */
  sorted: 'asc' | 'desc' | null;
}

/** What the column menu resolved to (null = dismissed, nothing changes). */
export type ColumnMenuResult =
  | { action: 'sort'; ascending: boolean }
  | { action: 'clearSort' }
  | { action: 'apply'; values: string[] | null }
  | { action: 'clearColumn' }
  | { action: 'more' };

/**
 * Everything the sort dialog needs to edit the sheet's compound sort keys.
 * The command layer prepares it (range detection, per-column header labels)
 * so the dialog itself stays a pure presentation surface — mirrors
 * `FilterDialogInput`.
 */
export interface SortDialogInput {
  /** Human-readable A1 range of the sort, e.g. "A1:D200". */
  rangeLabel: string;
  /** Whether the range's first row is treated as a header (never reordered). */
  headerRow: boolean;
  /** Every column of the range, for the key column pickers. */
  columns: Array<{ col: number; letter: string; header: string }>;
  /** The active sort's current keys (empty when nothing is sorted yet). */
  existingKeys: SortKey[];
  /** True when a sort already exists (its range is then fixed). */
  hasActiveSort: boolean;
}

/** What the sort dialog resolved to (null = cancelled, nothing changes). */
export type SortDialogResult = { action: 'apply'; headerRow: boolean; keys: SortKey[] } | { action: 'clear' };

/**
 * Everything the data-validation dialog needs to edit the selected range's
 * rule — mirrors `SortDialogInput`.
 */
export interface DataValidationDialogInput {
  /** Human-readable A1 range the rule would apply to, e.g. "A1:A20". */
  rangeLabel: string;
  /** The rule already covering this exact range, or null when creating one. */
  existing: ValidationRule | null;
}

/** What the data-validation dialog resolved to (null = cancelled, nothing changes). */
export type DataValidationDialogResult = { action: 'apply'; rule: ValidationRule } | { action: 'clear' };

/**
 * Everything the conditional-formatting dialog needs to edit the selected
 * range's rule — mirrors `DataValidationDialogInput`.
 */
export interface ConditionalFormatDialogInput {
  /** Human-readable A1 range the rule would apply to, e.g. "A1:A20". */
  rangeLabel: string;
  /** The rule already covering this exact range, or null when creating one. */
  existing: ConditionalFormatRule | null;
}

/** What the conditional-formatting dialog resolved to (null = cancelled, nothing changes). */
export type ConditionalFormatDialogResult =
  { action: 'apply'; rule: ConditionalFormatRule } | { action: 'clear' };

/** Everything the cell-comment dialog needs to edit the active cell's comment. */
export interface CellCommentDialogInput {
  /** Human-readable A1 label of the target cell, e.g. "B3". */
  cellLabel: string;
  /** The comment already on this cell, or null when adding a new one. */
  existing: string | null;
}

/** What the cell-comment dialog resolved to (null = cancelled, nothing changes). */
export type CellCommentDialogResult = { action: 'apply'; text: string } | { action: 'clear' };

/** What the Text/Background Color dialog resolved to (null = cancelled, nothing changes). */
export type ColorDialogResult = { action: 'apply'; color: string } | { action: 'clear' };

/** What the Borders dialog resolved to (null = cancelled, nothing changes). */
export type BordersDialogResult = {
  action: 'apply';
  sides: Partial<Record<BorderSide, string | null>>;
  /** Line style/width applied to every side being set (checked) by this apply. */
  lineStyle: BorderLineStyle;
  width: BorderWidth;
};

/** What the Number Format dialog resolved to (null = cancelled, nothing changes). */
export type NumberFormatDialogResult = { action: 'apply'; format: NumberFormat } | { action: 'clear' };

/**
 * The UI surface the command layer talks to. Menu items, context menus,
 * keyboard shortcuts, and drag-and-drop all execute the same commands; the
 * commands drive dialogs and notifications only through this port, which
 * keeps the layer unit-testable without a DOM.
 */
export interface UiPort {
  confirmValidation(name: string, summary: ValidationSummary): Promise<boolean>;
  confirmUnsaved(names: string[]): Promise<'save' | 'discard' | 'cancel'>;
  chooseSaveOptions(tab: Tab, downloadNote: string | null): Promise<SaveOptions | null>;
  /**
   * Ask for the filename to create in Google Drive, preselected with
   * `suggested`. Resolves with the chosen name, or null when cancelled.
   */
  promptDriveName(suggested: string): Promise<string | null>;
  confirmUnrepresentable(encodingLabel: string, cells: UnrepresentableCell[]): Promise<boolean>;
  notifyNcr(reports: NcrCellReport[]): Promise<void>;
  confirmUndecodableEdit(cells: Array<{ row: number; col: number }>): Promise<boolean>;
  chooseReopen(tab: Tab): Promise<{ encoding: EncodingId; delimiter: DelimiterId } | null>;
  /**
   * File > Open Recent…: pick one of the recently opened files (newest
   * first). Resolves to the chosen entry's id, `'clear'` to forget the whole
   * list, or null when cancelled.
   */
  chooseRecentFile(entries: RecentFileChoice[]): Promise<string | 'clear' | null>;
  /** Explain and confirm the explicit CSV -> RSF conversion. */
  confirmConvert(reason: ConvertReason, name: string): Promise<boolean>;
  /** Explain that a spreadsheet document is saved as .rsf (per-tab, once). */
  explainRsfSave(name: string): Promise<boolean>;
  /**
   * The CSV export options dialog: explains the lossy conversion and lets the
   * user choose encoding, delimiter, quoting, line endings, and BOM
   * behavior. `currentDelimiter` is the source document's own delimiter,
   * shown as the "keep" choice's effective value. Resolving with options
   * *is* the explicit confirmation; null cancels the export.
   */
  chooseExportCsv(name: string, currentDelimiter: DelimiterId): Promise<CsvExportOptions | null>;
  /** Choose the shift direction for Insert Copied Cells… (null cancels). */
  chooseInsertShift(rows: number, cols: number): Promise<'right' | 'down' | null>;
  /**
   * The accessible Flash Fill preview: the inferred operation, affected
   * range, a bounded before/after sample, and the change/overwrite counts.
   * Resolving true is the explicit confirmation to apply; false cancels and
   * leaves the document untouched.
   */
  confirmFlashFill(preview: FlashFillPreview): Promise<boolean>;
  /**
   * The accessible filter dialog for one column: conditions, AND/OR join,
   * the bounded searchable value list, and the header-row setting. Resolves
   * with the chosen action, or null when cancelled (nothing changes).
   */
  chooseFilter(
    input: FilterDialogInput,
    onApply?: ApplyHandler<FilterDialogResult>,
  ): Promise<FilterDialogResult | null>;
  /**
   * The header-row column menu: a small popover anchored beside a header
   * cell's filter button with sort buttons and a searchable value checklist.
   * Resolves with the chosen action, or null when dismissed (nothing changes).
   */
  chooseColumnMenu(input: ColumnMenuInput): Promise<ColumnMenuResult | null>;
  /**
   * The accessible sort dialog: compound sort keys (column + direction) and
   * the header-row setting. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseSort(
    input: SortDialogInput,
    onApply?: ApplyHandler<SortDialogResult>,
  ): Promise<SortDialogResult | null>;
  /**
   * The accessible data-validation dialog for the selected range: a rule
   * kind (a fixed list of choices, or a numeric range) and its parameters.
   * Resolves with the chosen action, or null when cancelled (nothing
   * changes).
   */
  chooseDataValidation(
    input: DataValidationDialogInput,
    onApply?: ApplyHandler<DataValidationDialogResult>,
  ): Promise<DataValidationDialogResult | null>;
  /**
   * The accessible conditional-formatting dialog for the selected range: a
   * rule kind (a value comparison, duplicate highlighting, or a two-color
   * scale) and its parameters. Resolves with the chosen action, or null when
   * cancelled (nothing changes).
   */
  chooseConditionalFormat(
    input: ConditionalFormatDialogInput,
    onApply?: ApplyHandler<ConditionalFormatDialogResult>,
  ): Promise<ConditionalFormatDialogResult | null>;
  /**
   * The accessible cell-comment dialog for the active cell: a free-text note
   * independent of the cell's value. Resolves with the chosen action, or
   * null when cancelled (nothing changes).
   */
  chooseCellComment(input: CellCommentDialogInput): Promise<CellCommentDialogResult | null>;
  /**
   * Ask for a worksheet name when adding, renaming, or duplicating. `validate`
   * returns an already-localized error message for an unacceptable name (empty,
   * too long, duplicate, or containing a character the formula/file syntax
   * reserves) or null when it is acceptable, so the dialog can report the
   * problem inline instead of silently refusing. Resolves with the trimmed
   * name (and, for `mode === 'add'`, the chosen kind), or null when cancelled.
   *
   * `kindOptions` is supplied only for `mode === 'add'`: it renders a
   * worksheet-kind picker (grid/Markdown/JSON/YAML/text) alongside the name
   * field, defaulting to `kindOptions.initialKind`. Changing the picker calls
   * `suggestName(kind)` to refill the name field with that kind's default
   * name — but only while the user has not yet typed a name of their own, so
   * an intentional custom name is never clobbered by switching kinds.
   * `rename`/`duplicate` omit it; the resolved `kind` is meaningless there
   * and callers ignore it.
   */
  promptSheetName(
    mode: 'add' | 'rename' | 'duplicate',
    current: string,
    validate: (name: string) => string | null,
    kindOptions?: { initialKind: WorksheetKind; suggestName: (kind: WorksheetKind) => string },
  ): Promise<{ name: string; kind: WorksheetKind } | null>;
  /**
   * Confirm deleting a worksheet that holds content, a filter, or non-default
   * display settings. `referenceCount` is how many formulas elsewhere in the
   * workbook point at it and will become #REF!, so the warning is truthful.
   */
  confirmDeleteSheet(name: string, referenceCount: number): Promise<boolean>;
  /**
   * Choose which worksheet a multi-worksheet workbook exports to CSV. CSV holds
   * exactly one worksheet, so the choice is always explicit — the export never
   * silently takes the active worksheet. Resolves with the worksheet id, or
   * null when cancelled.
   */
  chooseExportSheet(sheets: Array<{ id: string; name: string }>, currentId: string): Promise<string | null>;
  /**
   * Explain and confirm the lossy XLSX export: calculated values only, no
   * formulas or formatting. Unlike CSV, every worksheet is included, so there
   * is no worksheet picker. Resolving true is the explicit confirmation to
   * proceed; false cancels and leaves the document untouched.
   */
  confirmExportXlsx(name: string): Promise<boolean>;
  /**
   * Explain and confirm the lossy JSON export: calculated values only, one
   * worksheet (see `chooseExportSheet`). Resolving true is the explicit
   * confirmation to proceed; false cancels and leaves the document untouched.
   */
  confirmExportJson(name: string): Promise<boolean>;
  confirm(title: string, message: string, okLabel: string, cancelLabel: string): Promise<boolean>;
  showMessage(title: string, message: string): Promise<void>;
  notify(text: string, kind: 'info' | 'warn' | 'error'): void;
  openFindBar(replaceMode: boolean): void;
  findNext(direction: 1 | -1): void;
  /** Open the About dialog, or its independent Keyboard Shortcuts dialog. */
  showAbout(section?: 'about' | 'shortcuts'): void;
  /** Open the offline formula & function help panel. */
  showFormulaHelp(): void;
  /** Open the local, read-only SQL query panel (see `src/core/sql-engine.ts`). */
  showSqlQuery(input: SqlQueryDialogInput): Promise<void>;
  /** Open the local, read-only two-tab compare panel (see `src/core/diff-engine.ts`). */
  showDiff(input: DiffDialogInput): Promise<void>;
  /**
   * Confirm a workbook-wide Replace All before anything is mutated. Returns
   * false to cancel, which must leave every worksheet untouched.
   */
  confirmReplaceAllWorkbook(input: WorkbookReplaceConfirmInput): Promise<boolean>;
  /**
   * Confirm a range move that would replace non-empty destination cells.
   * Cancel is the default; nothing is mutated until this resolves true.
   */
  confirmRangeMoveOverwrite(input: RangeMoveConfirmInput): Promise<boolean>;
  /**
   * Ask for a destination for "Move Selected Cells…" — the keyboard-equivalent
   * of dragging the selection. Returns the top-left destination cell in A1
   * notation, or null when cancelled. `validate` returns a localized error for
   * an unusable entry, or null when it is acceptable.
   */
  promptMoveTarget(
    source: string,
    suggestion: string,
    validate: (text: string) => string | null,
  ): Promise<string | null>;
  /**
   * "Go to Cell…": ask for a cell reference (e.g. "B12") to jump the
   * selection to. `suggestion` seeds the field with the current cell;
   * `validate` returns a localized error for an unusable entry, or null
   * when it is acceptable. Resolves with the entered text, or null when
   * cancelled.
   */
  promptGoToCell(suggestion: string, validate: (text: string) => string | null): Promise<string | null>;
  /** Edit local settings; returns the chosen maximum file size in bytes, or null when cancelled. */
  chooseSettings(currentMaxFileSize: number): Promise<number | null>;
  /**
   * The workbook Timezone… dialog: pick an IANA zone from every zone the
   * runtime knows, with `current` preselected. Resolves with the chosen zone
   * name, or null when cancelled (nothing changes).
   */
  chooseTimezone(current: string): Promise<string | null>;
  /**
   * The workbook Display language… dialog: pick `en` or `ja`, with `current`
   * preselected. Resolves with the chosen language, or null when cancelled
   * (nothing changes).
   */
  chooseDisplayLanguage(current: LocaleId): Promise<LocaleId | null>;
  /**
   * The Sheet ▸ File Version History… dialog: whether this file records a
   * snapshot on every successful save, the per-file retained-snapshot cap
   * override (`maxOverride`: `undefined` = default, `null` = unlimited, or an
   * explicit number), and the recorded snapshots themselves (oldest first) so
   * one can be restored. Resolves `{ kind: 'save', ... }` when the enabled
   * checkbox / cap setting is confirmed, `{ kind: 'restore', index }` when a
   * snapshot's Restore action is chosen, or null when cancelled (nothing
   * changes). Never deletes anything — clearing is `sheet.clearVersionHistory`.
   */
  chooseVersionHistory(
    current: boolean,
    maxOverride: number | null | undefined,
    history: readonly RsfHistorySnapshot[],
  ): Promise<VersionHistoryChoice | null>;
  /**
   * Warn that saving now will drop the oldest recorded version-history
   * snapshot because this file's retained-snapshot cap (`max`) has been
   * reached (Sheet ▸ File Version History…), shown before the save happens.
   * Carries a "don't show again" checkbox (default off) whose choice is
   * persisted locally (`app/settings.ts`'s `setSuppressHistoryCapWarning`),
   * never written into the file. Resolves true to proceed with the save,
   * false to cancel it.
   */
  confirmHistoryCapExceeded(name: string, max: number): Promise<boolean>;
  /**
   * The Text Color dialog: a color picker preselected from `current` (null
   * when the selection has none, or is mixed). Resolves with the chosen
   * color, `'clear'` to remove it, or null when cancelled (nothing changes).
   */
  chooseTextColor(
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null>;
  /** The Background Color dialog — see {@link chooseTextColor}. */
  chooseBackgroundColor(
    current: string | null,
    onApply?: ApplyHandler<ColorDialogResult>,
  ): Promise<ColorDialogResult | null>;
  /**
   * The Borders dialog: which of the four sides carry a border (from
   * `current`) and their shared color, line style, and width. Resolves with
   * every side's next state (a color to set it, `null` to clear it) plus the
   * chosen line style/width to apply to every side being set, or null when
   * cancelled.
   */
  chooseBorders(
    current: Partial<Record<BorderSide, string>>,
    currentLineStyle: BorderLineStyle | null,
    currentWidth: BorderWidth | null,
    onApply?: ApplyHandler<BordersDialogResult>,
  ): Promise<BordersDialogResult | null>;
  /**
   * The Number Format dialog: kind (number/percent/currency), decimal places,
   * thousands separator, and (for currency) a symbol, preselected from
   * `current` (null when the selection has none, or is mixed). Resolves with
   * the chosen format, `'clear'` to remove it, or null when cancelled
   * (nothing changes).
   */
  chooseNumberFormat(
    current: NumberFormat | null,
    onApply?: ApplyHandler<NumberFormatDialogResult>,
  ): Promise<NumberFormatDialogResult | null>;
  /**
   * Show or hide the busy/loading indicator. `label` is already-localized
   * text describing the current operation; `null` hides the indicator.
   * `progress` is a real completion percentage (0-100) when the caller has
   * one to report — it shows a determinate progress bar in place of the
   * indeterminate spinner. Omit it when no honest percentage exists.
   */
  setBusy(label: string | null, progress?: number | null): void;
}
