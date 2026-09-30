// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { reindentJson } from '../../src/core/json-format';

describe('reindentJson', () => {
  it('matches JSON.stringify(value, null, 2) where no value would change', () => {
    const samples = ['{"a":1,"b":[1,2],"c":{"d":null,"e":[]},"f":{}}', '[ ]', '"x"', '[{"k" : true}, false]'];
    for (const text of samples) {
      expect(reindentJson(text)).toBe(JSON.stringify(JSON.parse(text), null, 2));
    }
  });

  it('keeps numbers exactly as written', () => {
    expect(reindentJson('{"a":1.0,"b":12345678901234567890,"c":1e3}')).toBe(
      '{\n  "a": 1.0,\n  "b": 12345678901234567890,\n  "c": 1e3\n}',
    );
  });

  it('keeps strings, escapes and punctuation inside them as written', () => {
    expect(reindentJson('{"a,b":"x:\\"{[\\u00e9"}')).toBe('{\n  "a,b": "x:\\"{[\\u00e9"\n}');
  });

  it('keeps a trailing newline', () => {
    expect(reindentJson('[1]\n')).toBe('[\n  1\n]\n');
  });
});
