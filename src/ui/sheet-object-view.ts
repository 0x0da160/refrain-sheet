// SPDX-License-Identifier: MIT
/**
 * How one sheet object (a shape or a picture: see
 * `src/core/workbook/sheet-objects.ts`) is drawn: an absolutely positioned
 * box holding an SVG for the shape and a text block over it, or the picture
 * as an `<img>` (where an SVG picture's scripts never run). Colours come only from validated `#rrggbb` values and
 * text is set with `textContent`, never parsed as markup.
 */
import { bytesToBase64, type SheetImage } from '../core/workbook/sheet-images';
import { isLineKind, objectDefaults, type SheetObject } from '../core/workbook/sheet-objects';
import { el } from './dom';
import { fontSizeCss } from './font-choices';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A box in grid-canvas pixels (already zoomed). */
export interface ObjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function svgNode(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

/** A line or arrow's start and end points inside its box (see `SheetObject.flipH`). */
export function lineEnds(
  o: SheetObject,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = o.flipH ? w : 0;
  const y1 = o.flipV ? h : 0;
  return { x1, y1, x2: w - x1, y2: h - y1 };
}

/** The shape's SVG, `w` × `h` pixels, drawn at `zoom`. */
function shapeSvg(o: SheetObject, w: number, h: number, zoom: number): SVGElement {
  const d = objectDefaults(o.kind);
  const fill = o.fill ?? d.fill;
  const stroke = o.stroke ?? d.stroke;
  const width = (o.strokeWidth ?? d.strokeWidth) * zoom;
  const svg = svgNode('svg', {
    class: 'sheet-object-shape',
    width: Math.max(w, 1),
    height: Math.max(h, 1),
    'aria-hidden': 'true',
  });
  const paint = { fill, stroke, 'stroke-width': stroke === 'none' ? 0 : width };
  if (o.kind === 'rect' || o.kind === 'text') {
    const inset = stroke === 'none' ? 0 : width / 2;
    svg.append(
      svgNode('rect', {
        x: inset,
        y: inset,
        width: Math.max(0, w - 2 * inset),
        height: Math.max(0, h - 2 * inset),
        ...paint,
      }),
    );
  } else if (o.kind === 'ellipse') {
    const inset = stroke === 'none' ? 0 : width / 2;
    svg.append(
      svgNode('ellipse', {
        cx: w / 2,
        cy: h / 2,
        rx: Math.max(0, w / 2 - inset),
        ry: Math.max(0, h / 2 - inset),
        ...paint,
      }),
    );
  } else {
    const { x1, y1, x2, y2 } = lineEnds(o, w, h);
    const color = stroke === 'none' ? 'transparent' : stroke;
    // A wide invisible stroke underneath, so a thin line is easy to pick.
    svg.append(
      svgNode('line', {
        x1,
        y1,
        x2,
        y2,
        class: 'sheet-object-hit',
        stroke: 'transparent',
        'stroke-width': 12,
      }),
    );
    let endX = x2;
    let endY = y2;
    if (o.kind === 'arrow') {
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / length;
      const uy = (y2 - y1) / length;
      const head = Math.max(8 * zoom, width * 3.5);
      const back = { x: x2 - ux * head, y: y2 - uy * head };
      const side = head * 0.45;
      svg.append(
        svgNode('polygon', {
          points: `${x2},${y2} ${back.x - uy * side},${back.y + ux * side} ${back.x + uy * side},${back.y - ux * side}`,
          fill: color,
        }),
      );
      // The line stops inside the head, so its end does not poke through the tip.
      endX = x2 - ux * head * 0.6;
      endY = y2 - uy * head * 0.6;
    }
    svg.append(
      svgNode('line', {
        x1,
        y1,
        x2: endX,
        y2: endY,
        stroke: color,
        'stroke-width': width,
        'stroke-linecap': 'round',
      }),
    );
  }
  return svg;
}

const dataUrls = new WeakMap<Uint8Array, string>();

/** A picture as a `data:` URL (the only image source the offline policy allows), made once per picture. */
function imageDataUrl(image: SheetImage): string {
  let url = dataUrls.get(image.bytes);
  if (url === undefined) {
    url = `data:${image.type};base64,${bytesToBase64(image.bytes)}`;
    dataUrls.set(image.bytes, url);
  }
  return url;
}

/**
 * An image object's picture: the part left after the crop, stretched to
 * fill the box and mirrored as the object says. A missing picture draws an
 * empty frame.
 */
function pictureElement(o: SheetObject, box: ObjectBox, image: SheetImage | undefined): HTMLElement {
  const frame = el('div', { className: 'sheet-object-picture' });
  if (!image) {
    frame.classList.add('missing');
    return frame;
  }
  const crop = o.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const w = box.w / (1 - (crop.left + crop.right) / 100);
  const h = box.h / (1 - (crop.top + crop.bottom) / 100);
  const img = el('img', { attrs: { src: imageDataUrl(image), alt: '', draggable: 'false' } });
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.left = `${(-crop.left / 100) * w}px`;
  img.style.top = `${(-crop.top / 100) * h}px`;
  if (o.flipH || o.flipV) {
    frame.style.transform = `scale(${o.flipH ? -1 : 1}, ${o.flipV ? -1 : 1})`;
  }
  frame.append(img);
  return frame;
}

/**
 * The object's element, placed at `box` (canvas pixels) for `zoom`; an
 * image object shows `image`, its picture from the workbook.
 */
export function buildObjectElement(
  o: SheetObject,
  box: ObjectBox,
  zoom: number,
  image?: SheetImage,
): HTMLElement {
  const node = el('div', {
    className: `sheet-object sheet-object-${o.kind}`,
    attrs: { 'data-object-id': o.id, role: 'img', 'aria-label': o.name },
  });
  node.style.left = `${box.x}px`;
  node.style.top = `${box.y}px`;
  node.style.width = `${box.w}px`;
  node.style.height = `${box.h}px`;
  if (o.rotation) {
    node.style.transform = `rotate(${o.rotation}deg)`;
  }
  if (o.kind === 'image') {
    node.append(pictureElement(o, box, image));
    return node;
  }
  node.append(shapeSvg(o, box.w, box.h, zoom));
  if (!isLineKind(o.kind) && o.text) {
    const d = objectDefaults(o.kind);
    const text = el('div', {
      className: `sheet-object-text align-${o.align ?? d.align} valign-${o.valign ?? d.valign}`,
    });
    text.append(el('span', { text: o.text }));
    // Text on a filled shape is black unless chosen, whatever the theme (the
    // fill is the file's own colour); on no fill it follows the sheet's text.
    const color = o.textColor ?? ((o.fill ?? d.fill) === 'none' ? '' : '#000000');
    if (color) text.style.color = color;
    if (o.fontSize) text.style.fontSize = fontSizeCss(o.fontSize);
    if (o.bold) text.style.fontWeight = '700';
    if (o.italic) text.style.fontStyle = 'italic';
    node.append(text);
  }
  return node;
}
