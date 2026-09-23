// SPDX-License-Identifier: MIT
// Guards the release-time changelog cut (scripts/changelog.mjs): the pending
// `[Unreleased]` entries move under the new version heading, a fresh empty
// `[Unreleased]` stays on top, and nothing else in the file changes.
import { describe, expect, it } from 'vitest';
import { hasVersionSection, releaseChangelog } from '../scripts/changelog.mjs';

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
