// SPDX-License-Identifier: MIT
// WCAG AA contrast gate for the colours the app actually renders.
//
// The app's colours come from the Refrain Sheet Design System
// (design-system/v2/): foundations.css holds the shell colours (bg-*,
// fg-*, border-*, accent-*, …) for light and dark, and app-tokens.css adds the
// canvas colours (the grid and source editors) and the hybrid theme — a dark
// shell around a light canvas. src/styles.css loads both, and src/app/theme.ts
// picks the theme with `data-theme` on the document root.
//
// This script reads the *generated* token CSS (never a hand-copied snapshot,
// which would silently drift), takes the sRGB hex each token is delivered as —
// exactly what the browser paints — and checks WCAG 2 contrast for the token
// pairs that compose as text on a background somewhere in the app, in every
// theme. Every pair targets AA body text (4.5:1): each is real rendered text,
// not a large heading or a decorative border.
//
// The design system's own build (design-system/v2/tools/build.mjs --check)
// audits the pairs its components use; this gate covers how the app uses the
// tokens today.
//
//   node scripts/check-contrast.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOUNDATIONS = 'design-system/v2/foundations/css/foundations.css';
const APP_TOKENS = 'design-system/v2/app/css/app-tokens.css';

// ---------- sRGB hex -> WCAG relative luminance ----------

/** `#RRGGBB` (or `#RGB`) to linear-light sRGB channels, each 0-1. */
export function hexToLinearSrgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new Error(`check-contrast: not an opaque #hex colour: "${hex}"`);
  }
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  return [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

/** WCAG relative luminance of an opaque hex colour. */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToLinearSrgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque hex colours. */
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- Extracting the declared tokens ----------

/**
 * Every `--name: value;` custom property declared directly in the top-level
 * rule whose selector list is exactly `selector` (whitespace-normalized, e.g.
 * `:root, [data-theme="light"]`). Deliberately not a general CSS parser: it
 * walks the top-level rules, skips at-rule blocks such as `@media` whole, and
 * compares selector lists exactly — so `[data-theme="hybrid"]` never matches
 * the longer `:root, [data-theme="light"], [data-theme="hybrid"]` list. Throws
 * if no rule matches, so a renamed block fails loudly here rather than
 * silently checking nothing.
 */
export function extractBlockTokens(css, selector) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const wanted = normalizeSelector(selector);
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
      j += 1;
    }
    if (!prelude.startsWith('@') && normalizeSelector(prelude) === wanted) {
      const tokens = new Map();
      for (const m of text.slice(open + 1, j - 1).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
        tokens.set(m[1], m[2].trim());
      }
      return tokens;
    }
    i = j;
  }
  throw new Error(`check-contrast: no top-level rule for "${selector}"`);
}

function normalizeSelector(selector) {
  return selector
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .join(', ');
}

// ---------- The themes and the pairs that matter ----------

const SHELL_LIGHT = ':root, [data-theme="light"]';
const SHELL_DARK = '[data-theme="dark"]';
const SHELL_HYBRID = '[data-theme="hybrid"]';
const CANVAS_LIGHT = ':root, [data-theme="light"], [data-theme="hybrid"]';
const CANVAS_DARK = '[data-theme="dark"]';

/** Each theme's shell block (foundations, or app for hybrid) and canvas block (app). */
const THEMES = [
  { name: 'light', shell: [FOUNDATIONS, SHELL_LIGHT], canvas: CANVAS_LIGHT },
  { name: 'dark', shell: [FOUNDATIONS, SHELL_DARK], canvas: CANVAS_DARK },
  { name: 'hybrid', shell: [APP_TOKENS, SHELL_HYBRID], canvas: CANVAS_LIGHT },
];

/**
 * [foreground, background, minRatio] — every pair is real rendered text on a
 * real background in the app (src/styles/), not a hypothetical combination:
 *  - fg-default on bg-page / bg-surface / bg-raised: body text on the page,
 *    bars and docked panels, and menus and dialogs.
 *  - fg-muted on bg-surface / bg-raised: secondary labels, hints, row counts.
 *  - fg-subtle on bg-surface: shortcut hints and inactive tab text.
 *  - accent-contrast on accent: the primary button (welcome screen, dialogs).
 *  - accent-subtle-text on accent-subtle: that button's hover state and
 *    selected items (sort buttons, toolbar toggles, the sheet-kind picker).
 *  - accent-text on bg-raised / bg-surface: accent-coloured text in dialogs,
 *    bars and the welcome screen.
 *  - link on bg-raised: links in dialogs.
 *  - fg-default / warning-text on warning-subtle: the warning banner in
 *    dialogs and the diff panel, the warning toast, and the diff panel's
 *    "modified" badge.
 *  - success-text on success-subtle, danger-text on danger-subtle: the diff
 *    panel's "added" and "deleted" badges.
 *  - danger-text on bg-raised / bg-surface: error text in dialogs and bars.
 *  - danger-contrast on danger: the error toast.
 *  - inverse-text on inverse-bg: the ordinary toast.
 *  - success-text on bg-raised / bg-surface: success text in dialogs and
 *    strings in the Markdown preview.
 *  - canvas-*: cell text on a plain, banded, selected and edited cell; header
 *    labels, plain and selected; muted, formula and error text in the grid.
 */
const PAIRS = [
  ['fg-default', 'bg-page', 4.5],
  ['fg-default', 'bg-surface', 4.5],
  ['fg-default', 'bg-raised', 4.5],
  ['fg-muted', 'bg-surface', 4.5],
  ['fg-muted', 'bg-raised', 4.5],
  ['fg-subtle', 'bg-surface', 4.5],
  ['accent-contrast', 'accent', 4.5],
  ['accent-subtle-text', 'accent-subtle', 4.5],
  ['accent-text', 'bg-raised', 4.5],
  ['accent-text', 'bg-surface', 4.5],
  ['link', 'bg-raised', 4.5],
  ['fg-default', 'warning-subtle', 4.5],
  ['warning-text', 'warning-subtle', 4.5],
  ['danger-text', 'bg-raised', 4.5],
  ['danger-text', 'bg-surface', 4.5],
  ['danger-contrast', 'danger', 4.5],
  ['inverse-text', 'inverse-bg', 4.5],
  ['success-text', 'bg-raised', 4.5],
  ['success-text', 'bg-surface', 4.5],
  ['success-text', 'success-subtle', 4.5],
  ['danger-text', 'danger-subtle', 4.5],
  ['canvas-text', 'canvas-bg', 4.5],
  ['canvas-text', 'canvas-row-alt', 4.5],
  ['canvas-text', 'canvas-row-alt-strong', 4.5],
  ['canvas-text', 'canvas-selection', 4.5],
  ['canvas-text', 'state-modified', 4.5],
  ['canvas-header-text', 'canvas-header-bg', 4.5],
  ['canvas-header-selected-text', 'canvas-header-selected-bg', 4.5],
  ['canvas-text-muted', 'canvas-bg', 4.5],
  ['canvas-formula-text', 'canvas-bg', 4.5],
  ['canvas-error-text', 'canvas-bg', 4.5],
];

// ---------- Run ----------

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`check-contrast: FAIL: ${msg}`);
};
const ok = (msg) => console.warn(`check-contrast: ok: ${msg}`);

function main() {
  const css = {
    [FOUNDATIONS]: readFileSync(join(root, FOUNDATIONS), 'utf8'),
    [APP_TOKENS]: readFileSync(join(root, APP_TOKENS), 'utf8'),
  };
  for (const theme of THEMES) {
    const [shellFile, shellSelector] = theme.shell;
    const tokens = new Map([
      ...extractBlockTokens(css[shellFile], shellSelector),
      ...extractBlockTokens(css[APP_TOKENS], theme.canvas),
    ]);
    for (const [nameA, nameB, minRatio] of PAIRS) {
      const hexA = tokens.get(nameA);
      const hexB = tokens.get(nameB);
      if (!hexA || !hexB) {
        fail(`${theme.name}: token --${!hexA ? nameA : nameB} not found`);
        continue;
      }
      const ratio = contrastRatio(hexA, hexB);
      const label = `${theme.name}: --${nameA} on --${nameB} = ${ratio.toFixed(2)}:1 (need ${minRatio}:1)`;
      if (ratio + 1e-6 < minRatio) {
        fail(label);
      } else {
        ok(label);
      }
    }
  }
  if (failures > 0) {
    console.error(`check-contrast: ${failures} pair(s) below their WCAG AA target`);
    process.exit(1);
  }
  console.warn('check-contrast: every checked pair meets its WCAG AA target in every theme');
}

// Only run when executed directly (`node scripts/check-contrast.mjs`), not
// when imported for its exported functions (see tests/check-contrast.test.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
