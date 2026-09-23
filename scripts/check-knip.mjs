// SPDX-License-Identifier: MIT
// Unused-code gate (Knip), for CI.
//
// Runs `knip --reporter json` with knip.jsonc and fails on any finding that
// is not on the DEFERRED list below — a new unused export, file, type,
// dependency, or binary. It also fails when a DEFERRED entry is no longer
// reported, so the list can never go stale and silently cover a future
// regression under the same name.
//
// DEFERRED holds findings that are known, classified, and intentionally left
// in place pending explicit human review (see docs/knip-baseline.md). They
// are listed one by one (file + issue type + name) rather than through a
// per-file knip.jsonc ignore, so a *new* unused export in the same file is
// still caught. Never add an entry here to make CI pass: classify the
// finding in docs/knip-baseline.md first (the cleanup-audit skill).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `<file>|<issue type>|<name>` — each needs a docs/knip-baseline.md entry. */
const DEFERRED = new Set([
  // S3 — RSF persisted-format contract; human review required (CLAUDE.md).
  ...[
    'RSF_COMPRESSION_STORE',
    'RSF_COMPRESSION_DEFLATE',
    'RSF_COMPRESSION_ZSTD',
    'RSF_COMPRESSION_LZ4',
    'RSF_METHODS',
    'RSF_CODEC_PROFILE',
    'MAX_RSF_ROWS',
    'MAX_RSF_COLS',
    'MAX_RSF_CELLS',
    'MAX_RSF_CELL_LENGTH',
    'MAX_RSF_COMMENT_BYTES',
    'MAX_RSF_BODY_BYTES',
    'RSF_WORKBOOK_BODY_VERSION',
    'MAX_RSF_SHEET_NAME_BYTES',
  ].map((name) => `src/core/rsf-codec.ts|exports|${name}`),
  'src/core/rsf-codec.ts|types|RsfWorksheetKind',
  'src/core/rsf-codec.ts|types|RsfDisplaySettings',
  'src/core/rsf-document.ts|exports|DEFAULT_SHEET_NAME',
  // Maintainer decision pending: wire the guard into a join function, or remove it.
  'src/core/formula-value.ts|exports|MAX_JOIN_ITEMS',
  'src/core/formula-value.ts|duplicates|MAX_RANGE_CELLS+MAX_JOIN_ITEMS',
]);

const run = spawnSync('npx', ['--no-install', 'knip', '--no-progress', '--reporter', 'json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error(`check-knip: FAIL: could not parse Knip's JSON output (exit ${run.status})`);
  console.error(run.stderr || run.stdout);
  process.exit(1);
}

const found = new Set();
for (const issue of report.issues) {
  for (const [type, items] of Object.entries(issue)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const name = Array.isArray(item) ? item.map((d) => d.name).join('+') : item.name;
      found.add(`${issue.file}|${type}|${name}`);
    }
  }
}

const unexpected = [...found].filter((key) => !DEFERRED.has(key)).sort();
const resolved = [...DEFERRED].filter((key) => !found.has(key)).sort();

for (const key of unexpected) console.error(`check-knip: FAIL: new finding ${key}`);
for (const key of resolved) {
  console.error(`check-knip: FAIL: deferred finding no longer reported, remove it from DEFERRED: ${key}`);
}
if (unexpected.length || resolved.length) {
  console.error(
    'check-knip: verify each new finding (docs/knip-baseline.md, cleanup-audit skill) — delete dead code, ' +
      'fix the Knip config for a real usage Knip cannot see, or classify it for human review.',
  );
  process.exit(1);
}
console.warn(
  `check-knip: ok: only the ${DEFERRED.size} deferred findings remain (see docs/knip-baseline.md)`,
);
