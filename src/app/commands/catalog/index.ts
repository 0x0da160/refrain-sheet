// SPDX-License-Identifier: MIT
/**
 * The command catalog: every command id the application knows, grouped by
 * menu family. `CommandId` is derived from it, so a command cannot exist
 * without a definition. See `./types.ts` for what an entry holds.
 */
import { APP_COMMANDS } from './app';
import { DATA_COMMANDS } from './data';
import { EDIT_COMMANDS } from './edit';
import { FILE_COMMANDS } from './file';
import { FORMAT_COMMANDS } from './format';
import { SEARCH_COMMANDS } from './search';
import { SHEET_COMMANDS } from './sheet';
import type { CommandSpec } from './types';
import { VIEW_COMMANDS } from './view';
import { WORKSHEET_COMMANDS } from './worksheet';

const CATALOG = {
  ...FILE_COMMANDS,
  ...EDIT_COMMANDS,
  ...SEARCH_COMMANDS,
  ...SHEET_COMMANDS,
  ...FORMAT_COMMANDS,
  ...DATA_COMMANDS,
  ...WORKSHEET_COMMANDS,
  ...VIEW_COMMANDS,
  ...APP_COMMANDS,
};

export type CommandId = keyof typeof CATALOG;

/** Every command id, in catalog order. */
export const COMMAND_IDS = Object.keys(CATALOG) as CommandId[];

export function commandSpec(id: CommandId): CommandSpec {
  return CATALOG[id];
}
