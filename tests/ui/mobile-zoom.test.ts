// SPDX-License-Identifier: MIT
/**
 * iOS Safari auto-zooms the page when a focused text control's computed
 * font-size is under ~16px. jsdom does not apply linked stylesheets and
 * vitest stubs CSS imports, so this reads the stylesheet source directly and
 * asserts the narrow-viewport rule floors every dialog text control —
 * including `textarea` (e.g. the SQL query editor, the data-validation
 * list-values field) — to 16px, not just `input`/`select`.
 */
import { describe, expect, it } from 'vitest';
import { readBundledCss } from '../helpers';

const css = readBundledCss();

describe('mobile focus-zoom prevention', () => {
  it('floors every real dialog text control, including textarea, to 16px', () => {
    const match = /\.dialog-body input\[type='text'\][^{]*\{([^}]*)\}/.exec(css);
    expect(match, 'missing the dialog-body 16px-floor rule').not.toBeNull();
    expect(match![0]).toMatch(/\.dialog-body textarea/);
    expect(match![1]).toMatch(/font-size:\s*16px/);
  });

  it('floors the docked worksheet source textareas to 16px too (#486), while following their zoom above it', () => {
    const match = /\.markdown-sheet-view \.markdown-editor-source,[^{]*\{([^}]*)\}/.exec(css);
    expect(match, 'missing the worksheet source 16px-floor rule').not.toBeNull();
    expect(match![0]).toMatch(/\.text-sheet-view \.markdown-editor-source/);
    expect(match![1]).toMatch(
      /font-size:\s*max\(16px,\s*calc\(var\(--text-body\)\s*\*\s*var\(--sheet-zoom,\s*1\)\)\)/,
    );
  });
});
