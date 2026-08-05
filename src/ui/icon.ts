// SPDX-License-Identifier: MIT
/**
 * Thin wrapper around Lucide's vanilla icon nodes. Icons are plain arrays of
 * SVG element descriptions (`IconNode`, no side effects), so importing only
 * the ones actually used keeps every unused icon out of the bundle; nothing
 * is ever fetched from a font, sprite sheet, or CDN, matching the offline
 * guarantee enforced by `npm run check:dist`.
 */
import { createElement, type IconNode } from 'lucide';

/**
 * Build a decorative icon element `size` CSS pixels square. Always
 * `aria-hidden` and never focusable — every icon in this app sits beside a
 * localized label (button text, `aria-label`, or `title`) that already
 * conveys its meaning to assistive technology, so the icon itself would only
 * produce a redundant announcement.
 */
export function createIcon(node: IconNode, className: string, size = 16): SVGElement {
  const svg = createElement(node, {
    width: String(size),
    height: String(size),
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.setAttribute('class', className);
  return svg;
}
