// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { AI_PLAN_MAX_CHANGES, parseAiPlan, splitAiPlanReply } from '../src/core/ai-plan';

function plan(changes: unknown): string {
  return `PLAN: ${JSON.stringify({ changes })}`;
}

describe('parseAiPlan', () => {
  it('returns no-plan for a plain chat reply', () => {
    expect(parseAiPlan('関数SUMは合計を計算します。')).toEqual({ ok: false, reason: 'no-plan' });
  });

  it('parses a well-formed single-cell plan', () => {
    const result = parseAiPlan(plan([{ ref: 'A1', value: '100' }]));
    expect(result).toEqual({ ok: true, changes: [{ row: 0, col: 0, ref: 'A1', value: '100' }] });
  });

  it('parses a plan following prose explanation, ignoring the prose', () => {
    const text = `A1とB1に合計を入れます。\n${plan([
      { ref: 'A1', value: '1' },
      { ref: 'B1', value: '2' },
    ])}`;
    const result = parseAiPlan(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes).toEqual([
        { row: 0, col: 0, ref: 'A1', value: '1' },
        { row: 0, col: 1, ref: 'B1', value: '2' },
      ]);
    }
  });

  it('coerces numeric values to strings', () => {
    const result = parseAiPlan(plan([{ ref: 'C3', value: 42 }]));
    expect(result).toEqual({ ok: true, changes: [{ row: 2, col: 2, ref: 'C3', value: '42' }] });
  });

  it('tolerates trailing prose after the JSON object', () => {
    const text = `${plan([{ ref: 'A1', value: 'x' }])}\nよろしいですか？`;
    const result = parseAiPlan(text);
    expect(result).toEqual({ ok: true, changes: [{ row: 0, col: 0, ref: 'A1', value: 'x' }] });
  });

  it('handles braces inside a quoted value without ending the match early', () => {
    const result = parseAiPlan(plan([{ ref: 'A1', value: '{note}' }]));
    expect(result).toEqual({ ok: true, changes: [{ row: 0, col: 0, ref: 'A1', value: '{note}' }] });
  });

  it('rejects invalid JSON', () => {
    expect(parseAiPlan('PLAN: {not json}')).toEqual({ ok: false, reason: 'invalid-json' });
  });

  it('rejects a missing changes array', () => {
    expect(parseAiPlan('PLAN: {"foo": 1}')).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('rejects an empty changes array', () => {
    expect(parseAiPlan(plan([]))).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('rejects a plan over the max change count', () => {
    const changes = Array.from({ length: AI_PLAN_MAX_CHANGES + 1 }, (_, i) => ({
      ref: `A${i + 1}`,
      value: 'x',
    }));
    expect(parseAiPlan(plan(changes))).toEqual({ ok: false, reason: 'too-many' });
  });

  it('accepts a plan at exactly the max change count', () => {
    const changes = Array.from({ length: AI_PLAN_MAX_CHANGES }, (_, i) => ({ ref: `A${i + 1}`, value: 'x' }));
    const result = parseAiPlan(plan(changes));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes).toHaveLength(AI_PLAN_MAX_CHANGES);
    }
  });

  it('drops entries with an invalid or missing ref, keeping the valid ones', () => {
    const result = parseAiPlan(
      plan([{ ref: 'not-a-ref', value: '1' }, { ref: 'B2', value: '2' }, { value: '3' }, { ref: 'C3' }]),
    );
    expect(result).toEqual({ ok: true, changes: [{ row: 1, col: 1, ref: 'B2', value: '2' }] });
  });

  it('fails with no-valid-refs when every entry is invalid', () => {
    expect(parseAiPlan(plan([{ ref: 'nope', value: '1' }]))).toEqual({ ok: false, reason: 'no-valid-refs' });
  });

  it('keeps only the last write when a ref repeats', () => {
    const result = parseAiPlan(
      plan([
        { ref: 'A1', value: 'first' },
        { ref: 'A1', value: 'second' },
      ]),
    );
    expect(result).toEqual({ ok: true, changes: [{ row: 0, col: 0, ref: 'A1', value: 'second' }] });
  });
});

describe('splitAiPlanReply', () => {
  it('returns the whole reply as prose when there is no plan', () => {
    const result = splitAiPlanReply('こんにちは');
    expect(result.prose).toBe('こんにちは');
    expect(result.plan).toEqual({ ok: false, reason: 'no-plan' });
  });

  it('splits prose from the plan and trims whitespace', () => {
    const text = `  A1に値を入れます。  \n${plan([{ ref: 'A1', value: '1' }])}`;
    const result = splitAiPlanReply(text);
    expect(result.prose).toBe('A1に値を入れます。');
    expect(result.plan).toEqual({ ok: true, changes: [{ row: 0, col: 0, ref: 'A1', value: '1' }] });
  });
});
