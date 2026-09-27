// SPDX-License-Identifier: MIT
// Guards the release-time changelog cut (scripts/release/changelog.mjs): the pending
// `[Unreleased]` entries move under the new version heading, a fresh empty
// `[Unreleased]` stays on top, and nothing else in the file changes.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  archiveChangelog,
  archiveHeader,
  hasVersionSection,
  linkArchives,
  releaseChangelog,
} from '../../scripts/release/changelog.mjs';

const HEAD = '# Changelog\n\nPreamble.\n\n';
const OLD = '## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old fix.\n';
const PENDING = '## [Unreleased]\n\n### Added\n\n- New thing\n  over two lines.\n\n### Fixed\n\n- A bug.\n\n';

describe('releaseChangelog', () => {
  it('files the pending entries under the new version and keeps an empty Unreleased', () => {
    expect(releaseChangelog(HEAD + PENDING + OLD, '1.1.0', '2026-02-03')).toBe(
      HEAD +
        '## [Unreleased]\n\n## [1.1.0] - 2026-02-03\n\n' +
        '### Added\n\n- New thing\n  over two lines.\n\n### Fixed\n\n- A bug.\n\n' +
        OLD,
    );
  });

  it('works when Unreleased is the last section', () => {
    expect(releaseChangelog(HEAD + '## [Unreleased]\n\n- Only.\n', '0.1.0', '2026-02-03')).toBe(
      HEAD + '## [Unreleased]\n\n## [0.1.0] - 2026-02-03\n\n- Only.\n\n',
    );
  });

  it('returns null when nothing is pending, so internal-only releases get no section', () => {
    expect(releaseChangelog(HEAD + '## [Unreleased]\n\n' + OLD, '1.1.0', '2026-02-03')).toBeNull();
    expect(
      releaseChangelog(HEAD + '## [Unreleased]\n\n### Added\n\n' + OLD, '1.1.0', '2026-02-03'),
    ).toBeNull();
  });

  it('never writes a version that already has a section', () => {
    expect(releaseChangelog(HEAD + PENDING + OLD, '1.0.0', '2026-02-03')).toBeNull();
    expect(hasVersionSection(OLD, '1.0.0')).toBe(true);
    expect(hasVersionSection(OLD, '1.0.1')).toBe(false);
  });

  it('refuses malformed input rather than guessing', () => {
    expect(() => releaseChangelog(HEAD + OLD, '1.1.0', '2026-02-03')).toThrow(/Unreleased/);
    expect(() => releaseChangelog(HEAD + PENDING + PENDING, '1.1.0', '2026-02-03')).toThrow(/more than one/);
    expect(() => releaseChangelog(HEAD + PENDING, 'v1.1', '2026-02-03')).toThrow(/version/);
    expect(() => releaseChangelog(HEAD + PENDING, '1.1.0', '3 Feb')).toThrow(/date/);
  });
});

describe('archiveChangelog', () => {
  const S = (v: string) => `## [${v}] - 2026-01-01\n\n- Entry for ${v}.\n`;
  const NOTE = '## Older versions\n\nLinks.\n';
  const text =
    HEAD + '## [Unreleased]\n\n' + [S('1.2.1'), S('1.2.0'), S('1.1.3'), S('0.9.0'), NOTE].join('\n');

  it('keeps the current series and moves every other one, newest first', () => {
    const { changelog, archives } = archiveChangelog(text, '1.2.1');
    expect(changelog).toBe(HEAD + '## [Unreleased]\n\n' + [S('1.2.1'), S('1.2.0'), NOTE].join('\n'));
    expect(archives).toEqual({
      '1.1': archiveHeader('1.1') + '\n' + S('1.1.3'),
      '0.9': archiveHeader('0.9') + '\n' + S('0.9.0'),
    });
  });

  it('puts newly archived sections above the ones already in an archive file', () => {
    const existing = { '1.1': archiveHeader('1.1') + '\n' + S('1.1.0') };
    const { archives } = archiveChangelog(text, '1.2.1', existing);
    expect(archives['1.1']).toBe(archiveHeader('1.1') + '\n' + S('1.1.3') + '\n' + S('1.1.0'));
  });

  it('is a no-op once only the current series remains', () => {
    const { changelog } = archiveChangelog(text, '1.2.1');
    expect(archiveChangelog(changelog, '1.2.1')).toEqual({ changelog, archives: {} });
  });

  it('rewrites the Older versions links newest first', () => {
    expect(linkArchives(HEAD + NOTE, ['0.9', '1.10', '1.2'])).toBe(
      HEAD +
        '## Older versions\n\nEarlier series are archived, unchanged, one file per minor version:\n' +
        '[1.10.x](docs/changelog/1.10.md) ·\n[1.2.x](docs/changelog/1.2.md) ·\n[0.9.x](docs/changelog/0.9.md).\n',
    );
  });
});

describe('the committed changelog', () => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;

  it('holds only the current minor series; older ones are archived and linked', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    expect(archiveChangelog(changelog, version).archives).toEqual({});
    const series = readdirSync('docs/changelog').map((f) => f.replace(/\.md$/, ''));
    expect(linkArchives(changelog, series)).toBe(changelog);
  });
});
