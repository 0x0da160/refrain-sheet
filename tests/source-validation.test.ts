// SPDX-License-Identifier: MIT
/** JSON/YAML syntax checking for the source worksheets (`src/core/source-validation.ts`). */
import { describe, expect, it } from 'vitest';
import { validateJson, validateYaml } from '../src/core/source-validation';

describe('validateJson', () => {
  it('accepts valid JSON and a blank sheet', () => {
    expect(validateJson('{"a": [1, 2]}')).toBeNull();
    expect(validateJson('  \n')).toBeNull();
  });

  it('reports the first error with its line and column', () => {
    const problem = validateJson('{\n "a": 1\n "b": 2}');
    expect(problem).toMatchObject({ line: 3, col: 2, offset: 11, count: 1 });
    expect(problem?.message).not.toMatch(/position/);
  });

  it('places an unexpected end at the end of the text', () => {
    const text = '[1, 2';
    expect(validateJson(text)).toMatchObject({ offset: text.length, line: 1 });
  });
});

describe('validateYaml', () => {
  it('accepts valid YAML, several documents, and a blank sheet', () => {
    expect(validateYaml('a: 1\nb:\n  - x\n')).toBeNull();
    expect(validateYaml('---\na: 1\n---\nb: 2\n')).toBeNull();
    expect(validateYaml('')).toBeNull();
  });

  it('reports duplicate keys and tab indentation as errors', () => {
    expect(validateYaml('a: 1\na: 2')).toMatchObject({ line: 2, col: 1, message: 'Map keys must be unique' });
    expect(validateYaml('a:\n\tb: 1')?.line).toBe(2);
  });

  it('counts every error and reports the first', () => {
    const problem = validateYaml('a: 1\n b: 2');
    expect(problem).toMatchObject({ line: 1, col: 4 });
    expect(problem!.count).toBeGreaterThan(1);
    expect(problem!.message).not.toMatch(/at line/);
  });
});
