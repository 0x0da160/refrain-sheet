// SPDX-License-Identifier: MIT
// Changelog gate.
//
// CHANGELOG.md § "Maintaining this file" asks every pull request that changes
// user-visible behavior to add an entry under `[Unreleased]`. Between v0.6.2
// and v0.6.10 that convention lapsed silently, because nothing checked it
// (Issue #178). This script is the check.
//
// It fails a pull request that touches application source (`src/`, `wasm/src/`)
// without also touching CHANGELOG.md. Those two trees are an approximation of
// "user-visible", not a definition of it: a refactor under `src/` changes
// nothing a user can see, and CHANGELOG.md itself says purely internal changes
// need no entry. So the gate is deliberately escapable — put
//
//   Changelog: not-needed
//
// anywhere in the pull request title or description and it steps aside. The
// marker is plain text rather than a label, so it needs no permission to apply
// and stays visible in the pull request CI already reads.
//
// Everything the gate needs comes from the workflow event payload
// (GITHUB_EVENT_PATH) and the local git history, so `ci.yml` keeps its
// read-only `permissions: contents: read` and makes no API call.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHANGELOG = 'CHANGELOG.md';

// Application source. Tests live entirely under the top-level `tests/`, so
// nothing inside these trees needs to be exempted.
const APP_SOURCE = /^(?:src|wasm\/src)\//;

const OPT_OUT = /changelog:[ \t]*not-needed/i;

const die = (msg) => {
  console.error(`check-changelog: FAIL: ${msg}`);
  process.exit(1);
};

const skip = (msg) => {
  console.warn(`check-changelog: skipped: ${msg}`);
  process.exit(0);
};

/**
 * True when the changed set obliges the author to write a changelog entry:
 * it touches application source but leaves CHANGELOG.md alone. Pure, so the
 * decision can be unit-tested without a git repository or an event payload.
 */
export function needsChangelogEntry(changedFiles) {
  const files = changedFiles.filter(Boolean);
  return files.some((file) => APP_SOURCE.test(file)) && !files.includes(CHANGELOG);
}

/**
 * True when the pull request text carries the opt-out marker. Matched
 * case-insensitively and anywhere in the text, so it works in a checklist, a
 * trailer line, or a sentence.
 */
export function hasChangelogOptOut(prText) {
  return OPT_OUT.test(prText ?? '');
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * The files a pull request changes, taken from the merge commit that
 * `actions/checkout` leaves at HEAD for a `pull_request` event. Its first
 * parent is the base branch tip, so diffing that against HEAD is exactly the
 * pull request's net effect — unaffected by commits that landed on the base
 * branch after the branch was cut. Needs `fetch-depth: 2`.
 */
function changedFiles() {
  let parents;
  try {
    parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ');
  } catch (err) {
    die(`could not read HEAD: ${err.message}`);
  }
  if (parents.length < 3) {
    die(
      'HEAD is not a merge commit, so the pull request diff cannot be derived. ' +
        'Ensure the checkout step uses `fetch-depth: 2` on `pull_request`.',
    );
  }
  return git(['diff', '--name-only', parents[1], 'HEAD']).split('\n').filter(Boolean);
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    skip('not a pull_request event; the gate only applies to pull requests.');
  }

  // Fail closed from here on: a missing or unreadable payload means the gate
  // cannot do its job, which must not read as a pass.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) die('GITHUB_EVENT_PATH is not set, so the pull request cannot be inspected.');

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (err) {
    die(`could not read the event payload from ${eventPath}: ${err.message}`);
  }

  const pr = event.pull_request;
  if (!pr) die('the event payload carries no `pull_request` object.');

  if (hasChangelogOptOut(`${pr.title ?? ''}\n${pr.body ?? ''}`)) {
    skip('the pull request is marked `Changelog: not-needed`.');
  }

  const files = changedFiles();
  if (!needsChangelogEntry(files)) {
    console.warn(
      `check-changelog: ok: ${files.length} changed file(s) need no changelog entry, or one was added.`,
    );
    return;
  }

  const touched = files.filter((file) => APP_SOURCE.test(file));
  die(
    `this pull request changes application source but not ${CHANGELOG}:\n` +
      touched.map((file) => `  ${file}`).join('\n') +
      `\n\nAdd an entry under [Unreleased] in ${CHANGELOG} describing what a user\n` +
      'would notice. If this change is purely internal (a refactor, a test, CI,\n' +
      'or tooling with no user-visible effect), put `Changelog: not-needed` in the\n' +
      'pull request description instead.',
  );
}

// Only run as the CI gate when invoked directly, not when imported — this lets
// the tests exercise the pure helpers without touching git or the environment.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
