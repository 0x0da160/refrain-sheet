// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el } from '../../src/ui/dom';

describe('el() text fields', () => {
  it('marks inputs and textareas so password managers leave them alone', () => {
    for (const field of [el('input'), el('textarea')]) {
      expect(field.getAttribute('autocomplete')).toBe('off');
      expect(field.getAttribute('data-1p-ignore')).toBe('true');
      expect(field.getAttribute('data-lpignore')).toBe('true');
    }
  });

  it('lets a field ask for autocomplete explicitly', () => {
    const field = el('input', { attrs: { autocomplete: 'on' } });
    expect(field.getAttribute('autocomplete')).toBe('on');
  });

  it('leaves other elements untouched', () => {
    expect(el('div').hasAttribute('autocomplete')).toBe(false);
  });
});
