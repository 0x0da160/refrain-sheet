// SPDX-License-Identifier: MIT
/**
 * Structural deltas between two JSON trees, used to store an `.rsf` file's
 * version history as the changes between one snapshot and the next rather
 * than as a full copy of the workbook per save (see
 * `knowledge/formats/rsf/json-document.md`, "History").
 *
 * A delta turns a *base* tree into a *target* tree. It is one of:
 *
 * - `{ "v": value }` — the target is `value` (a replacement);
 * - `{ "o": { key: delta }, "d": [keys], "k": [keys] }` — both are objects:
 *   each key in `o` gets its delta applied (a key the base lacks is added,
 *   its delta then being a `v`), each key in `d` is removed, every other key
 *   is kept. `d` and `k` are optional; `k`, present only when the target's
 *   key order is not the base's with new keys appended, lists the target's
 *   keys in order;
 * - `{ "a": [[index, delta], …] }` — both are arrays of the same length:
 *   each listed element (ascending indexes) gets its delta applied;
 * - `{ "s": [start, deleteCount, [items]] }` — both are arrays: the target
 *   is the base with `deleteCount` elements at `start` replaced by `items`
 *   (an inserted or deleted row, an added worksheet).
 *
 * Applying never trusts the delta: every index, count, key, and nesting
 * level is checked, and a delta that does not fit its base throws
 * {@link HistoryDeltaError}. Unchanged subtrees are shared with the base,
 * not copied.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** Deeper deltas than any workbook tree needs are refused (bounded recursion). */
const MAX_DELTA_DEPTH = 32;

export class HistoryDeltaError extends Error {
  constructor() {
    super('rsf: a version-history delta does not fit its base');
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Set an own key, even `__proto__` (a plain assignment would set the prototype). */
function put(obj: JsonObject, key: string, value: Json): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function jsonEqual(a: Json, b: Json): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => has(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

function diffObject(base: JsonObject, target: JsonObject): Json {
  const changed: JsonObject = {};
  // Existing keys first, in the base's order, then new keys in the target's
  // order: the same content always yields the same delta text.
  for (const k of Object.keys(base)) {
    if (has(target, k)) {
      const delta = diffJson(base[k], target[k]);
      if (delta !== null) put(changed, k, delta);
    }
  }
  for (const k of Object.keys(target)) {
    if (!has(base, k)) put(changed, k, { v: target[k] });
  }
  const out: JsonObject = { o: changed };
  const deleted = Object.keys(base).filter((k) => !has(target, k));
  if (deleted.length > 0) out.d = deleted;
  const targetKeys = Object.keys(target);
  const kept = Object.keys(base).filter((k) => has(target, k));
  const natural = [...kept, ...targetKeys.filter((k) => !has(base, k))];
  if (natural.some((k, i) => k !== targetKeys[i])) out.k = targetKeys;
  return out;
}

function diffArray(base: Json[], target: Json[]): Json {
  if (base.length === target.length) {
    const edits: Json[] = [];
    for (let i = 0; i < base.length; i++) {
      const delta = diffJson(base[i], target[i]);
      if (delta !== null) edits.push([i, delta]);
    }
    // A row of plain values that mostly changed is smaller written out whole.
    const plain = target.every((item) => item === null || typeof item !== 'object');
    return plain && edits.length * 2 > target.length ? { v: target } : { a: edits };
  }
  let start = 0;
  const shortest = Math.min(base.length, target.length);
  while (start < shortest && jsonEqual(base[start], target[start])) start++;
  let tail = 0;
  while (
    tail < shortest - start &&
    jsonEqual(base[base.length - 1 - tail], target[target.length - 1 - tail])
  ) {
    tail++;
  }
  return { s: [start, base.length - start - tail, target.slice(start, target.length - tail)] };
}

/** The delta that turns `base` into `target`, or `null` when they are equal. */
export function diffJson(base: Json, target: Json): Json | null {
  if (jsonEqual(base, target)) {
    return null;
  }
  if (Array.isArray(base) && Array.isArray(target)) {
    return diffArray(base, target);
  }
  if (isObject(base) && isObject(target)) {
    return diffObject(base, target);
  }
  return { v: target };
}

function fail(): never {
  throw new HistoryDeltaError();
}

function isIndex(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function applyObject(base: JsonObject, delta: JsonObject, depth: number): Json {
  const changed = delta.o;
  if (!isObject(changed)) fail();
  const out: JsonObject = {};
  const deleted = delta.d ?? [];
  if (!Array.isArray(deleted)) fail();
  const removed = new Set<string>();
  for (const k of deleted) {
    if (typeof k !== 'string' || !has(base, k) || has(changed, k)) fail();
    removed.add(k);
  }
  for (const k of Object.keys(base)) {
    if (removed.has(k)) continue;
    put(out, k, has(changed, k) ? applyAt(base[k], changed[k], depth + 1) : base[k]);
  }
  for (const k of Object.keys(changed)) {
    if (!has(base, k)) {
      const add = changed[k];
      if (!isObject(add) || !has(add, 'v') || Object.keys(add).length !== 1) fail();
      put(out, k, add.v);
    }
  }
  if (delta.k === undefined) {
    return out;
  }
  const order = delta.k;
  const keys = Object.keys(out);
  if (!Array.isArray(order) || order.length !== keys.length) fail();
  const ordered: JsonObject = {};
  for (const k of order) {
    if (typeof k !== 'string' || !has(out, k) || has(ordered, k)) fail();
    put(ordered, k, out[k]);
  }
  return ordered;
}

function applyElements(base: Json[], edits: Json, depth: number): Json {
  if (!Array.isArray(edits)) fail();
  const out = base.slice();
  let last = -1;
  for (const edit of edits) {
    if (!Array.isArray(edit) || edit.length !== 2 || !isIndex(edit[0], base.length - 1) || edit[0] <= last) {
      fail();
    }
    last = edit[0];
    out[last] = applyAt(base[last], edit[1], depth + 1);
  }
  return out;
}

function applySplice(base: Json[], splice: Json): Json {
  if (!Array.isArray(splice) || splice.length !== 3) fail();
  const [start, count, items] = splice;
  if (!isIndex(start, base.length) || !isIndex(count, base.length - start) || !Array.isArray(items)) {
    fail();
  }
  return [...base.slice(0, start), ...items, ...base.slice(start + count)];
}

function applyAt(base: Json, delta: Json, depth: number): Json {
  if (depth > MAX_DELTA_DEPTH || !isObject(delta)) fail();
  const keys = Object.keys(delta);
  if (keys.length === 1 && keys[0] === 'v') return delta.v;
  if (keys.length === 1 && keys[0] === 'a') {
    if (!Array.isArray(base)) fail();
    return applyElements(base, delta.a, depth);
  }
  if (keys.length === 1 && keys[0] === 's') {
    if (!Array.isArray(base)) fail();
    return applySplice(base, delta.s);
  }
  if (has(delta, 'o') && keys.every((k) => k === 'o' || k === 'd' || k === 'k')) {
    if (!isObject(base)) fail();
    return applyObject(base, delta, depth);
  }
  return fail();
}

/**
 * Apply `delta` (untrusted, as parsed from a file) to `base`. Throws
 * {@link HistoryDeltaError} when the delta is malformed or does not fit.
 */
export function applyJsonDelta(base: Json, delta: unknown): Json {
  return applyAt(base, delta as Json, 0);
}
