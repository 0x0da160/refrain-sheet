// SPDX-License-Identifier: MIT
// WCAG AA contrast gate for the Oklch-authored color system (src/styles.css).
//
// The color system (`:root`, `:root[data-theme='dark']`, and the hybrid
// theme's `.grid-container` override — see the "Oklab-based color system"
// comment in styles.css) is authored entirely as `oklch(L C H[ / alpha])`.
// This script parses the *actual* declared tokens straight out of that file
// (never a hand-copied snapshot, which would silently drift from reality),
// converts each one through Oklab to linear sRGB, and checks WCAG 2 contrast
// ratios for the token pairs that actually compose as text-on-background in
// the UI, at every theme. It targets AA body text (4.5:1) for all of them,
// since every pair checked here is real rendered text, not a large heading or
// a decorative border.
//
// This exists because #535's original brand-redesign brief explicitly never
// verified contrast ("existing ratios preserved exactly rather than newly
// verified") — the recolor this script guards (#557) makes that checkable
// instead of a matter of taste, and re-runs on every future palette change.
//
//   node scripts/check-contrast.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Oklch -> linear sRGB ----------
// Reference implementation of Björn Ottosson's Oklab conversion
// (https://bottosson.github.io/posts/oklab/), the same math browsers use to
// resolve `oklch()`. `L` here is 0-1 (not 0-100), matching how it's used
// once parsed from the CSS below.

export function oklchToLinearSrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl];
}

/**
 * WCAG relative luminance from an Oklch color. Colors slightly outside the
 * sRGB gamut (linear channel < 0 or > 1) are clamped, matching what a
 * browser's own gamut mapping ultimately displays — this script checks the
 * ratio a viewer actually sees, not an idealized unclamped one.
 */
export function relativeLuminance(L, C, H) {
  const [r, g, b] = oklchToLinearSrgb(L, C, H).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two Oklch colors, each given as [L, C, H]. */
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(...a);
  const l2 = relativeLuminance(...b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- Extracting the actual declared tokens from styles.css ----------

/**
 * Pull every `--name: value;` custom property declared directly inside one
 * top-level block, given the block's selector exactly as it appears in the
 * file. Deliberately not a general CSS parser: every block this script reads
 * is flat (custom-property declarations only, no nested rules), so scanning
 * for the selector and taking everything up to the next `}` is exact for
 * this file. Throws if the selector isn't found, so a future rename of one
 * of these blocks fails loudly here rather than silently checking nothing.
 */
export function extractBlockTokens(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`check-contrast: could not find block "${selector}" in styles.css`);
  }
  const bodyStart = css.indexOf('{', start) + 1;
  const bodyEnd = css.indexOf('}', bodyStart);
  const body = css.slice(bodyStart, bodyEnd);
  const tokens = new Map();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body))) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/**
 * Resolve one token's raw declared value (e.g. `oklch(46.5% 0.078 var(--hue-accent))`)
 * into an [L, C, H] triple with `L` normalized to 0-1, substituting
 * `var(--hue-neutral)` / `var(--hue-accent)` from `hues`. Any ` / alpha`
 * suffix is dropped — every token this script actually checks (see PAIRS
 * below) is used as an opaque color, never as a semi-transparent overlay.
 */
export function resolveOklch(raw, hues) {
  // The hue group is matched explicitly as either a `var(--name)` reference
  // or a plain number — not a generic "anything but `/` or `)`" class, which
  // would stop at `var(--hue-accent)`'s own closing paren before reaching
  // oklch()'s. The optional `/ alpha` sits *inside* oklch()'s closing paren
  // and is matched and discarded, never split off naively (a naive split on
  // `/` would also lose that closing paren).
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+(var\(--[\w-]+\)|[\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/.exec(
    raw.trim(),
  );
  if (!m) {
    throw new Error(`check-contrast: could not parse oklch() value: "${raw}"`);
  }
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const hueRaw = m[3].trim();
  const hueVarMatch = /^var\(--(hue-\w+)\)$/.exec(hueRaw);
  const H = hueVarMatch ? hues[hueVarMatch[1]] : Number(hueRaw);
  if (H === undefined || Number.isNaN(H)) {
    throw new Error(`check-contrast: could not resolve hue in "${raw}"`);
  }
  return [L, C, H];
}

// ---------- The themes and the pairs that matter ----------

const THEMES = [
  { name: 'light', selector: ':root {' },
  { name: 'dark', selector: ":root[data-theme='dark'] {" },
  { name: 'hybrid', selector: ":root[data-theme='dark'][data-theme-choice='hybrid'] .grid-container {" },
];

/**
 * [tokenA, tokenB, minRatio, why] — every pair is real rendered text on a
 * real background in the app, not a hypothetical combination:
 *  - text/bg, text/panel, text/surface: ordinary body text on the app's three
 *    main surface levels.
 *  - accent-contrast/accent: the primary button (bg-accent text-accent-contrast,
 *    src/ui/welcome-screen.ts) — the pair the original low-contrast report
 *    was actually about once traced (see Commit 17 in the project plan).
 *  - accent/accent-soft: that same button's hover state
 *    (hover:bg-accent-soft hover:text-accent) and every other secondary
 *    accent-on-soft-background usage — the pair that was actually weak
 *    before this recolor.
 *  - accent-contrast-dim/accent: the formula-autocomplete active item's
 *    secondary description text (.ac-item.active .ac-desc, on the same
 *    --accent background as its label).
 *  - accent/surface: an accent-colored link or plain text directly on a
 *    white/surface background (e.g. .dialog-link).
 *  - text/warning-soft: the actual rendered `.dialog-warning` banner (its
 *    background is --warning-soft; it never overrides `color`, so it's
 *    ordinary --text on that background, not --warning itself).
 *  - danger/surface, danger/panel: error text's two common containers.
 *  - success/surface: success-colored text/icons on a white/surface background.
 *  - formula-text/cell-bg: a formula cell's tinted text on the grid's own
 *    cell background.
 */
const PAIRS = [
  ['text', 'bg', 4.5],
  ['text', 'panel', 4.5],
  ['text', 'surface', 4.5],
  ['accent-contrast', 'accent', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['accent-contrast-dim', 'accent', 4.5],
  ['accent', 'surface', 4.5],
  ['text', 'warning-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['danger', 'panel', 4.5],
  ['success', 'surface', 4.5],
  ['formula-text', 'cell-bg', 4.5],
];

// ---------- Run ----------

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`check-contrast: FAIL: ${msg}`);
};
const ok = (msg) => console.warn(`check-contrast: ok: ${msg}`);

function main() {
  const css = readFileSync(join(root, 'src/styles.css'), 'utf8');
  const rootTokens = extractBlockTokens(css, ':root {');
  const hues = {
    'hue-neutral': Number(rootTokens.get('hue-neutral')),
    'hue-accent': Number(rootTokens.get('hue-accent')),
    'hue-paper': Number(rootTokens.get('hue-paper')),
  };
  if (Number.isNaN(hues['hue-neutral']) || Number.isNaN(hues['hue-accent'])) {
    fail('could not read --hue-neutral / --hue-accent from :root');
    reportAndExit();
    return;
  }

  for (const theme of THEMES) {
    const tokens = extractBlockTokens(css, theme.selector);
    for (const [nameA, nameB, minRatio] of PAIRS) {
      const rawA = tokens.get(nameA);
      const rawB = tokens.get(nameB);
      if (!rawA || !rawB) {
        fail(`${theme.name}: token --${!rawA ? nameA : nameB} not found in "${theme.selector}"`);
        continue;
      }
      const colorA = resolveOklch(rawA, hues);
      const colorB = resolveOklch(rawB, hues);
      const ratio = contrastRatio(colorA, colorB);
      const label = `${theme.name}: --${nameA} on --${nameB} = ${ratio.toFixed(2)}:1 (need ${minRatio}:1)`;
      if (ratio + 1e-6 < minRatio) {
        fail(label);
      } else {
        ok(label);
      }
    }
  }
  reportAndExit();
}

function reportAndExit() {
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
