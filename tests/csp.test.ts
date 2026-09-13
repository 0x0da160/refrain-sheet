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
  it('grants only Google origins, and only ones on the allowlist', () => {
    const hosted = buildCsp('hosted');
    const allowed = allowedOrigins('hosted');
    expect(allowed.length).toBeGreaterThan(0);
    for (const origin of allowed) {
      expect(origin, `${origin} must be a Google origin`).toMatch(
        /^https:\/\/([a-z*.]+\.)?(google|googleapis|googleusercontent|gstatic)\.com$/,
      );
    }
    // Every origin the policy names must come from the allowlist — the same
    // invariant scripts/check-dist.mjs enforces against the built artifact.
    for (const origin of hosted.match(/https:\/\/[^\s;]+/g) ?? []) {
      expect(allowed, `${origin} is not allowlisted`).toContain(origin);
    }
  });

  it('never weakens a directive with a keyword instead of an origin', () => {
    // Origins are reviewable; 'unsafe-inline' / 'unsafe-eval' are not. The
    // Picker may want inline styles — that relaxation must be a deliberate,
    // separate decision, never something an origin edit drags in.
    const hosted = buildCsp('hosted');
    expect(hosted).not.toContain("'unsafe-inline'");
    expect(hosted).not.toContain("'unsafe-eval'");
    // 'wasm-unsafe-eval' is the pre-existing WebAssembly grant, not a widening.
    expect(hosted).toContain("'wasm-unsafe-eval'");
  });

  it('adds frame-src for the Picker iframe, which the offline policy never gains', () => {
    expect(buildCsp('hosted')).toContain('frame-src https://docs.google.com');
    // Offline keeps inheriting default-src 'none' for frames.
    expect(buildCsp('offline')).not.toContain('frame-src');
  });

  it('leaves the offline policy untouched despite a populated allowlist', () => {
    expect(Object.values(HOSTED_ALLOWLIST).flat().length).toBeGreaterThan(0);
    expect(buildCsp('offline')).toBe(OFFLINE_CSP);
    expect(allowedOrigins('offline')).toEqual([]);
  });

  it("replaces 'none' when a directive gains an origin, and leaves offline untouched", () => {
    // Simulates a future widening. The assertion that matters is the last one:
    // relaxing the hosted policy must not move the offline policy at all.
    // object-src still carries the bare 'none' keyword, so it shows the
    // replacement clearly. Simulates a future widening without shipping one.
    expect(HOSTED_ALLOWLIST['object-src']).toBeUndefined();
    try {
      HOSTED_ALLOWLIST['object-src'] = ['https://example.test'];
      const hosted = buildCsp('hosted');
      expect(hosted).toContain('object-src https://example.test');
      expect(hosted).not.toContain("object-src 'none'");
      // The assertion that matters: relaxing the hosted policy must not move
      // the offline policy by a single byte.
      expect(buildCsp('offline')).toBe(OFFLINE_CSP);
    } finally {
      delete HOSTED_ALLOWLIST['object-src'];
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
