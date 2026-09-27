// SPDX-License-Identifier: MIT
// Moves the `## [Unreleased]` entries in CHANGELOG.md under a version heading.
//
//   node scripts/release/changelog.mjs release 1.2.3 [--date 2026-09-23]
//   node scripts/release/changelog.mjs sync
//   node scripts/release/changelog.mjs archive
//
// `release` is what `scripts/release/index.mjs` does inside every release commit: the
// entries collected under `[Unreleased]` become `## [1.2.3] - <date>` and a
// fresh, empty `[Unreleased]` heading is left above them.
//
// `sync` is the manual catch-up used by `.github/workflows/release-docs.yml`:
// when the current package.json version is already tagged but has no section
// yet (a release cut before this automation existed, or cut by hand), the
// pending entries are filed under that version, dated by its tag. Otherwise
// the entries belong to the next release and `sync` leaves the file alone.
//
// `archive` keeps CHANGELOG.md short: every version section outside the
// current MAJOR.MINOR series (package.json) moves, unchanged and newest first,
// into `docs/changelog/<MAJOR.MINOR>.md`, which CHANGELOG.md's "Older
// versions" section links to (the command rewrites that list). Run it once
// when a new minor series starts; running it again is a no-op.
//
// A release with no pending entries (purely internal changes) gets no section,
// as CHANGELOG.md § "Maintaining this file" describes. Nothing outside the
// `[Unreleased]` section is ever rewritten, and a version that already has a
// section is never written twice.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const VERSION_HEADING = /^## \[(\d+)\.(\d+)\.\d+\]/;

/** Splits a changelog into its preamble and its `## ` sections (each ending with a newline). */
function splitSections(text) {
  const parts = text.split(/\n(?=## )/);
  const preamble = parts[0].startsWith('## ') ? '' : parts.shift() + '\n';
  return { preamble, sections: parts.map((s) => s.replace(/\n*$/, '\n')) };
}

/** The header every archive file starts with. */
export function archiveHeader(series) {
  return (
    `# Changelog — ${series}.x\n\n` +
    `Archived release notes for the ${series}.x series, moved out of\n` +
    `[CHANGELOG.md](../../CHANGELOG.md) by \`node scripts/release/changelog.mjs archive\`.\n` +
    'The entries are unchanged from when they were written.\n'
  );
}

/**
 * Moves every version section outside the `currentVersion` MAJOR.MINOR series
 * out of the changelog. Returns the shortened changelog and, per series, the
 * archive file's new text (`existing[series]` is that file's current text, if
 * any; new sections go above the ones already archived, keeping newest
 * first). Non-version sections (`[Unreleased]`, notes) stay. Pure, so it is
 * unit-tested without touching the real files.
 */
export function archiveChangelog(text, currentVersion, existing = {}) {
  const current = SEMVER.exec(currentVersion);
  if (!current) throw new Error(`"${currentVersion}" is not a strict MAJOR.MINOR.PATCH version`);
  const currentSeries = `${current[1]}.${current[2]}`;
  const { preamble, sections } = splitSections(text);
  const kept = [];
  const moved = {};
  for (const section of sections) {
    const m = VERSION_HEADING.exec(section);
    const series = m && `${m[1]}.${m[2]}`;
    if (!series || series === currentSeries) kept.push(section);
    else (moved[series] ??= []).push(section);
  }
  const archives = {};
  for (const [series, list] of Object.entries(moved)) {
    const old = existing[series]
      ? splitSections(existing[series])
      : { preamble: archiveHeader(series), sections: [] };
    archives[series] = [old.preamble.replace(/\n*$/, '\n'), ...list, ...old.sections].join('\n');
  }
  return { changelog: preamble + kept.join('\n'), archives };
}

/**
 * Rewrites the body of the `## Older versions` section to link every archived
 * series, newest first (appending the section if it is missing).
 */
export function linkArchives(text, seriesList) {
  const order = (s) => s.split('.').map(Number);
  const sorted = [...seriesList].sort((a, b) => {
    const [am, an] = order(a);
    const [bm, bn] = order(b);
    return bm - am || bn - an;
  });
  const links = sorted.map((s) => `[${s}.x](docs/changelog/${s}.md)`).join(' ·\n');
  const section =
    '## Older versions\n\nEarlier series are archived, unchanged, one file per minor version:\n' +
    links +
    '.\n';
  const at = text.indexOf('\n## Older versions\n');
  if (at === -1) return text.replace(/\n*$/, '\n\n') + section;
  const next = text.indexOf('\n## ', at + 1);
  return text.slice(0, at + 1) + section + (next === -1 ? '' : text.slice(next));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
  if (command === 'archive') {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const archiveDir = join(root, 'docs', 'changelog');
    const text = readFileSync(changelogPath, 'utf8');
    const existing = {};
    for (const line of text.split('\n')) {
      const m = VERSION_HEADING.exec(line);
      const file = m && join(archiveDir, `${m[1]}.${m[2]}.md`);
      if (file && existsSync(file)) existing[`${m[1]}.${m[2]}`] = readFileSync(file, 'utf8');
    }
    const { changelog, archives } = archiveChangelog(text, version, existing);
    if (Object.keys(archives).length === 0) {
      console.warn(
        `changelog: only ${version.split('.').slice(0, 2).join('.')}.x sections remain; nothing to archive.`,
      );
      return;
    }
    mkdirSync(archiveDir, { recursive: true });
    for (const [series, body] of Object.entries(archives))
      writeFileSync(join(archiveDir, `${series}.md`), body);
    const all = readdirSync(archiveDir)
      .filter((f) => /^\d+\.\d+\.md$/.test(f))
      .map((f) => f.slice(0, -'.md'.length));
    writeFileSync(changelogPath, linkArchives(changelog, all));
    console.warn(`changelog: archived ${Object.keys(archives).join(', ')} into docs/changelog/.`);
    return;
  }
  die('usage: node scripts/release/changelog.mjs release <version> [--date YYYY-MM-DD] | sync | archive');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
