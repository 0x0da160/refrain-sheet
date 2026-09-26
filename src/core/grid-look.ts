// SPDX-License-Identifier: MIT
/**
 * The grid's look: banded rows (and how strong the band is), gridlines, and
 * the highlight of the selected cell's row and column.
 *
 * Each is a layered display setting like zoom and wrap
 * (`settings-cascade.ts`): the worksheet, the file, and this browser may each
 * specify it, and the narrowest level that does wins. Presentational only —
 * never changes cell data, evaluation, export, or the dirty state.
 *
 * Pure and DOM-free.
 */

import { resolveSetting, type SettingLayers } from './settings-cascade';

/** Band strength: 1 = light (the default), 2 = medium, 3 = dark. */
export type BandLevel = 1 | 2 | 3;

export const BAND_LEVELS: readonly BandLevel[] = [1, 2, 3];

export interface GridLook {
  /** Tint every other row. */
  bands: boolean;
  /** How strong the band tint is. */
  bandLevel: BandLevel;
  /** Draw the lines between data cells. */
  gridlines: boolean;
  /** Tint the row of the selected cell. */
  rowHighlight: boolean;
  /** Tint the column of the selected cell. */
  colHighlight: boolean;
}

/** One level's values; a missing key means "not specified". */
export type GridLookLayer = Partial<GridLook>;

export const GRID_LOOK_KEYS = ['bands', 'bandLevel', 'gridlines', 'rowHighlight', 'colHighlight'] as const;

/**
 * What applies when no level specifies a value. Bands stay off (they compete
 * with the fill colours users give cells) and start at the lightest level;
 * only the selected row is highlighted.
 */
export const DEFAULT_GRID_LOOK: GridLook = {
  bands: false,
  bandLevel: 1,
  gridlines: true,
  rowHighlight: true,
  colHighlight: false,
};

export function isBandLevel(value: unknown): value is BandLevel {
  return value === 1 || value === 2 || value === 3;
}

/** Whether a layer specifies nothing. */
export function isEmptyGridLook(layer: GridLookLayer | undefined): boolean {
  return layer === undefined || GRID_LOOK_KEYS.every((key) => layer[key] === undefined);
}

/** Resolve every key of the look: sheet > file > browser, else the default. */
export function resolveGridLook(layers: SettingLayers<GridLookLayer>): GridLook {
  const pick = <K extends keyof GridLook>(key: K): GridLook[K] =>
    resolveSetting<GridLook[K]>(
      { sheet: layers.sheet?.[key], file: layers.file?.[key], browser: layers.browser?.[key] },
      DEFAULT_GRID_LOOK[key],
    ).value;
  return {
    bands: pick('bands'),
    bandLevel: pick('bandLevel'),
    gridlines: pick('gridlines'),
    rowHighlight: pick('rowHighlight'),
    colHighlight: pick('colHighlight'),
  };
}
