// SPDX-License-Identifier: MIT
// Moves the `## [Unreleased]` entries in CHANGELOG.md under a version heading.
//
//   node scripts/changelog.mjs release 1.2.3 [--date 2026-09-23]
//   node scripts/changelog.mjs sync
//
// `release` is what `scripts/release.mjs` does inside every release commit: the
// entries collected under `[Unreleased]` become `## [1.2.3] - <date>` and a
// fresh, empty `[Unreleased]` heading is left above them.
//
// `sync` is the manual catch-up used by `.github/workflows/release-docs.yml`:
// when the current package.json version is already tagged but has no section
// yet (a release cut before this automation existed, or cut by hand), the
// pending entries are filed under that version, dated by its tag. Otherwise
// the entries belong to the next release and `sync` leaves the file alone.
//
// A release with no pending entries (purely internal changes) gets no section,
// as CHANGELOG.md § "Maintaining this file" describes. Nothing outside the
// `[Unreleased]` section is ever rewritten, and a version that already has a
// section is never written twice.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNRELEASED = '## [Unreleased]';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when CHANGELOG.md already has a `## [version]` section. */
export function hasVersionSection(text, version) {
  return text.split('\n').some((line) => line.startsWith(`## [${version}]`));
}

/**
 * Returns the changelog with the `[Unreleased]` entries filed under
 * `## [version] - date`, or `null` when there is nothing to file (no pending
 * entry, or the version already has a section). Pure, so it is unit-tested
 * without touching the real file.
 */
export function releaseChangelog(text, version, date) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a strict MAJOR.MINOR.PATCH version`);
  if (!DATE.test(date)) throw new Error(`"${date}" is not a YYYY-MM-DD date`);
  const start = text.indexOf(`${UNRELEASED}\n`);
  if (start === -1) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`);
  if (text.indexOf(`${UNRELEASED}\n`, start + 1) !== -1) {
    throw new Error(`CHANGELOG.md has more than one "${UNRELEASED}" heading`);
  }
  const bodyStart = start + UNRELEASED.length + 1;
  const next = text.indexOf('\n## ', bodyStart - 1);
  const bodyEnd = next === -1 ? text.length : next + 1;
  const body = text.slice(bodyStart, bodyEnd).trim();

  if (!/^- /m.test(body) || hasVersionSection(text, version)) return null;

  return (
    text.slice(0, start) +
    `${UNRELEASED}\n\n## [${version}] - ${date}\n\n${body}\n\n` +
    text.slice(bodyEnd).replace(/^\n+/, '')
  );
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = join(root, 'CHANGELOG.md');

function die(message) {
  console.error(`changelog: ${message}`);
  process.exit(1);
}

function write(version, date) {
  const text = readFileSync(changelogPath, 'utf8');
  let updated;
  try {
    updated = releaseChangelog(text, version, date);
  } catch (err) {
    die(err.message);
  }
  if (updated === null) {
    console.warn(
      hasVersionSection(text, version)
        ? `changelog: [${version}] already has a section; nothing to do.`
        : `changelog: no pending [Unreleased] entries; ${version} gets no section.`,
    );
    return false;
  }
  writeFileSync(changelogPath, updated);
  console.warn(`changelog: filed the [Unreleased] entries under [${version}] - ${date}.`);
  return true;
}

function main(argv) {
  const [command, ...rest] = argv;
  const today = new Date().toISOString().slice(0, 10);
  if (command === 'release') {
    const version = (rest[0] ?? '').replace(/^v/, '');
    const dateAt = rest.indexOf('--date');
    write(version, dateAt === -1 ? today : rest[dateAt + 1]);
    return;
  }
  if (command === 'sync') {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    let date;
    try {
      date = execFileSync('git', ['log', '-1', '--format=%cs', `refs/tags/v${version}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      console.warn(`changelog: v${version} is not tagged yet; pending entries stay under [Unreleased].`);
      return;
    }
    write(version, date);
    return;
  }
  die('usage: node scripts/changelog.mjs release <version> [--date YYYY-MM-DD] | sync');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
