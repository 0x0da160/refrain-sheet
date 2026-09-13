// SPDX-License-Identifier: MIT
// Guards the hosted/offline CSP split. The offline policy is pinned
// byte-for-byte because it is the mechanical form of the no-network guarantee
// in docs/security.md; the hosted policy may only ever differ from it by
// origins that were explicitly added to HOSTED_ALLOWLIST.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allowedOrigins, buildCsp, BUILD_MODES, HOSTED_ALLOWLIST } from '../scripts/csp.mjs';

// The exact policy that shipped before the split existed. This string moving
// means the offline artifact's permissions changed — never an incidental edit.
const OFFLINE_CSP =
  "default-src 'none'; script-src 'self' file: 'wasm-unsafe-eval'; style-src 'self' file:; img-src 'self' file: data:; font-src 'self' file:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

describe('offline CSP', () => {
  it('is byte-identical to the policy that shipped before the split', () => {
    expect(buildCsp('offline')).toBe(OFFLINE_CSP);
  });

  it('forbids every network connection', () => {
    const csp = buildCsp('offline');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/https?:/);
  });

  it('still permits local WebAssembly compilation', () => {
    expect(buildCsp('offline')).toContain("'wasm-unsafe-eval'");
  });

  it('never consults the hosted allowlist', () => {
    expect(allowedOrigins('offline')).toEqual([]);
  });
});

describe('hosted CSP', () => {
  it('grants no origin today, so it is identical to the offline policy', () => {
    expect(Object.values(HOSTED_ALLOWLIST).flat()).toEqual([]);
    expect(buildCsp('hosted')).toBe(buildCsp('offline'));
    expect(allowedOrigins('hosted')).toEqual([]);
  });

  it("replaces 'none' when a directive gains an origin, and leaves offline untouched", () => {
    // Simulates a future widening. The assertion that matters is the last one:
    // relaxing the hosted policy must not move the offline policy at all.
    const original = [...HOSTED_ALLOWLIST['connect-src']];
    try {
      HOSTED_ALLOWLIST['connect-src'].push('https://example.test');
      const hosted = buildCsp('hosted');
      expect(hosted).toContain('connect-src https://example.test');
      expect(hosted).not.toContain("connect-src 'none'");
      expect(buildCsp('offline')).toBe(OFFLINE_CSP);
    } finally {
      HOSTED_ALLOWLIST['connect-src'].length = 0;
      HOSTED_ALLOWLIST['connect-src'].push(...original);
    }
  });
});

describe('build modes', () => {
  it('offers exactly the offline and hosted modes', () => {
    expect([...BUILD_MODES]).toEqual(['offline', 'hosted']);
  });

  it('rejects an unknown mode rather than silently falling back', () => {
    expect(() => buildCsp('staging')).toThrow(/unknown build mode/);
  });
});

describe('index.html', () => {
  it('carries the placeholder instead of a hand-written policy', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('content="__CSP__"');
    // A second, hand-maintained copy of the policy is exactly the drift the
    // single source of truth exists to prevent.
    expect(html).not.toContain("default-src 'none'");
  });
});
