// SPDX-License-Identifier: MIT
/**
 * A cell's style object in `.rsf` (the values of a worksheet's `styles`,
 * knowledge/formats/rsf/json-document.md), read and written here rather than
 * in `rsf-codec.ts`. Like every key in the codec, a known key with the wrong
 * shape fails the whole file; a key this reader does not know is ignored.
 */
import {
  BORDER_LINE_STYLES,
  BORDER_SIDES,
  BORDER_STYLE_KEY,
  BORDER_WIDTH_KEY,
  BORDER_WIDTHS,
  HORIZONTAL_ALIGNS,
  DEFAULT_BORDER_LINE_STYLE,
  DEFAULT_BORDER_WIDTH,
  MAX_CURRENCY_SYMBOL_LENGTH,
  MAX_NUMBER_FORMAT_DECIMALS,
  NUMBER_FORMAT_KINDS,
  normalizeHexColor,
  type CellStyle,
  type NumberFormat,
} from './cell-style';
import { MAX_TEXT_RUNS, runsForText, type RunFormat, type TextRun } from './rich-text';
import { MAX_FONT_FAMILY_LENGTH, normalizeFontFamily, normalizeFontSize } from './text-font';

type Fail = (reason?: 'too-large') => never;
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: unknown };

/** The font keys a style and a run share, for their JSON object. */
function fontToJson(format: RunFormat, out: { [key: string]: Json }): void {
  if (format.fontFamily !== undefined) out.fontFamily = format.fontFamily;
  if (format.fontSize !== undefined) out.fontSize = format.fontSize;
}

/**
 * A style's JSON object. `input` is the cell's text: rich-text runs are
 * written only while they still spell it out (stale runs are dropped here,
 * never saved).
 */
export function styleToJson(style: CellStyle, input: string): { [key: string]: Json } {
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
  fontToJson(style, out);
  if (style.horizontalAlign) out.horizontalAlign = style.horizontalAlign;
  const runs = runsForText(style.runs, input);
  if (runs) {
    out.runs = runs.map((run) => {
      const json: { [key: string]: Json } = { text: run.text };
      if (run.bold !== undefined) json.bold = run.bold;
      if (run.italic !== undefined) json.italic = run.italic;
      if (run.underline !== undefined) json.underline = run.underline;
      if (run.textColor !== undefined) json.textColor = run.textColor;
      fontToJson(run, json);
      return json;
    });
  }
  return out;
}

/** Reads one style's JSON object. `maxText` bounds the runs' total text length. */
export function styleFromJson(value: unknown, maxText: number, fail: Fail): CellStyle {
  const read = new Reader(fail);
  if (!read.isObject(value)) {
    return fail();
  }
  const style: CellStyle = {};
  if (read.boolean(value, 'bold')) style.bold = true;
  if (read.boolean(value, 'italic')) style.italic = true;
  if (read.boolean(value, 'underline')) style.underline = true;
  const text = read.color(value, 'textColor');
  if (text) style.textColor = text;
  const background = read.color(value, 'backgroundColor');
  if (background) style.backgroundColor = background;
  for (const side of BORDER_SIDES) {
    const sideColor = read.color(value, side);
    if (!sideColor) {
      continue;
    }
    style[side] = sideColor;
    const lineStyle = value[BORDER_STYLE_KEY[side]];
    if (lineStyle !== undefined) {
      style[BORDER_STYLE_KEY[side]] = read.oneOf(lineStyle, BORDER_LINE_STYLES);
    }
    const width = value[BORDER_WIDTH_KEY[side]];
    if (width !== undefined) {
      style[BORDER_WIDTH_KEY[side]] = read.oneOf(width, BORDER_WIDTHS);
    }
  }
  if (value.numberFormat !== undefined) {
    style.numberFormat = read.numberFormat(value.numberFormat);
  }
  read.font(value, style);
  if (value.horizontalAlign !== undefined) {
    style.horizontalAlign = read.oneOf(value.horizontalAlign, HORIZONTAL_ALIGNS);
  }
  if (value.runs !== undefined) {
    style.runs = read.runs(value.runs, maxText);
  }
  return style;
}

/** The strict readers a style is built from, each failing through `fail`. */
class Reader {
  constructor(private readonly fail: Fail) {}

  isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  string(obj: JsonObject, key: string, max = 255): string | undefined {
    const value = obj[key];
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'string' && value.length <= max ? value : this.fail();
  }

  boolean(obj: JsonObject, key: string): boolean | undefined {
    const value = obj[key];
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'boolean' ? value : this.fail();
  }

  oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : this.fail();
  }

  color(obj: JsonObject, key: string): string | undefined {
    const raw = this.string(obj, key);
    return raw === undefined ? undefined : (normalizeHexColor(raw) ?? this.fail());
  }

  numberFormat(value: unknown): NumberFormat {
    if (!this.isObject(value)) {
      return this.fail();
    }
    const kind = this.oneOf(value.kind, NUMBER_FORMAT_KINDS);
    const decimals = value.decimals;
    if (
      typeof decimals !== 'number' ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > MAX_NUMBER_FORMAT_DECIMALS
    ) {
      return this.fail();
    }
    const numberFormat: NumberFormat = {
      kind,
      decimals,
      thousands: this.boolean(value, 'thousands') ?? false,
    };
    if (kind === 'currency') {
      const symbol = this.string(value, 'currencySymbol', 64);
      numberFormat.currencySymbol = (symbol ?? '$').slice(0, MAX_CURRENCY_SYMBOL_LENGTH);
    }
    return numberFormat;
  }

  /** `fontFamily` and `fontSize`, onto `out`. */
  font(obj: JsonObject, out: RunFormat): void {
    const family = this.string(obj, 'fontFamily', MAX_FONT_FAMILY_LENGTH);
    if (family !== undefined) {
      out.fontFamily = normalizeFontFamily(family) ?? this.fail();
    }
    const size = obj.fontSize;
    if (size !== undefined) {
      out.fontSize = (typeof size === 'number' ? normalizeFontSize(size) : null) ?? this.fail();
    }
  }

  /** A style's rich-text runs: `[{ "text", "bold"?, …, "fontFamily"?, "fontSize"? }]`. */
  runs(value: unknown, maxText: number): TextRun[] {
    if (!Array.isArray(value)) {
      return this.fail();
    }
    if (value.length > MAX_TEXT_RUNS) {
      return this.fail('too-large');
    }
    let length = 0;
    return value.map((raw: unknown) => {
      if (!this.isObject(raw) || typeof raw.text !== 'string') {
        return this.fail();
      }
      length += raw.text.length;
      if (length > maxText) {
        return this.fail('too-large');
      }
      const run: TextRun = { text: raw.text };
      const bold = this.boolean(raw, 'bold');
      if (bold !== undefined) run.bold = bold;
      const italic = this.boolean(raw, 'italic');
      if (italic !== undefined) run.italic = italic;
      const underline = this.boolean(raw, 'underline');
      if (underline !== undefined) run.underline = underline;
      const color = this.color(raw, 'textColor');
      if (color !== undefined) run.textColor = color;
      this.font(raw, run);
      return run;
    });
  }
}
