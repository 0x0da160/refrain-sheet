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

const sources = import.meta.glob(['../src/**/*.ts', '!../src/wasm-gen/**'], {
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
});
