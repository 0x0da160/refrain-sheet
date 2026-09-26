// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  BORDER_LINE_STYLES,
  BORDER_SIDES,
  BORDER_STYLE_KEY,
  BORDER_WIDTH_KEY,
  BORDER_WIDTHS,
  DEFAULT_BORDER_LINE_STYLE,
  DEFAULT_BORDER_WIDTH,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_NUMBER_FORMAT_DECIMALS,
  NUMBER_FORMAT_KINDS,
  normalizeHexColor,
  type CellStyle,
  type NumberFormat,
  type NumberFormatKind,
} from './cell-style';
import { validateFilter, type SheetFilter } from './filter';
import { getRsfCodec } from './csv-engine';
import { MAX_COMMENT_LENGTH } from './cell-comment';
import { MAX_TEXT_RUNS, runsForText, type TextRun } from './rich-text';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language';
import { DEFAULT_TIMEZONE } from './timezone';
import { readSkippableFrame, readU32, writeSkippableFrame, writeU32, ZSTD_MAGIC } from './zstd-frame';

/**
 * The Refrain Sheet Format (`.rsf`): a UTF-8 JSON document compressed with
 * Zstandard. See `knowledge/formats/rsf/index.md` for the full specification.
 *
 * A file is two Zstandard frames:
 *
 * ```
 * off  size  field
 * 0    4     skippable-frame magic 0x184D2A5A (little-endian)
 * 4    4     skippable-frame payload size = 12
 * 8    4     identifier "RSF2"
 * 12   4     uncompressed JSON length in bytes (u32, at most MAX_RSF_BODY_BYTES)
 * 16   4     CRC-32 (IEEE) of the uncompressed JSON
 * 20   …     one standard Zstandard frame holding the JSON text
 * ```
 *
 * Standard tools skip the first frame, so `zstd -d book.rsf -o book.json`
 * yields the JSON directly. The reader requires the identifier (so a random
 * `.zst` file or an older binary `.rsf` is rejected rather than guessed at),
 * bounds decompression by the stored length (a decompression bomb cannot
 * exhaust memory), and checks the CRC-32 (accidental corruption only — it is
 * not tamper protection).
 *
 * The JSON is validated strictly on load: known keys must have the documented
 * types and stay within the bounds below; unknown keys are ignored. Cell
 * values are always plain strings — the raw input exactly as typed, a
 * formula being a string that starts with `=` — and are never interpreted as
 * HTML or code.
 */

/** The skippable-frame magic's low nibble (0x184D2A5A). */
const RSF_SKIPPABLE_NIBBLE = 0xa;
/** The container identifier inside the skippable frame. */
const RSF_IDENTIFIER = new Uint8Array([0x52, 0x53, 0x46, 0x32]); // "RSF2"
const HEADER_PAYLOAD_SIZE = 12;
const HEADER_SIZE = 8 + HEADER_PAYLOAD_SIZE;

/** The `format` value every document carries. */
const RSF_FORMAT_NAME = 'refrain-sheet';
/** The JSON document version this release writes and reads. */
export const RSF_FORMAT_VERSION = 1;

export const RSF_ZOOM_MIN = 50;
export const RSF_ZOOM_MAX = 200;
export const RSF_COL_WIDTH_MIN = 40;
export const RSF_COL_WIDTH_MAX = 1200;

const MAX_RSF_ROWS = 2_000_000;
const MAX_RSF_COLS = 16_384;
const MAX_RSF_CELLS = 20_000_000;
/** Longest cell input (UTF-16 code units). */
const MAX_RSF_CELL_LENGTH = 1_000_000;
/** The decompression ceiling: the longest JSON text a file may hold. */
export const MAX_RSF_BODY_BYTES = 512 * 1024 * 1024;
export const MAX_RSF_SHEETS = 256;
/** Longest worksheet name, in UTF-8 bytes. */
const MAX_RSF_SHEET_NAME_BYTES = 400;
/** Longest short metadata string (ids, app name/version, timezone, language). */
const MAX_META_LENGTH = 255;

/** Retained snapshots when the file sets no cap of its own. */
export const DEFAULT_HISTORY_SNAPSHOT_LIMIT = 20;
/** The hard ceiling on retained snapshots, even when "unlimited". */
export const MAX_RSF_HISTORY_SNAPSHOTS = 500;

/**
 * What a worksheet's content is: `grid` is an ordinary spreadsheet;
 * `markdown`, `json`, `yaml`, and `text` each hold one source document —
 * see `WorksheetKind` in `worksheet.ts`.
 */
export type RsfWorksheetKind = 'grid' | 'markdown' | 'json' | 'yaml' | 'text';

const WORKSHEET_KINDS: readonly RsfWorksheetKind[] = ['grid', 'markdown', 'json', 'yaml', 'text'];

/**
 * One entry of a document's version history: the workbook as it was at one
 * past successful save. `bytes` is that workbook's compact JSON text (UTF-8,
 * no history of its own — see {@link encodeRsfBody}), so history can never
 * nest. It is validated in full only when it is previewed or restored
 * ({@link decodeRsfHistorySnapshot}).
 */
export interface RsfHistorySnapshot {
  /** When this snapshot was captured (ms since epoch — the save time). */
  timestamp: number;
  /** The snapshot's compact JSON text, UTF-8. */
  bytes: Uint8Array;
}

/** Validated presentational state of one worksheet. */
export interface RsfDisplaySettings {
  /** Spreadsheet zoom percent, or undefined when the file stores none. */
  zoom?: number;
  /** Overridden column widths as [columnIndex, widthPx-at-100%] pairs. */
  colWidths?: Array<[number, number]>;
  /** Whether long cells wrap onto several visual lines. */
  wrap?: boolean;
}

/**
 * One worksheet. `id` is its stable internal identifier (never shown, kept
 * across renames); `name` is the display name cross-sheet formulas write.
 */
export interface RsfWorksheetData {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. A source worksheet holds its text at (0, 0). */
  cells: Array<[number, number, string]>;
  /** Absent means `grid`. */
  kind?: RsfWorksheetKind;
  display?: RsfDisplaySettings;
  /** The worksheet's filter, fully validated against its dimensions. */
  filter?: SheetFilter;
  /** Set on decode when a stored filter failed validation and was dropped (never guessed at). */
  filterDropped?: boolean;
  styles?: Array<[number, number, CellStyle]>;
  comments?: Array<[number, number, string]>;
  locked?: boolean;
}

/** A workbook: its metadata plus its worksheets, in order. */
export interface RsfWorkbookData {
  /** Delimiter used as the default for CSV export. */
  delimiter: DelimiterId;
  appName?: string;
  appVersion?: string;
  /** Creation / last-update timestamps (ms since epoch). */
  createdAt?: number;
  updatedAt?: number;
  /** Stable workbook identifier, preserved across saves. */
  docId?: string;
  /** The worksheet to activate on open; falls back to the first. */
  activeSheetId?: string;
  /** IANA timezone name read by `TODAY()`/`NOW()`; `RsfDocument` validates it. */
  timezone?: string;
  /** Display language read by `TEXT()`'s weekday names; `RsfDocument` validates it. */
  displayLanguage?: string;
  sheets: RsfWorksheetData[];
  /** Whether version history is recorded; absent means the default (`true`). */
  historyEnabled?: boolean;
  /** Past snapshots, oldest first. */
  history?: RsfHistorySnapshot[];
  /** The retained-snapshot cap: absent = default, `null` = unlimited, else 1–MAX_RSF_HISTORY_SNAPSHOTS. */
  historyMaxOverride?: number | null;
  /** Whether the JSON/YAML editors auto-format their source on commit (default `false`). */
  autoFormatSource?: boolean;
  /**
   * File-level display settings. Each one, when present, applies to every
   * worksheet that does not set its own (see `settings-cascade.ts`).
   */
  display?: RsfFileDisplaySettings;
}

/** Validated file-level display settings; an absent key means "not specified". */
interface RsfFileDisplaySettings {
  zoom?: number;
  wrap?: boolean;
}

/**
 * Why a file could not be opened. `legacy-format` is an `.rsf`/`.rcsv` file
 * in the binary format earlier releases wrote, which this release no longer
 * reads.
 */
export type RsfDecodeError =
  | 'bad-magic'
  | 'legacy-format'
  | 'bad-version'
  | 'bad-shape'
  | 'checksum'
  | 'unsupported-compression'
  | 'too-large';

export type RsfWorkbookDecodeResult =
  { ok: true; data: RsfWorkbookData } | { ok: false; error: RsfDecodeError };

class DecodeFailure extends Error {
  constructor(readonly reason: RsfDecodeError) {
    super(reason);
  }
}

function fail(reason: RsfDecodeError = 'bad-shape'): never {
  throw new DecodeFailure(reason);
}

// ----- A1 references -----

/** Column index (0-based) → letters: 0 → "A", 26 → "AA". */
function columnLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function lettersToColumn(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function a1(row: number, col: number): string {
  return `${columnLetters(col)}${row + 1}`;
}

const A1_PATTERN = /^([A-Z]{1,4})([1-9][0-9]{0,7})$/;
const COLUMN_PATTERN = /^[A-Z]{1,4}$/;

/** Parse an A1 key inside a `rows` × `cols` grid, or fail. */
function parseA1(key: string, rows: number, cols: number): [number, number] {
  const match = A1_PATTERN.exec(key);
  if (!match) {
    fail();
  }
  const col = lettersToColumn(match[1]);
  const row = Number(match[2]) - 1;
  if (row >= rows || col >= cols) {
    fail();
  }
  return [row, col];
}

// ----- Encoding -----

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * `input` is the cell's text: rich-text runs are written only while they
 * still spell it out (stale runs are dropped here, never saved).
 */
function styleToJson(style: CellStyle, input: string): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  if (style.bold) out.bold = true;
  if (style.italic) out.italic = true;
  if (style.underline) out.underline = true;
  if (style.textColor) out.textColor = style.textColor;
  if (style.backgroundColor) out.backgroundColor = style.backgroundColor;
  for (const side of BORDER_SIDES) {
    const color = style[side];
    if (!color) {
      continue;
    }
    out[side] = color;
    const lineStyle = style[BORDER_STYLE_KEY[side]];
    const width = style[BORDER_WIDTH_KEY[side]];
    // The defaults (solid, thin) are left out, so a style has one spelling.
    if (lineStyle && lineStyle !== DEFAULT_BORDER_LINE_STYLE) out[BORDER_STYLE_KEY[side]] = lineStyle;
    if (width && width !== DEFAULT_BORDER_WIDTH) out[BORDER_WIDTH_KEY[side]] = width;
  }
  if (style.numberFormat) {
    const f = style.numberFormat;
    const format: { [key: string]: Json } = { kind: f.kind, decimals: f.decimals, thousands: f.thousands };
    if (f.kind === 'currency' && f.currencySymbol !== undefined) {
      format.currencySymbol = f.currencySymbol;
    }
    out.numberFormat = format;
  }
  const runs = runsForText(style.runs, input);
  if (runs) {
    out.runs = runs.map((run) => {
      const json: { [key: string]: Json } = { text: run.text };
      if (run.bold !== undefined) json.bold = run.bold;
      if (run.italic !== undefined) json.italic = run.italic;
      if (run.underline !== undefined) json.underline = run.underline;
      if (run.textColor !== undefined) json.textColor = run.textColor;
      return json;
    });
  }
  return out;
}

function filterToJson(filter: SheetFilter): Json {
  return {
    top: filter.top,
    left: filter.left,
    bottom: filter.bottom,
    right: filter.right,
    headerRow: filter.headerRow,
    columns: filter.columns.map((column) => ({
      col: column.col,
      join: column.join,
      conditions: column.conditions.map((cond) =>
        cond.kind === 'text'
          ? { kind: 'text', op: cond.op, value: cond.value }
          : {
              kind: 'number',
              op: cond.op,
              value: cond.value,
              ...(cond.value2 !== undefined ? { value2: cond.value2 } : {}),
            },
      ),
      values: column.values,
    })),
  };
}

function sheetToJson(sheet: RsfWorksheetData): { [key: string]: Json } {
  const kind = sheet.kind ?? 'grid';
  const out: { [key: string]: Json } = { id: sheet.id, name: sheet.name, kind };
  if (sheet.locked) {
    out.locked = true;
  }
  if (kind === 'grid') {
    out.rows = sheet.rowCount;
    out.cols = sheet.columnCount;
    // Dense rows, trailing empty cells and rows trimmed.
    const rows: string[][] = [];
    for (const [row, col, input] of sheet.cells) {
      if (input === '' || row >= sheet.rowCount || col >= sheet.columnCount) {
        continue;
      }
      while (rows.length <= row) {
        rows.push([]);
      }
      const line = rows[row];
      while (line.length < col) {
        line.push('');
      }
      line[col] = input;
    }
    out.cells = rows;
  } else {
    const text = sheet.cells.find(([row, col]) => row === 0 && col === 0)?.[2] ?? '';
    out.lines = text.split('\n');
  }
  const display = sheet.display;
  if (display && (display.zoom !== undefined || display.wrap || (display.colWidths?.length ?? 0) > 0)) {
    const view: { [key: string]: Json } = {};
    if (display.zoom !== undefined) {
      view.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(display.zoom)));
    }
    if (display.wrap) {
      view.wrap = true;
    }
    const widths: { [key: string]: Json } = {};
    let any = false;
    for (const [col, width] of [...(display.colWidths ?? [])].sort((a, b) => a[0] - b[0])) {
      if (Number.isInteger(col) && col >= 0 && col < sheet.columnCount && width > 0) {
        widths[columnLetters(col)] = Math.max(
          RSF_COL_WIDTH_MIN,
          Math.min(RSF_COL_WIDTH_MAX, Math.round(width)),
        );
        any = true;
      }
    }
    if (any) {
      view.colWidths = widths;
    }
    out.view = view;
  }
  if (sheet.filter) {
    out.filter = filterToJson(sheet.filter);
  }
  if (sheet.styles && sheet.styles.length > 0) {
    const styles: { [key: string]: Json } = {};
    const inputs = new Map<string, string>();
    if (sheet.styles.some(([, , style]) => style.runs)) {
      for (const [row, col, input] of sheet.cells) {
        inputs.set(`${row},${col}`, input);
      }
    }
    for (const [row, col, style] of sheet.styles) {
      const json = styleToJson(style, inputs.get(`${row},${col}`) ?? '');
      if (Object.keys(json).length > 0) {
        styles[a1(row, col)] = json;
      }
    }
    out.styles = styles;
  }
  if (sheet.comments && sheet.comments.length > 0) {
    const comments: { [key: string]: Json } = {};
    for (const [row, col, text] of sheet.comments) {
      comments[a1(row, col)] = text.slice(0, MAX_COMMENT_LENGTH);
    }
    out.comments = comments;
  }
  return out;
}

/** The workbook's JSON tree, without the `format`/`version` header or history. */
function workbookContentToJson(data: RsfWorkbookData): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  if (data.appName !== undefined || data.appVersion !== undefined) {
    out.app = { name: data.appName ?? '', version: data.appVersion ?? '' };
  }
  if (data.docId) out.id = data.docId;
  if (data.createdAt !== undefined && Number.isFinite(data.createdAt)) out.created = isoTime(data.createdAt);
  if (data.updatedAt !== undefined && Number.isFinite(data.updatedAt)) out.updated = isoTime(data.updatedAt);
  out.delimiter = data.delimiter;
  // The defaults (UTC, English) are left out.
  if (data.timezone && data.timezone !== DEFAULT_TIMEZONE) out.timezone = data.timezone;
  if (data.displayLanguage && data.displayLanguage !== DEFAULT_DISPLAY_LANGUAGE) {
    out.language = data.displayLanguage;
  }
  if (data.activeSheetId) out.activeSheet = data.activeSheetId;
  if (data.autoFormatSource) out.autoFormatSource = true;
  const fileView = data.display;
  if (fileView && (fileView.zoom !== undefined || fileView.wrap !== undefined)) {
    const view: { [key: string]: Json } = {};
    if (fileView.zoom !== undefined) {
      view.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(fileView.zoom)));
    }
    if (fileView.wrap !== undefined) {
      view.wrap = fileView.wrap;
    }
    out.view = view;
  }
  out.sheets = data.sheets.slice(0, MAX_RSF_SHEETS).map(sheetToJson);
  return out;
}

function historyToJson(data: RsfWorkbookData): Json | undefined {
  const snapshots: Json[] = [];
  const dec = new TextDecoder();
  for (const snapshot of data.history ?? []) {
    let workbook: Json;
    try {
      workbook = JSON.parse(dec.decode(snapshot.bytes)) as Json;
    } catch {
      continue; // never written by this codec; skip rather than corrupt the file
    }
    snapshots.push({ at: isoTime(snapshot.timestamp), workbook });
  }
  const enabled = data.historyEnabled !== false;
  if (enabled && snapshots.length === 0 && data.historyMaxOverride === undefined) {
    return undefined; // all defaults: leave the section out
  }
  const out: { [key: string]: Json } = { enabled };
  if (data.historyMaxOverride !== undefined) {
    out.limit = data.historyMaxOverride;
  }
  out.snapshots = snapshots;
  return out;
}

/** Arrays of strings under these keys get one element per line (a source worksheet's text). */
const ONE_PER_LINE_KEYS: ReadonlySet<string> = new Set(['lines']);
const INLINE_OBJECT_MAX = 100;

function isPrimitive(value: Json): value is string | number | boolean | null {
  return value === null || typeof value !== 'object';
}

/**
 * Pretty-print for a text editor: 2-space indentation, but an array of plain
 * values stays on one line (one grid row per line) and a small object of
 * plain values stays inline (a style, a column-width table).
 */
function formatJson(value: Json, indent: string, key: string | null, out: string[]): void {
  if (isPrimitive(value)) {
    out.push(JSON.stringify(value));
    return;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push('[]');
      return;
    }
    if (value.every(isPrimitive) && !(key !== null && ONE_PER_LINE_KEYS.has(key))) {
      out.push(`[${value.map((v) => JSON.stringify(v)).join(', ')}]`);
      return;
    }
    out.push('[\n');
    value.forEach((item, i) => {
      out.push(inner);
      formatJson(item, inner, null, out);
      out.push(i < value.length - 1 ? ',\n' : '\n');
    });
    out.push(`${indent}]`);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    out.push('{}');
    return;
  }
  if (keys.every((k) => isPrimitive(value[k]))) {
    const inline = `{ ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(value[k])}`).join(', ')} }`;
    if (inline.length <= INLINE_OBJECT_MAX) {
      out.push(inline);
      return;
    }
  }
  out.push('{\n');
  keys.forEach((k, i) => {
    out.push(`${inner}${JSON.stringify(k)}: `);
    formatJson(value[k], inner, k, out);
    out.push(i < keys.length - 1 ? ',\n' : '\n');
  });
  out.push(`${indent}}`);
}

/** The document's full JSON text, as stored (before compression). */
export function rsfJsonText(data: RsfWorkbookData): string {
  const tree: { [key: string]: Json } = {
    format: RSF_FORMAT_NAME,
    version: RSF_FORMAT_VERSION,
    ...workbookContentToJson(data),
  };
  const history = historyToJson(data);
  if (history !== undefined) {
    tree.history = history;
  }
  const out: string[] = [];
  formatJson(tree, '', null, out);
  out.push('\n');
  return out.join('');
}

/** Encode a workbook as a `.rsf` file (JSON text, Zstandard-compressed). */
export function encodeRsfWorkbook(data: RsfWorkbookData): Uint8Array {
  return packRsfJsonText(rsfJsonText(data));
}

/**
 * Wrap JSON text in the `.rsf` container (header frame + Zstandard frame).
 * The text is not validated here — {@link decodeRsfWorkbook} validates on
 * load; tests use this to build files a real writer would never produce.
 */
export function packRsfJsonText(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (body.length > MAX_RSF_BODY_BYTES) {
    throw new RangeError('rsf: the document is larger than the format allows');
  }
  const codec = getRsfCodec();
  const payload = new Uint8Array(HEADER_PAYLOAD_SIZE);
  payload.set(RSF_IDENTIFIER, 0);
  writeU32(payload, 4, body.length);
  writeU32(payload, 8, codec.crc32(body));
  const header = writeSkippableFrame(RSF_SKIPPABLE_NIBBLE, payload);
  const frame = codec.compress(body);
  const out = new Uint8Array(header.length + frame.length);
  out.set(header, 0);
  out.set(frame, header.length);
  return out;
}

/**
 * A version-history snapshot's bytes for `data`: its compact JSON text with
 * no history of its own (see {@link RsfHistorySnapshot}).
 */
export function encodeRsfBody(data: RsfWorkbookData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(workbookContentToJson(data)));
}

// ----- Decoding -----

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optString(obj: JsonObject, key: string, max = MAX_META_LENGTH): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) {
    fail();
  }
  return value;
}

function optBoolean(obj: JsonObject, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    fail();
  }
  return value;
}

function optTime(obj: JsonObject, key: string): number | undefined {
  const value = optString(obj, key);
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function intIn(value: unknown, min: number, max: number, overflow: RsfDecodeError = 'bad-shape'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    fail();
  }
  if (value > max) {
    fail(overflow);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail();
  }
  return value as T;
}

function styleFromJson(value: unknown): CellStyle {
  if (!isObject(value)) {
    fail();
  }
  const style: CellStyle = {};
  if (optBoolean(value, 'bold')) style.bold = true;
  if (optBoolean(value, 'italic')) style.italic = true;
  if (optBoolean(value, 'underline')) style.underline = true;
  const color = (key: string): string | undefined => {
    const raw = optString(value, key);
    if (raw === undefined) {
      return undefined;
    }
    const hex = normalizeHexColor(raw);
    if (hex === null) {
      fail();
    }
    return hex;
  };
  const text = color('textColor');
  if (text) style.textColor = text;
  const background = color('backgroundColor');
  if (background) style.backgroundColor = background;
  for (const side of BORDER_SIDES) {
    const sideColor = color(side);
    if (!sideColor) {
      continue;
    }
    style[side] = sideColor;
    const lineStyle = value[BORDER_STYLE_KEY[side]];
    if (lineStyle !== undefined) {
      style[BORDER_STYLE_KEY[side]] = oneOf(lineStyle, BORDER_LINE_STYLES);
    }
    const width = value[BORDER_WIDTH_KEY[side]];
    if (width !== undefined) {
      style[BORDER_WIDTH_KEY[side]] = oneOf(width, BORDER_WIDTHS);
    }
  }
  const format = value.numberFormat;
  if (format !== undefined) {
    if (!isObject(format)) {
      fail();
    }
    const kind: NumberFormatKind = oneOf(format.kind, NUMBER_FORMAT_KINDS);
    const decimals = intIn(format.decimals, 0, MAX_NUMBER_FORMAT_DECIMALS);
    const thousands = optBoolean(format, 'thousands') ?? false;
    const numberFormat: NumberFormat = { kind, decimals, thousands };
    if (kind === 'currency') {
      const symbol = optString(format, 'currencySymbol', 64);
      numberFormat.currencySymbol = (symbol ?? '$').slice(0, MAX_CURRENCY_SYMBOL_LENGTH);
    }
    style.numberFormat = numberFormat;
  }
  if (value.runs !== undefined) {
    style.runs = runsFromJson(value.runs);
  }
  return style;
}

/** A style's rich-text runs: `[{ "text", "bold"?, "italic"?, "underline"?, "textColor"? }]`. */
function runsFromJson(value: unknown): TextRun[] {
  if (!Array.isArray(value)) {
    fail();
  }
  if (value.length > MAX_TEXT_RUNS) {
    fail('too-large');
  }
  let length = 0;
  return value.map((raw) => {
    if (!isObject(raw) || typeof raw.text !== 'string') {
      fail();
    }
    length += raw.text.length;
    if (length > MAX_RSF_CELL_LENGTH) {
      fail('too-large');
    }
    const run: TextRun = { text: raw.text };
    const bold = optBoolean(raw, 'bold');
    if (bold !== undefined) run.bold = bold;
    const italic = optBoolean(raw, 'italic');
    if (italic !== undefined) run.italic = italic;
    const underline = optBoolean(raw, 'underline');
    if (underline !== undefined) run.underline = underline;
    const color = optString(raw, 'textColor');
    if (color !== undefined) {
      const hex = normalizeHexColor(color);
      if (hex === null) {
        fail();
      }
      run.textColor = hex;
    }
    return run;
  });
}

/** Workbook-wide running totals, so many worksheets cannot add up past a bound. */
interface Totals {
  cells: number;
  styles: number;
  comments: number;
}

function sheetFromJson(value: unknown, totals: Totals): RsfWorksheetData {
  if (!isObject(value)) {
    fail();
  }
  const id = optString(value, 'id');
  const name = optString(value, 'name', MAX_RSF_SHEET_NAME_BYTES);
  if (!id || name === undefined || new TextEncoder().encode(name).length > MAX_RSF_SHEET_NAME_BYTES) {
    fail();
  }
  const kind: RsfWorksheetKind = value.kind === undefined ? 'grid' : oneOf(value.kind, WORKSHEET_KINDS);
  const sheet: RsfWorksheetData = { id, name, rowCount: 1, columnCount: 1, cells: [] };
  if (kind !== 'grid') {
    sheet.kind = kind;
    const lines = value.lines ?? [];
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string')) {
      fail();
    }
    const text = (lines as string[]).join('\n');
    if (text.length > MAX_RSF_CELL_LENGTH) {
      fail('too-large');
    }
    if (text !== '') {
      sheet.cells.push([0, 0, text]);
      totals.cells += 1;
    }
  } else {
    const rows = intIn(value.rows, 1, MAX_RSF_ROWS, 'too-large');
    const cols = intIn(value.cols, 1, MAX_RSF_COLS, 'too-large');
    if (rows * cols > MAX_RSF_CELLS) {
      fail('too-large');
    }
    sheet.rowCount = rows;
    sheet.columnCount = cols;
    const cells = value.cells ?? [];
    if (!Array.isArray(cells) || cells.length > rows) {
      fail();
    }
    for (let r = 0; r < cells.length; r++) {
      const line: unknown = cells[r];
      if (!Array.isArray(line) || line.length > cols) {
        fail();
      }
      for (let c = 0; c < line.length; c++) {
        const input: unknown = line[c];
        if (typeof input !== 'string') {
          fail();
        }
        if (input === '') {
          continue;
        }
        if (input.length > MAX_RSF_CELL_LENGTH) {
          fail('too-large');
        }
        sheet.cells.push([r, c, input]);
      }
    }
    totals.cells += sheet.cells.length;
  }
  if (totals.cells > MAX_RSF_CELLS) {
    fail('too-large');
  }
  if (optBoolean(value, 'locked')) {
    sheet.locked = true;
  }
  if (value.view !== undefined) {
    const view = value.view;
    if (!isObject(view)) {
      fail();
    }
    const display: RsfDisplaySettings = {};
    if (view.zoom !== undefined) {
      if (typeof view.zoom !== 'number' || !Number.isFinite(view.zoom)) {
        fail();
      }
      display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(view.zoom)));
    }
    if (optBoolean(view, 'wrap')) {
      display.wrap = true;
    }
    if (view.colWidths !== undefined) {
      if (!isObject(view.colWidths)) {
        fail();
      }
      const widths: Array<[number, number]> = [];
      for (const [letters, width] of Object.entries(view.colWidths)) {
        if (!COLUMN_PATTERN.test(letters) || typeof width !== 'number' || !Number.isFinite(width)) {
          fail();
        }
        const col = lettersToColumn(letters);
        if (col < sheet.columnCount) {
          widths.push([col, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, Math.round(width)))]);
        }
      }
      if (widths.length > 0) {
        display.colWidths = widths;
      }
    }
    if (display.zoom !== undefined || display.wrap || display.colWidths) {
      sheet.display = display;
    }
  }
  if (value.filter !== undefined && value.filter !== null) {
    // Full semantic validation against this worksheet's dimensions; an
    // invalid filter is dropped (never guessed at) and the caller warns.
    let validated: SheetFilter | null = null;
    try {
      validated = isObject(value.filter)
        ? validateFilter(value.filter as unknown as SheetFilter, sheet.rowCount, sheet.columnCount)
        : null;
    } catch {
      validated = null;
    }
    if (validated) {
      sheet.filter = validated;
    } else {
      sheet.filterDropped = true;
    }
  }
  if (value.styles !== undefined) {
    if (!isObject(value.styles)) {
      fail();
    }
    const styles: Array<[number, number, CellStyle]> = [];
    for (const [key, raw] of Object.entries(value.styles)) {
      const [row, col] = parseA1(key, sheet.rowCount, sheet.columnCount);
      styles.push([row, col, styleFromJson(raw)]);
    }
    totals.styles += styles.length;
    if (totals.styles > MAX_RSF_CELLS) {
      fail('too-large');
    }
    if (styles.length > 0) {
      sheet.styles = styles;
    }
  }
  if (value.comments !== undefined) {
    if (!isObject(value.comments)) {
      fail();
    }
    const comments: Array<[number, number, string]> = [];
    for (const [key, text] of Object.entries(value.comments)) {
      const [row, col] = parseA1(key, sheet.rowCount, sheet.columnCount);
      if (typeof text !== 'string') {
        fail();
      }
      if (text.length > MAX_COMMENT_LENGTH) {
        fail('too-large');
      }
      comments.push([row, col, text]);
    }
    totals.comments += comments.length;
    if (totals.comments > MAX_RSF_CELLS) {
      fail('too-large');
    }
    if (comments.length > 0) {
      sheet.comments = comments;
    }
  }
  return sheet;
}

/** Validate a workbook tree (the document itself, or a history snapshot's). */
function workbookFromJson(value: unknown): RsfWorkbookData {
  if (!isObject(value)) {
    fail();
  }
  const delimiter = value.delimiter === undefined ? ',' : oneOf(value.delimiter, [',', ';', '\t'] as const);
  const rawSheets = value.sheets;
  if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
    fail();
  }
  if (rawSheets.length > MAX_RSF_SHEETS) {
    fail('too-large');
  }
  const totals: Totals = { cells: 0, styles: 0, comments: 0 };
  const sheets = rawSheets.map((sheet) => sheetFromJson(sheet, totals));
  const ids = new Set<string>();
  for (const sheet of sheets) {
    // Worksheet identifiers must be unique: duplicates would make the active
    // worksheet and every cross-sheet reference ambiguous.
    if (ids.has(sheet.id)) {
      fail();
    }
    ids.add(sheet.id);
  }
  const data: RsfWorkbookData = { delimiter, sheets };
  if (value.app !== undefined) {
    if (!isObject(value.app)) {
      fail();
    }
    const appName = optString(value.app, 'name');
    const appVersion = optString(value.app, 'version');
    if (appName) data.appName = appName;
    if (appVersion) data.appVersion = appVersion;
  }
  const docId = optString(value, 'id');
  if (docId) data.docId = docId;
  const createdAt = optTime(value, 'created');
  if (createdAt !== undefined) data.createdAt = createdAt;
  const updatedAt = optTime(value, 'updated');
  if (updatedAt !== undefined) data.updatedAt = updatedAt;
  const timezone = optString(value, 'timezone');
  if (timezone) data.timezone = timezone;
  const language = optString(value, 'language');
  if (language) data.displayLanguage = language;
  if (optBoolean(value, 'autoFormatSource')) data.autoFormatSource = true;
  if (value.view !== undefined) {
    const view = value.view;
    if (!isObject(view)) {
      fail();
    }
    const display: RsfFileDisplaySettings = {};
    if (view.zoom !== undefined) {
      if (typeof view.zoom !== 'number' || !Number.isFinite(view.zoom)) {
        fail();
      }
      display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(view.zoom)));
    }
    const wrap = optBoolean(view, 'wrap');
    if (wrap !== undefined) {
      display.wrap = wrap;
    }
    if (display.zoom !== undefined || display.wrap !== undefined) {
      data.display = display;
    }
  }
  // An active-worksheet id that names no worksheet falls back to the first.
  const active = optString(value, 'activeSheet');
  data.activeSheetId = active !== undefined && ids.has(active) ? active : sheets[0].id;
  return data;
}

function historyFromJson(value: unknown, data: RsfWorkbookData): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    fail();
  }
  if (optBoolean(value, 'enabled') === false) {
    data.historyEnabled = false;
  }
  if (value.limit !== undefined) {
    data.historyMaxOverride = value.limit === null ? null : intIn(value.limit, 1, MAX_RSF_HISTORY_SNAPSHOTS);
  }
  const snapshots = value.snapshots ?? [];
  if (!Array.isArray(snapshots)) {
    fail();
  }
  if (snapshots.length > MAX_RSF_HISTORY_SNAPSHOTS) {
    fail('too-large');
  }
  const enc = new TextEncoder();
  const history: RsfHistorySnapshot[] = [];
  for (const entry of snapshots) {
    if (!isObject(entry) || !isObject(entry.workbook)) {
      fail();
    }
    const timestamp = optTime(entry, 'at');
    if (timestamp === undefined) {
      fail();
    }
    // Kept as compact JSON; validated in full only when previewed or restored.
    history.push({ timestamp, bytes: enc.encode(JSON.stringify(entry.workbook)) });
  }
  if (history.length > 0) {
    data.history = history;
  }
}

function parseJsonText(body: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    fail();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail();
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/** The binary container earlier releases wrote ("RSF1", and "RCSV" before it). */
function isLegacyContainer(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x52, 0x53, 0x46, 0x31]) || startsWith(bytes, [0x52, 0x43, 0x53, 0x56]);
}

/** The container half of decoding: the verified JSON bytes, or a {@link DecodeFailure}. */
function unpackBody(bytes: Uint8Array): Uint8Array {
  if (isLegacyContainer(bytes)) {
    fail('legacy-format');
  }
  const header = readSkippableFrame(bytes, RSF_SKIPPABLE_NIBBLE);
  if (
    !header ||
    header.payload.length !== HEADER_PAYLOAD_SIZE ||
    !startsWith(header.payload, [...RSF_IDENTIFIER])
  ) {
    fail('bad-magic');
  }
  const length = readU32(header.payload, 4);
  const crc = readU32(header.payload, 8);
  if (length > MAX_RSF_BODY_BYTES) {
    fail('too-large');
  }
  const frame = bytes.subarray(HEADER_SIZE);
  if (frame.length < 4 || readU32(frame, 0) !== ZSTD_MAGIC) {
    fail();
  }
  const codec = getRsfCodec();
  const body = codec.decompress(frame, length);
  if (body === 'needs-wasm') {
    fail('unsupported-compression');
  }
  if (body === null) {
    fail();
  }
  if (codec.crc32(body) !== crc) {
    fail('checksum');
  }
  return body;
}

/** The JSON text inside a `.rsf` file, or null when the container is invalid. */
export function unpackRsfJsonText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder().decode(unpackBody(bytes));
  } catch (err) {
    if (err instanceof DecodeFailure) {
      return null;
    }
    throw err;
  }
}

/** Decode and strictly validate `.rsf` bytes. Never executes anything. */
export function decodeRsfWorkbook(bytes: Uint8Array): RsfWorkbookDecodeResult {
  try {
    const tree = parseJsonText(unpackBody(bytes));
    if (!isObject(tree) || tree.format !== RSF_FORMAT_NAME) {
      fail();
    }
    if (tree.version !== RSF_FORMAT_VERSION) {
      fail('bad-version');
    }
    const data = workbookFromJson(tree);
    historyFromJson(tree.history, data);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof DecodeFailure) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}

/** Decode one version-history snapshot into a workbook (see {@link RsfHistorySnapshot}). */
export function decodeRsfHistorySnapshot(snapshot: RsfHistorySnapshot): RsfWorkbookDecodeResult {
  try {
    if (snapshot.bytes.length > MAX_RSF_BODY_BYTES) {
      fail('too-large');
    }
    return { ok: true, data: workbookFromJson(parseJsonText(snapshot.bytes)) };
  } catch (err) {
    if (err instanceof DecodeFailure) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}
