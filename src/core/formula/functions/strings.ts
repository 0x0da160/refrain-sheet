// SPDX-License-Identifier: MIT
/**
 * Text functions.
 */
import {
  boundedText,
  codePointLength,
  lastCodePoints,
  sliceCodePoints,
  substituteText,
  toCodePoints,
  trimText,
} from '../text';
import { formatValueAsText } from '../text-format';
import {
  coerceToBoolean,
  coerceToText,
  type FormulaValue,
  MAX_TEXT_LENGTH,
  numberValue,
  textValue,
} from '../value';
import { collectValues, numberOf, optionalNumber, textOf, VALUE_ERR } from './helpers';
import { functionGroup, type FunctionDef } from './contract';

const { defs, def } = functionGroup();

// ----- Priority B: text -----

for (const name of ['LEFT', 'RIGHT'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 2,
    signature: `${name}(text, [num_chars])`,
    example: `=${name}(A1, 3)`,
    category: 'text',
    call: (args) => {
      const t = textOf(args[0]);
      if (!t.ok) {
        return t.error;
      }
      const countArg = optionalNumber(args, 1, 1);
      if (!countArg.ok) {
        return countArg.error;
      }
      const count = Math.trunc(countArg.n);
      if (count < 0) {
        return VALUE_ERR;
      }
      return textValue(name === 'LEFT' ? sliceCodePoints(t.s, 0, count) : lastCodePoints(t.s, count));
    },
  });
}

def({
  name: 'MID',
  minArgs: 3,
  maxArgs: 3,
  signature: 'MID(text, start_num, num_chars)',
  example: '=MID(A1, 2, 3)',
  category: 'text',
  call: (args) => {
    const t = textOf(args[0]);
    if (!t.ok) {
      return t.error;
    }
    const start = numberOf(args[1]);
    if (!start.ok) {
      return start.error;
    }
    const count = numberOf(args[2]);
    if (!count.ok) {
      return count.error;
    }
    const s = Math.trunc(start.n);
    const n = Math.trunc(count.n);
    if (s < 1 || n < 0) {
      return VALUE_ERR;
    }
    return textValue(sliceCodePoints(t.s, s - 1, n));
  },
});

def({
  name: 'LEN',
  minArgs: 1,
  maxArgs: 1,
  signature: 'LEN(text)',
  example: '=LEN(A1)',
  category: 'text',
  call: (args) => {
    const t = textOf(args[0]);
    return t.ok ? numberValue(codePointLength(t.s)) : t.error;
  },
});

def({
  name: 'TRIM',
  minArgs: 1,
  maxArgs: 1,
  signature: 'TRIM(text)',
  example: '=TRIM(A1)',
  category: 'text',
  call: (args) => {
    const t = textOf(args[0]);
    return t.ok ? textValue(trimText(t.s)) : t.error;
  },
});

for (const name of ['UPPER', 'LOWER'] as const) {
  def({
    name,
    minArgs: 1,
    maxArgs: 1,
    signature: `${name}(text)`,
    example: `=${name}(A1)`,
    category: 'text',
    call: (args) => {
      const t = textOf(args[0]);
      if (!t.ok) {
        return t.error;
      }
      // Locale-independent case mapping: a locale-aware fold would make a
      // workbook's values depend on the host's language.
      return textValue(name === 'UPPER' ? t.s.toUpperCase() : t.s.toLowerCase());
    },
  });
}

def({
  name: 'CONCAT',
  minArgs: 1,
  maxArgs: Infinity,
  signature: 'CONCAT(text1, …)',
  example: '=CONCAT(A1:A3)',
  category: 'text',
  call: (args) => {
    const values: FormulaValue[] = [];
    const err = collectValues(args, values);
    if (err) {
      return err;
    }
    let out = '';
    for (const v of values) {
      if (v.type === 'error') {
        return v;
      }
      out += coerceToText(v) ?? '';
      if (out.length > MAX_TEXT_LENGTH) {
        return VALUE_ERR;
      }
    }
    const bounded = boundedText(out);
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

def({
  name: 'TEXTJOIN',
  minArgs: 3,
  maxArgs: Infinity,
  signature: 'TEXTJOIN(delimiter, ignore_empty, text1, …)',
  example: '=TEXTJOIN(", ", TRUE, A1:A10)',
  category: 'text',
  call: (args) => {
    const delim = textOf(args[0]);
    if (!delim.ok) {
      return delim.error;
    }
    const flagValue = args[1].value();
    if (flagValue.type === 'error') {
      return flagValue;
    }
    const ignoreEmpty = coerceToBoolean(flagValue);
    if (ignoreEmpty === null) {
      return VALUE_ERR;
    }
    const values: FormulaValue[] = [];
    const err = collectValues(args.slice(2), values);
    if (err) {
      return err;
    }
    const parts: string[] = [];
    let length = 0;
    for (const v of values) {
      if (v.type === 'error') {
        return v;
      }
      const text = coerceToText(v) ?? '';
      if (ignoreEmpty && text === '') {
        continue;
      }
      parts.push(text);
      length += text.length + delim.s.length;
      if (length > MAX_TEXT_LENGTH) {
        return VALUE_ERR;
      }
    }
    const bounded = boundedText(parts.join(delim.s));
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

def({
  name: 'SUBSTITUTE',
  minArgs: 3,
  maxArgs: 4,
  signature: 'SUBSTITUTE(text, old_text, new_text, [instance_num])',
  example: '=SUBSTITUTE(A1, "-", "/")',
  category: 'text',
  call: (args) => {
    const text = textOf(args[0]);
    if (!text.ok) {
      return text.error;
    }
    const oldText = textOf(args[1]);
    if (!oldText.ok) {
      return oldText.error;
    }
    const newText = textOf(args[2]);
    if (!newText.ok) {
      return newText.error;
    }
    const instanceArg = optionalNumber(args, 3, 0);
    if (!instanceArg.ok) {
      return instanceArg.error;
    }
    let instance: number | undefined;
    if (instanceArg.provided) {
      instance = Math.trunc(instanceArg.n);
      if (instance < 1) {
        return VALUE_ERR;
      }
    }
    const result = substituteText(text.s, oldText.s, newText.s, instance);
    return result === null ? VALUE_ERR : textValue(result);
  },
});

def({
  name: 'REPLACE',
  minArgs: 4,
  maxArgs: 4,
  signature: 'REPLACE(old_text, start_num, num_chars, new_text)',
  example: '=REPLACE(A1, 1, 3, "abc")',
  category: 'text',
  call: (args) => {
    const oldText = textOf(args[0]);
    if (!oldText.ok) {
      return oldText.error;
    }
    const start = numberOf(args[1]);
    if (!start.ok) {
      return start.error;
    }
    const count = numberOf(args[2]);
    if (!count.ok) {
      return count.error;
    }
    const newText = textOf(args[3]);
    if (!newText.ok) {
      return newText.error;
    }
    const s = Math.trunc(start.n);
    const n = Math.trunc(count.n);
    if (s < 1 || n < 0) {
      return VALUE_ERR;
    }
    const points = toCodePoints(oldText.s);
    const head = points.slice(0, s - 1).join('');
    const tail = points.slice(s - 1 + n).join('');
    const bounded = boundedText(head + newText.s + tail);
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

def({
  name: 'TEXT',
  minArgs: 2,
  maxArgs: 2,
  signature: 'TEXT(value, format_text)',
  example: '=TEXT(1234.5, "#,##0.00")',
  category: 'text',
  call: (args, ctx) => {
    const value = numberOf(args[0]);
    if (!value.ok) {
      return value.error;
    }
    const format = textOf(args[1]);
    if (!format.ok) {
      return format.error;
    }
    const rendered = formatValueAsText(value.n, format.s, ctx.displayLanguage);
    if (rendered === null) {
      return VALUE_ERR;
    }
    const bounded = boundedText(rendered);
    return bounded === null ? VALUE_ERR : textValue(bounded);
  },
});

export const TEXT_FUNCTIONS: readonly FunctionDef[] = defs;
