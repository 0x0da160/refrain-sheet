// SPDX-License-Identifier: MIT
// Guards the changelog gate's two decisions: whether a changed file set obliges
// an entry, and whether the pull request opted out. Both are pure, so they are
// tested directly, without a git repository or a workflow event payload.
import { describe, expect, it } from 'vitest';
import { hasChangelogOptOut, needsChangelogEntry } from '../scripts/check-changelog.mjs';

describe('needsChangelogEntry', () => {
  it('requires an entry when application source changed without one', () => {
    expect(needsChangelogEntry(['src/app/commands.ts'])).toBe(true);
    expect(needsChangelogEntry(['wasm/src/lib.rs'])).toBe(true);
  });

  it('is satisfied when CHANGELOG.md changed alongside the source', () => {
    expect(needsChangelogEntry(['src/app/commands.ts', 'CHANGELOG.md'])).toBe(false);
  });

  it('ignores changes outside the application source trees', () => {
    expect(needsChangelogEntry(['tests/formula.test.ts'])).toBe(false);
    expect(needsChangelogEntry(['.github/workflows/ci.yml', 'scripts/release.mjs'])).toBe(false);
    expect(needsChangelogEntry(['docs/security.md', 'README.md', 'package.json'])).toBe(false);
  });

  it('does not mistake a similarly named path for application source', () => {
    // Only `src/` and `wasm/src/` count; these merely start with the letters.
    expect(needsChangelogEntry(['srcs/thing.ts'])).toBe(false);
    expect(needsChangelogEntry(['docs/src/example.ts'])).toBe(false);
    expect(needsChangelogEntry(['wasm/Cargo.toml'])).toBe(false);
  });

  it('accepts an empty change set', () => {
    expect(needsChangelogEntry([])).toBe(false);
    expect(needsChangelogEntry([''])).toBe(false);
  });

  it('matches CHANGELOG.md only at the repository root', () => {
    expect(needsChangelogEntry(['src/app/commands.ts', 'docs/CHANGELOG.md'])).toBe(true);
  });
});

describe('hasChangelogOptOut', () => {
  it('recognizes the marker regardless of case or surrounding text', () => {
    expect(hasChangelogOptOut('Changelog: not-needed')).toBe(true);
    expect(hasChangelogOptOut('changelog: NOT-NEEDED')).toBe(true);
    expect(hasChangelogOptOut('## Summary\n\nInternal only.\n\nChangelog: not-needed\n')).toBe(true);
    expect(hasChangelogOptOut('Changelog:not-needed')).toBe(true);
  });

  it('does not fire on prose that merely mentions the changelog', () => {
    expect(hasChangelogOptOut('Updated the changelog.')).toBe(false);
    expect(hasChangelogOptOut('Changelog: added an entry for the spill fix')).toBe(false);
    expect(hasChangelogOptOut('')).toBe(false);
    expect(hasChangelogOptOut(null)).toBe(false);
    expect(hasChangelogOptOut(undefined)).toBe(false);
  });
});
