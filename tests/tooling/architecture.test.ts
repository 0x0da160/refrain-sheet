// SPDX-License-Identifier: MIT
/**
 * Structural guardrails for `src/` that ESLint's per-file rules cannot see:
 * the runtime import graph must be acyclic. Type-only imports are erased at
 * build time (and marked as such, per eslint.config.js's
 * consistent-type-imports rule), so they are excluded. Layer direction
 * (ui -> app -> core) is enforced by eslint.config.js; this test re-checks
 * it on the resolved graph so a relative path that slips past a lint glob
 * still fails. See knowledge/architecture/module-boundaries.md.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['../../src/**/*.ts', '!../../src/generated/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Resolve `spec` relative to `from` (both `../src/...` style keys). */
function resolve(from: string, spec: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  const base = parts.join('/');
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (candidate in sources) return candidate;
  }
  return null;
}

const RUNTIME_IMPORT = /^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+'(\.[^']+)'/gm;

function runtimeDeps(file: string): string[] {
  const deps: string[] = [];
  for (const [, clause, spec] of sources[file].matchAll(RUNTIME_IMPORT)) {
    // `import { type A, type B } from` is erased too.
    const names = clause
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (clause.startsWith('{') && names.length > 0 && names.every((n) => n.startsWith('type '))) continue;
    const target = resolve(file, spec);
    if (target) deps.push(target);
  }
  return deps;
}

const graph = new Map(Object.keys(sources).map((file) => [file, runtimeDeps(file)]));

function findCycles(): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (file: string): void => {
    state.set(file, 'visiting');
    stack.push(file);
    for (const dep of graph.get(file) ?? []) {
      if (state.get(dep) === 'visiting') cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (!state.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(file, 'done');
  };
  for (const file of graph.keys()) if (!state.has(file)) visit(file);
  return cycles;
}

const layerOf = (file: string): string => file.split('/')[2];

describe('src/ architecture', () => {
  it('finds the source files', () => {
    expect(graph.size).toBeGreaterThan(100);
  });

  it('has no runtime import cycles', () => {
    expect(findCycles().map((cycle) => cycle.join(' -> '))).toEqual([]);
  });

  it('keeps dependencies flowing inward (ui -> app -> core)', () => {
    const forbidden: Record<string, string[]> = { core: ['app', 'ui'], app: ['ui'] };
    const violations: string[] = [];
    for (const [file, deps] of graph) {
      for (const dep of deps) {
        if (forbidden[layerOf(file)]?.includes(layerOf(dep))) violations.push(`${file} -> ${dep}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps directory-module helpers from importing their own entry point', () => {
    // A helper beside `x/index.ts` exists so the entry point can shrink; it
    // must not reach back into it (the entry point composes the helpers).
    const violations: string[] = [];
    for (const [file, deps] of graph) {
      if (file.endsWith('/index.ts')) continue;
      const entry = `${file.split('/').slice(0, -1).join('/')}/index.ts`;
      if (entry in sources && deps.includes(entry)) violations.push(`${file} -> ${entry}`);
    }
    expect(violations).toEqual([]);
  });

  it('keeps the formula engine layered (knowledge/architecture/dependency-rules.md)', () => {
    // Lower rank = more basic. A module may import only modules of the same
    // or a lower rank, so the value model never learns about functions and
    // the function registry never learns about the parser or the workbook.
    const rank = (file: string): number | null => {
      const m = /\/src\/core\/(formula\/.*|workbook\/rsf-document\.ts)$/.exec(file);
      if (!m) return null;
      const path = m[1];
      if (path === 'formula/value.ts') return 0;
      if (/^formula\/(criteria|date|text|text-format)\.ts$/.test(path)) return 1;
      if (path.startsWith('formula/functions/')) return 2;
      if (/^formula\/(refs|tokenizer|ref-toggle)\.ts$/.test(path)) return 3;
      if (/^formula\/(parser|evaluator|rewrite|ref-scan|index)\.ts$/.test(path)) return 4;
      if (path === 'formula/spill.ts') return 5;
      if (path === 'workbook/rsf-document.ts') return 6;
      throw new Error(`unranked formula-engine module: ${path}`);
    };
    const violations: string[] = [];
    for (const [file, deps] of graph) {
      const own = rank(file);
      if (own === null) continue;
      for (const dep of deps) {
        const theirs = rank(dep);
        if (theirs !== null && theirs > own)
          violations.push(`${file} (rank ${own}) -> ${dep} (rank ${theirs})`);
      }
    }
    expect(violations).toEqual([]);
  });
});
