// SPDX-License-Identifier: MIT
/**
 * Which edition of the app this is. The regular edition has every feature.
 * The CSV-only minimal edition (`npm run build:minimal` → `dist-minimal/`)
 * keeps only what editing a CSV file needs: open, edit, find, sort, filter
 * and save. RSF workbooks, formulas, formatting, objects, SQL, comparison,
 * Google Drive and the other workbook features are left out. Saving a CSV
 * goes through the same code in both editions, so the saved bytes are the
 * same (tests/app/edition.test.ts, scripts/ui-check/minimal.mjs).
 *
 * The edition is fixed at build time by `__MINIMAL_BUILD__` (vite.config.ts);
 * dev and Vitest build the regular edition, and tests switch with
 * {@link setMinimalEditionForTests}.
 */
import type { CommandId } from './commands/catalog';

/** `true` only in `vite build --mode minimal`, injected by vite.config.ts. */
declare const __MINIMAL_BUILD__: boolean;

let minimal = __MINIMAL_BUILD__;

/** True in the CSV-only minimal edition. */
export function isMinimalEdition(): boolean {
  return minimal;
}

/** Switch editions in a test. */
export function setMinimalEditionForTests(on: boolean): void {
  minimal = on;
}

/** Whole command groups the minimal edition leaves out. */
const LEFT_OUT_GROUPS = ['data.', 'drive.', 'format.', 'insert.', 'object.', 'worksheet.'];

/** Single commands the minimal edition leaves out: each needs a workbook or is not about a CSV. */
const LEFT_OUT = new Set<CommandId>([
  'file.new',
  'file.importJsonTable',
  'file.print',
  'edit.copyScreenshot',
  'edit.copyAsMarkdown',
  'edit.copyAsMarkdownNoHeader',
  'edit.copyAsBacklog',
  'edit.copyAsBacklogHeaderRow',
  'edit.copyAsBacklogHeaderCol',
  'edit.pasteFormats',
  'edit.fillDown',
  'edit.flashFill',
  'edit.moveRange',
  'edit.insertCopiedCells',
  'edit.insertCopiedRows',
  'edit.insertCopiedCols',
  'sheet.convert',
  'sheet.recalculate',
  'sheet.timezone',
  'sheet.displayLanguage',
  'sheet.versionHistory',
  'sheet.clearVersionHistory',
  'sheet.exportCsv',
  'sheet.exportXlsx',
  'sheet.exportJson',
  'view.commentsPanel',
  'view.sheetTabsVertical',
  'help.formula',
]);

/** Whether this edition has `id` at all. Menus, the toolbar and shortcuts leave out a command it lacks. */
export function isCommandAvailable(id: CommandId): boolean {
  return !minimal || !(LEFT_OUT.has(id) || LEFT_OUT_GROUPS.some((group) => id.startsWith(group)));
}
