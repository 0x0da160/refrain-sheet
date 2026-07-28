// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The floating (inline cell editor) variant of `FormulaAutocomplete` must
 * place its popup through the shared `positionPopup` helper — clamped into
 * the viewport, and re-clamped on scroll/resize — the same as every other
 * floating surface (see `src/ui/popup.ts`, `src/ui/context-menu.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormulaAutocomplete } from '../src/ui/formula-autocomplete';

function stubRect(node: HTMLElement, rect: Partial<DOMRect>): void {
  node.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect }) as DOMRect;
}

describe('FormulaAutocomplete (floating popup)', () => {
  let field: HTMLInputElement;
  let parent: HTMLElement;

  beforeEach(() => {
    document.body.textContent = '';
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    field = document.createElement('input');
    parent = document.body;
    document.body.append(field);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function open(): FormulaAutocomplete {
    const autocomplete = new FormulaAutocomplete(field, parent, true);
    stubRect(autocomplete.popup, { width: 260, height: 100 });
    field.value = '=SU';
    field.selectionStart = 3;
    autocomplete.update();
    return autocomplete;
  }

  it('clamps the popup into the viewport instead of overflowing near an edge', () => {
    // The field sits hard against the bottom-right corner: naive `left =
    // rect.left` / `top = rect.bottom` placement would push the popup off
    // both edges.
    stubRect(field, { left: 950, top: 780, right: 1000, bottom: 800 });
    const autocomplete = open();
    expect(autocomplete.isOpen).toBe(true);
    const left = parseFloat(autocomplete.popup.style.left);
    const top = parseFloat(autocomplete.popup.style.top);
    expect(left + 260).toBeLessThanOrEqual(1000);
    expect(top + 100).toBeLessThanOrEqual(800);
  });

  it('re-positions when the window is resized while open', () => {
    stubRect(field, { left: 100, top: 100, right: 150, bottom: 120 });
    const autocomplete = open();
    const firstTop = autocomplete.popup.style.top;

    // The field moves (e.g. the layout reflowed) and the window resizes.
    stubRect(field, { left: 400, top: 500, right: 450, bottom: 520 });
    window.dispatchEvent(new Event('resize'));
    expect(autocomplete.popup.style.top).not.toBe(firstTop);
    expect(parseFloat(autocomplete.popup.style.top)).toBe(520);
  });

  it('re-positions on a capturing scroll event while open', () => {
    stubRect(field, { left: 100, top: 100, right: 150, bottom: 120 });
    const autocomplete = open();

    stubRect(field, { left: 200, top: 300, right: 250, bottom: 320 });
    document.dispatchEvent(new Event('scroll'));
    expect(parseFloat(autocomplete.popup.style.top)).toBe(320);
  });

  it('stops repositioning after dispose', () => {
    stubRect(field, { left: 100, top: 100, right: 150, bottom: 120 });
    const autocomplete = open();
    const topBeforeDispose = autocomplete.popup.style.top;
    autocomplete.dispose();

    stubRect(field, { left: 900, top: 700, right: 950, bottom: 720 });
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
    // The listeners were removed, so the stale style is left untouched.
    expect(autocomplete.popup.style.top).toBe(topBeforeDispose);
  });

  it('does not touch positioning for the non-floating (in-flow) popup', () => {
    const autocomplete = new FormulaAutocomplete(field, parent, false);
    field.value = '=SU';
    field.selectionStart = 3;
    autocomplete.update();
    expect(autocomplete.popup.style.left).toBe('');
    expect(autocomplete.popup.style.top).toBe('');
  });
});
