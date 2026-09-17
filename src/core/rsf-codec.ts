// SPDX-License-Identifier: MIT
import type { DelimiterId } from './byte-csv-parser';
import {
  BORDER_SIDES,
  BORDER_STYLE_KEY,
  BORDER_WIDTH_KEY,
  borderSideValue,
  COLOR_KEYS,
  DEFAULT_BORDER_LINE_STYLE,
  DEFAULT_BORDER_WIDTH,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_NUMBER_FORMAT_DECIMALS,
  type BorderLineStyle,
  type BorderSide,
  type BorderWidth,
  type CellStyle,
  type NumberFormat,
  type NumberFormatKind,
} from './cell-style';
import {
  FILTER_NUMBER_OPS,
  FILTER_TEXT_OPS,
  MAX_FILTER_COLUMNS,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_STRING,
  MAX_FILTER_VALUES,
  validateFilter,
  type ColumnFilter,
  type FilterCondition,
  type SheetFilter,
} from './filter';
import {
  getRsfCodec,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_LZ4,
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_ZSTD,
  RSF_METHODS,
} from './csv-engine';
import { DEFAULT_TIMEZONE } from './timezone';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language';
import { MAX_COMMENT_LENGTH } from './cell-comment';

export {
  RSF_COMPRESSION_STORE,
  RSF_COMPRESSION_DEFLATE,
  RSF_COMPRESSION_ZSTD,
  RSF_COMPRESSION_LZ4,
  RSF_METHODS,
};

/**
 * Binary Refrain Sheet Format (`.rsf`) container. The container is a small
 * fixed header followed by a (optionally compressed) binary body describing
 * the sheet. The header records the uncompressed body length and a CRC-32
 * checksum so corruption is detected, and decompression is bounded by the
 * stored length so a crafted payload cannot exhaust memory. See
 * `docs/rsf-format.md`.
 *
 * Container layout (little-endian):
 *
 * ```
 * off  size  field
 * 0    4     magic "RSF1" (0x52 0x53 0x46 0x31)
 * 4    1     container version (3)
 * 5    1     compression method (0 = store, 1 = deflate, 2 = zstd, 3 = lz4 frame)
 * 6    1     flags (reserved, 0)
 * 7    1     codec profile version (0)
 * 8    4     uncompressed body length (u32)
 * 12   4     CRC-32 of the uncompressed body (u32)
 * 16   4     compressed payload length (u32)
 * 20   …     payload
 * ```
 *
 * **Compatibility.** The format was previously named "Refrain CSV Format"
 * (RCSV) and used the magic "RCSV" (0x52 0x43 0x53 0x56) with container
 * version 2. Only the container name, magic bytes, and version number changed
 * in the rename to RSF — the header shape and body layout are byte-identical.
 * Legacy `.rcsv` files (magic "RCSV", container version 2) are therefore read
 * transparently as a legacy *import* format; the document is then saved as
 * `.rsf` (new magic, version 3). Writing only ever produces the current
 * format, so old readers safely reject the new magic rather than
 * misinterpreting it.
 *
 * The compression method is per-file: a container records which codec packed
 * its payload, so any supported method round-trips and unknown methods are
 * rejected safely. The default for new documents is Zstandard (method 2). CRC-32
 * detects accidental corruption only — it is not tamper protection.
 *
 * Body layout (little-endian), all strings UTF-8. Body version 2 adds the
 * creating/updating application metadata after the delimiter; version 3 adds
 * the display-settings block; version 4 adds the sheet-filter block; version 6
 * adds the workbook timezone; version 7 adds the workbook display language;
 * version 8 adds the cell-style block; version 9 adds a per-style number
 * format; version 10 adds a per-border-side line style and width; version 11
 * adds the cell-comment block; version 12 adds the worksheet-kind byte;
 * version 13 adds the worksheet-locked byte; version 14 adds the version
 * history block; version 15 allows the worksheet-kind byte to also hold
 * `json` (2), rejected as `bad-shape` below that version; version 16 adds a
 * per-file retained-snapshot cap override (a `u32` right after the history
 * flags byte) to the history block. Older versions are still accepted on
 * read:
 *
 * ```
 * 0    1     body version (1–15 readable; lowest sufficient version written)
 * 1    1     delimiter byte (',' ';' or TAB)
 * --- body versions 2+ ---
 * 2    2     application-name length (u16)
 * …    …     application name
 * …    2     application-version length (u16)
 * …    …     application version
 * --- body versions 3+ ---
 * …    2     spreadsheet zoom percent (u16; 0 = not stored)
 * …    4     column-width entry count (u32)
 * …    per entry: column index (u32), width px at 100% zoom (u16)
 * --- body version 5+ ---
 * …    1     display flags (bit 0: wrap long rows)
 * --- body version 4+ ---
 * …    1     filter flags (bit 0: a filter is present)
 * …    …     filter block (only when present — see `docs/rsf-format.md`)
 * --- body version 6+ ---
 * …    2     IANA timezone-name length (u16; written only when non-UTC)
 * …    …     IANA timezone name
 * --- body version 7+ ---
 * …    2     display-language length (u16; written only when non-default, "en")
 * …    …     display-language id ("en" or "ja")
 * --- body version 12+ ---
 * …    1     worksheet kind (0 = grid, 1 = markdown, 2 = json; written only
 *            when non-grid; 2 legal only from body version 15)
 * --- body version 13+ ---
 * …    1     worksheet locked (0 = unlocked, 1 = locked; written only when locked)
 * --- body version 14+ ---
 * …    1     history flags (bit 0: version history enabled; bit 1: retained-
 *            snapshot cap is unlimited — body version 16+ only, always 0 below it)
 * --- body version 16+ ---
 * …    4     retained-snapshot cap override (u32; ignored when bit 1 above is
 *            set, written as 0 in that case)
 * --- body version 14+ ---
 * …    4     snapshot count (u32)
 * …    per snapshot: timestamp f64 (ms since epoch), byte length (u32), opaque bytes
 * --- all versions ---
 * …    2     sheet-name length (u16)
 * …    …     sheet name
 * …    4     row count (u32)
 * …    4     column count (u32)
 * …    4     cell count (u32)
 * …    per cell: row (u32), col (u32), input length (u32), input bytes
 * --- body version 8+ ---
 * …    4     styled-cell count (u32)
 * …    per style: row (u32), col (u32), style flags (u16), then one 3-byte
 *             RGB triple per flag bit set — for a border-side flag, followed
 *             (version 10+ only) by one line-style+width byte — then
 *             (version 9+ only) a number format sub-record (see
 *             `docs/rsf-format.md`)
 * --- body version 11+ ---
 * …    4     commented-cell count (u32)
 * …    per comment: row (u32), col (u32), text length (u32), text bytes
 * ```
 */
export const RSF_MAGIC = new Uint8Array([0x52, 0x53, 0x46, 0x31]); // "RSF1"
export const RSF_CONTAINER_VERSION = 3;
/**
 * Legacy "Refrain CSV Format" container magic ("RCSV") and version, read for
 * backward compatibility so existing `.rcsv` files open. Never written.
 */
export const RSF_LEGACY_MAGIC = new Uint8Array([0x52, 0x43, 0x53, 0x56]); // "RCSV"
export const RSF_LEGACY_CONTAINER_VERSION = 2;
/**
 * Highest body version this release reads and writes. Version selection on
 * write is minimal: 16 when this file overrides its retained-snapshot cap
 * (see {@link RsfData.historyMaxOverride}), else 15 when the worksheet is a
 * json sheet (see {@link WorksheetKind} in `worksheet.ts`), else 14 when
 * version history is disabled or holds at least one snapshot (see
 * {@link RsfData.history}), else 13 when the worksheet is locked (see
 * {@link Worksheet.locked} in `worksheet.ts`), else 12 when the worksheet is
 * a markdown sheet, else 11 when at least one cell carries a comment, else 10
 * when at least one border side carries a non-default line style or width,
 * else 9 when at least one cell carries a number format, else 8 when at
 * least one cell carries a style, else 7 when the workbook display language
 * is not English, else 6 when the workbook timezone is not UTC, else 5 when
 * wrap-long-rows is stored, else 4 when a sheet filter is present, else 3
 * when display settings are present, else 2 when application metadata is
 * present, else 1 — so documents without the newer data stay readable by
 * older releases. Versions 1–16 are all accepted on read; an older reader
 * rejects a version it does not know with `bad-version` (a localized
 * "unsupported version" message) rather than misparsing it.
 */
export const RSF_BODY_VERSION = 16;

// ----- Display-settings bounds (body version 3) -----------------------------
// Persisted display state is validated and clamped on load so a malformed or
// hostile container can never push layout, allocation, or rendering outside
// safe bounds. The width bounds mirror the grid's MIN_COL_WIDTH/MAX_COL_WIDTH
// (src/ui/grid.ts) — the UI clamps again, but the codec enforces them first.

/** Smallest / largest spreadsheet zoom the container may carry (percent). */
export const RSF_ZOOM_MIN = 50;
export const RSF_ZOOM_MAX = 200;
/** Column-width bounds (px at 100% zoom) for persisted display widths. */
export const RSF_COL_WIDTH_MIN = 40;
export const RSF_COL_WIDTH_MAX = 1200;
/** Maximum stored length (bytes) of the application name/version metadata strings. */
const MAX_META_LENGTH = 255;
const HEADER_SIZE = 20;
/**
 * Codec profile version stored at header byte 7. All current codecs use stable
 * frame formats (DEFLATE/RFC-1951, Zstandard, LZ4 Frame) at profile 0; the byte
 * is reserved so a future codec revision can be distinguished and rejected
 * safely by older readers. Non-zero profiles are unsupported for now.
 */
export const RSF_CODEC_PROFILE = 0;

export const MAX_RSF_ROWS = 2_000_000;
export const MAX_RSF_COLS = 16_384;
export const MAX_RSF_CELLS = 20_000_000;
export const MAX_RSF_CELL_LENGTH = 1_000_000;
/**
 * Maximum stored length (UTF-8 bytes) of one cell's comment text. Comment
 * text is already capped at {@link MAX_COMMENT_LENGTH} UTF-16 code units on
 * write (`normalizeCommentText`); this is a generous byte-level ceiling (3
 * bytes per unit covers every UTF-8 encoding of a UTF-16 code unit) enforced
 * on read too, so a crafted container cannot claim an unbounded comment.
 */
export const MAX_RSF_COMMENT_BYTES = MAX_COMMENT_LENGTH * 3;
/** Decompression-bomb ceiling for the uncompressed body (512 MiB). */
export const MAX_RSF_BODY_BYTES = 512 * 1024 * 1024;
/**
 * Default number of snapshots a document retains in its version history (body
 * version 14 / workbook body version 10; see {@link RsfData.history}) when the
 * file carries no cap override of its own (see
 * {@link RsfData.historyMaxOverride}). Every document saved before the
 * per-file override existed effectively uses this default.
 */
export const DEFAULT_HISTORY_SNAPSHOT_LIMIT = 20;
/**
 * Absolute technical ceiling on retained snapshots, regardless of the
 * per-file cap (including an explicit "unlimited" choice — see
 * {@link RsfData.historyMaxOverride}). Each snapshot is a full copy of the
 * document, so an unbounded cap could otherwise grow a repeatedly-saved file
 * without limit; this keeps worst-case file size and decode cost bounded. A
 * snapshot count above this on read, or a per-file override above it, is
 * `too-large` / `bad-shape` respectively.
 */
export const MAX_RSF_HISTORY_SNAPSHOTS = 500;

// ----- Workbook container (container version 4) ------------------------------

/**
 * Container version of a **workbook** payload: one or more worksheets, their
 * stable identifiers, order, and the active-worksheet identifier. Written only
 * when a workbook actually holds more than one worksheet — a single-worksheet
 * workbook keeps writing the version-3 single-sheet container, so files that
 * do not use the new capability stay readable by older releases.
 *
 * Older readers validate the magic/version *pair* and therefore reject a
 * version-4 container outright (`bad-version`, surfaced as a localized
 * "unsupported version" explanation) instead of misparsing it.
 */
export const RSF_CONTAINER_VERSION_WORKBOOK = 4;

/**
 * Highest workbook body version this release reads and writes. Version 12 is
 * written whenever this workbook overrides its retained-snapshot cap (see
 * {@link RsfWorkbookData.historyMaxOverride}); version 11 is written whenever
 * at least one worksheet in the workbook is a json sheet (see
 * {@link WorksheetKind} in `worksheet.ts`) — the per-worksheet
 * worksheet-kind byte (see version 8 below) is only legal to hold `json` (2)
 * from this version; version 10 adds the workbook-level version-history
 * block (history flags plus a snapshot count and records — see
 * {@link RsfWorkbookData.history}), written whenever history is disabled or
 * holds at least one snapshot; version 9 appends one worksheet-locked byte (0
 * = unlocked, 1 = locked; see {@link Worksheet.locked} in `worksheet.ts`) to
 * the end of every worksheet record, written only when at least one
 * worksheet in the workbook is locked; version 8 appends one worksheet-kind
 * byte (0 = grid, 1 = markdown, 2 = json) to the end of every worksheet
 * record, written only when at least one worksheet in the workbook is a
 * markdown or json sheet; version 7 adds a per-worksheet cell-comment block
 * (written only when at least one cell in the workbook carries a comment);
 * version 6 adds a per-border-side line style and width (written only when at
 * least one border side in the workbook uses a non-default one); version 5
 * adds a per-style number format (written only when at least one styled cell
 * in the workbook carries one); version 4 adds a per-worksheet cell-style
 * block (written only when at least one cell in the workbook carries a
 * style); version 3 adds the workbook display language (written only when it
 * is not English); version 2 adds the workbook timezone (written only when it
 * is not UTC); version 1 is the original layout.
 */
export const RSF_WORKBOOK_BODY_VERSION = 12;

/**
 * Bounds for workbook payloads. A malformed or hostile container can never
 * push allocation or processing beyond these: the worksheet count and every
 * per-worksheet dimension are validated before anything is allocated, and the
 * total cell count across all worksheets is capped by {@link MAX_RSF_CELLS}.
 */
export const MAX_RSF_SHEETS = 256;
/** Maximum stored length (bytes) of a worksheet name or identifier. */
export const MAX_RSF_SHEET_NAME_BYTES = 400;

/**
 * What a worksheet's content is (body version 12 / workbook body version 8;
 * `json` requires body version 15 / workbook body version 11): `grid` is
 * every worksheet before this field existed and the default when absent;
 * `markdown` holds one Markdown document as its sole content; `json` holds
 * one JSON document as its sole content — see {@link WorksheetKind} in
 * `worksheet.ts`, the reference implementation this mirrors byte-for-byte.
 */
export type RsfWorksheetKind = 'grid' | 'markdown' | 'json';

/**
 * One entry in a document's version (snapshot) history (body version 14 /
 * workbook body version 10; see {@link RsfData.history}): the document's full
 * content as it was at one past successful save. `bytes` is an opaque,
 * headerless body encoding — the same shape {@link encodeRsfBody} produces —
 * with no history section of its own, so a snapshot never nests another
 * snapshot list inside itself and history cannot grow recursively. It carries
 * no executable content: exactly the same inert cell/style/formula data the
 * live document itself stores, nothing more.
 */
export interface RsfHistorySnapshot {
  /** When this snapshot was captured (ms since epoch — the save time). */
  timestamp: number;
  /** Opaque encoded document bytes for this snapshot (see above). */
  bytes: Uint8Array;
}

export interface RsfData {
  name: string;
  delimiter: DelimiterId;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. */
  cells: Array<[number, number, string]>;
  /**
   * The worksheet's kind (body version 12+). Absent (or `'grid'`) is the
   * default and keeps the body at its otherwise-minimal version; `'markdown'`
   * forces version 12 to be written; `'json'` forces version 15. On decode
   * this is `'grid'` for every body version below 12.
   */
  kind?: RsfWorksheetKind;
  /**
   * Creating/updating application metadata. When either field is provided the
   * body is written in version 2 (metadata-bearing); when both are omitted the
   * body is written in the legacy version 1. On decode these are populated
   * only for version-2 bodies (left undefined for version 1).
   */
  appName?: string;
  appVersion?: string;
  /**
   * Compression method the container was packed with (one of the
   * `RSF_COMPRESSION_*` ids). Populated on decode so a document can preserve
   * its method on the next save; ignored on encode (the method is passed to
   * {@link encodeRsf} explicitly).
   */
  compression?: number;
  /**
   * Non-executable display settings (body versions 3+). Purely
   * presentational: they never affect cell data, evaluation, or export. When
   * present on encode the body is written in version 3 (or 4 when a filter
   * is also present); on decode this is populated only for version-3+
   * bodies, already validated and clamped (zoom into
   * [{@link RSF_ZOOM_MIN}, {@link RSF_ZOOM_MAX}]; widths into
   * [{@link RSF_COL_WIDTH_MIN}, {@link RSF_COL_WIDTH_MAX}]; entries for
   * out-of-range columns dropped).
   */
  display?: RsfDisplaySettings;
  /**
   * The sheet's filter state (body version 4). Pure, non-executable criteria
   * data: no expressions, patterns, URLs, or code of any kind — only operator
   * ids, plain comparison strings, and numbers. When present on encode the
   * body is written in version 4; on decode it is populated only when the
   * stored filter passes full structural + bounds validation against the
   * sheet's dimensions.
   */
  filter?: SheetFilter;
  /**
   * Set on decode when a version-4 body carried a structurally readable
   * filter block whose contents failed validation (out-of-range coordinates,
   * unknown operators, bounds violations). The filter is ignored — never
   * guessed at — and the caller shows a localized warning; the sheet itself
   * loads normally.
   */
  filterDropped?: boolean;
  /**
   * The workbook's IANA timezone name (body version 6+), read by `TODAY()`
   * and `NOW()`. Written only when it differs from `"UTC"`, so a document
   * whose timezone is UTC (including every document saved before this field
   * existed) stays on the lowest sufficient body version. On decode this is
   * the raw stored string, not yet validated against `Intl` — the caller
   * (`RsfDocument`) falls back to UTC for an absent or unresolvable value.
   */
  timezone?: string;
  /**
   * The workbook's stored display language (body version 7+), read by
   * `TEXT()`'s `ddd`/`dddd` weekday-name tokens. Written only when it differs
   * from `"en"`, so a document using the default language (including every
   * document saved before this field existed) stays on the lowest sufficient
   * body version. On decode this is the raw stored string, not yet validated
   * — the caller (`RsfDocument`) falls back to `"en"` for an absent or
   * unrecognized value.
   */
  displayLanguage?: string;
  /**
   * Cell-level visual formatting (body version 8): bold/italic/underline,
   * text/background color, and per-side borders. Purely presentational — it
   * never affects cell data, evaluation, or export. When present on encode
   * the body is written in version 8; on decode it is populated only for
   * version-8 bodies. Row/column indices are validated against the sheet's
   * dimensions exactly like cell records (out of range is `bad-shape`).
   */
  styles?: Array<[number, number, CellStyle]>;
  /**
   * Cell-level annotations (body version 11): a short free-text note
   * attached to a cell, independent of its value (see
   * `src/core/cell-comment.ts`). Purely an annotation — it never affects a
   * cell's value, formula evaluation, sort, filter, or CSV export. When
   * present on encode the body is written in version 11; on decode this is
   * populated only for version-11 bodies. Row/column indices are validated
   * against the sheet's dimensions exactly like cell records (out of range
   * is `bad-shape`).
   */
  comments?: Array<[number, number, string]>;
  /**
   * Whether this worksheet is locked against editing (body version 13). A
   * plain, non-cryptographic protection flag — no password, and no effect on
   * cell data, formula evaluation, or export. Absent (or `false`) is the
   * default and keeps the body at its otherwise-minimal version; `true`
   * forces version 13 to be written. On decode this is `false` for every
   * body version below 13.
   */
  locked?: boolean;
  /**
   * Whether version history is recorded for this document (body version 14),
   * a per-file setting (see `RsfDocument.setHistoryEnabled`). Absent means
   * "use the default" (`true`) — every new document, and every file saved
   * before this setting existed, keeps recording history unless explicitly
   * turned off. Written only when `false` (the non-default choice) or when
   * {@link history} is non-empty, so a document left on the default with no
   * snapshots yet stays on the lowest sufficient body version. On decode this
   * is `true` for every body version below 14.
   */
  historyEnabled?: boolean;
  /**
   * Past snapshots of this document's content (body version 14), oldest
   * first, capped at {@link effectiveHistoryMax} by the writer (the oldest is
   * dropped once a save would exceed it). On decode this is populated only
   * for version-14+ bodies whose block holds at least one snapshot; a count
   * above {@link MAX_RSF_HISTORY_SNAPSHOTS} is `too-large`.
   */
  history?: RsfHistorySnapshot[];
  /**
   * This file's override of the retained-snapshot cap (body version 16),
   * a per-file setting (see `RsfDocument.setHistoryMaxOverride`). `undefined`
   * (absent) means "use the default" ({@link DEFAULT_HISTORY_SNAPSHOT_LIMIT})
   * — every file saved before this setting existed; `null` means "unlimited"
   * (still bounded by the hard ceiling {@link MAX_RSF_HISTORY_SNAPSHOTS}); a
   * number is an explicit cap, validated into `[1, MAX_RSF_HISTORY_SNAPSHOTS]`
   * on decode (`bad-shape` outside that range). Written only when present, so
   * a document left on the default stays on the lowest sufficient body
   * version. On decode this is `undefined` for every body version below 16.
   */
  historyMaxOverride?: number | null;
}

/**
 * One worksheet inside a workbook container. `id` is the worksheet's stable
 * internal identifier (never shown to the user, unchanged by a rename); `name`
 * is the display name that cross-sheet formulas write.
 */
export interface RsfWorksheetData {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Non-empty cells as [row, col, input] triples. */
  cells: Array<[number, number, string]>;
  /** This worksheet's kind (workbook body version 8+); see {@link RsfData.kind}. */
  kind?: RsfWorksheetKind;
  /** Per-worksheet presentational state (validated and clamped on decode). */
  display?: RsfDisplaySettings;
  /** Per-worksheet filter (fully validated against this worksheet's dimensions). */
  filter?: SheetFilter;
  /** Set when a stored filter failed validation and was dropped. */
  filterDropped?: boolean;
  /** Per-worksheet cell styles (workbook body version 4+); see {@link RsfData.styles}. */
  styles?: Array<[number, number, CellStyle]>;
  /** Per-worksheet cell comments (workbook body version 7+); see {@link RsfData.comments}. */
  comments?: Array<[number, number, string]>;
  /** Whether this worksheet is locked (workbook body version 9+); see {@link RsfData.locked}. */
  locked?: boolean;
}

/**
 * A decoded workbook: workbook-level metadata plus its worksheets in order.
 * Legacy single-sheet containers (version 3, and legacy RCSV version 2) decode
 * into this same shape with exactly one worksheet, so the whole application
 * works against one model regardless of which container version was read.
 */
export interface RsfWorkbookData {
  /** Delimiter used as the default for CSV export (workbook-level). */
  delimiter: DelimiterId;
  appName?: string;
  appVersion?: string;
  /** Creation / last-update timestamps (ms since epoch); absent when not stored. */
  createdAt?: number;
  updatedAt?: number;
  /** Stable workbook identifier, preserved across saves. */
  docId?: string;
  /** Identifier of the worksheet to activate on open; falls back to the first. */
  activeSheetId?: string;
  /**
   * The workbook's IANA timezone name (workbook body version 2+), read by
   * `TODAY()` and `NOW()`. Written only when it differs from `"UTC"`; absent
   * when not stored, including every workbook saved before this field
   * existed. Not yet validated against `Intl` — `RsfDocument` falls back to
   * UTC for an absent or unresolvable value.
   */
  timezone?: string;
  /**
   * The workbook's stored display language (workbook body version 3+), read
   * by `TEXT()`'s `ddd`/`dddd` weekday-name tokens. Written only when it
   * differs from `"en"`; absent when not stored, including every workbook
   * saved before this field existed. Not yet validated — `RsfDocument` falls
   * back to `"en"` for an absent or unrecognized value.
   */
  displayLanguage?: string;
  sheets: RsfWorksheetData[];
  /** Compression method the container was packed with (populated on decode). */
  compression?: number;
  /**
   * True when the bytes were a single-worksheet container (version 3, or a
   * legacy RCSV version 2) rather than a workbook container. The document
   * migrates to the workbook schema on its next save *only if* it then holds
   * more than one worksheet.
   */
  legacySingleSheet?: boolean;
  /**
   * Whether version history is recorded for this workbook (workbook body
   * version 10+); see {@link RsfData.historyEnabled}. Absent means the
   * default (`true`).
   */
  historyEnabled?: boolean;
  /**
   * Past snapshots of this workbook's content (workbook body version 10+),
   * oldest first; see {@link RsfData.history}.
   */
  history?: RsfHistorySnapshot[];
  /**
   * This workbook's override of the retained-snapshot cap (workbook body
   * version 12+); see {@link RsfData.historyMaxOverride}. Absent means the
   * default ({@link DEFAULT_HISTORY_SNAPSHOT_LIMIT}).
   */
  historyMaxOverride?: number | null;
}

export type RsfWorkbookDecodeResult =
  { ok: true; data: RsfWorkbookData } | { ok: false; error: RsfDecodeError };

/** Validated presentational state carried by a version-3 body. */
export interface RsfDisplaySettings {
  /** Spreadsheet zoom percent, or undefined when the file stores none. */
  zoom?: number;
  /** Overridden column widths as [columnIndex, widthPx-at-100%] pairs. */
  colWidths?: Array<[number, number]>;
  /**
   * Whether long cells wrap onto several visual lines (body version 5 /
   * workbook display flag bit 2). A single payload-free flag: a reader that
   * does not know it simply does not set it, and — because it carries no bytes
   * — a workbook display block stays perfectly in sync for older readers.
   */
  wrap?: boolean;
}

export type RsfDecodeError =
  'bad-magic' | 'bad-version' | 'bad-shape' | 'checksum' | 'unsupported-compression' | 'too-large';

export type RsfDecodeResult = { ok: true; data: RsfData } | { ok: false; error: RsfDecodeError };

/** Thrown by {@link encodeRsf} when the requested method cannot be written here. */
export class RsfEncodeError extends Error {
  constructor(readonly method: number) {
    super(`rsf: compression method ${method} is not available in this build`);
    this.name = 'RsfEncodeError';
  }
}

/** True when `method` is a defined container compression method. */
export function isRsfMethod(method: number): boolean {
  return RSF_METHODS.includes(method);
}

/** i18n key stub for a method (`rsf.method.<name>`) used for labels/descriptions. */
export function rsfMethodKey(method: number): string {
  switch (method) {
    case RSF_COMPRESSION_ZSTD:
      return 'rsf.method.zstd';
    case RSF_COMPRESSION_LZ4:
      return 'rsf.method.lz4';
    case RSF_COMPRESSION_DEFLATE:
      return 'rsf.method.deflate';
    default:
      return 'rsf.method.store';
  }
}

const DELIMS: Record<number, DelimiterId> = { 0x2c: ',', 0x3b: ';', 0x09: '\t' };

// ----- Worksheet kind byte (body version 12 / workbook body version 8) -----
// One byte: 0 = grid (the default for every worksheet before this field
// existed), 1 = markdown, 2 = json (json legal only from body version 15 /
// workbook body version 11 — see `encodeBody`/`decodeBody`; a real writer
// never emits it below that version, so it is rejected as `bad-shape` there
// rather than guessed at). A markdown or json worksheet's raw document text
// lives as an ordinary cell (0, 0) — the container adds no new cell-storage
// shape — so either is required to be exactly 1x1 with at most one cell
// record; anything else is a shape a real writer never emits, rejected as
// `bad-shape` rather than guessed at, matching the reject-don't-guess
// treatment of every other kind/enum byte in this container.
const WORKSHEET_KIND_BYTE: Record<RsfWorksheetKind, number> = { grid: 0, markdown: 1, json: 2 };
const WORKSHEET_KIND_FROM_BYTE: Record<number, RsfWorksheetKind> = { 0: 'grid', 1: 'markdown', 2: 'json' };

/** True when a decoded markdown/json worksheet's dimensions are the required 1x1 shape. */
function isValidSourceKindShape(rowCount: number, columnCount: number, cellCount: number): boolean {
  return rowCount === 1 && columnCount === 1 && cellCount <= 1;
}

/**
 * Pack a compressed body into an RSF container: the fixed 20-byte header
 * (magic, `containerVersion`, method, profile, lengths, CRC-32) followed by
 * the payload. Shared by the single-sheet and workbook encoders so the header
 * layout has exactly one call site to update.
 */
function packRsfContainer(
  containerVersion: number,
  method: number,
  body: Uint8Array,
  payload: Uint8Array,
  crc: number,
): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + payload.length);
  out.set(RSF_MAGIC, 0);
  const view = new DataView(out.buffer);
  out[4] = containerVersion;
  out[5] = method;
  out[6] = 0;
  out[7] = RSF_CODEC_PROFILE;
  view.setUint32(8, body.length, true);
  view.setUint32(12, crc, true);
  view.setUint32(16, payload.length, true);
  out.set(payload, HEADER_SIZE);
  return out;
}

/** Encode a sheet or workbook body with `method`, then pack it into a container
 *  of `containerVersion`. Shared compress/CRC/pack step for both encoders. */
function encodeRsfContainer(containerVersion: number, method: number, body: Uint8Array): Uint8Array {
  const codec = getRsfCodec();
  const payload = codec.compress(body, method);
  if (payload === null) {
    throw new RsfEncodeError(method);
  }
  return packRsfContainer(containerVersion, method, body, payload, codec.crc32(body));
}

/**
 * Encode a sheet into the binary `.rsf` container using `method` (defaults to
 * the active codec's preferred method — Zstandard when the WASM engine is
 * available). Throws {@link RsfEncodeError} when `method` cannot be written in
 * this build, so the caller can surface a localized error and never silently
 * substitutes a different codec.
 */
export function encodeRsf(data: RsfData, method: number = getRsfCodec().defaultMethod()): Uint8Array {
  return encodeRsfContainer(RSF_CONTAINER_VERSION, method, encodeBody(data));
}

/**
 * Validate and decompress an RSF container's header + payload (magic/version
 * already confirmed by the caller): method, codec profile, declared lengths,
 * decompression, and CRC-32. Shared by the single-sheet and workbook decoders
 * so a future bounds/CRC fix cannot land in one copy while missing the other.
 * Returns the uncompressed body and the method it was packed with, so the
 * caller can hand the body to its own body decoder and stamp `compression`.
 */
function decodeRsfContainer(
  bytes: Uint8Array,
): { ok: true; body: Uint8Array; method: number } | { ok: false; error: RsfDecodeError } {
  const method = bytes[5];
  if (!isRsfMethod(method)) {
    // Unknown / future compression method — reject safely, never guess.
    return { ok: false, error: 'unsupported-compression' };
  }
  // A future codec profile is not something this build can decode safely.
  if (bytes[7] !== RSF_CODEC_PROFILE) {
    return { ok: false, error: 'unsupported-compression' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyLen = view.getUint32(8, true);
  const crc = view.getUint32(12, true);
  const payloadLen = view.getUint32(16, true);
  if (bodyLen > MAX_RSF_BODY_BYTES) {
    return { ok: false, error: 'too-large' };
  }
  if (HEADER_SIZE + payloadLen !== bytes.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const payload = bytes.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);
  const codec = getRsfCodec();
  const body = codec.decompress(payload, method, bodyLen);
  if (!body) {
    // Reconstruction failed. If this build cannot even write the method it
    // lacks the matching decoder (the JS fallback for any compressed method),
    // so report it as unsupported; otherwise the payload is corrupt/truncated.
    const decodable = method === RSF_COMPRESSION_STORE || codec.canWrite(method);
    return { ok: false, error: decodable ? 'bad-shape' : 'unsupported-compression' };
  }
  if (codec.crc32(body) !== crc) {
    return { ok: false, error: 'checksum' };
  }
  return { ok: true, body, method };
}

/** Decode and strictly validate a binary `.rsf` container (or a legacy `.rcsv`
 *  container — see the compatibility note above). Never executes anything. */
export function decodeRsf(bytes: Uint8Array): RsfDecodeResult {
  if (bytes.length < HEADER_SIZE) {
    return { ok: false, error: 'bad-magic' };
  }
  const matchesMagic = (magic: Uint8Array): boolean => magic.every((b, i) => bytes[i] === b);
  // Accept the current RSF magic and the legacy RCSV magic; each pins its own
  // container version so a mismatched magic/version pair is rejected.
  const isRsf = matchesMagic(RSF_MAGIC);
  const isLegacy = !isRsf && matchesMagic(RSF_LEGACY_MAGIC);
  if (!isRsf && !isLegacy) {
    return { ok: false, error: 'bad-magic' };
  }
  const expectedVersion = isRsf ? RSF_CONTAINER_VERSION : RSF_LEGACY_CONTAINER_VERSION;
  if (bytes[4] !== expectedVersion) {
    return { ok: false, error: 'bad-version' };
  }
  const container = decodeRsfContainer(bytes);
  if (!container.ok) {
    return container;
  }
  const decoded = decodeBody(container.body);
  if (decoded.ok) {
    decoded.data.compression = container.method;
  }
  return decoded;
}

/**
 * Encode the body-version-4 filter block (its leading flags byte included).
 * Bounds are enforced defensively on write — columns, conditions, values, and
 * strings beyond the documented limits are truncated so an encoded filter
 * always validates on read.
 */
function encodeFilterBlock(filter: SheetFilter | undefined): Uint8Array {
  if (!filter) {
    return Uint8Array.of(0);
  }
  const enc = new TextEncoder();
  const bytes: number[] = [1];
  const u8 = (v: number): void => {
    bytes.push(v & 0xff);
  };
  const u16 = (v: number): void => {
    bytes.push(v & 0xff, (v >> 8) & 0xff);
  };
  const u32 = (v: number): void => {
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const f64 = (v: number): void => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, v, true);
    for (const b of buf) {
      bytes.push(b);
    }
  };
  const str = (s: string): void => {
    const encoded = enc.encode(s.slice(0, MAX_FILTER_STRING));
    u16(encoded.length);
    for (const b of encoded) {
      bytes.push(b);
    }
  };
  u8(filter.headerRow ? 1 : 0);
  u32(filter.top);
  u32(filter.left);
  u32(filter.bottom);
  u32(filter.right);
  const columns = filter.columns.slice(0, MAX_FILTER_COLUMNS);
  u16(columns.length);
  for (const column of columns) {
    u32(column.col);
    u8(column.join === 'or' ? 1 : 0);
    const conditions = column.conditions.slice(0, MAX_FILTER_CONDITIONS);
    u8(conditions.length);
    for (const cond of conditions) {
      if (cond.kind === 'text') {
        u8(0);
        u8(Math.max(0, FILTER_TEXT_OPS.indexOf(cond.op)));
        str(cond.value);
      } else {
        u8(1);
        u8(Math.max(0, FILTER_NUMBER_OPS.indexOf(cond.op)));
        f64(cond.value);
        f64(cond.value2 ?? Number.NaN);
      }
    }
    const values = column.values === null ? null : column.values.slice(0, MAX_FILTER_VALUES);
    u8(values === null ? 0 : 1);
    if (values !== null) {
      u16(values.length);
      for (const v of values) {
        str(v);
      }
    }
  }
  return Uint8Array.from(bytes);
}

// ----- Cell-style block (body version 8 / workbook body version 4) ----------
// One bit per boolean/color property, in the fixed order COLOR_KEYS iterates
// (textColor, backgroundColor, then the four border sides). A present color
// is stored as three RGB bytes right after the flags, in that same order —
// for a border-side color, body version 10+ (workbook 6+) additionally
// stores one line-style+width byte right after that RGB triple (see below).

const STYLE_FLAG_BOLD = 1 << 0;
const STYLE_FLAG_ITALIC = 1 << 1;
const STYLE_FLAG_UNDERLINE = 1 << 2;
/** Bit index of the first color flag (`textColor`); subsequent `COLOR_KEYS` follow at +1 each. */
const STYLE_COLOR_FLAG_BASE = 3;

const BORDER_SIDE_SET: ReadonlySet<string> = new Set(BORDER_SIDES);

// ----- Border line-style+width byte (body version 10 / workbook body version 6) --
// One byte per "on" border side, written immediately after that side's RGB
// triple, only when the body is written at version 10+. Bits 0-1: width
// index (0 thin, 1 medium, 2 thick — 3 is unused/invalid); bits 2-3: line
// style index (0 solid, 1 dashed, 2 dotted, 3 double). Additive to the
// version-8 border encoding, so a version-9-or-lower reader never sees this
// byte and a version-10 file with only default-style borders keeps writing
// the lowest sufficient (pre-10) body version — see `encodeBody`.
const BORDER_WIDTH_BYTE: Record<BorderWidth, number> = { thin: 0, medium: 1, thick: 2 };
const BORDER_WIDTH_FROM_BYTE: Record<number, BorderWidth> = { 0: 'thin', 1: 'medium', 2: 'thick' };
const BORDER_LINE_STYLE_BYTE: Record<BorderLineStyle, number> = { solid: 0, dashed: 1, dotted: 2, double: 3 };
const BORDER_LINE_STYLE_FROM_BYTE: Record<number, BorderLineStyle> = {
  0: 'solid',
  1: 'dashed',
  2: 'dotted',
  3: 'double',
};

// ----- Number-format sub-record (body version 9 / workbook body version 5) --
// Appended to every style record, right after its color bytes, only when the
// body version is high enough to carry one — see `encodeStyleBlock`. A
// leading kind byte of 0 means "no number format on this cell"; 1/2/3 select
// `number`/`percent`/`currency` and are followed by a fixed decimals byte, a
// flags byte (bit 0: thousands separator), and — for `currency` only — a
// length-prefixed UTF-8 currency symbol. A kind byte outside 0-3 makes the
// sub-record's length ambiguous (a legitimate writer never emits one), so the
// reader treats it as `bad-shape` rather than guessing how many bytes to skip.
const STYLE_NUMBER_FORMAT_KIND_BYTE: Record<NumberFormatKind, number> = {
  number: 1,
  percent: 2,
  currency: 3,
};
const STYLE_NUMBER_FORMAT_KIND_FROM_BYTE: Record<number, NumberFormatKind> = {
  1: 'number',
  2: 'percent',
  3: 'currency',
};
const STYLE_NUMBER_FORMAT_THOUSANDS_BIT = 1 << 0;

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) || 0,
    parseInt(hex.slice(3, 5), 16) || 0,
    parseInt(hex.slice(5, 7), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Encode the body-version-8+ / workbook-version-4+ style block: a `u32`
 * count followed by that many records. Zero is a perfectly ordinary "no
 * styled cells" encoding (like the cell-record count), so — unlike the
 * filter block — no separate presence flag is needed. `withBorderStyle`
 * appends the version-10 (workbook version-6) line-style+width byte after
 * every border side's RGB triple; `withNumberFormat` appends the version-9
 * (workbook version-5) number-format sub-record to every record. The caller
 * passes each only when the body is actually being written at that version
 * (see {@link BORDER_WIDTH_BYTE}, {@link STYLE_NUMBER_FORMAT_KIND_BYTE}).
 */
function encodeStyleBlock(
  styles: Array<[number, number, CellStyle]> | undefined,
  withNumberFormat: boolean,
  withBorderStyle: boolean,
): number[] {
  const list = styles ?? [];
  const bytes: number[] = [
    list.length & 0xff,
    (list.length >>> 8) & 0xff,
    (list.length >>> 16) & 0xff,
    (list.length >>> 24) & 0xff,
  ];
  const enc = new TextEncoder();
  for (const [row, col, style] of list) {
    bytes.push(row & 0xff, (row >>> 8) & 0xff, (row >>> 16) & 0xff, (row >>> 24) & 0xff);
    bytes.push(col & 0xff, (col >>> 8) & 0xff, (col >>> 16) & 0xff, (col >>> 24) & 0xff);
    let flags = 0;
    if (style.bold) flags |= STYLE_FLAG_BOLD;
    if (style.italic) flags |= STYLE_FLAG_ITALIC;
    if (style.underline) flags |= STYLE_FLAG_UNDERLINE;
    COLOR_KEYS.forEach((key, i) => {
      if (style[key] !== undefined) {
        flags |= 1 << (STYLE_COLOR_FLAG_BASE + i);
      }
    });
    bytes.push(flags & 0xff, (flags >> 8) & 0xff);
    for (const key of COLOR_KEYS) {
      const color = style[key];
      if (color !== undefined) {
        bytes.push(...hexToRgb(color));
        if (withBorderStyle && BORDER_SIDE_SET.has(key)) {
          const side = key as BorderSide;
          const lineStyle = style[BORDER_STYLE_KEY[side]] ?? DEFAULT_BORDER_LINE_STYLE;
          const width = style[BORDER_WIDTH_KEY[side]] ?? DEFAULT_BORDER_WIDTH;
          bytes.push(BORDER_WIDTH_BYTE[width] | (BORDER_LINE_STYLE_BYTE[lineStyle] << 2));
        }
      }
    }
    if (withNumberFormat) {
      const format = style.numberFormat;
      bytes.push(format ? STYLE_NUMBER_FORMAT_KIND_BYTE[format.kind] : 0);
      if (format) {
        bytes.push(Math.max(0, Math.min(MAX_NUMBER_FORMAT_DECIMALS, format.decimals)) & 0xff);
        bytes.push(format.thousands ? STYLE_NUMBER_FORMAT_THOUSANDS_BIT : 0);
        if (format.kind === 'currency') {
          const symbol = enc.encode((format.currencySymbol ?? '$').slice(0, MAX_CURRENCY_SYMBOL_LENGTH));
          bytes.push(symbol.length & 0xff);
          bytes.push(...symbol);
        }
      }
    }
  }
  return bytes;
}

/**
 * Read the style block. Row/column indices are validated against the sheet's
 * (already-known) dimensions exactly like cell records — out of range is
 * `bad-shape`, and a count above what the grid could possibly hold is
 * `too-large`, matching the cell-record checks in `decodeBody`.
 * `withBorderStyle` reads the version-10 (workbook version-6) line-style+width
 * byte after every border side's RGB triple — see {@link BORDER_WIDTH_BYTE}.
 * `withNumberFormat` reads the version-9 (workbook version-5) number-format
 * sub-record from every record — see {@link STYLE_NUMBER_FORMAT_KIND_BYTE}.
 */
function readStyleBlock(
  rd: BodyReader,
  rowCount: number,
  columnCount: number,
  withNumberFormat: boolean,
  withBorderStyle: boolean,
): { ok: true; styles: Array<[number, number, CellStyle]> } | { ok: false; error: RsfDecodeError } {
  if (!rd.need(4)) {
    return { ok: false, error: 'bad-shape' };
  }
  const count = rd.u32();
  if (count > rowCount * columnCount) {
    return { ok: false, error: 'too-large' };
  }
  const styles: Array<[number, number, CellStyle]> = [];
  for (let i = 0; i < count; i++) {
    if (!rd.need(4 + 4 + 2)) {
      return { ok: false, error: 'bad-shape' };
    }
    const row = rd.u32();
    const col = rd.u32();
    const flags = rd.u16();
    if (row >= rowCount || col >= columnCount) {
      return { ok: false, error: 'bad-shape' };
    }
    const style: CellStyle = {};
    if (flags & STYLE_FLAG_BOLD) style.bold = true;
    if (flags & STYLE_FLAG_ITALIC) style.italic = true;
    if (flags & STYLE_FLAG_UNDERLINE) style.underline = true;
    for (let k = 0; k < COLOR_KEYS.length; k++) {
      if (flags & (1 << (STYLE_COLOR_FLAG_BASE + k))) {
        if (!rd.need(3)) {
          return { ok: false, error: 'bad-shape' };
        }
        const key = COLOR_KEYS[k];
        style[key] = rgbToHex(rd.u8(), rd.u8(), rd.u8());
        if (withBorderStyle && BORDER_SIDE_SET.has(key)) {
          if (!rd.need(1)) {
            return { ok: false, error: 'bad-shape' };
          }
          const side = key as BorderSide;
          const byte = rd.u8();
          const width = BORDER_WIDTH_FROM_BYTE[byte & 0x3];
          const lineStyle = BORDER_LINE_STYLE_FROM_BYTE[(byte >> 2) & 0x3];
          // Width has only 3 valid encodings in 2 bits (see the layout note
          // above) — the 4th is a shape a real writer never emits.
          if (width === undefined) {
            return { ok: false, error: 'bad-shape' };
          }
          style[BORDER_WIDTH_KEY[side]] = width;
          style[BORDER_STYLE_KEY[side]] = lineStyle;
        }
      }
    }
    if (withNumberFormat) {
      if (!rd.need(1)) {
        return { ok: false, error: 'bad-shape' };
      }
      const kindByte = rd.u8();
      if (kindByte !== 0) {
        const kind = STYLE_NUMBER_FORMAT_KIND_FROM_BYTE[kindByte];
        // A kind byte a real writer never emits leaves the rest of this
        // record's length unknowable (see the sub-record note above), so the
        // whole container is rejected rather than risking a misaligned read.
        if (kind === undefined) {
          return { ok: false, error: 'bad-shape' };
        }
        if (!rd.need(2)) {
          return { ok: false, error: 'bad-shape' };
        }
        const decimals = Math.min(MAX_NUMBER_FORMAT_DECIMALS, rd.u8());
        const thousands = (rd.u8() & STYLE_NUMBER_FORMAT_THOUSANDS_BIT) !== 0;
        const format: NumberFormat = { kind, decimals, thousands };
        if (kind === 'currency') {
          if (!rd.need(1)) {
            return { ok: false, error: 'bad-shape' };
          }
          const symbolLen = rd.u8();
          if (!rd.need(symbolLen)) {
            return { ok: false, error: 'bad-shape' };
          }
          try {
            format.currencySymbol = new TextDecoder('utf-8', { fatal: true }).decode(
              rd.body.subarray(rd.off, rd.off + symbolLen),
            );
          } catch {
            return { ok: false, error: 'bad-shape' };
          }
          rd.off += symbolLen;
        }
        style.numberFormat = format;
      }
    }
    styles.push([row, col, style]);
  }
  return { ok: true, styles };
}

/**
 * Encode the body-version-11+ / workbook-version-7+ comment block: a `u32`
 * count followed by that many `[row, col, text]` records. Zero is a
 * perfectly ordinary "no commented cells" encoding, matching the style
 * block's own zero-count convention — no separate presence flag is needed.
 */
function encodeCommentBlock(comments: Array<[number, number, string]> | undefined): number[] {
  const list = comments ?? [];
  const enc = new TextEncoder();
  const bytes: number[] = [
    list.length & 0xff,
    (list.length >>> 8) & 0xff,
    (list.length >>> 16) & 0xff,
    (list.length >>> 24) & 0xff,
  ];
  for (const [row, col, text] of list) {
    bytes.push(row & 0xff, (row >>> 8) & 0xff, (row >>> 16) & 0xff, (row >>> 24) & 0xff);
    bytes.push(col & 0xff, (col >>> 8) & 0xff, (col >>> 16) & 0xff, (col >>> 24) & 0xff);
    const value = enc.encode(text.slice(0, MAX_COMMENT_LENGTH));
    bytes.push(
      value.length & 0xff,
      (value.length >>> 8) & 0xff,
      (value.length >>> 16) & 0xff,
      (value.length >>> 24) & 0xff,
    );
    bytes.push(...value);
  }
  return bytes;
}

/**
 * Read the comment block. Row/column indices are validated against the
 * sheet's (already-known) dimensions exactly like cell and style records —
 * out of range is `bad-shape`, a count above what the grid could possibly
 * hold is `too-large`, and a single comment's declared byte length above
 * {@link MAX_RSF_COMMENT_BYTES} is `too-large` too.
 */
function readCommentBlock(
  rd: BodyReader,
  rowCount: number,
  columnCount: number,
): { ok: true; comments: Array<[number, number, string]> } | { ok: false; error: RsfDecodeError } {
  if (!rd.need(4)) {
    return { ok: false, error: 'bad-shape' };
  }
  const count = rd.u32();
  if (count > rowCount * columnCount) {
    return { ok: false, error: 'too-large' };
  }
  const dec = new TextDecoder('utf-8', { fatal: true });
  const comments: Array<[number, number, string]> = [];
  for (let i = 0; i < count; i++) {
    if (!rd.need(4 + 4 + 4)) {
      return { ok: false, error: 'bad-shape' };
    }
    const row = rd.u32();
    const col = rd.u32();
    const textLen = rd.u32();
    if (row >= rowCount || col >= columnCount || textLen > MAX_RSF_COMMENT_BYTES || !rd.need(textLen)) {
      return textLen > MAX_RSF_COMMENT_BYTES
        ? { ok: false, error: 'too-large' }
        : { ok: false, error: 'bad-shape' };
    }
    let text: string;
    try {
      text = dec.decode(rd.body.subarray(rd.off, rd.off + textLen));
    } catch {
      return { ok: false, error: 'bad-shape' };
    }
    rd.off += textLen;
    comments.push([row, col, text]);
  }
  return { ok: true, comments };
}

/**
 * Encode the body-version-14+ / workbook-version-10+ history block: a
 * one-byte flags field (bit 0: version history enabled; bit 1: the
 * retained-snapshot cap override is unlimited) optionally followed by the
 * body-version-16+ / workbook-version-12+ cap override (`u32`, present only
 * when `maxOverride !== undefined`, ignored/written as 0 when bit 1 is set),
 * then a `u32` snapshot count and that many
 * `[timestamp f64, byte length u32, bytes]` records, oldest first. Always
 * physically present once the chosen version reaches the threshold — even a
 * document with history disabled and no snapshots yet still writes the
 * (empty) block, matching every other version-gated section in this format.
 * Snapshot bytes are written verbatim (never truncated here) — capping the
 * retained count is the writer's (`RsfDocument`) responsibility, exactly like
 * every other write-side bound in this codec.
 */
function encodeHistoryBlock(
  enabled: boolean | undefined,
  history: RsfHistorySnapshot[] | undefined,
  maxOverride: number | null | undefined,
): Uint8Array {
  const list = history ?? [];
  const hasMaxOverride = maxOverride !== undefined;
  const unlimited = maxOverride === null;
  let total = 1 + (hasMaxOverride ? 4 : 0) + 4;
  for (const snap of list) {
    total += 8 + 4 + snap.bytes.length;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = (enabled === false ? 0 : 1) | (hasMaxOverride && unlimited ? 2 : 0);
  if (hasMaxOverride) {
    view.setUint32(off, unlimited ? 0 : (maxOverride as number), true);
    off += 4;
  }
  view.setUint32(off, list.length, true);
  off += 4;
  for (const snap of list) {
    view.setFloat64(off, snap.timestamp, true);
    off += 8;
    view.setUint32(off, snap.bytes.length, true);
    off += 4;
    out.set(snap.bytes, off);
    off += snap.bytes.length;
  }
  return out;
}

/**
 * Read the history block. `hasMaxOverride` selects the body-version-16+ /
 * workbook-version-12+ shape (with the cap-override field); older versions
 * read the version-14/15 shape and always resolve `maxOverride` to
 * `undefined` ("use the default"). A snapshot count above, or a decoded
 * numeric cap override outside `[1, MAX_RSF_HISTORY_SNAPSHOTS]`, is
 * `bad-shape`/`too-large`; a single snapshot's declared byte length above
 * {@link MAX_RSF_BODY_BYTES} (a snapshot is itself a body, so it can never
 * legitimately exceed the same ceiling) is `too-large`; structural truncation
 * is `bad-shape`, matching every other block in this codec. Snapshot bytes
 * are carried opaquely — bounds-checked but not decoded here.
 */
function readHistoryBlock(
  rd: BodyReader,
  hasMaxOverride: boolean,
):
  | { ok: true; enabled: boolean; maxOverride: number | null | undefined; history: RsfHistorySnapshot[] }
  | { ok: false; error: RsfDecodeError } {
  if (!rd.need(1)) {
    return { ok: false, error: 'bad-shape' };
  }
  const flags = rd.u8();
  let maxOverride: number | null | undefined;
  if (hasMaxOverride) {
    if (!rd.need(4)) {
      return { ok: false, error: 'bad-shape' };
    }
    const rawMax = rd.u32();
    if ((flags & 2) === 2) {
      maxOverride = null;
    } else if (rawMax < 1 || rawMax > MAX_RSF_HISTORY_SNAPSHOTS) {
      return { ok: false, error: 'bad-shape' };
    } else {
      maxOverride = rawMax;
    }
  }
  if (!rd.need(4)) {
    return { ok: false, error: 'bad-shape' };
  }
  const count = rd.u32();
  if (count > MAX_RSF_HISTORY_SNAPSHOTS) {
    return { ok: false, error: 'too-large' };
  }
  const history: RsfHistorySnapshot[] = [];
  for (let i = 0; i < count; i++) {
    if (!rd.need(8 + 4)) {
      return { ok: false, error: 'bad-shape' };
    }
    const timestamp = rd.f64();
    const length = rd.u32();
    if (length > MAX_RSF_BODY_BYTES || !rd.need(length)) {
      return length > MAX_RSF_BODY_BYTES
        ? { ok: false, error: 'too-large' }
        : { ok: false, error: 'bad-shape' };
    }
    const bytes = rd.body.slice(rd.off, rd.off + length);
    rd.off += length;
    history.push({ timestamp, bytes });
  }
  return { ok: true, enabled: (flags & 1) === 1, maxOverride, history };
}

function encodeBody(data: RsfData): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(data.name.slice(0, MAX_META_LENGTH));
  // Version selection is minimal: a retained-snapshot cap override needs
  // version 16, else a json worksheet needs version 15, else history
  // disabled or non-empty needs version 14, else a locked worksheet needs
  // version 13, else a markdown worksheet needs version 12, else any
  // commented cell needs version 11, any border side with a non-default line
  // style or width needs version 10, any cell with a number format needs
  // version 9, any styled cell needs version 8, a non-default display
  // language needs version 7, a non-UTC timezone needs version 6, stored
  // wrap needs version 5, a filter needs version 4, display settings alone
  // need version 3, metadata alone needs version 2, otherwise the legacy
  // version-1 body is written. A newer section implies every older one, so
  // the layout stays a strict prefix chain — each `has*` below is OR'd with
  // every section above it (a cap override forces the history section same
  // as a json worksheet does, which forces the lock section, which forces
  // the kind section, which forces the comment section, which forces the
  // style section, which forces the number-format sub-record inclusion flag,
  // and cascades down through display language, timezone, flags, filter,
  // display, to meta) so a body picking a high version always physically
  // contains every lower section's bytes, even when that section's own data
  // is empty/default (a document with history disabled is not necessarily
  // locked — see `RsfDocument.setHistoryEnabled`), matching what `decodeBody`
  // reads for that version unconditionally.
  const hasMaxOverride = data.historyMaxOverride !== undefined;
  const isJson = data.kind === 'json';
  const hasHistorySection =
    hasMaxOverride || isJson || data.historyEnabled === false || (data.history?.length ?? 0) > 0;
  const hasLocked = hasHistorySection || data.locked === true;
  const isMarkdown = data.kind === 'markdown';
  // Physical presence of the worksheet-kind byte: forced by a lock exactly
  // like every other lower section is forced by something above it, even
  // when the worksheet itself is a plain grid (`isMarkdown`/`isJson` stay
  // `false` — they name the byte's *value*, not its presence).
  const hasKindSection = hasLocked || isMarkdown || isJson;
  // A markdown worksheet (or a locked one, via `hasKindSection`) forces every
  // lower section's block to be physically written (even empty/default) the
  // same way every other higher section forces the ones below it —
  // `decodeBody` reads the comment block, style block, display-language,
  // timezone, flags, filter, and meta sections unconditionally once
  // `bodyVersion >= 11/8/7/6/5/4/2` respectively, and versions 12/13 are `>=`
  // all of those. Chaining through `hasComments` (the top of the existing
  // cascade) propagates down to `hasMeta` below.
  const hasComments = hasKindSection || (data.comments?.length ?? 0) > 0;
  const hasBorderStyle = (data.styles ?? []).some(([, , style]) =>
    BORDER_SIDES.some((side) => {
      const value = borderSideValue(style, side);
      return (
        value !== null &&
        (value.lineStyle !== DEFAULT_BORDER_LINE_STYLE || value.width !== DEFAULT_BORDER_WIDTH)
      );
    }),
  );
  const hasNumberFormats = (data.styles ?? []).some(([, , style]) => style.numberFormat !== undefined);
  const hasNumberFormatSection = hasBorderStyle || hasNumberFormats;
  const hasStyles = hasNumberFormatSection || (data.styles?.length ?? 0) > 0 || hasComments;
  const hasDisplayLanguage =
    hasStyles || (data.displayLanguage !== undefined && data.displayLanguage !== DEFAULT_DISPLAY_LANGUAGE);
  const displayLanguageBytes = hasDisplayLanguage
    ? enc.encode((data.displayLanguage ?? DEFAULT_DISPLAY_LANGUAGE).slice(0, MAX_META_LENGTH))
    : null;
  const hasTimezone =
    hasDisplayLanguage || (data.timezone !== undefined && data.timezone !== DEFAULT_TIMEZONE);
  const timezoneBytes = hasTimezone
    ? enc.encode((data.timezone ?? DEFAULT_TIMEZONE).slice(0, MAX_META_LENGTH))
    : null;
  const displayWidths = (data.display?.colWidths ?? []).filter(
    ([col, width]) => Number.isInteger(col) && col >= 0 && Number.isInteger(width) && width > 0,
  );
  const displayZoom = data.display?.zoom;
  const wrapSet = data.display?.wrap === true;
  const hasFlagsSection = wrapSet || hasTimezone;
  const hasFilterSection = hasFlagsSection || data.filter !== undefined;
  const hasDisplay = hasFilterSection || displayZoom !== undefined || displayWidths.length > 0;
  const hasMeta = hasDisplay || data.appName !== undefined || data.appVersion !== undefined;
  const appName = hasMeta ? enc.encode((data.appName ?? '').slice(0, MAX_META_LENGTH)) : null;
  const appVersion = hasMeta ? enc.encode((data.appVersion ?? '').slice(0, MAX_META_LENGTH)) : null;
  const filterBlock = hasFilterSection ? encodeFilterBlock(data.filter) : null;
  const cellBufs = data.cells.map(([r, c, input]) => {
    const value = enc.encode(input);
    const buf = new Uint8Array(12 + value.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, r, true);
    dv.setUint32(4, c, true);
    dv.setUint32(8, value.length, true);
    buf.set(value, 12);
    return buf;
  });
  const cellsSize = cellBufs.reduce((n, b) => n + b.length, 0);
  const metaSize = hasMeta ? 2 + appName!.length + 2 + appVersion!.length : 0;
  const displaySize = hasDisplay ? 2 + 4 + displayWidths.length * 6 : 0;
  const flagsSize = hasFlagsSection ? 1 : 0;
  const filterSize = filterBlock ? filterBlock.length : 0;
  const timezoneSize = hasTimezone ? 2 + timezoneBytes!.length : 0;
  const displayLanguageSize = hasDisplayLanguage ? 2 + displayLanguageBytes!.length : 0;
  const styleBytes = hasStyles ? encodeStyleBlock(data.styles, hasNumberFormatSection, hasBorderStyle) : null;
  const styleSize = styleBytes ? styleBytes.length : 0;
  const commentBytes = hasComments ? encodeCommentBlock(data.comments) : null;
  const commentSize = commentBytes ? commentBytes.length : 0;
  const kindSize = hasKindSection ? 1 : 0;
  const lockedSize = hasLocked ? 1 : 0;
  const historyBytes = hasHistorySection
    ? encodeHistoryBlock(data.historyEnabled, data.history, data.historyMaxOverride)
    : null;
  const historySize = historyBytes ? historyBytes.length : 0;
  const total =
    1 +
    1 +
    metaSize +
    displaySize +
    flagsSize +
    filterSize +
    timezoneSize +
    displayLanguageSize +
    kindSize +
    lockedSize +
    historySize +
    2 +
    name.length +
    4 +
    4 +
    4 +
    cellsSize +
    styleSize +
    commentSize;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = hasMaxOverride
    ? 16
    : isJson
      ? 15
      : hasHistorySection
        ? 14
        : hasLocked
          ? 13
          : isMarkdown
            ? 12
            : hasComments
              ? 11
              : hasBorderStyle
                ? 10
                : hasNumberFormats
                  ? 9
                  : hasStyles
                    ? 8
                    : hasDisplayLanguage
                      ? 7
                      : hasTimezone
                        ? 6
                        : wrapSet
                          ? 5
                          : hasFilterSection
                            ? 4
                            : hasDisplay
                              ? 3
                              : hasMeta
                                ? 2
                                : 1;
  out[off++] = data.delimiter.charCodeAt(0);
  if (hasMeta) {
    view.setUint16(off, appName!.length, true);
    off += 2;
    out.set(appName!, off);
    off += appName!.length;
    view.setUint16(off, appVersion!.length, true);
    off += 2;
    out.set(appVersion!, off);
    off += appVersion!.length;
  }
  if (hasDisplay) {
    // Zoom percent (0 = not stored), clamped into the container bounds.
    const zoom =
      displayZoom === undefined ? 0 : Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(displayZoom)));
    view.setUint16(off, zoom, true);
    off += 2;
    view.setUint32(off, displayWidths.length, true);
    off += 4;
    for (const [col, width] of displayWidths) {
      view.setUint32(off, col, true);
      off += 4;
      view.setUint16(off, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, Math.round(width))), true);
      off += 2;
    }
  }
  if (hasFlagsSection) {
    // Version-5+ display flags. Bit 0: wrap long rows. The byte itself is
    // written whenever the chosen version is 5 or above (even a version-6
    // body picked solely for its timezone still carries this byte, with bit 0
    // clear) — see the "prefix chain" note above.
    out[off++] = wrapSet ? 1 : 0;
  }
  if (filterBlock) {
    out.set(filterBlock, off);
    off += filterBlock.length;
  }
  if (hasTimezone) {
    // Version-6 timezone. Written only when it differs from UTC, so a
    // document whose timezone is UTC (including every pre-existing document)
    // stays a version-5-or-lower body.
    view.setUint16(off, timezoneBytes!.length, true);
    off += 2;
    out.set(timezoneBytes!, off);
    off += timezoneBytes!.length;
  }
  if (hasDisplayLanguage) {
    // Version-7 display language. Written only when it differs from "en", so
    // a document using the default language (including every pre-existing
    // document) stays a version-6-or-lower body.
    view.setUint16(off, displayLanguageBytes!.length, true);
    off += 2;
    out.set(displayLanguageBytes!, off);
    off += displayLanguageBytes!.length;
  }
  if (hasKindSection) {
    // Version-12+ worksheet kind (json legal only from version 15). Written
    // whenever the chosen version is 12 or above (even a version-13 body
    // picked solely for its lock still carries this byte, with the grid
    // value) — see the "prefix chain" note above; a grid worksheet (every
    // worksheet before this field existed) stays a version-11-or-lower body
    // unless it is locked.
    out[off++] = WORKSHEET_KIND_BYTE[isJson ? 'json' : isMarkdown ? 'markdown' : 'grid'];
  }
  if (hasLocked) {
    // Version-13 worksheet lock. Written only when locked, so an unlocked
    // worksheet (every worksheet before this field existed) stays a
    // version-12-or-lower body.
    out[off++] = 1;
  }
  if (historyBytes) {
    // Version-14 history block. Written whenever history is disabled or
    // holds at least one snapshot, so a document left on the (enabled)
    // default with no saves recorded yet stays a version-13-or-lower body.
    out.set(historyBytes, off);
    off += historyBytes.length;
  }
  view.setUint16(off, name.length, true);
  off += 2;
  out.set(name, off);
  off += name.length;
  view.setUint32(off, data.rowCount, true);
  off += 4;
  view.setUint32(off, data.columnCount, true);
  off += 4;
  view.setUint32(off, data.cells.length, true);
  off += 4;
  for (const buf of cellBufs) {
    out.set(buf, off);
    off += buf.length;
  }
  if (styleBytes) {
    out.set(styleBytes, off);
    off += styleBytes.length;
  }
  if (commentBytes) {
    out.set(commentBytes, off);
    off += commentBytes.length;
  }
  return out;
}

function decodeBody(body: Uint8Array): RsfDecodeResult {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let off = 0;
  const need = (n: number): boolean => off + n <= body.length;
  if (!need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const bodyVersion = body[off++];
  if (bodyVersion < 1 || bodyVersion > RSF_BODY_VERSION) {
    return { ok: false, error: 'bad-version' };
  }
  const delimByte = body[off++];
  const delimiter = DELIMS[delimByte];
  if (!delimiter) {
    return { ok: false, error: 'bad-shape' };
  }
  // A length-prefixed UTF-8 string reader shared by the metadata and name.
  const readString = (): string | null => {
    if (!need(2)) {
      return null;
    }
    const len = view.getUint16(off, true);
    off += 2;
    if (!need(len)) {
      return null;
    }
    try {
      const s = dec.decode(body.subarray(off, off + len));
      off += len;
      return s;
    } catch {
      return null;
    }
  };
  let appName: string | undefined;
  let appVersion: string | undefined;
  if (bodyVersion >= 2) {
    const readName = readString();
    if (readName === null) {
      return { ok: false, error: 'bad-shape' };
    }
    const readVersion = readString();
    if (readVersion === null) {
      return { ok: false, error: 'bad-shape' };
    }
    appName = readName;
    appVersion = readVersion;
  }
  // Version-3+ display settings. Structural truncation is bad-shape; value
  // problems are handled by clamping (zoom, widths) or dropping (columns out
  // of range, checked after the column count is known below) — a malformed
  // display block must never make the sheet itself unreadable or unsafe.
  let rawZoom = 0;
  const rawWidths: Array<[number, number]> = [];
  if (bodyVersion >= 3) {
    if (!need(6)) {
      return { ok: false, error: 'bad-shape' };
    }
    rawZoom = view.getUint16(off, true);
    off += 2;
    const widthCount = view.getUint32(off, true);
    off += 4;
    if (widthCount > MAX_RSF_COLS || !need(widthCount * 6)) {
      return { ok: false, error: 'bad-shape' };
    }
    for (let i = 0; i < widthCount; i++) {
      const col = view.getUint32(off, true);
      off += 4;
      const width = view.getUint16(off, true);
      off += 2;
      rawWidths.push([col, width]);
    }
  }
  // Version-5 display flags (one byte, no payload). Unknown bits are ignored
  // so a future flag can be added without changing this layout again.
  let rawWrap = false;
  if (bodyVersion >= 5) {
    if (!need(1)) {
      return { ok: false, error: 'bad-shape' };
    }
    rawWrap = (body[off++] & 1) === 1;
  }
  // Version-4 filter block. Structural truncation, undecodable strings, and
  // unreadable shapes are bad-shape (matching the rest of the codec); every
  // *readable* filter is fully validated against the sheet dimensions and the
  // documented bounds after those are known — a filter that fails validation
  // is dropped with a warning flag, never guessed at, and never prevents the
  // sheet itself from loading.
  let rawFilter: SheetFilter | null = null;
  let filterStored = false;
  if (bodyVersion >= 4) {
    // The filter block has the same layout in both container versions, so it
    // is read by the shared, bounds-checked reader (see readFilterBlock).
    const rd = new BodyReader(body, dec);
    rd.off = off;
    const block = readFilterBlock(rd);
    if (block === null) {
      return { ok: false, error: 'bad-shape' };
    }
    off = rd.off;
    filterStored = block.stored;
    rawFilter = block.raw;
  }
  // Version-6 workbook timezone. Not validated against `Intl` here — that
  // happens where it is consumed (`RsfDocument`), which falls back to UTC for
  // an unresolvable name rather than rejecting the whole file.
  let timezone: string | undefined;
  if (bodyVersion >= 6) {
    const readTz = readString();
    if (readTz === null) {
      return { ok: false, error: 'bad-shape' };
    }
    timezone = readTz;
  }
  // Version-7 workbook display language. Not validated here — that happens
  // where it is consumed (`RsfDocument`), which falls back to `"en"` for an
  // absent or unrecognized value rather than rejecting the whole file.
  let displayLanguage: string | undefined;
  if (bodyVersion >= 7) {
    const readLang = readString();
    if (readLang === null) {
      return { ok: false, error: 'bad-shape' };
    }
    displayLanguage = readLang;
  }
  // Version-12 worksheet kind. A byte outside the three defined values is a
  // shape a real writer never emits (see `WORKSHEET_KIND_FROM_BYTE`), so it
  // is rejected as `bad-shape` rather than guessed at; `json` (2) is a shape
  // a real writer never emits below version 15 either.
  let kind: RsfWorksheetKind = 'grid';
  if (bodyVersion >= 12) {
    if (!need(1)) {
      return { ok: false, error: 'bad-shape' };
    }
    const resolved = WORKSHEET_KIND_FROM_BYTE[body[off++]];
    if (resolved === undefined || (resolved === 'json' && bodyVersion < 15)) {
      return { ok: false, error: 'bad-shape' };
    }
    kind = resolved;
  }
  // Version-13 worksheet lock. A byte outside the two defined values is a
  // shape a real writer never emits, so it is rejected as `bad-shape` rather
  // than guessed at, matching the kind byte just above.
  let locked = false;
  if (bodyVersion >= 13) {
    if (!need(1)) {
      return { ok: false, error: 'bad-shape' };
    }
    const rawLocked = body[off++];
    if (rawLocked !== 0 && rawLocked !== 1) {
      return { ok: false, error: 'bad-shape' };
    }
    locked = rawLocked === 1;
  }
  // Version-14 history block (see `readHistoryBlock`); version 16 adds the
  // retained-snapshot cap override. Read via a temporary `BodyReader` sharing
  // this function's own `off`, the same technique used for the
  // filter/style/comment blocks above.
  let historyEnabled = true;
  let historyMaxOverride: number | null | undefined;
  let history: RsfHistorySnapshot[] = [];
  if (bodyVersion >= 14) {
    const rd = new BodyReader(body, dec);
    rd.off = off;
    const block = readHistoryBlock(rd, bodyVersion >= 16);
    if (!block.ok) {
      return { ok: false, error: block.error };
    }
    off = rd.off;
    historyEnabled = block.enabled;
    historyMaxOverride = block.maxOverride;
    history = block.history;
  }
  const name = readString();
  if (name === null) {
    return { ok: false, error: 'bad-shape' };
  }
  if (!need(12)) {
    return { ok: false, error: 'bad-shape' };
  }
  const rowCount = view.getUint32(off, true);
  off += 4;
  const columnCount = view.getUint32(off, true);
  off += 4;
  const cellCount = view.getUint32(off, true);
  off += 4;
  if (rowCount < 1 || columnCount < 1) {
    return { ok: false, error: 'bad-shape' };
  }
  if (
    rowCount > MAX_RSF_ROWS ||
    columnCount > MAX_RSF_COLS ||
    rowCount * columnCount > MAX_RSF_CELLS ||
    cellCount > rowCount * columnCount
  ) {
    return { ok: false, error: 'too-large' };
  }
  // A markdown or json worksheet's document text is stored as an ordinary
  // cell (0, 0) (see `WORKSHEET_KIND_BYTE` above) — a real writer never emits
  // any other shape for one, so anything else is rejected rather than
  // guessed at.
  if (kind !== 'grid' && !isValidSourceKindShape(rowCount, columnCount, cellCount)) {
    return { ok: false, error: 'bad-shape' };
  }
  const cells: Array<[number, number, string]> = [];
  for (let i = 0; i < cellCount; i++) {
    if (!need(12)) {
      return { ok: false, error: 'bad-shape' };
    }
    const r = view.getUint32(off, true);
    off += 4;
    const c = view.getUint32(off, true);
    off += 4;
    const inputLen = view.getUint32(off, true);
    off += 4;
    if (r >= rowCount || c >= columnCount || inputLen > MAX_RSF_CELL_LENGTH || !need(inputLen)) {
      return { ok: false, error: 'bad-shape' };
    }
    let input: string;
    try {
      input = dec.decode(body.subarray(off, off + inputLen));
    } catch {
      return { ok: false, error: 'bad-shape' };
    }
    off += inputLen;
    cells.push([r, c, input]);
  }
  // Version-8 cell-style block, validated against the same known dimensions
  // exactly like the cell records just above; version 9 adds a per-style
  // number format; version 10 adds a per-border-side line style and width —
  // both read from the same records.
  let styles: Array<[number, number, CellStyle]> | undefined;
  if (bodyVersion >= 8) {
    const rd = new BodyReader(body, dec);
    rd.off = off;
    const block = readStyleBlock(rd, rowCount, columnCount, bodyVersion >= 9, bodyVersion >= 10);
    if (!block.ok) {
      return { ok: false, error: block.error };
    }
    off = rd.off;
    styles = block.styles;
  }
  // Version-11 cell-comment block, validated against the same known
  // dimensions exactly like the cell and style records above.
  let comments: Array<[number, number, string]> | undefined;
  if (bodyVersion >= 11) {
    const rd = new BodyReader(body, dec);
    rd.off = off;
    const block = readCommentBlock(rd, rowCount, columnCount);
    if (!block.ok) {
      return { ok: false, error: block.error };
    }
    off = rd.off;
    comments = block.comments;
  }
  if (off !== body.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const data: RsfData = { name, delimiter, rowCount, columnCount, cells };
  if (kind !== 'grid') {
    data.kind = kind;
  }
  if (locked) {
    data.locked = true;
  }
  if (!historyEnabled) {
    data.historyEnabled = false;
  }
  if (history.length > 0) {
    data.history = history;
  }
  if (historyMaxOverride !== undefined) {
    data.historyMaxOverride = historyMaxOverride;
  }
  if (styles !== undefined) {
    data.styles = styles;
  }
  if (comments !== undefined) {
    data.comments = comments;
  }
  if (appName !== undefined) {
    data.appName = appName;
  }
  if (appVersion !== undefined) {
    data.appVersion = appVersion;
  }
  if (timezone !== undefined) {
    data.timezone = timezone;
  }
  if (displayLanguage !== undefined) {
    data.displayLanguage = displayLanguage;
  }
  if (bodyVersion >= 3) {
    // Validate the display block now that the sheet dimensions are known:
    // out-of-range zoom clamps, widths clamp, unknown columns are dropped,
    // and duplicate column entries resolve to the last one written.
    const display: RsfDisplaySettings = {};
    if (rawZoom !== 0) {
      display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, rawZoom));
    }
    const widths = new Map<number, number>();
    for (const [col, width] of rawWidths) {
      if (col < columnCount) {
        widths.set(col, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, width)));
      }
    }
    if (widths.size > 0) {
      display.colWidths = [...widths.entries()];
    }
    if (rawWrap) {
      display.wrap = true;
    }
    if (display.zoom !== undefined || display.colWidths || display.wrap) {
      data.display = display;
    }
  }
  if (filterStored) {
    // Full semantic validation against the (now known) sheet dimensions and
    // the documented bounds. An invalid stored filter is ignored — the sheet
    // loads without it and the caller shows a localized warning.
    const validated = rawFilter === null ? null : validateFilter(rawFilter, rowCount, columnCount);
    if (validated !== null) {
      data.filter = validated;
    } else {
      data.filterDropped = true;
    }
  }
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Workbook container (container version 4)
// ---------------------------------------------------------------------------

/**
 * A bounds-checked cursor over an uncompressed body. Every read is guarded by
 * {@link BodyReader.need} so a truncated or crafted container can never read
 * past the buffer; string reads use a fatal UTF-8 decoder so invalid sequences
 * are rejected rather than replaced.
 */
class BodyReader {
  readonly view: DataView;
  off = 0;

  constructor(
    readonly body: Uint8Array,
    private readonly dec: TextDecoder,
  ) {
    this.view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  }

  need(n: number): boolean {
    return n >= 0 && this.off + n <= this.body.length;
  }

  u8(): number {
    return this.body[this.off++];
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.off, true);
    this.off += 8;
    return v;
  }

  /** A length-prefixed UTF-8 string, or null when truncated/undecodable. */
  str(): string | null {
    if (!this.need(2)) {
      return null;
    }
    const len = this.u16();
    if (!this.need(len)) {
      return null;
    }
    try {
      const s = this.dec.decode(this.body.subarray(this.off, this.off + len));
      this.off += len;
      return s;
    } catch {
      return null;
    }
  }
}

/**
 * Read a filter block (its leading flags byte included). Returns null when the
 * block is structurally unreadable (the container is malformed); otherwise
 * reports whether a filter was stored and the raw filter, which the caller
 * validates against the worksheet's dimensions. A *readable* block whose
 * contents are semantically unknown (unknown operator or join) yields
 * `raw: null` so the caller drops it with a warning instead of guessing.
 */
function readFilterBlock(rd: BodyReader): { stored: boolean; raw: SheetFilter | null } | null {
  if (!rd.need(1)) {
    return null;
  }
  const flags = rd.u8();
  if ((flags & 1) === 0) {
    return { stored: false, raw: null };
  }
  if (!rd.need(1 + 16 + 2)) {
    return null;
  }
  const headerRow = rd.u8() !== 0;
  const top = rd.u32();
  const left = rd.u32();
  const bottom = rd.u32();
  const right = rd.u32();
  const columnCount = rd.u16();
  const columns: ColumnFilter[] = [];
  let readable = true;
  for (let i = 0; i < columnCount; i++) {
    if (!rd.need(4 + 1 + 1)) {
      return null;
    }
    const col = rd.u32();
    const joinByte = rd.u8();
    if (joinByte > 1) {
      readable = false; // unknown join semantics: never guessed at
    }
    const conditionCount = rd.u8();
    const conditions: FilterCondition[] = [];
    for (let j = 0; j < conditionCount; j++) {
      if (!rd.need(2)) {
        return null;
      }
      const kind = rd.u8();
      const opIndex = rd.u8();
      if (kind === 0) {
        const value = rd.str();
        if (value === null) {
          return null;
        }
        const op = FILTER_TEXT_OPS[opIndex];
        if (op === undefined) {
          readable = false;
        } else {
          conditions.push({ kind: 'text', op, value });
        }
      } else if (kind === 1) {
        if (!rd.need(16)) {
          return null;
        }
        const value = rd.f64();
        const value2 = rd.f64();
        const op = FILTER_NUMBER_OPS[opIndex];
        if (op === undefined) {
          readable = false;
        } else {
          conditions.push({
            kind: 'number',
            op,
            value,
            ...(Number.isNaN(value2) ? {} : { value2 }),
          });
        }
      } else {
        // An unknown condition kind has an unknown layout, so the rest of the
        // block cannot be located: the container is malformed.
        return null;
      }
    }
    if (!rd.need(1)) {
      return null;
    }
    const hasValues = rd.u8();
    let values: string[] | null = null;
    if (hasValues === 1) {
      if (!rd.need(2)) {
        return null;
      }
      const valueCount = rd.u16();
      values = [];
      for (let j = 0; j < valueCount; j++) {
        const v = rd.str();
        if (v === null) {
          return null;
        }
        values.push(v);
      }
    } else if (hasValues !== 0) {
      return null;
    }
    columns.push({ col, join: joinByte === 1 ? 'or' : 'and', conditions, values });
  }
  return { stored: true, raw: readable ? { top, left, bottom, right, headerRow, columns } : null };
}

/** Encode a worksheet's display block: a flags byte plus the present parts. */
function encodeDisplayBlock(display: RsfDisplaySettings | undefined, columnCount: number): number[] {
  const widths = (display?.colWidths ?? []).filter(
    ([col, width]) =>
      Number.isInteger(col) && col >= 0 && col < columnCount && Number.isInteger(width) && width > 0,
  );
  const zoom = display?.zoom;
  const bytes: number[] = [];
  // Bit 0: zoom follows. Bit 1: a width table follows. Bit 2: wrap long rows
  // (payload-free, so a reader that ignores it stays byte-aligned).
  const flags = (zoom !== undefined ? 1 : 0) | (widths.length > 0 ? 2 : 0) | (display?.wrap ? 4 : 0);
  bytes.push(flags);
  if (zoom !== undefined) {
    const clamped = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, Math.round(zoom)));
    bytes.push(clamped & 0xff, (clamped >> 8) & 0xff);
  }
  if (widths.length > 0) {
    const n = widths.length;
    bytes.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    for (const [col, width] of widths) {
      bytes.push(col & 0xff, (col >>> 8) & 0xff, (col >>> 16) & 0xff, (col >>> 24) & 0xff);
      const w = Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, Math.round(width)));
      bytes.push(w & 0xff, (w >> 8) & 0xff);
    }
  }
  return bytes;
}

/** Read a worksheet display block, clamping every value into the documented bounds. */
function readDisplayBlock(rd: BodyReader, columnCount: number): RsfDisplaySettings | null | 'bad-shape' {
  if (!rd.need(1)) {
    return 'bad-shape';
  }
  const flags = rd.u8();
  const display: RsfDisplaySettings = {};
  if (flags & 1) {
    if (!rd.need(2)) {
      return 'bad-shape';
    }
    display.zoom = Math.max(RSF_ZOOM_MIN, Math.min(RSF_ZOOM_MAX, rd.u16()));
  }
  if (flags & 2) {
    if (!rd.need(4)) {
      return 'bad-shape';
    }
    const count = rd.u32();
    if (count > MAX_RSF_COLS || !rd.need(count * 6)) {
      return 'bad-shape';
    }
    const widths = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const col = rd.u32();
      const width = rd.u16();
      if (col < columnCount) {
        widths.set(col, Math.max(RSF_COL_WIDTH_MIN, Math.min(RSF_COL_WIDTH_MAX, width)));
      }
    }
    if (widths.size > 0) {
      display.colWidths = [...widths.entries()];
    }
  }
  if (flags & 4) {
    display.wrap = true;
  }
  return display.zoom !== undefined || display.colWidths || display.wrap ? display : null;
}

/** Append a length-prefixed UTF-8 string (bounded to `max` bytes). */
function pushString(bytes: number[], enc: TextEncoder, value: string, max: number): void {
  let encoded = enc.encode(value);
  if (encoded.length > max) {
    encoded = encoded.subarray(0, max);
  }
  bytes.push(encoded.length & 0xff, (encoded.length >> 8) & 0xff);
  for (const b of encoded) {
    bytes.push(b);
  }
}

/**
 * Encode the workbook body (container version 4). Body version 11 is written
 * whenever at least one worksheet in the workbook is a json sheet (the
 * per-worksheet kind byte, see version 8 below, is only legal to hold `json`
 * from this version); body version 8 appends a per-worksheet kind byte (0 =
 * grid, 1 = markdown, 2 = json), written for every worksheet only when at
 * least one worksheet in the workbook is markdown or json; body version 7
 * adds a per-worksheet cell-comment block; body version 6
 * adds a per-border-side line style and width, written only when at least
 * one border side in the workbook uses a non-default one; body version 5
 * adds a per-style number format, written only when at least one styled cell
 * in the workbook carries one; body version 4 adds a per-worksheet
 * cell-style block, written (for every worksheet) only when at least one
 * cell in the workbook carries a style; body version 3 adds the workbook
 * display language, written only when it is not English; body version 2
 * adds the workbook timezone, written only when it is not UTC; body version
 * 1 is the original layout.
 */
function encodeWorkbookBody(data: RsfWorkbookData): Uint8Array {
  const enc = new TextEncoder();
  const bytes: number[] = [];
  const u32 = (v: number): void => {
    bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const f64 = (v: number): void => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, v, true);
    for (const b of buf) {
      bytes.push(b);
    }
  };
  // At least one json worksheet needs body version 11, which — like every
  // other version bump here — must physically carry every lower section too,
  // so it is chained into `hasHistorySection` (>= 10) the same way history
  // chains into `hasLocked` (>= 9) the same way a locked worksheet chains
  // into `hasMarkdown` (>= 8) the same way a markdown worksheet chains into
  // `hasComments` (>= 7) the same way the single-sheet body's `encodeBody`
  // chains it in. Comments/border style/number formats force the style-block
  // version too — same prefix-chain rule as the single-sheet body above.
  const hasMaxOverride = data.historyMaxOverride !== undefined;
  const hasJson = data.sheets.some((sheet) => sheet.kind === 'json');
  const hasHistorySection =
    hasMaxOverride || hasJson || data.historyEnabled === false || (data.history?.length ?? 0) > 0;
  const hasLocked = hasHistorySection || data.sheets.some((sheet) => sheet.locked === true);
  const hasMarkdown = hasLocked || data.sheets.some((sheet) => sheet.kind === 'markdown');
  const hasComments = hasMarkdown || data.sheets.some((sheet) => (sheet.comments?.length ?? 0) > 0);
  const hasBorderStyle = data.sheets.some((sheet) =>
    (sheet.styles ?? []).some(([, , style]) =>
      BORDER_SIDES.some((side) => {
        const value = borderSideValue(style, side);
        return (
          value !== null &&
          (value.lineStyle !== DEFAULT_BORDER_LINE_STYLE || value.width !== DEFAULT_BORDER_WIDTH)
        );
      }),
    ),
  );
  const hasNumberFormats = data.sheets.some((sheet) =>
    (sheet.styles ?? []).some(([, , style]) => style.numberFormat !== undefined),
  );
  const hasNumberFormatSection = hasBorderStyle || hasNumberFormats;
  const hasStyles =
    hasNumberFormatSection || data.sheets.some((sheet) => (sheet.styles?.length ?? 0) > 0) || hasComments;
  const hasDisplayLanguage =
    hasStyles || (data.displayLanguage !== undefined && data.displayLanguage !== DEFAULT_DISPLAY_LANGUAGE);
  const hasTimezone =
    hasDisplayLanguage || (data.timezone !== undefined && data.timezone !== DEFAULT_TIMEZONE);
  bytes.push(
    hasMaxOverride
      ? 12
      : hasJson
        ? 11
        : hasHistorySection
          ? 10
          : hasLocked
            ? 9
            : hasMarkdown
              ? 8
              : hasComments
                ? 7
                : hasBorderStyle
                  ? 6
                  : hasNumberFormats
                    ? 5
                    : hasStyles
                      ? 4
                      : hasDisplayLanguage
                        ? 3
                        : hasTimezone
                          ? 2
                          : 1,
  );
  bytes.push(data.delimiter.charCodeAt(0));
  pushString(bytes, enc, data.appName ?? '', MAX_META_LENGTH);
  pushString(bytes, enc, data.appVersion ?? '', MAX_META_LENGTH);
  f64(data.createdAt ?? 0);
  f64(data.updatedAt ?? 0);
  pushString(bytes, enc, data.docId ?? '', MAX_RSF_SHEET_NAME_BYTES);
  pushString(bytes, enc, data.activeSheetId ?? '', MAX_RSF_SHEET_NAME_BYTES);
  if (hasTimezone) {
    pushString(bytes, enc, data.timezone ?? DEFAULT_TIMEZONE, MAX_META_LENGTH);
  }
  if (hasDisplayLanguage) {
    pushString(bytes, enc, data.displayLanguage ?? DEFAULT_DISPLAY_LANGUAGE, MAX_META_LENGTH);
  }
  if (hasHistorySection) {
    // Version-10 workbook-level history block. Written whenever history is
    // disabled or holds at least one snapshot, so a workbook left on the
    // (enabled) default with no saves recorded yet stays a version-9-or-lower
    // body — same placement and reasoning as the single-sheet body's own
    // version-14 block (see `encodeBody`).
    for (const b of encodeHistoryBlock(data.historyEnabled, data.history, data.historyMaxOverride)) {
      bytes.push(b);
    }
  }
  const sheets = data.sheets.slice(0, MAX_RSF_SHEETS);
  bytes.push(sheets.length & 0xff, (sheets.length >> 8) & 0xff);
  for (const sheet of sheets) {
    pushString(bytes, enc, sheet.id, MAX_RSF_SHEET_NAME_BYTES);
    pushString(bytes, enc, sheet.name, MAX_RSF_SHEET_NAME_BYTES);
    u32(sheet.rowCount);
    u32(sheet.columnCount);
    u32(sheet.cells.length);
    for (const [r, c, input] of sheet.cells) {
      u32(r);
      u32(c);
      const value = enc.encode(input);
      u32(value.length);
      for (const b of value) {
        bytes.push(b);
      }
    }
    for (const b of encodeDisplayBlock(sheet.display, sheet.columnCount)) {
      bytes.push(b);
    }
    for (const b of encodeFilterBlock(sheet.filter)) {
      bytes.push(b);
    }
    if (hasStyles) {
      for (const b of encodeStyleBlock(sheet.styles, hasNumberFormatSection, hasBorderStyle)) {
        bytes.push(b);
      }
    }
    if (hasComments) {
      for (const b of encodeCommentBlock(sheet.comments)) {
        bytes.push(b);
      }
    }
    if (hasMarkdown) {
      // Version-8+ worksheet kind (json legal only from version 11),
      // appended after every other section of the record so every existing
      // field position is unchanged — the same additive-at-the-tail approach
      // used for the per-style number-format sub-record. Written for every
      // worksheet once version 8 is selected (including by a lock or a json
      // worksheet elsewhere in the workbook, both via `hasMarkdown`'s
      // chaining), exactly like the style/comment blocks above.
      bytes.push(WORKSHEET_KIND_BYTE[sheet.kind ?? 'grid']);
    }
    if (hasLocked) {
      // Version-9 worksheet lock, appended after the kind byte for the same
      // additive-at-the-tail reason. Written for every worksheet once version
      // 9 is selected, with each worksheet's own locked state.
      bytes.push(sheet.locked === true ? 1 : 0);
    }
  }
  return Uint8Array.from(bytes);
}

/** Decode and strictly validate a workbook body. Never executes anything. */
function decodeWorkbookBody(body: Uint8Array): RsfWorkbookDecodeResult {
  const dec = new TextDecoder('utf-8', { fatal: true });
  const rd = new BodyReader(body, dec);
  if (!rd.need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const version = rd.u8();
  if (version < 1 || version > RSF_WORKBOOK_BODY_VERSION) {
    return { ok: false, error: 'bad-version' };
  }
  const delimiter = DELIMS[rd.u8()];
  if (!delimiter) {
    return { ok: false, error: 'bad-shape' };
  }
  const appName = rd.str();
  const appVersion = rd.str();
  if (appName === null || appVersion === null) {
    return { ok: false, error: 'bad-shape' };
  }
  if (!rd.need(16)) {
    return { ok: false, error: 'bad-shape' };
  }
  const createdAt = rd.f64();
  const updatedAt = rd.f64();
  const docId = rd.str();
  const activeSheetId = rd.str();
  if (docId === null || activeSheetId === null) {
    return { ok: false, error: 'bad-shape' };
  }
  // Version-2 workbook timezone. Not validated against `Intl` here — that
  // happens where it is consumed (`RsfDocument`), which falls back to UTC for
  // an unresolvable name rather than rejecting the whole file.
  let timezone: string | undefined;
  if (version >= 2) {
    const tz = rd.str();
    if (tz === null) {
      return { ok: false, error: 'bad-shape' };
    }
    timezone = tz;
  }
  // Version-3 workbook display language. Not validated here — that happens
  // where it is consumed (`RsfDocument`), which falls back to `"en"` for an
  // absent or unrecognized value rather than rejecting the whole file.
  let displayLanguage: string | undefined;
  if (version >= 3) {
    const lang = rd.str();
    if (lang === null) {
      return { ok: false, error: 'bad-shape' };
    }
    displayLanguage = lang;
  }
  // Version-10 workbook-level history block (see `readHistoryBlock` and
  // `encodeWorkbookBody`); version 12 adds the retained-snapshot cap override.
  let historyEnabled = true;
  let historyMaxOverride: number | null | undefined;
  let history: RsfHistorySnapshot[] = [];
  if (version >= 10) {
    const block = readHistoryBlock(rd, version >= 12);
    if (!block.ok) {
      return { ok: false, error: block.error };
    }
    historyEnabled = block.enabled;
    historyMaxOverride = block.maxOverride;
    history = block.history;
  }
  if (!rd.need(2)) {
    return { ok: false, error: 'bad-shape' };
  }
  const sheetCount = rd.u16();
  if (sheetCount < 1) {
    return { ok: false, error: 'bad-shape' };
  }
  if (sheetCount > MAX_RSF_SHEETS) {
    return { ok: false, error: 'too-large' };
  }
  const sheets: RsfWorksheetData[] = [];
  const seenIds = new Set<string>();
  // Cells (and styles) are capped across the whole workbook, not just per
  // worksheet, so a container cannot multiply its way past the ceiling with
  // many worksheets.
  let totalCells = 0;
  let totalStyles = 0;
  let totalComments = 0;
  for (let s = 0; s < sheetCount; s++) {
    const id = rd.str();
    const name = rd.str();
    if (id === null || name === null || id.length === 0) {
      return { ok: false, error: 'bad-shape' };
    }
    // Worksheet identifiers must be unique: duplicates would make the active
    // worksheet and every cross-sheet reference ambiguous.
    if (seenIds.has(id)) {
      return { ok: false, error: 'bad-shape' };
    }
    seenIds.add(id);
    if (!rd.need(12)) {
      return { ok: false, error: 'bad-shape' };
    }
    const rowCount = rd.u32();
    const columnCount = rd.u32();
    const cellCount = rd.u32();
    if (rowCount < 1 || columnCount < 1) {
      return { ok: false, error: 'bad-shape' };
    }
    if (
      rowCount > MAX_RSF_ROWS ||
      columnCount > MAX_RSF_COLS ||
      rowCount * columnCount > MAX_RSF_CELLS ||
      cellCount > rowCount * columnCount
    ) {
      return { ok: false, error: 'too-large' };
    }
    totalCells += cellCount;
    if (totalCells > MAX_RSF_CELLS) {
      return { ok: false, error: 'too-large' };
    }
    const cells: Array<[number, number, string]> = [];
    for (let i = 0; i < cellCount; i++) {
      if (!rd.need(12)) {
        return { ok: false, error: 'bad-shape' };
      }
      const r = rd.u32();
      const c = rd.u32();
      const inputLen = rd.u32();
      if (r >= rowCount || c >= columnCount || inputLen > MAX_RSF_CELL_LENGTH || !rd.need(inputLen)) {
        return { ok: false, error: 'bad-shape' };
      }
      let input: string;
      try {
        input = dec.decode(rd.body.subarray(rd.off, rd.off + inputLen));
      } catch {
        return { ok: false, error: 'bad-shape' };
      }
      rd.off += inputLen;
      cells.push([r, c, input]);
    }
    const display = readDisplayBlock(rd, columnCount);
    if (display === 'bad-shape') {
      return { ok: false, error: 'bad-shape' };
    }
    const filterBlock = readFilterBlock(rd);
    if (filterBlock === null) {
      return { ok: false, error: 'bad-shape' };
    }
    // Version-4 per-worksheet cell-style block, validated against this
    // worksheet's dimensions exactly like its cell records above; version 5
    // adds a per-style number format; version 6 adds a per-border-side line
    // style and width — both read from the same records.
    let styles: Array<[number, number, CellStyle]> | undefined;
    if (version >= 4) {
      const styleBlock = readStyleBlock(rd, rowCount, columnCount, version >= 5, version >= 6);
      if (!styleBlock.ok) {
        return { ok: false, error: styleBlock.error };
      }
      totalStyles += styleBlock.styles.length;
      if (totalStyles > MAX_RSF_CELLS) {
        return { ok: false, error: 'too-large' };
      }
      styles = styleBlock.styles;
    }
    // Version-7 per-worksheet cell-comment block, validated against this
    // worksheet's dimensions exactly like its cell and style records above.
    let comments: Array<[number, number, string]> | undefined;
    if (version >= 7) {
      const commentBlock = readCommentBlock(rd, rowCount, columnCount);
      if (!commentBlock.ok) {
        return { ok: false, error: commentBlock.error };
      }
      totalComments += commentBlock.comments.length;
      if (totalComments > MAX_RSF_CELLS) {
        return { ok: false, error: 'too-large' };
      }
      comments = commentBlock.comments;
    }
    // Version-8 worksheet kind, appended after every other section of the
    // record (see `encodeWorkbookBody`). A byte outside the three defined
    // values is a shape a real writer never emits, rejected rather than
    // guessed at, matching the single-sheet body's own kind byte; `json` (2)
    // is a shape a real writer never emits below version 11 either.
    let kind: RsfWorksheetKind = 'grid';
    if (version >= 8) {
      if (!rd.need(1)) {
        return { ok: false, error: 'bad-shape' };
      }
      const resolved = WORKSHEET_KIND_FROM_BYTE[rd.u8()];
      if (resolved === undefined || (resolved === 'json' && version < 11)) {
        return { ok: false, error: 'bad-shape' };
      }
      kind = resolved;
    }
    // Version-9 worksheet lock, appended after the kind byte (see
    // `encodeWorkbookBody`). A byte outside the two defined values is a shape
    // a real writer never emits, rejected rather than guessed at, matching
    // the single-sheet body's own lock byte.
    let locked = false;
    if (version >= 9) {
      if (!rd.need(1)) {
        return { ok: false, error: 'bad-shape' };
      }
      const rawLocked = rd.u8();
      if (rawLocked !== 0 && rawLocked !== 1) {
        return { ok: false, error: 'bad-shape' };
      }
      locked = rawLocked === 1;
    }
    // A markdown or json worksheet's document text is stored as an ordinary
    // cell (0, 0) — a real writer never emits any other shape for one.
    if (kind !== 'grid' && !isValidSourceKindShape(rowCount, columnCount, cellCount)) {
      return { ok: false, error: 'bad-shape' };
    }
    const sheet: RsfWorksheetData = { id, name, rowCount, columnCount, cells };
    if (kind !== 'grid') {
      sheet.kind = kind;
    }
    if (locked) {
      sheet.locked = true;
    }
    if (display) {
      sheet.display = display;
    }
    if (filterBlock.stored) {
      // Full semantic validation against this worksheet's dimensions. An
      // invalid stored filter is dropped (never guessed at) with a warning.
      const validated =
        filterBlock.raw === null ? null : validateFilter(filterBlock.raw, rowCount, columnCount);
      if (validated !== null) {
        sheet.filter = validated;
      } else {
        sheet.filterDropped = true;
      }
    }
    if (styles !== undefined && styles.length > 0) {
      sheet.styles = styles;
    }
    if (comments !== undefined && comments.length > 0) {
      sheet.comments = comments;
    }
    sheets.push(sheet);
  }
  if (rd.off !== body.length) {
    return { ok: false, error: 'bad-shape' };
  }
  const data: RsfWorkbookData = { delimiter, sheets };
  if (appName !== '') {
    data.appName = appName;
  }
  if (appVersion !== '') {
    data.appVersion = appVersion;
  }
  if (createdAt > 0 && Number.isFinite(createdAt)) {
    data.createdAt = createdAt;
  }
  if (updatedAt > 0 && Number.isFinite(updatedAt)) {
    data.updatedAt = updatedAt;
  }
  if (docId !== '') {
    data.docId = docId;
  }
  if (timezone !== undefined && timezone !== '') {
    data.timezone = timezone;
  }
  if (displayLanguage !== undefined && displayLanguage !== '') {
    data.displayLanguage = displayLanguage;
  }
  if (!historyEnabled) {
    data.historyEnabled = false;
  }
  if (history.length > 0) {
    data.history = history;
  }
  if (historyMaxOverride !== undefined) {
    data.historyMaxOverride = historyMaxOverride;
  }
  // An active-worksheet identifier that names no worksheet falls back to the
  // first one rather than leaving the workbook without an active worksheet.
  if (activeSheetId !== '' && seenIds.has(activeSheetId)) {
    data.activeSheetId = activeSheetId;
  } else {
    data.activeSheetId = sheets[0].id;
  }
  return { ok: true, data };
}

/**
 * Convert a one-worksheet workbook payload into the flat single-sheet shape
 * `encodeBody`/`encodeRsf` expect. Shared by {@link encodeRsfWorkbook} (which
 * adds container framing) and {@link encodeRsfBody} (which returns raw body
 * bytes only, for a history snapshot's own opaque payload).
 */
function workbookToSingleSheetData(data: RsfWorkbookData): RsfData {
  const only = data.sheets[0];
  const single: RsfData = {
    name: only.name,
    delimiter: data.delimiter,
    rowCount: only.rowCount,
    columnCount: only.columnCount,
    cells: only.cells,
  };
  if (only.kind !== undefined) {
    single.kind = only.kind;
  }
  if (only.locked) {
    single.locked = true;
  }
  if (data.appName !== undefined) {
    single.appName = data.appName;
  }
  if (data.appVersion !== undefined) {
    single.appVersion = data.appVersion;
  }
  if (data.timezone !== undefined) {
    single.timezone = data.timezone;
  }
  if (data.displayLanguage !== undefined) {
    single.displayLanguage = data.displayLanguage;
  }
  if (data.historyEnabled !== undefined) {
    single.historyEnabled = data.historyEnabled;
  }
  if (data.history !== undefined) {
    single.history = data.history;
  }
  if (data.historyMaxOverride !== undefined) {
    single.historyMaxOverride = data.historyMaxOverride;
  }
  if (only.display) {
    single.display = only.display;
  }
  if (only.filter) {
    single.filter = only.filter;
  }
  if (only.styles) {
    single.styles = only.styles;
  }
  if (only.comments) {
    single.comments = only.comments;
  }
  return single;
}

/**
 * Encode a workbook into the binary `.rsf` container. Workbooks holding a
 * single worksheet are written in the version-3 single-sheet container so
 * files that do not use multi-worksheet features stay readable by older
 * releases; workbooks with two or more worksheets are written in the
 * version-4 workbook container.
 */
export function encodeRsfWorkbook(
  data: RsfWorkbookData,
  method: number = getRsfCodec().defaultMethod(),
): Uint8Array {
  if (data.sheets.length === 1) {
    return encodeRsf(workbookToSingleSheetData(data), method);
  }
  return encodeRsfContainer(RSF_CONTAINER_VERSION_WORKBOOK, method, encodeWorkbookBody(data));
}

/**
 * Encode a workbook payload into raw body bytes only — no container framing
 * (magic, header, compression, CRC-32) and, when `data` carries no
 * `historyEnabled`/`history` of its own, no history section. This is what a
 * history snapshot's own opaque `bytes` are — see {@link RsfData.history} —
 * so a snapshot captures cell/style/formula content exactly like the live
 * document, but never nests another snapshot list inside itself. `RsfDocument`
 * calls this with the current content and no history fields set, which is
 * exactly what a version-13-or-lower single-sheet body (or version-9-or-lower
 * workbook body) already looked like before this feature existed.
 */
export function encodeRsfBody(data: RsfWorkbookData): Uint8Array {
  if (data.sheets.length === 1) {
    return encodeBody(workbookToSingleSheetData(data));
  }
  return encodeWorkbookBody(data);
}

/**
 * Convert a decoded single-sheet body into the flat workbook shape — the
 * inverse of {@link workbookToSingleSheetData}. Used by
 * {@link decodeRsfHistorySnapshot} to give a restored snapshot the same
 * one-worksheet workbook model every other decode path produces; carries only
 * content (no `historyEnabled`/`history`/`compression`, irrelevant to a
 * snapshot's own past content).
 */
function singleToWorkbookData(data: RsfData): RsfWorkbookData {
  const sheet: RsfWorksheetData = {
    id: 's1',
    name: data.name,
    rowCount: data.rowCount,
    columnCount: data.columnCount,
    cells: data.cells,
  };
  if (data.kind !== undefined) {
    sheet.kind = data.kind;
  }
  if (data.locked) {
    sheet.locked = true;
  }
  if (data.display) {
    sheet.display = data.display;
  }
  if (data.filter) {
    sheet.filter = data.filter;
  }
  if (data.filterDropped) {
    sheet.filterDropped = true;
  }
  if (data.styles) {
    sheet.styles = data.styles;
  }
  if (data.comments) {
    sheet.comments = data.comments;
  }
  const workbook: RsfWorkbookData = { delimiter: data.delimiter, sheets: [sheet], activeSheetId: sheet.id };
  if (data.appName !== undefined) {
    workbook.appName = data.appName;
  }
  if (data.appVersion !== undefined) {
    workbook.appVersion = data.appVersion;
  }
  if (data.timezone !== undefined) {
    workbook.timezone = data.timezone;
  }
  if (data.displayLanguage !== undefined) {
    workbook.displayLanguage = data.displayLanguage;
  }
  return workbook;
}

/**
 * Decode one version-history snapshot's opaque body bytes back into a
 * workbook model, for the "restore" action of Sheet ▸ File Version History….
 * A snapshot's `bytes` are produced by {@link encodeRsfBody}, which picks the
 * single-sheet or workbook body shape based on how many worksheets the
 * document held *at that save* — information not recorded alongside the
 * bytes themselves (see {@link RsfHistorySnapshot}), so this tries the
 * single-sheet decoder first (the overwhelmingly common case) and falls back
 * to the workbook decoder. Both decoders fully validate their shape,
 * including an exact-length final check, so bytes written in one shape do
 * not parse successfully as the other in practice.
 */
export function decodeRsfHistorySnapshot(snapshot: RsfHistorySnapshot): RsfWorkbookDecodeResult {
  const single = decodeBody(snapshot.bytes);
  if (single.ok) {
    return { ok: true, data: singleToWorkbookData(single.data) };
  }
  const workbook = decodeWorkbookBody(snapshot.bytes);
  if (workbook.ok) {
    return workbook;
  }
  return single;
}

/**
 * Decode any supported `.rsf` container into the workbook model: a version-4
 * workbook container, a version-3 single-sheet container, or a legacy `.rcsv`
 * (RCSV magic, container version 2) single-sheet container. The two
 * single-sheet forms decode into a one-worksheet workbook and are flagged with
 * `legacySingleSheet` so the caller can report the migration.
 */
export function decodeRsfWorkbook(bytes: Uint8Array): RsfWorkbookDecodeResult {
  if (bytes.length < HEADER_SIZE) {
    return { ok: false, error: 'bad-magic' };
  }
  const isWorkbook = RSF_MAGIC.every((b, i) => bytes[i] === b) && bytes[4] === RSF_CONTAINER_VERSION_WORKBOOK;
  if (!isWorkbook) {
    // Not a workbook container: fall back to the single-sheet decoder, which
    // validates the magic/version pair itself and reads legacy containers.
    const single = decodeRsf(bytes);
    if (!single.ok) {
      return { ok: false, error: single.error };
    }
    const sheet: RsfWorksheetData = {
      // A single-sheet container stores no worksheet identifier; a stable one
      // is minted here so the in-memory workbook model is uniform.
      id: 's1',
      name: single.data.name,
      rowCount: single.data.rowCount,
      columnCount: single.data.columnCount,
      cells: single.data.cells,
    };
    if (single.data.kind !== undefined) {
      sheet.kind = single.data.kind;
    }
    if (single.data.locked) {
      sheet.locked = true;
    }
    if (single.data.display) {
      sheet.display = single.data.display;
    }
    if (single.data.filter) {
      sheet.filter = single.data.filter;
    }
    if (single.data.filterDropped) {
      sheet.filterDropped = true;
    }
    if (single.data.styles) {
      sheet.styles = single.data.styles;
    }
    if (single.data.comments) {
      sheet.comments = single.data.comments;
    }
    const data: RsfWorkbookData = {
      delimiter: single.data.delimiter,
      sheets: [sheet],
      activeSheetId: sheet.id,
      legacySingleSheet: true,
    };
    if (single.data.appName !== undefined) {
      data.appName = single.data.appName;
    }
    if (single.data.appVersion !== undefined) {
      data.appVersion = single.data.appVersion;
    }
    if (single.data.timezone !== undefined) {
      data.timezone = single.data.timezone;
    }
    if (single.data.displayLanguage !== undefined) {
      data.displayLanguage = single.data.displayLanguage;
    }
    if (single.data.compression !== undefined) {
      data.compression = single.data.compression;
    }
    if (single.data.historyEnabled === false) {
      data.historyEnabled = false;
    }
    if (single.data.history !== undefined) {
      data.history = single.data.history;
    }
    if (single.data.historyMaxOverride !== undefined) {
      data.historyMaxOverride = single.data.historyMaxOverride;
    }
    return { ok: true, data };
  }
  const container = decodeRsfContainer(bytes);
  if (!container.ok) {
    return container;
  }
  const decoded = decodeWorkbookBody(container.body);
  if (decoded.ok) {
    decoded.data.compression = container.method;
  }
  return decoded;
}
