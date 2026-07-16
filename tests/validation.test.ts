// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { validateDocument, VALIDATION_DISPLAY_LIMIT } from '../src/core/validation';
import { doc } from './helpers';

describe('structural validation diagnostics', () => {
  it('reports an unclosed quote with row and column', () => {
    const summary = validateDocument(doc('a,b\nx,"broken\n'));
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ row: 2, column: 2, type: 'unclosed-quote' }),
    );
  });

  it('reports ambiguity when an unclosed quote swallows line breaks', () => {
    const summary = validateDocument(doc('a,"broken\nmore\n'));
    expect(summary.counts['ambiguous']).toBe(1);
  });

  it('reports invalid text after a closing quote', () => {
    const summary = validateDocument(doc('a,"x"junk,c\n'));
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ row: 1, column: 2, type: 'text-after-quote' }),
    );
  });

  it('does not flag whitespace after a closing quote', () => {
    expect(validateDocument(doc('a,"x" ,c\n')).diagnostics).toEqual([]);
  });

  it('reports bare quotes inside unquoted fields', () => {
    const summary = validateDocument(doc('a,b"c,d\n'));
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ row: 1, column: 2, type: 'bare-quote' }),
    );
  });

  it('reports inconsistent field counts with expected and actual values', () => {
    const summary = validateDocument(doc('a,b,c\n1,2\nx,y,z,w\n'));
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ row: 2, type: 'inconsistent-field-count', expected: 3, actual: 2 }),
    );
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ row: 3, type: 'inconsistent-field-count', expected: 3, actual: 4 }),
    );
  });

  it('well-formed CSV produces no diagnostics', () => {
    expect(validateDocument(doc('a,b\n" x ",y\nc,"d""e"\n')).diagnostics).toEqual([]);
  });

  it('caps the diagnostics shown in the dialog', () => {
    const rows = ['a,b'];
    for (let i = 0; i < VALIDATION_DISPLAY_LIMIT + 50; i++) {
      rows.push('only-one-field');
    }
    const summary = validateDocument(doc(rows.join('\n')));
    expect(summary.shown.length).toBe(VALIDATION_DISPLAY_LIMIT);
    expect(summary.truncated).toBe(50);
  });
});
