// SPDX-License-Identifier: MIT
/**
 * Every production dependency bundled into the build must carry a license
 * notice in THIRD-PARTY-NOTICES.md, which the release ZIP ships. The `yaml`
 * package was once bundled without one; this keeps the two lists in step.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import noticesRaw from '../THIRD-PARTY-NOTICES.md?raw';

// A section heading is the package name, optionally followed by a note, e.g.
// `## sql.js (and SQLite)`. Maps package name -> that section's body.
const sections = new Map(
  noticesRaw
    .split('\n## ')
    .slice(1)
    .map((chunk) => [chunk.split(/[\s\n]/, 1)[0], chunk] as const),
);

describe('THIRD-PARTY-NOTICES.md', () => {
  it.each(Object.keys(pkg.dependencies))('has a section for the production dependency %s', (name) => {
    expect(sections.has(name)).toBe(true);
  });

  it.each(Object.entries(pkg.dependencies))(
    'states the pinned version of %s when it is pinned exactly',
    (name, range) => {
      if (!/^\d+\.\d+\.\d+$/.test(range)) return;
      expect(sections.get(name) ?? '').toContain(`- Version: ${range}`);
    },
  );
});
