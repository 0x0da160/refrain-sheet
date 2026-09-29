// SPDX-License-Identifier: MIT
/**
 * Selected objects as one picture (Insert > Save as PNG Image… / Save as
 * SVG Image…, see `src/app/commands/object-export.ts`): a standalone SVG
 * with every object where the sheet has it, in its stacking order, on a
 * transparent background; the PNG is that SVG drawn on a canvas.
 *
 * The picture stands on its own, so nothing in it depends on the app's
 * stylesheet: shape text is SVG text (wrapped by measuring it, as the grid
 * wraps it), a picture is its own `data:` URL, a chart is its drawing.
 * Text with no colour of its own is black, since the picture is meant for
 * other documents, not for this app's theme. Nothing is parsed as markup:
 * every node is built and the result serialized.
 */
import type { RsfDocument } from '../core/workbook/rsf-document';
import { isLineKind, objectDefaults, type SheetObject } from '../core/workbook/sheet-objects';
import { wrapVisualLines, type WrapMeasure } from '../core/text-wrap';
import { chartSvg, imageDataUrl, shapeSvg } from './sheet-object-view';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** Shape text: the grid's default size (px) and the padding inside the shape. */
const TEXT_SIZE = 12;
const TEXT_PAD_X = 6;
const TEXT_PAD_Y = 4;
const LINE_HEIGHT = 1.3;
const MAX_TEXT_LINES = 200;
/** A PNG is drawn at twice the size for sharp edges, but never wider or taller than this. */
const PNG_SCALE = 2;
const MAX_PNG_SIDE = 8192;

/** One object to draw and its top-left corner on the sheet (px at 100% zoom). */
export interface PlacedObject {
  o: SheetObject;
  x: number;
  y: number;
}

/** How shape text is set: the font family and a way to measure a line in a CSS font. */
export interface TextSetting {
  family: string;
  measure: (text: string, font: string) => number;
}

function svgNode(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

/** The box a placed object covers, rotation and line ends included. */
function coveredBox(item: PlacedObject): { left: number; top: number; right: number; bottom: number } {
  const { o, x, y } = item;
  const pad = isLineKind(o.kind)
    ? Math.ceil(Math.max(4, (o.strokeWidth ?? objectDefaults(o.kind).strokeWidth) * 2))
    : 0;
  const cx = x + o.width / 2;
  const cy = y + o.height / 2;
  const angle = ((o.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const halfW = (o.width * cos + o.height * sin) / 2 + pad;
  const halfH = (o.width * sin + o.height * cos) / 2 + pad;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
}

/** A shape's text as SVG text, wrapped to the shape and clipped to it. */
function shapeText(o: SheetObject, text: TextSetting): SVGElement | null {
  if (isLineKind(o.kind) || !o.text) {
    return null;
  }
  const d = objectDefaults(o.kind);
  const size = o.fontSize ? (o.fontSize * 4) / 3 : TEXT_SIZE;
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : ''}${size}px ${text.family}`;
  const measure: WrapMeasure = (s) => text.measure(s, font);
  const lines = wrapVisualLines(o.text, measure, o.width - 2 * TEXT_PAD_X, MAX_TEXT_LINES);
  const step = size * LINE_HEIGHT;
  const align = o.align ?? d.align;
  const valign = o.valign ?? d.valign;
  const x = align === 'left' ? TEXT_PAD_X : align === 'right' ? o.width - TEXT_PAD_X : o.width / 2;
  const total = lines.length * step;
  const top =
    valign === 'top'
      ? TEXT_PAD_Y
      : valign === 'bottom'
        ? o.height - TEXT_PAD_Y - total
        : (o.height - total) / 2;
  const box = svgNode('svg', { width: Math.max(o.width, 1), height: Math.max(o.height, 1) });
  const node = svgNode('text', {
    'font-family': text.family,
    'font-size': size,
    fill: o.textColor ?? '#000000',
    'text-anchor': align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle',
    'dominant-baseline': 'central',
  });
  node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  if (o.bold) node.setAttribute('font-weight', '700');
  if (o.italic) node.setAttribute('font-style', 'italic');
  lines.forEach((line, i) => {
    const span = svgNode('tspan', { x, y: top + i * step + step / 2 });
    span.textContent = line;
    node.append(span);
  });
  box.append(node);
  return box;
}

/** A picture object: the part left after the crop, stretched to the box and mirrored as the object says. */
function pictureSvg(book: RsfDocument, o: SheetObject): SVGElement {
  const box = svgNode('svg', { width: Math.max(o.width, 1), height: Math.max(o.height, 1) });
  const image = o.image !== undefined ? book.images.get(o.image) : undefined;
  if (!image) {
    return box;
  }
  const crop = o.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const w = o.width / (1 - (crop.left + crop.right) / 100);
  const h = o.height / (1 - (crop.top + crop.bottom) / 100);
  const flip = svgNode('g', {
    transform: `translate(${o.flipH ? o.width : 0} ${o.flipV ? o.height : 0}) scale(${o.flipH ? -1 : 1} ${o.flipV ? -1 : 1})`,
  });
  const url = imageDataUrl(image);
  const picture = svgNode('image', {
    href: url,
    x: (-crop.left / 100) * w,
    y: (-crop.top / 100) * h,
    width: w,
    height: h,
    preserveAspectRatio: 'none',
  });
  // Older SVG readers know only the XLink form.
  picture.setAttributeNS(XLINK_NS, 'xlink:href', url);
  flip.append(picture);
  box.append(flip);
  return box;
}

/** One object's drawing, in its own box (0, 0)–(width, height). */
function objectSvg(book: RsfDocument, o: SheetObject, text: TextSetting): SVGElement[] {
  if (o.kind === 'image') {
    return [pictureSvg(book, o)];
  }
  if (o.kind === 'chart') {
    const chart = chartSvg(book, o, o.width, o.height, 1);
    chart.removeAttribute('class');
    chart.setAttribute('font-family', text.family);
    return [chart];
  }
  const shape = shapeSvg(o, o.width, o.height, 1);
  shape.removeAttribute('class');
  shape.removeAttribute('aria-hidden');
  shape.setAttribute('overflow', 'visible');
  shape.querySelector('.sheet-object-hit')?.remove();
  const words = shapeText(o, text);
  return words ? [shape, words] : [shape];
}

/**
 * `items` (bottom to top) as one SVG just big enough to hold them, with
 * their places relative to each other kept. Null when there is nothing to draw.
 */
export function objectsSvg(
  book: RsfDocument,
  items: readonly PlacedObject[],
  text: TextSetting,
): { svg: SVGElement; width: number; height: number } | null {
  if (items.length === 0) {
    return null;
  }
  const boxes = items.map(coveredBox);
  const left = Math.floor(Math.min(...boxes.map((b) => b.left)));
  const top = Math.floor(Math.min(...boxes.map((b) => b.top)));
  const width = Math.max(1, Math.ceil(Math.max(...boxes.map((b) => b.right))) - left);
  const height = Math.max(1, Math.ceil(Math.max(...boxes.map((b) => b.bottom))) - top);
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
  for (const { o, x, y } of items) {
    const rotate = o.rotation ? ` rotate(${o.rotation} ${o.width / 2} ${o.height / 2})` : '';
    const group = svgNode('g', { transform: `translate(${x - left} ${y - top})${rotate}` });
    group.append(...objectSvg(book, o, text));
    svg.append(group);
  }
  return { svg, width, height };
}

/** The SVG as a file's text. */
export function svgFileText(svg: SVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
}

/** The SVG drawn on a transparent canvas as PNG bytes, or null when the browser cannot draw it. */
async function svgToPng(
  doc: Document,
  markup: string,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const scale = Math.min(PNG_SCALE, MAX_PNG_SIDE / Math.max(width, height));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const bytes = new TextEncoder().encode(markup);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${btoa(binary)}`;
  try {
    await image.decode();
  } catch {
    return null;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** A measure for shape text: a canvas where there is one, else an estimate (wide characters count double). */
export function textMeasure(doc: Document): TextSetting['measure'] {
  const ctx =
    typeof doc.defaultView?.CanvasRenderingContext2D === 'function'
      ? doc.createElement('canvas').getContext('2d')
      : null;
  if (ctx) {
    return (s, font) => {
      ctx.font = font;
      return ctx.measureText(s).width;
    };
  }
  return (s, font) => {
    const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? TEXT_SIZE);
    return Array.from(s).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e7f ? size : size * 0.6), 0);
  };
}

/** `items` as the bytes of a PNG or SVG file, or null when the browser cannot draw it. */
export async function objectImageBytes(
  doc: Document,
  book: RsfDocument,
  items: readonly PlacedObject[],
  format: 'png' | 'svg',
  text: TextSetting,
): Promise<Uint8Array | null> {
  const drawn = objectsSvg(book, items, text);
  if (!drawn) {
    return null;
  }
  const markup = svgFileText(drawn.svg);
  return format === 'svg'
    ? new TextEncoder().encode(markup)
    : svgToPng(doc, markup, drawn.width, drawn.height);
}
