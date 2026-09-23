// SPDX-License-Identifier: MIT
/**
 * `.github/labels.yml` is the manual source of truth for the agent loop's
 * labels (no workflow syncs them). Every `agent:*` / `risk:*` / `type:*`
 * label a workflow, skill, or CLAUDE.md applies or checks must be defined
 * there, so a renamed or new label cannot silently diverge from it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const labelsYml = import.meta.glob('../.github/labels.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const users = import.meta.glob(
  ['../.github/workflows/*.yml', '../.claude/skills/*/SKILL.md', '../CLAUDE.md'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

const defined = new Set(
  (parse(Object.values(labelsYml)[0] as string) as Array<{ name: string }>).map((label) => label.name),
);
const LABEL_RE = /\b(?:agent|risk|type):[a-z][a-z-]*[a-z]\b/g;

describe('.github/labels.yml', () => {
  it('defines labels', () => {
    expect(defined.size).toBeGreaterThan(10);
  });

  it.each(Object.keys(users))('defines every label %s uses', (file) => {
    const used = [...new Set(users[file].match(LABEL_RE) ?? [])];
    expect(used.filter((label) => !defined.has(label))).toEqual([]);
  });
});
