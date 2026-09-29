// SPDX-License-Identifier: MIT
/**
 * The shape of one entry in the command catalog: everything the application
 * knows about a command id in one place — when it applies, why it does not,
 * and what it does. `Commands.isEnabled` / `disabledReason` / `run` look the
 * id up here instead of switching over it three times.
 *
 * Presentation (menu placement, icon, shortcut label) stays in the UI layer,
 * which the app layer never imports; `tests/app/command-catalog.test.ts`
 * checks that every catalog id is reachable from the UI and localized.
 */
import type { AppState, Tab } from '../../state';
import type { UiPort } from '../../ui-port';
import type { ConditionalFormatCommands } from '../conditional-format';
import type { CommentCommands } from '../comment';
import type { ValidationCommands } from '../data-validation';
import type { DiffCommands } from '../diff';
import type { DriveIoCommands } from '../drive-io';
import type { FileIoCommands } from '../file-io';
import type { FilterCommands } from '../filter';
import type { FormatCommands } from '../format';
import type { Commands } from '../index';
import type { ObjectCommands } from '../objects';
import type { PasteFillCommands } from '../paste-fill';
import type { RangeOpsCommands } from '../range-ops';
import type { SortCommands } from '../sort';
import type { SqlCommands } from '../sql';
import type { SheetFolderCommands } from '../sheet-folders';
import type { WorksheetCommands } from '../worksheets';

/** The feature controllers `Commands` composes, handed to catalog handlers. */
export interface CommandParts {
  readonly fileIo: FileIoCommands;
  /** Null in the offline build, which compiles Google Drive out. */
  readonly drive: DriveIoCommands | null;
  readonly filter: FilterCommands;
  readonly sort: SortCommands;
  readonly validation: ValidationCommands;
  readonly conditionalFormat: ConditionalFormatCommands;
  readonly comment: CommentCommands;
  readonly objects: ObjectCommands;
  readonly worksheets: WorksheetCommands;
  readonly folders: SheetFolderCommands;
  readonly pasteFill: PasteFillCommands;
  readonly rangeOps: RangeOpsCommands;
  readonly format: FormatCommands;
  readonly sql: SqlCommands;
  readonly diff: DiffCommands;
}

/** What a catalog entry sees when it is queried or run. */
export interface CommandContext {
  readonly commands: Commands;
  readonly parts: CommandParts;
  readonly state: AppState;
  readonly ui: UiPort;
  readonly dom: Document;
  /** The active tab at the moment of the query or run, or null. */
  readonly tab: Tab | null;
}

export interface CommandSpec {
  /** When the command currently makes sense (menu enabled state). Omitted: always. */
  enabled?(ctx: CommandContext): boolean;
  /**
   * Why a disabled command is disabled, when that is not self-evident from
   * context (no selection, no open tab). Consulted only while disabled.
   */
  disabledReason?(ctx: CommandContext): string | null;
  run(ctx: CommandContext): unknown;
}

/** A command that needs an open tab: run is a no-op without one. */
export function withTab(
  run: (ctx: CommandContext, tab: Tab) => unknown,
  enabled?: (ctx: CommandContext, tab: Tab) => boolean,
): CommandSpec {
  return {
    enabled: (ctx) => ctx.tab !== null && (enabled?.(ctx, ctx.tab) ?? true),
    run: (ctx) => (ctx.tab ? run(ctx, ctx.tab) : undefined),
  };
}

/** True when a tab is open. */
export function hasTab(ctx: CommandContext): boolean {
  return ctx.tab !== null;
}

/** True when the active tab has a selection. */
export function hasSelection(ctx: CommandContext): boolean {
  return ctx.tab?.selection != null;
}
