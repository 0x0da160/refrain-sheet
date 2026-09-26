// SPDX-License-Identifier: MIT
// End-of-life gate: every direct dependency and toolchain component in the
// full SBOM (scripts/sbom.mjs) must have a lifecycle entry in
// docs/eol-register.json, and nothing may be past its end of life, near it
// without a plan, behind a missed plan date, or unreviewed for too long.
//
// Fails when:
//   - an SBOM component (scope direct/toolchain) has no register entry —
//     keyed `<ecosystem>:<name>@<cycle>`, so a major upgrade needs its new
//     cycle recorded and the old entry removed;
//   - a register entry matches nothing in the SBOM (stale);
//   - a component is past its `eol` date;
//   - a component reaches `eol` within `warnWithinDays` and has no `plan`;
//   - a `plan.due` date has passed (the plan was not carried out — do it, or
//     re-plan with a reason);
//   - the register's `reviewed` date is older than `reviewIntervalDays`
//     (the periodic EOL review is overdue).
// Warns (without failing) on every open plan, so it stays visible.
//
// The last four are "overdue" findings: they depend on today's date, not on
// the change under test. Pull-request CI passes `--overdue-as-warning` so a
// missed date annotates every pull request without blocking unrelated work;
// the weekly maintenance workflow (and a plain local run) fails on them.
//
// Offline and deterministic apart from today's date. `--today YYYY-MM-DD`
// overrides the date; `--no-fail` reports without a failing exit code (the
// session-start hook uses it to surface findings to the agent).
// Policy: knowledge/operations/dependency-lifecycle.md.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSbom, collectInventory } from './sbom.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** `<ecosystem>:<name>@<cycle>` for every direct/toolchain component of a CycloneDX SBOM built by scripts/sbom.mjs. */
export function trackedKeys(sbom) {
  const keys = new Map();
  for (const c of sbom.components) {
    const prop = (n) => c.properties.filter((p) => p.name === n).map((p) => p.value);
    const scope = prop('refrain:scope')[0];
    if (scope !== 'direct' && scope !== 'toolchain') continue;
    const ecosystem = c.purl.slice('pkg:'.length, c.purl.indexOf('/'));
    const key = `${ecosystem}:${c.name}@${prop('refrain:cycle')[0]}`;
    const sources = keys.get(key) ?? new Set();
    for (const s of prop('refrain:source')) sources.add(s);
    keys.set(key, sources);
  }
  return keys;
}

/**
 * Pure evaluation of the register against the tracked keys on `today`
 * (ISO date). Returns `{ failures, overdue, warnings }` (string arrays):
 * `failures` are structural (the register does not describe the SBOM),
 * `overdue` are date-driven (EOL passed or near without a plan, plan or
 * review date missed), `warnings` list the open plans.
 */
export function evaluateEol(register, tracked, today) {
  const failures = [];
  const overdue = [];
  const warnings = [];
  const now = toTime(today);
  const components = register.components ?? {};
  const warnDays = register.warnWithinDays ?? 180;

  if (!ISO_DATE.test(register.reviewed ?? '')) {
    failures.push('docs/eol-register.json: `reviewed` must be an ISO date (YYYY-MM-DD)');
  } else {
    const dueAt = toTime(register.reviewed) + (register.reviewIntervalDays ?? 92) * DAY;
    if (now > dueAt) {
      const due = new Date(dueAt).toISOString().slice(0, 10);
      overdue.push(
        `the periodic EOL review is overdue (last reviewed ${register.reviewed}, due ${due}): ` +
          'review every entry, update docs/eol-plan.md and bump `reviewed`',
      );
    }
  }

  for (const [key, sources] of tracked) {
    if (!(key in components)) {
      failures.push(
        `${key} (${[...sources].join(', ')}) has no entry in docs/eol-register.json — record its lifecycle (eol, support, plan)`,
      );
    }
  }

  for (const [key, entry] of Object.entries(components)) {
    if (!tracked.has(key)) {
      failures.push(`${key} is in docs/eol-register.json but no longer in the SBOM — remove the stale entry`);
      continue;
    }
    if (entry.eol !== null && entry.eol !== undefined) {
      if (!ISO_DATE.test(entry.eol)) {
        failures.push(`${key}: eol "${entry.eol}" must be an ISO date or null`);
        continue;
      }
      const days = Math.round((toTime(entry.eol) - now) / DAY);
      if (days < 0) {
        overdue.push(`${key} reached end of life on ${entry.eol} — upgrade it`);
      } else if (days <= warnDays && !entry.plan) {
        overdue.push(`${key} reaches end of life on ${entry.eol} (in ${days} days) and has no plan`);
      }
    }
    if (entry.plan) {
      if (!ISO_DATE.test(entry.plan.due ?? '') || !entry.plan.action) {
        failures.push(`${key}: plan needs an \`action\` and an ISO \`due\` date`);
      } else if (toTime(entry.plan.due) < now) {
        overdue.push(`${key}: planned action was due ${entry.plan.due} — ${entry.plan.action}`);
      } else {
        warnings.push(`${key}: due ${entry.plan.due} — ${entry.plan.action}`);
      }
    }
  }
  return { failures, overdue, warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const todayIndex = process.argv.indexOf('--today');
  const today = todayIndex === -1 ? new Date().toISOString().slice(0, 10) : process.argv[todayIndex + 1];
  const noFail = process.argv.includes('--no-fail');
  const overdueAsWarning = process.argv.includes('--overdue-as-warning');
  const register = JSON.parse(readFileSync(join(root, 'docs', 'eol-register.json'), 'utf8'));
  const tracked = trackedKeys(buildSbom(collectInventory(root)));
  const { failures, overdue, warnings } = evaluateEol(register, tracked, today);

  for (const w of warnings) console.warn(`check-eol: planned: ${w}`);
  if (overdueAsWarning) {
    // A GitHub Actions annotation, so the finding shows on the pull request.
    for (const o of overdue) console.warn(`::warning title=EOL overdue::${o}`);
  } else {
    failures.push(...overdue);
  }
  for (const f of failures) console.error(`check-eol: FAIL: ${f}`);
  if (failures.length > 0) {
    console.error(
      `check-eol: ${failures.length} finding(s) as of ${today} — see knowledge/operations/dependency-lifecycle.md`,
    );
    process.exit(noFail ? 0 : 1);
  }
  console.warn(
    overdue.length > 0
      ? `check-eol: ok: register matches the SBOM (${tracked.size} components); ${overdue.length} overdue finding(s) reported as warnings`
      : `check-eol: ok: ${tracked.size} components tracked, none past or near EOL without a plan (${today})`,
  );
}
