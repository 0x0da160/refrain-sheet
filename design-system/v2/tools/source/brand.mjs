// SPDX-License-Identifier: MIT
//
// Brand layer — tokens for everything outside the app: the landing site,
// documentation pages, store listings, social images. Built on
// foundations.mjs (colours, fonts, weights, space, shape are shared), it
// adds only what reading-first, marketing surfaces need: a fluid type
// scale, page layout, larger controls and a showcase elevation.

/* Fluid type: [name, min rem, preferred, max rem, leading, weight, role].
   Sizes are the landing site's tuned scale (site/styles.css), renamed by
   role; minimums respect foundations --text-min (12px). Line height has
   two values only, from foundations: 'prose' (1.75) for reading text and
   'display' (1.3) for headings. */
export const typeScale = [
  ['caption', 0.75, '0.7rem + 0.25vw', 0.875, 'prose', 400, 'Captions, footnotes, eyebrows'],
  ['small', 0.875, '0.8rem + 0.35vw', 1, 'prose', 400, 'Secondary copy, nav, buttons'],
  ['body', 1, '0.95rem + 0.25vw', 1.125, 'prose', 400, 'Body copy'],
  ['lead', 1.125, '1rem + 0.75vw', 1.5, 'prose', 400, 'Lead paragraphs, h3'],
  ['h2', 1.5, '1.2rem + 1.25vw', 2.25, 'display', 700, 'Section headings'],
  ['display', 2, '1.2rem + 2.5vw', 3.25, 'display', 700, 'Hero heading, one per page'],
];

export const tracking = {
  'brand-tracking-display-latin': ['-0.02em', 'Latin display text only (html[lang=en]); Japanese is never tightened'],
};

// Page layout.
export const layout = [
  ['brand-content-max', '73.75rem', '1180px — content column'],
  ['brand-gutter', '1.25rem', 'Minimum side margin'],
  ['brand-section-pad', 'clamp(4rem, 9vw, 6rem)', 'Vertical padding of a section'],
  ['brand-header-h', '4rem', '64px sticky header'],
  ['brand-measure', '40em', 'Reading measure: about 40 full-width characters'],
];

// Controls: marketing buttons are touch-sized on every device.
export const controls = [
  ['brand-btn-h', 2.75, '44px (= --target-touch) — default button'],
  ['brand-btn-h-lg', 3.25, '52px — hero call to action'],
  ['brand-btn-px', 1.25, '20px'],
  ['brand-btn-px-lg', 1.5, '24px'],
];

// The one brand-only elevation: product screenshots floating on paper.
export const shadows = {
  'brand-shadow-showcase': [
    [0, 1, 2, 0, 'ink.900', 0.05],
    [0, 12, 32, -12, 'ink.900', 0.18],
  ],
};

// Brand-only pairs, checked in light and dark (dark = night bands). Pairs
// the landing site shares with the app (accent text on a card, badge text
// on accent-subtle, muted copy) are audited once, in foundations.
export const contrastPairs = [
  ['fg-default', 'bg-sunken', 4.5, 'Inline code in a sunken well'],
];
