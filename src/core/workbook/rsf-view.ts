// SPDX-License-Identifier: MIT
/**
 * The display keys a `.rsf` `view` object shares at the worksheet and the
 * file level: `zoom`, `wrap`, `font`, and the grid look (`bands`,
 * `bandLevel`, `gridlines`, `rowHighlight`, `colHighlight`). The worksheet's
 * `colWidths` stays in `rsf-codec.ts`, which calls these to read and write
 * the rest (knowledge/formats/rsf/json-document.md, "View").
 */
import { GRID_LOOK_KEYS, isBandLevel, isEmptyGridLook, type GridLookLayer } from '../grid-look';

export const RSF_ZOOM_MIN = 50;
export const RSF_ZOOM_MAX = 200;

/** Validated display settings a worksheet or the file may specify; an absent key is "not specified". */
export interface RsfViewSettings {
  /** Spreadsheet zoom percent, clamped into 50–200. */
  zoom?: number;
  /** Whether long cells wrap onto several visual lines. */
  wrap?: boolean;
  /**
   * Spreadsheet font id (`biz-ud`, `ms`, …). Only its shape is checked here;
   * the application ignores an id it does not know.
   */
  font?: string;
  /** Grid look: bands and their strength, gridlines, row/column highlight. */
  look?: GridLookLayer;
}

/**
 * How `wrap: false` is treated. A worksheet stores only `true` (false means
 * "not specified" there); the file stores both, since false means "don't wrap".
 */
export type WrapFalse = 'drop' | 'keep';

const clampZoom = (zoom: number): number => Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(zoom)));

/** Whether any shared key is specified. */
export function hasViewSettings(view: RsfViewSettings | undefined, wrapFalse: WrapFalse): boolean {
  return (
    view !== undefined &&
    (view.zoom !== undefined ||
      (wrapFalse === 'keep' ? view.wrap !== undefined : view.wrap === true) ||
      view.font !== undefined ||
      !isEmptyGridLook(view.look))
  );
}

/** Write the specified shared keys into a `view` object (grid-look `false` values included: each is a choice). */
export function viewToJson(
  view: RsfViewSettings,
  wrapFalse: WrapFalse,
  out: { [key: string]: string | number | boolean | unknown },
): void {
  if (view.zoom !== undefined) out.zoom = clampZoom(view.zoom);
  if (wrapFalse === 'keep' ? view.wrap !== undefined : view.wrap === true) out.wrap = view.wrap;
  if (view.font !== undefined) out.font = view.font;
  for (const key of GRID_LOOK_KEYS) {
    if (view.look?.[key] !== undefined) out[key] = view.look[key];
  }
}

/**
 * Read the shared keys of a `view` object. A present key of the wrong type,
 * a font id that is not 1–64 of `a-z 0-9 -`, or a band level outside 1–3
 * calls `bad` (the codec's `bad-shape` failure).
 */
export function viewFromJson(
  view: { [key: string]: unknown },
  wrapFalse: WrapFalse,
  bad: () => never,
): RsfViewSettings {
  const bool = (key: string): boolean | undefined => {
    const value = view[key];
    if (value !== undefined && typeof value !== 'boolean') bad();
    return value as boolean | undefined;
  };
  const out: RsfViewSettings = {};
  if (view.zoom !== undefined) {
    if (typeof view.zoom !== 'number' || !Number.isFinite(view.zoom)) bad();
    out.zoom = clampZoom(view.zoom);
  }
  const wrap = bool('wrap');
  if (wrapFalse === 'keep' ? wrap !== undefined : wrap === true) out.wrap = wrap;
  if (view.font !== undefined) {
    if (typeof view.font !== 'string' || !/^[a-z0-9-]{1,64}$/.test(view.font)) bad();
    out.font = view.font;
  }
  const look: GridLookLayer = {};
  for (const key of ['bands', 'gridlines', 'rowHighlight', 'colHighlight'] as const) {
    const value = bool(key);
    if (value !== undefined) look[key] = value;
  }
  if (view.bandLevel !== undefined) {
    if (!isBandLevel(view.bandLevel)) bad();
    look.bandLevel = view.bandLevel;
  }
  if (!isEmptyGridLook(look)) out.look = look;
  return out;
}
