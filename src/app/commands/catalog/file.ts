// SPDX-License-Identifier: MIT
/** File and Google Drive commands (`file.*`, `drive.*`). */
import { isCsv } from '../../../core/editor-document';
import { KEEP_SAVE_OPTIONS } from '../../../core/csv/serializer';
import { fileSystemAccessAvailable, pickFiles } from '../../file-access';
import { getMaxFileSize } from '../../settings';
import { withTab, type CommandContext, type CommandSpec } from './types';

const driveAvailable = (ctx: CommandContext): boolean => ctx.commands.driveAvailable();

export const FILE_COMMANDS = {
  'file.new': { run: (ctx) => ctx.commands.newDocument() },
  'file.newCsv': { run: (ctx) => ctx.commands.newCsvDocument() },
  'file.open': {
    run: async (ctx) => {
      const files = await pickFiles(ctx.dom, getMaxFileSize());
      await ctx.commands.openFiles(files, { confirmNonCsv: false });
    },
  },
  'file.importJsonTable': {
    run: async (ctx) => {
      const files = await pickFiles(ctx.dom, getMaxFileSize());
      await ctx.parts.fileIo.opening.importJsonTables(files);
    },
  },
  'file.openRecent': {
    // Only the File System Access API gives the app a file it can reopen.
    enabled: () => fileSystemAccessAvailable(),
    run: (ctx) => ctx.parts.fileIo.openRecent(),
  },
  'file.reopen': withTab(
    (ctx, tab) => ctx.parts.fileIo.reopen(tab),
    (_, tab) => isCsv(tab.doc),
  ),
  'file.toggleProtect': withTab((ctx, tab) => ctx.state.setReadOnly(tab, !tab.readOnly)),
  'file.save': withTab((ctx, tab) => ctx.commands.save(tab, KEEP_SAVE_OPTIONS)),
  'file.saveOptions': withTab(
    (ctx, tab) => ctx.parts.fileIo.saveWithOptions(tab),
    // Encoding/EOL/BOM options; an .rsf file has nothing to choose.
    (_, tab) => isCsv(tab.doc),
  ),
  // The panel prints through the browser's own print, which also saves PDFs.
  'file.print': withTab((ctx) => ctx.commands.panelActions?.openPrint()),
  'file.closeTab': withTab((ctx, tab) => ctx.commands.closeTab(tab)),
  'drive.open': {
    enabled: driveAvailable,
    run: (ctx) => ctx.parts.drive?.open(),
  },
  'drive.save': withTab(
    (ctx, tab) => ctx.parts.drive?.save(tab),
    (ctx) => driveAvailable(ctx),
  ),
  'drive.saveAs': withTab(
    (ctx, tab) => ctx.parts.drive?.saveAs(tab),
    (ctx) => driveAvailable(ctx),
  ),
  'drive.signOut': {
    enabled: (ctx) => driveAvailable(ctx) && ctx.commands.driveSignedIn(),
    run: (ctx) => ctx.parts.drive?.signOut(),
  },
} satisfies Record<string, CommandSpec>;
