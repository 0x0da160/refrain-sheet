// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { toggleReferenceAt } from '../src/core/formula-ref-toggle';
import { FormulaFieldRef, isRefToggleKey } from '../src/ui/formula-autocomplete';

function cycle(text: string, caret: number, times = 1): string {
  let current = text;
  let at = caret;
  for (let i = 0; i < times; i++) {
    const result = toggleReferenceAt(current, at);
    if (!result) throw new Error('no reference at caret');
    current = result.text;
    at = result.end;
  }
  return current;
}

describe('toggleReferenceAt', () => {
  it('cycles A1 → $A$1 → A$1 → $A1 → A1', () => {
    expect(cycle('=A1', 3, 1)).toBe('=$A$1');
    expect(cycle('=A1', 3, 2)).toBe('=A$1');
    expect(cycle('=A1', 3, 3)).toBe('=$A1');
    expect(cycle('=A1', 3, 4)).toBe('=A1');
  });

  it('toggles the reference the caret is on or right after', () => {
    expect(cycle('=A1+B2', 1)).toBe('=$A$1+B2');
    expect(cycle('=A1+B2', 6)).toBe('=A1+$B$2');
  });

  it('toggles both ends of a range together', () => {
    expect(cycle('=SUM(A1:B10)', 7)).toBe('=SUM($A$1:$B$10)');
    expect(cycle('=SUM($A$1:B10)', 9)).toBe('=SUM(A$1:B$10)');
  });

  it('keeps a sheet prefix', () => {
    expect(cycle('=Sheet1!C3', 10)).toBe('=Sheet1!$C$3');
  });

  it('returns the new span so the caret can follow it', () => {
    expect(toggleReferenceAt('=A1*2', 3)).toEqual({ text: '=$A$1*2', start: 1, end: 5 });
  });

  it('ignores non-formulas, function names, strings, and a caret away from any reference', () => {
    expect(toggleReferenceAt('A1', 2)).toBeNull();
    expect(toggleReferenceAt('=LOG10(5)', 4)).toBeNull();
    expect(toggleReferenceAt('="A1"', 3)).toBeNull();
    expect(toggleReferenceAt('=A1 + 5', 7)).toBeNull();
  });
});

describe('FormulaFieldRef.toggleReference (F4 in the formula bar and cell editor)', () => {
  it('rewrites the field, keeps the caret after the reference, and fires input', () => {
    const field = document.createElement('textarea');
    document.body.append(field);
    field.value = '=A1+1';
    field.setSelectionRange(3, 3);
    let inputs = 0;
    field.addEventListener('input', () => inputs++);
    const ref = new FormulaFieldRef(field);
    expect(ref.toggleReference()).toBe(true);
    expect(field.value).toBe('=$A$1+1');
    expect(field.selectionStart).toBe(5);
    expect(inputs).toBe(1);
  });

  it('leaves plain text alone', () => {
    const field = document.createElement('textarea');
    field.value = 'A1';
    field.setSelectionRange(2, 2);
    expect(new FormulaFieldRef(field).toggleReference()).toBe(false);
    expect(field.value).toBe('A1');
  });

  it('treats only unmodified F4 as the toggle key', () => {
    expect(isRefToggleKey(new KeyboardEvent('keydown', { key: 'F4' }))).toBe(true);
    expect(isRefToggleKey(new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true }))).toBe(false);
    expect(isRefToggleKey(new KeyboardEvent('keydown', { key: 'F3' }))).toBe(false);
  });
});
