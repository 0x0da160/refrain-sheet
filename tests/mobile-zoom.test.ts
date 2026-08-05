// SPDX-License-Identifier: MIT
/**
 * iOS Safari auto-zooms the page when a focused text control's computed
 * font-size is under ~16px. jsdom does not apply linked stylesheets and
 * vitest stubs CSS imports, so this reads the stylesheet source directly and
 * asserts the narrow-viewport rule floors every dialog text control —
 * including `textarea` (e.g. the SQL query editor, the data-validation
 * list-values field) — to 16px, not just `input`/`select`.
 */
// `fs` is declared ambiently in tests/node-shims.d.ts (no @types/node needed).
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// vitest runs from the project root, so a cwd-relative path is stable.
const css = readFileSync('src/styles.css', 'utf8');

describe('mobile focus-zoom prevention', () => {
  it('floors every real dialog text control, including textarea, to 16px', () => {
    const match = /\.dialog-body input\[type='text'\][^{]*\{([^}]*)\}/.exec(css);
    expect(match, 'missing the dialog-body 16px-floor rule').not.toBeNull();
    expect(match![0]).toMatch(/\.dialog-body textarea/);
    expect(match![1]).toMatch(/font-size:\s*16px/);
  });
});
