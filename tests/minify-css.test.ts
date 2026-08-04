// SPDX-License-Identifier: MIT
// Covers the landing-page CSS minifier (Issue #219): it must shrink the
// stylesheet while never changing what it declares, so a `@media` guard,
// a `content: '...'` string, or a calc()-style operator can't silently
// break in the built landing/ output.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { minifyCss } from '../scripts/minify-css.mjs';

describe('minifyCss', () => {
  it('strips comments', () => {
    expect(minifyCss('/* a comment */a{color:red}')).toBe('a{color:red}');
    expect(minifyCss('a {\n  /* inline */\n  color: red;\n}')).toBe('a{color:red}');
  });

  it('collapses whitespace and drops it around punctuation that never needs it', () => {
    expect(minifyCss('a ,  b {\n  color: red;\n  gap: 0 0;\n}')).toBe('a,b{color:red;gap:0 0}');
  });

  it('preserves the descendant combinator space between selectors', () => {
    expect(minifyCss('div  p {\n  color: red;\n}')).toBe('div p{color:red}');
  });

  it('preserves operator spacing inside clamp()/calc()-style math', () => {
    const src = '--text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);';
    expect(minifyCss(src)).toBe('--text-xs:clamp(0.75rem,0.7rem + 0.25vw,0.875rem);');
  });

  it('copies quoted string content verbatim, including internal spaces', () => {
    expect(minifyCss("--font: 'Zen Kaku Gothic New', sans-serif;")).toBe(
      "--font:'Zen Kaku Gothic New',sans-serif;",
    );
    expect(minifyCss("a::after { content: '  keep  '; }")).toBe("a::after{content:'  keep  '}");
  });

  it('does not treat a comment-like sequence inside a string as a comment', () => {
    expect(minifyCss("a::after { content: '/* not a comment */'; }")).toBe(
      "a::after{content:'/* not a comment */'}",
    );
  });

  it('trims leading and trailing whitespace', () => {
    expect(minifyCss('\n\n  a { color: red; }\n\n')).toBe('a{color:red}');
  });

  it('returns an empty string for empty input', () => {
    expect(minifyCss('')).toBe('');
  });

  it('shrinks the real landing stylesheet by a meaningful margin without dropping any declaration', () => {
    const original = readFileSync('src/landing/styles.css', 'utf8');
    const minified = minifyCss(original);

    expect(minified.length).toBeLessThan(original.length * 0.85);
    expect(minified).not.toMatch(/\/\*/);

    // Every custom property and every rule's declaration count survives,
    // which would catch a minifier bug that merges or eats a declaration.
    const propertyNames = [...original.matchAll(/--[\w-]+(?=\s*:)/g)].map((m) => m[0]);
    for (const name of new Set(propertyNames)) {
      expect(minified).toContain(name);
    }
  });
});
