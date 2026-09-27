// SPDX-License-Identifier: MIT
/**
 * The command catalog (`src/app/commands/catalog/`) is the single definition
 * of every command id; the UI decides where each one appears. These checks
 * keep the two in step: every id is reachable from some UI entry point
 * (menu, shortcut, context menu, strip, welcome screen) — a command nothing
 * can run is dead code.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_IDS } from '../../src/app/commands';

const entryPoints = import.meta.glob(
  ['../../src/ui/**/*.ts', '../../src/app/shortcuts.ts', '../../src/main.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

/** True when `source` names `id` literally, or builds it from a template (`view.zoom.${level}`). */
function mentioned(source: string, id: string): boolean {
  const prefix = id.slice(0, id.lastIndexOf('.') + 1);
  return source.includes(`'${id}'`) || source.includes(`\`${prefix}\${`);
}

describe('command catalog', () => {
  it('defines each id once', () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
  });

  it('makes every command reachable from the UI', () => {
    const sources = Object.values(entryPoints);
    const unreachable = COMMAND_IDS.filter((id) => !sources.some((source) => mentioned(source, id)));
    expect(unreachable).toEqual([]);
  });
});
