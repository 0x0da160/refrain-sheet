// SPDX-License-Identifier: MIT
// Version-consistency gate.
//
// The application version is defined once in package.json (src/app/version.ts
// imports it, so app-visible strings never hard-code a number). This script
// fails when any *other* version source drifts out of sync:
//
//   1. package.json `version` is a strict SemVer MAJOR.MINOR.PATCH,
//   2. package-lock.json agrees at both the root and the packages[""] entry,
//   3. (optional) a release tag passed via `--tag vX.Y.Z` exactly matches
//      `v<package.json version>`.
//
// The WASM core crate (wasm/Cargo.toml) is an internal library with its own
// independent version and is intentionally NOT tied to the app version; it is
// reported for visibility but never gates the check. Run in CI and by the
// release script before a tag is ever created.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`check-versions: FAIL: ${msg}`);
};
const ok = (msg) => console.warn(`check-versions: ok: ${msg}`);

const pkg = readJson('package.json');
const version = pkg.version;

if (typeof version !== 'string' || !SEMVER.test(version)) {
  fail(`package.json version "${version}" is not a strict MAJOR.MINOR.PATCH SemVer`);
}

// package-lock.json must agree at both places npm records the version.
let lock;
try {
  lock = readJson('package-lock.json');
} catch {
  fail('package-lock.json is missing or not valid JSON (it must be committed)');
}
if (lock) {
  if (lock.version !== version) {
    fail(
      `package-lock.json root version "${lock.version}" != package.json "${version}" — run \`npm install --package-lock-only --ignore-scripts\``,
    );
  } else {
    ok(`package-lock.json root version matches (${version})`);
  }
  const rootPkgEntry = lock.packages && lock.packages[''];
  if (rootPkgEntry && rootPkgEntry.version !== version) {
    fail(`package-lock.json packages[""].version "${rootPkgEntry.version}" != package.json "${version}"`);
  } else if (rootPkgEntry) {
    ok('package-lock.json packages[""] version matches');
  }
}

// Report (do not gate on) the internal WASM crate version.
try {
  const cargo = read('wasm/Cargo.toml');
  const crateVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  if (crateVersion) {
    ok(`internal WASM core crate version is ${crateVersion} (independent of the app version, by design)`);
  }
} catch {
  // The Cargo manifest is optional context; its absence never fails the check.
}

// Optional strict tag match: `node scripts/check-versions.mjs --tag v1.2.3`.
const tagArgIndex = process.argv.indexOf('--tag');
if (tagArgIndex !== -1) {
  const tag = process.argv[tagArgIndex + 1];
  const expected = `v${version}`;
  if (tag !== expected) {
    fail(`release tag "${tag}" does not match package.json version "${expected}"`);
  } else {
    ok(`release tag matches package.json (${expected})`);
  }
}

if (failures > 0) {
  console.error(`check-versions: ${failures} inconsistency(ies) found`);
  process.exit(1);
}
console.warn(`check-versions: all version sources are consistent (v${version})`);
