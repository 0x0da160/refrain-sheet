// SPDX-License-Identifier: MIT
/**
 * Parses the local AI assistant's proposed-change plans out of its raw chat
 * reply text. When the assistant is asked to change the sheet rather than
 * just answer a question, the system prompt (`AI_SYSTEM_PROMPT` in
 * ./ai-prompt.ts) asks it to end its reply with a `PLAN: {...}` line;
 * everything before that line is the assistant's explanation, shown to the
 * user as-is.
 *
 * This module only understands cell-value writes (the same primitive Paste,
 * Fill, and Find & Replace already use) — never row/column/sheet structural
 * changes — so a plan can always be undone as a single `edit.undo` step and
 * its effect is fully previewable as a list of `ref → value` pairs before
 * the user approves it. Parsing is deliberately tolerant of a small,
 * unreliable in-browser model: malformed JSON, an unknown shape, or a plan
 * with no valid references all just fail to parse rather than throwing.
 */
import { cellLabel, parseRef } from './formula';

/** Upper bound on how many cells a single proposed plan may touch. */
export const AI_PLAN_MAX_CHANGES = 200;

export interface AiPlanChange {
  row: number;
  col: number;
  /** Canonical "A1"-style label for `row`/`col`, for display. */
  ref: string;
  value: string;
}

export type AiPlanParseResult =
  | { ok: true; changes: AiPlanChange[] }
  | { ok: false; reason: 'no-plan' | 'invalid-json' | 'invalid-shape' | 'too-many' | 'no-valid-refs' };

/**
 * Finds the `{...}` object starting at `openBraceIndex`, respecting string
 * literals (so a `}` inside a quoted value doesn't end the match early), and
 * returns its source text. Returns null if the braces never balance.
 */
function extractJsonObject(text: string, openBraceIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex, i + 1);
      }
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Where the plan marker starts: `PLAN:` in any case, with optional spaces
 * and a code fence before the JSON object, since a small model does not
 * always copy the format exactly. A bare "plan:" in prose, with no object
 * after it, is not a marker.
 */
function planMarkerIndex(replyText: string): number {
  return replyText.search(/PLAN\s*:\s*(?:```[a-z]*\s*)?\{/i);
}

/** Splits a raw assistant reply into its prose explanation and (if present) its plan. */
export function splitAiPlanReply(replyText: string): { prose: string; plan: AiPlanParseResult } {
  const markerIndex = planMarkerIndex(replyText);
  const before = markerIndex === -1 ? replyText : replyText.slice(0, markerIndex);
  // A model that wraps the plan line in a code fence leaves the opening fence behind.
  const prose = before.replace(/```[a-z]*\s*$/i, '').trim();
  return { prose, plan: parseAiPlan(replyText) };
}

/** Parses the `PLAN: {"changes": [...]}` block out of a raw assistant reply, if present. */
export function parseAiPlan(replyText: string): AiPlanParseResult {
  const markerIndex = planMarkerIndex(replyText);
  if (markerIndex === -1) {
    return { ok: false, reason: 'no-plan' };
  }
  const openBraceIndex = replyText.indexOf('{', markerIndex);
  if (openBraceIndex === -1) {
    return { ok: false, reason: 'invalid-json' };
  }
  const jsonText = extractJsonObject(replyText, openBraceIndex);
  if (!jsonText) {
    return { ok: false, reason: 'invalid-json' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.changes)) {
    return { ok: false, reason: 'invalid-shape' };
  }
  const rawChanges = parsed.changes;
  if (rawChanges.length === 0) {
    return { ok: false, reason: 'invalid-shape' };
  }
  if (rawChanges.length > AI_PLAN_MAX_CHANGES) {
    return { ok: false, reason: 'too-many' };
  }
  const byCell = new Map<string, AiPlanChange>();
  for (const raw of rawChanges) {
    if (!isPlainObject(raw)) {
      continue;
    }
    const refText = typeof raw.ref === 'string' ? raw.ref.trim() : '';
    const value =
      typeof raw.value === 'string'
        ? raw.value
        : typeof raw.value === 'number' && Number.isFinite(raw.value)
          ? String(raw.value)
          : null;
    if (!refText || value === null) {
      continue;
    }
    const parsedRef = parseRef(refText);
    if (!parsedRef) {
      continue;
    }
    // Last write wins if the model repeats a reference.
    byCell.set(`${parsedRef.row}:${parsedRef.col}`, {
      row: parsedRef.row,
      col: parsedRef.col,
      ref: cellLabel(parsedRef.row, parsedRef.col),
      value,
    });
  }
  const changes = [...byCell.values()];
  if (changes.length === 0) {
    return { ok: false, reason: 'no-valid-refs' };
  }
  return { ok: true, changes };
}
