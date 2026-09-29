// SPDX-License-Identifier: MIT
/**
 * Sheet commands (`sheet.*`): conversion, row/column structure, filter and
 * sort, recalculation and per-workbook settings, version history, export.
 */
import { isCsv, isWorkbook, workbookOf } from '../../../core/editor-document';
import type { RsfDocument } from '../../../core/workbook/rsf-document';
import { getLocale, t } from '../../i18n';
import type { Tab } from '../../state';
import { isGridSurface } from '../shared';
import type { SheetOpId } from '../worksheets';
import { hasSelection, withTab, type CommandContext, type CommandSpec } from './types';

/**
 * Row insert/delete is meaningless while a whole-column selection is active
 * (there is no well-defined row to insert/delete around), and column
 * insert/delete while a whole-row selection is.
 */
function sheetOp(id: SheetOpId, axis: 'row' | 'col'): CommandSpec {
  return withTab(
    (ctx, tab) => ctx.parts.worksheets.runSheetOp(tab, id),
    (_, tab) => tab.selection !== null && tab.selectionKind !== (axis === 'row' ? 'col' : 'row'),
  );
}

/** A workbook-only command that runs against the active tab's workbook. */
function forWorkbook(
  run: (ctx: CommandContext, tab: Tab, doc: RsfDocument) => unknown,
  enabled?: (doc: RsfDocument) => boolean,
): CommandSpec {
  return {
    enabled: ({ tab }) => {
      const doc = workbookOf(tab?.doc);
      return doc !== null && (enabled?.(doc) ?? true);
    },
    run: (ctx) => {
      const doc = workbookOf(ctx.tab?.doc);
      return ctx.tab && doc ? run(ctx, ctx.tab, doc) : undefined;
    },
  };
}

async function chooseTimezone(ctx: CommandContext, _tab: Tab, doc: RsfDocument): Promise<void> {
  const chosen = await ctx.ui.chooseTimezone(doc.timezone);
  // Like Recalculate, this changes no cell input: no history entry, no dirty
  // flag. setTimezone() itself invalidates every cached result so
  // TODAY()/NOW() reflect the new zone immediately.
  if (chosen !== null) {
    doc.setTimezone(chosen);
    ctx.state.emit('doc');
    ctx.ui.notify(t('notify.timezoneChanged', { timezone: doc.timezone }), 'info');
  }
}

async function chooseDisplayLanguage(ctx: CommandContext, _tab: Tab, doc: RsfDocument): Promise<void> {
  const chosen = await ctx.ui.chooseDisplayLanguage(doc.displayLanguage);
  // Like Timezone, this changes no cell input: no history entry, no dirty
  // flag. setDisplayLanguage() itself invalidates every cached result so
  // TEXT()'s ddd/dddd tokens reflect the new language immediately.
  if (chosen !== null) {
    doc.setDisplayLanguage(chosen);
    ctx.state.emit('doc');
    ctx.ui.notify(
      t('notify.displayLanguageChanged', { language: t(`language.${doc.displayLanguage}`) }),
      'info',
    );
  }
}

/** Sheet ▸ File Version History…: restore a snapshot, or change the per-file settings. */
async function versionHistory(ctx: CommandContext, tab: Tab, doc: RsfDocument): Promise<void> {
  const choice = await ctx.ui.chooseVersionHistory(doc.historyEnabled, doc.historyMaxOverride, doc.history);
  if (!choice) {
    return;
  }
  if (choice.kind === 'restore') {
    await restoreVersion(ctx, tab, doc, choice.index);
    return;
  }
  const enabledChanged = choice.enabled !== doc.historyEnabled;
  const maxChanged = choice.maxOverride !== doc.historyMaxOverride;
  if (!enabledChanged && !maxChanged) {
    return;
  }
  // Like the lock flag, these are persisted in the saved container but
  // change no cell input, so they mark the document dirty without touching
  // the evaluation memo.
  if (enabledChanged) {
    doc.setHistoryEnabled(choice.enabled);
  }
  if (maxChanged) {
    doc.setHistoryMaxOverride(choice.maxOverride);
  }
  ctx.state.emit('doc');
  const key = enabledChanged
    ? choice.enabled
      ? 'notify.versionHistoryEnabled'
      : 'notify.versionHistoryDisabled'
    : 'notify.versionHistoryMaxUpdated';
  ctx.ui.notify(t(key), 'info');
}

async function restoreVersion(ctx: CommandContext, tab: Tab, doc: RsfDocument, index: number): Promise<void> {
  const snapshot = doc.history[index];
  if (!snapshot) {
    return;
  }
  const when = new Date(snapshot.timestamp).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
  const ok = await ctx.ui.confirm(
    t('dialog.restoreVersion.title'),
    t('dialog.restoreVersion.message', { when }),
    t('dialog.restoreVersion.ok'),
    t('dialog.restoreVersion.cancel'),
  );
  if (!ok) {
    return;
  }
  // A restore is a deliberate revert, not an edit: it is not itself undoable,
  // and the tab's existing undo/redo entries describe edits to the content
  // this call just replaced, so they are cleared rather than left to
  // (mis)apply against the restored content.
  if (doc.restoreFromSnapshot(index)) {
    tab.history.clear();
    ctx.state.emit('doc');
    ctx.state.emit('tabs');
    ctx.ui.notify(t('notify.versionRestored'), 'info');
  } else {
    ctx.ui.notify(t('notify.versionRestoreFailed'), 'error');
  }
}

async function clearVersionHistory(ctx: CommandContext, _tab: Tab, doc: RsfDocument): Promise<void> {
  if (doc.history.length === 0) {
    return;
  }
  const ok = await ctx.ui.confirm(
    t('dialog.clearVersionHistory.title'),
    t('dialog.clearVersionHistory.message', { n: doc.history.length }),
    t('dialog.delete.ok'),
    t('dialog.delete.cancel'),
  );
  if (ok) {
    doc.clearHistory();
    ctx.state.emit('doc');
    ctx.ui.notify(t('notify.versionHistoryCleared'), 'info');
  }
}

export const SHEET_COMMANDS = {
  'sheet.convert': withTab(
    (ctx, tab) => ctx.parts.fileIo.convertCommand(tab),
    (_, tab) => isCsv(tab.doc),
  ),
  'sheet.insertRowAbove': sheetOp('sheet.insertRowAbove', 'row'),
  'sheet.insertRowBelow': sheetOp('sheet.insertRowBelow', 'row'),
  'sheet.deleteRows': sheetOp('sheet.deleteRows', 'row'),
  'sheet.insertColLeft': sheetOp('sheet.insertColLeft', 'col'),
  'sheet.insertColRight': sheetOp('sheet.insertColRight', 'col'),
  'sheet.deleteCols': sheetOp('sheet.deleteCols', 'col'),
  // Appends at the very end of the sheet, so — unlike the selection-relative
  // insert commands — no selection is required.
  'sheet.addRow': withTab((ctx, tab) => ctx.parts.worksheets.appendAxis(tab, 'row')),
  'sheet.addColumn': withTab((ctx, tab) => ctx.parts.worksheets.appendAxis(tab, 'col')),
  'sheet.autoFitCols': {
    enabled: ({ tab }) => tab !== null && tab.selection !== null && isGridSurface(tab),
    run: (ctx) => ctx.commands.gridActions?.autoFitSelectedColumns(),
  },
  // Filter and Sort work on a CSV tab too, on screen only: the file is saved unchanged.
  'sheet.filter': { enabled: hasSelection, run: ({ tab, commands }) => tab && commands.filterDialog(tab) },
  'sheet.filterClear': withTab(
    (ctx, tab) => ctx.commands.clearAllFilters(tab),
    (_, tab) => tab.doc.filter !== null,
  ),
  'sheet.headerFilter': {
    enabled: (ctx) => hasSelection(ctx) || ctx.commands.hasFilter(ctx.tab),
    run: ({ tab, commands }) => tab && commands.toggleHeaderFilter(tab),
  },
  'sheet.sort': { enabled: hasSelection, run: ({ tab, commands }) => tab && commands.sortDialog(tab) },
  'sheet.sortClear': withTab(
    (ctx, tab) => ctx.commands.clearSort(tab),
    (_, tab) => tab.doc.sort !== null,
  ),
  // Recalculation drops every cached result and advances the clock the
  // volatile functions read. It changes no cell input, so the document does
  // not become dirty and nothing is pushed onto the undo history. A plain CSV
  // has no formulas and therefore nothing to recalculate.
  'sheet.recalculate': forWorkbook((ctx, _tab, doc) => {
    doc.recalculate();
    ctx.state.emit('doc');
    ctx.ui.notify(t('notify.recalculated'), 'info');
  }),
  // The timezone only affects TODAY()/NOW(), and the display language only
  // TEXT()'s ddd/dddd tokens, which only a spreadsheet document evaluates.
  'sheet.timezone': forWorkbook(chooseTimezone),
  'sheet.displayLanguage': forWorkbook(chooseDisplayLanguage),
  // Version history is an RSF-only, per-file setting; a plain CSV has no
  // container to record snapshots in.
  'sheet.versionHistory': forWorkbook(versionHistory),
  'sheet.clearVersionHistory': forWorkbook(clearVersionHistory, (doc) => doc.history.length > 0),
  'sheet.exportCsv': withTab(
    (ctx, tab) => ctx.commands.exportCsv(tab),
    (_, tab) => isWorkbook(tab.doc),
  ),
  // Unlike CSV (already the format for a CSV-kind tab), no tab kind is already
  // an .xlsx or .json file, so both kinds can export to either.
  'sheet.exportXlsx': withTab((ctx, tab) => ctx.commands.exportXlsx(tab)),
  'sheet.exportJson': withTab((ctx, tab) => ctx.commands.exportJson(tab)),
} satisfies Record<string, CommandSpec>;
