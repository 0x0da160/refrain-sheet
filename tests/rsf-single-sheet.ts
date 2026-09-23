// SPDX-License-Identifier: MIT
/**
 * Test helper: a flat, one-worksheet view of the `.rsf` codec, so feature
 * tests (styles, filters, comments, display settings, …) can round-trip one
 * sheet without building a whole `RsfWorkbookData` each time. It maps onto
 * `encodeRsfWorkbook`/`decodeRsfWorkbook` — the only format there is.
 */
import type { DelimiterId } from '../src/core/byte-csv-parser';
import type { CellStyle } from '../src/core/cell-style';
import type { SheetFilter } from '../src/core/filter';
import {
  decodeRsfWorkbook,
  encodeRsfWorkbook,
  packRsfJsonText,
  unpackRsfJsonText,
  type RsfDecodeError,
  type RsfDisplaySettings,
  type RsfHistorySnapshot,
  type RsfWorksheetKind,
} from '../src/core/rsf-codec';

export interface RsfData {
  name: string;
  delimiter: DelimiterId;
  rowCount: number;
  columnCount: number;
  cells: Array<[number, number, string]>;
  kind?: RsfWorksheetKind;
  appName?: string;
  appVersion?: string;
  display?: RsfDisplaySettings;
  filter?: SheetFilter;
  filterDropped?: boolean;
  timezone?: string;
  displayLanguage?: string;
  styles?: Array<[number, number, CellStyle]>;
  comments?: Array<[number, number, string]>;
  locked?: boolean;
  historyEnabled?: boolean;
  history?: RsfHistorySnapshot[];
  historyMaxOverride?: number | null;
  autoFormatSource?: boolean;
}

export function encodeRsf(data: RsfData): Uint8Array {
  return encodeRsfWorkbook({
    delimiter: data.delimiter,
    appName: data.appName,
    appVersion: data.appVersion,
    timezone: data.timezone,
    displayLanguage: data.displayLanguage,
    historyEnabled: data.historyEnabled,
    history: data.history,
    historyMaxOverride: data.historyMaxOverride,
    autoFormatSource: data.autoFormatSource,
    sheets: [
      {
        id: 's1',
        name: data.name,
        rowCount: data.rowCount,
        columnCount: data.columnCount,
        cells: data.cells,
        kind: data.kind,
        display: data.display,
        filter: data.filter,
        styles: data.styles,
        comments: data.comments,
        locked: data.locked,
      },
    ],
  });
}

export function decodeRsf(
  bytes: Uint8Array,
): { ok: true; data: RsfData } | { ok: false; error: RsfDecodeError } {
  const result = decodeRsfWorkbook(bytes);
  if (!result.ok) {
    return result;
  }
  const book = result.data;
  const sheet = book.sheets[0];
  const data: RsfData = {
    name: sheet.name,
    delimiter: book.delimiter,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    cells: sheet.cells,
    kind: sheet.kind ?? 'grid',
    locked: sheet.locked ?? false,
    historyEnabled: book.historyEnabled ?? true,
    autoFormatSource: book.autoFormatSource ?? false,
  };
  const optional: Partial<RsfData> = {
    appName: book.appName,
    appVersion: book.appVersion,
    display: sheet.display,
    filter: sheet.filter,
    filterDropped: sheet.filterDropped,
    timezone: book.timezone,
    displayLanguage: book.displayLanguage,
    styles: sheet.styles,
    comments: sheet.comments,
    history: book.history,
    historyMaxOverride: book.historyMaxOverride,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) {
      (data as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return { ok: true, data };
}

/** The JSON tree inside a `.rsf` file (container verified, content not validated). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rsfTree(bytes: Uint8Array): any {
  const text = unpackRsfJsonText(bytes);
  if (text === null) {
    throw new Error('not a valid .rsf container');
  }
  return JSON.parse(text);
}

/** A `.rsf` file holding `tree` as-is — for building files a real writer never would. */
export function rsfFromTree(tree: unknown): Uint8Array {
  return packRsfJsonText(JSON.stringify(tree));
}
