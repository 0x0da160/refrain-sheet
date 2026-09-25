// SPDX-License-Identifier: MIT
/**
 * The text Ctrl+; (today's date) and Ctrl+Shift+; (the current time) enter
 * into a cell: `2026-09-25` and `13:45`. ISO-style text reads the same in
 * every language and sorts correctly as text.
 * The caller supplies the clock and the timezone offset, so this stays pure.
 */

export type DateStampKind = 'date' | 'time';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Today's date or the current time at `nowMs`, shifted by `offsetMs` from UTC. */
export function dateStamp(kind: DateStampKind, nowMs: number, offsetMs: number): string {
  const d = new Date(nowMs + offsetMs);
  if (kind === 'time') {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
