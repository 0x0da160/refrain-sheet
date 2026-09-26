// SPDX-License-Identifier: MIT
// Guards the EOL gate (scripts/check-eol.mjs) and the full SBOM it reads
// (scripts/sbom.mjs): the committed register must describe exactly the
// SBOM's direct and toolchain components, and each date rule must fire.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateEol, trackedKeys, type EolRegister } from '../scripts/check-eol.mjs';
import { buildSbom, collectInventory, cycleOf } from '../scripts/sbom.mjs';

const tracked = (...keys: string[]) => new Map(keys.map((k) => [k, new Set(['package.json'])]));

describe('cycleOf', () => {
  it('uses the SemVer major, or 0.minor below 1', () => {
    expect(cycleOf('8.3.1')).toBe('8');
    expect(cycleOf('v7')).toBe('7');
    expect(cycleOf('0.35.4')).toBe('0.35');
    expect(cycleOf('24')).toBe('24');
  });
});

describe('full SBOM', () => {
  const sbom = buildSbom(collectInventory());

  it('covers npm, Rust crates, toolchains and GitHub Actions', () => {
    const purls = sbom.components.map((c) => c.purl);
    expect(purls.some((p) => p.startsWith('pkg:npm/vite@'))).toBe(true);
    expect(purls.some((p) => p.startsWith('pkg:cargo/ruzstd@'))).toBe(true);
    expect(purls.some((p) => p.startsWith('pkg:generic/rust@'))).toBe(true);
    expect(purls.some((p) => p.startsWith('pkg:generic/nodejs@'))).toBe(true);
    expect(purls.some((p) => p.startsWith('pkg:github/actions/checkout@'))).toBe(true);
  });

  it('is described exactly by the committed EOL register', () => {
    const register = JSON.parse(readFileSync('docs/eol-register.json', 'utf8')) as EolRegister;
    // A fixed date inside the review window: only structural findings count here.
    const { failures } = evaluateEol(register, trackedKeys(sbom), register.reviewed as string);
    expect(failures).toEqual([]);
  });
});

describe('evaluateEol', () => {
  const base = { reviewed: '2026-09-01', reviewIntervalDays: 92, warnWithinDays: 180 };

  it('fails on a tracked component without an entry, and on a stale entry', () => {
    const register = { ...base, components: { 'npm:vite@7': { eol: null, plan: null } } };
    const { failures } = evaluateEol(register, tracked('npm:vite@8'), '2026-09-02');
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain('npm:vite@8');
    expect(failures[1]).toContain('stale');
  });

  it('reports a past EOL, and a near EOL without a plan, as overdue', () => {
    const register = {
      ...base,
      components: {
        'generic:nodejs@20': { eol: '2026-04-30', plan: null },
        'generic:nodejs@22': { eol: '2027-01-31', plan: null },
        'generic:nodejs@24': { eol: '2028-04-30', plan: null },
      },
    };
    const keys = tracked('generic:nodejs@20', 'generic:nodejs@22', 'generic:nodejs@24');
    const { failures, overdue } = evaluateEol(register, keys, '2026-09-02');
    expect(failures).toEqual([]);
    expect(overdue).toHaveLength(2);
    expect(overdue[0]).toContain('reached end of life');
    expect(overdue[1]).toContain('has no plan');
  });

  it('accepts a near EOL with a plan, until the plan is overdue', () => {
    const register = {
      ...base,
      components: {
        'generic:nodejs@22': { eol: '2027-01-31', plan: { action: 'Move to 24', due: '2026-10-31' } },
      },
    };
    const keys = tracked('generic:nodejs@22');
    expect(evaluateEol(register, keys, '2026-09-02').overdue).toEqual([]);
    expect(evaluateEol(register, keys, '2026-09-02').warnings).toHaveLength(1);
    expect(evaluateEol(register, keys, '2026-11-01').overdue[0]).toContain('was due 2026-10-31');
  });

  it('reports an overdue periodic review', () => {
    const register = { ...base, components: {} };
    expect(evaluateEol(register, tracked(), '2026-12-01').overdue).toEqual([]);
    expect(evaluateEol(register, tracked(), '2026-12-03').overdue[0]).toContain('review is overdue');
  });
});
