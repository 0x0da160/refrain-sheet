// SPDX-License-Identifier: MIT
/**
 * Formula cells must never be italicized (italic hurts CJK legibility and is
 * easily confused with editing/placeholder states). jsdom does not apply
 * linked stylesheets and vitest stubs CSS imports, so this reads the
 * stylesheet source directly and asserts the relevant rules.
 */
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// vitest runs from the project root, so a cwd-relative path is stable.
const css = readFileSync('src/styles.css', 'utf8');

/** The declaration block for a CSS selector (first match). */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `missing rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe('formula typography', () => {
  it('reads the stylesheet source', () => {
    expect(css.length).toBeGreaterThan(1000);
  });

  it('formula cells are upright, never italic', () => {
    const body = ruleBody('.vcell.formula');
    expect(body).toMatch(/font-style:\s*normal/);
    expect(body).not.toMatch(/font-style:\s*italic/);
  });

  it('error cells stay upright (clear without color or italic alone)', () => {
    const body = ruleBody('.vcell.cell-error');
    expect(body).toMatch(/font-style:\s*normal/);
    expect(body).not.toMatch(/italic/);
  });

  it('the formula bar renders formulas upright', () => {
    const body = ruleBody('.formula-bar textarea');
    expect(body).toMatch(/font-style:\s*normal/);
  });

  it('formula differentiation does not rely on italic anywhere', () => {
    // No rule targeting a formula cell may set italic.
    expect(css).not.toMatch(/\.vcell\.formula[^{]*\{[^}]*italic/);
  });
});
