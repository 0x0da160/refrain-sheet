// SPDX-License-Identifier: MIT
//
// Build the Refrain Sheet Design System from tools/source/*.mjs.
//
//   node design-system/2.0.0/tools/build.mjs          write every output
//   node design-system/2.0.0/tools/build.mjs --check  verify outputs are current
//
// Three layers, one source of truth each:
//   foundations/  shared by brand and app (source/foundations.mjs)
//   app/          the application UI       (source/app.mjs)
//   brand/        landing site, docs, store (source/brand.mjs)
// Outputs per layer: css/*-tokens.css, a bundle, tokens/*.tokens.json
// (Design Tokens Format Module 2025.10) and the <!-- gen:NAME --> regions of
// its docs page; plus manifest.json. Fails (exit 1) when a contrast pair is
// under its minimum, when a hand-written stylesheet contains a colour
// literal, or, with --check, when an output is stale. Node only.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import * as F from './source/foundations.mjs';
import * as A from './source/app.mjs';
import * as B from './source/brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SCHEMA = 'https://www.designtokens.org/schemas/2025.10/format.json';
const errors = [];

/* ----------------------------- colour maths ----------------------------- */

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinearRgb([L, C, H]) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** Reduce chroma until the colour fits sRGB (hue and lightness kept). */
function gamutMap([L, C, H]) {
  if (inGamut(oklchToLinearRgb([L, C, H]))) return [L, C, H];
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearRgb([L, mid, H]))) lo = mid;
    else hi = mid;
  }
  return [L, lo, H];
}

function oklchToHex(lch) {
  const rgb = oklchToLinearRgb(gamutMap(lch)).map((c) => Math.round(clamp01(toGamma(clamp01(c))) * 255));
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A2 = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B2 = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A2, B2);
  let H = (Math.atan2(B2, A2) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-4 ? 0 : H];
}
const fmtOklch = ([L, C, H]) => `oklch ${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)}`;
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const composite = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

/* ------------------------------- palette -------------------------------- */

const palette = {};
for (const [hue, steps] of Object.entries(F.palette)) {
  palette[hue] = {};
  for (const [step, v] of Object.entries(steps)) {
    const hex = typeof v === 'string' ? v.toUpperCase() : oklchToHex(v.oklch);
    palette[hue][step] = { hex, oklch: hexToOklch(hex) };
  }
}
function resolveRef(ref) {
  if (ref.startsWith('#')) return ref.toUpperCase();
  const [hue, step] = ref.split('.');
  const c = palette[hue]?.[step];
  if (!c) throw new Error(`unknown colour reference: ${ref}`);
  return c.hex;
}
function resolveValue(v) {
  if (typeof v === 'string') return { hex: resolveRef(v), alpha: 1, ref: v };
  return { hex: resolveRef(v.ref), alpha: v.alpha, ref: v.ref };
}
function cssColor({ hex, alpha }) {
  if (alpha === 1) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/* ------------------------------- themes --------------------------------- */

// mode -> token -> { hex, alpha, ref, description }
const shared = { light: {}, dark: {} };
for (const [name, [l, d, desc]] of Object.entries(F.semantic)) {
  shared.light[name] = { ...resolveValue(l), description: desc };
  shared.dark[name] = { ...resolveValue(d), description: desc };
}
const canvas = { light: {}, dark: {} };
for (const [name, [l, d, desc]] of Object.entries(A.canvas)) {
  canvas.light[name] = { ...resolveValue(l), description: desc };
  canvas.dark[name] = { ...resolveValue(d), description: desc };
}
// App themes: light, dark, hybrid (shared dark + canvas light).
const APP_THEMES = ['light', 'dark', 'hybrid'];
const appTheme = {
  light: { ...shared.light, ...canvas.light },
  dark: { ...shared.dark, ...canvas.dark },
  hybrid: { ...shared.dark, ...canvas.light },
};
const SHARED_MODES = ['light', 'dark'];

const cssShadow = (layers) =>
  layers
    .map(([x, y, blur, spread, ref, a]) => {
      const [r, g, b] = hexToRgb(resolveRef(ref));
      return `${x}px ${y}px ${blur}px${spread ? ` ${spread}px` : ''} rgb(${r} ${g} ${b} / ${a})`;
    })
    .join(', ');

/* ------------------------------- swatches ------------------------------- */

const swatches = [];
for (const [hue, [H, fixedC]] of Object.entries(A.swatches.hues)) {
  for (const [step, L, cap] of A.swatches.steps) {
    swatches.push({ name: `swatch-${hue}-${step}`, hue, hex: oklchToHex([L, fixedC ?? cap, H]) });
  }
}
swatches.push({ name: 'swatch-white', hue: 'base', hex: '#FFFFFF' });
swatches.push({ name: 'swatch-black', hue: 'base', hex: '#000000' });

/* ------------------------------ contrast -------------------------------- */

function colourOf(tokens, expr) {
  const [top, , under] = expr.split(' ');
  const t = tokens[top];
  if (!t) throw new Error(`contrast pair names unknown token: ${top}`);
  const rgb = hexToRgb(t.hex);
  if (under) return composite(rgb, t.alpha, colourOf(tokens, under));
  if (t.alpha !== 1) return composite(rgb, t.alpha, hexToRgb((tokens['canvas-bg'] ?? tokens['bg-page']).hex));
  return rgb;
}
function runAudit(layer, pairs, themes) {
  const rows = pairs.map(([fg, bg, min, label]) => {
    const ratios = Object.fromEntries(Object.entries(themes).map(([t, tokens]) => [t, contrast(colourOf(tokens, fg), colourOf(tokens, bg))]));
    for (const [t, r] of Object.entries(ratios)) {
      if (r + 1e-9 < min) errors.push(`${layer}: contrast ${fg} / ${bg} in ${t}: ${r.toFixed(2)} < ${min}`);
    }
    return { fg, bg, min, label, ratios };
  });
  const names = Object.keys(themes);
  const checks = rows.length * names.length;
  const pass = rows.reduce((n, a) => n + names.filter((t) => a.ratios[t] + 1e-9 >= a.min).length, 0);
  return { rows, names, checks, pass };
}
const audits = {
  foundations: runAudit('foundations', F.contrastPairs, shared),
  app: runAudit('app', A.contrastPairs, appTheme),
  brand: runAudit('brand', B.contrastPairs, shared),
};

/* ------------------------------ CSS helpers ----------------------------- */

const rem = (px) => `${+(px / 16).toFixed(4)}rem`;
const pad = (s, n = 36) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));
const decl = (name, value, comment = '', indent = '  ') =>
  `${indent}${pad(`--${name}: ${value};`)}${comment ? `/* ${comment} */` : ''}`.trimEnd();
const family = (list) => list.map((f) => (/^[a-z-]+$/.test(f) ? f : `"${f}"`)).join(', ');
const header = (title, source) => [
  `/*! Refrain Sheet Design System — ${title}  v${F.VERSION}  (${F.RELEASED})`,
  ` *  GENERATED by tools/build.mjs from ${source}. Do not edit by hand.`,
  ' */',
  '',
];
const tokenBlock = (tokens, indent = '  ') =>
  Object.entries(tokens).map(([name, t]) => decl(name, cssColor(t), t.ref, indent));

/* --------------------------- foundations.css ---------------------------- */

function sharedModeBlock(mode, indent = '  ') {
  const L = [`${indent}color-scheme: ${mode};`];
  L.push(...tokenBlock(shared[mode], indent));
  for (const [name, layers] of Object.entries(F.shadows[mode])) L.push(decl(name, cssShadow(layers), '', indent));
  return L.join('\n');
}

function buildFoundationsCss() {
  const L = header('foundations (shared by brand and app)', 'tools/source/foundations.mjs');
  L.push('/* Units: rem for anything that belongs to text (type, spacing, control');
  L.push("   heights) so the reader's default font size scales it; px for hairlines,");
  L.push('   radii and shadows; em in media queries. Colour: designed in OKLCH,');
  L.push('   delivered as sRGB hex. */');
  L.push(':root {');
  L.push('  /* ---------- colour primitives ---------- */');
  for (const [hue, steps] of Object.entries(palette)) {
    for (const [step, c] of Object.entries(steps)) L.push(decl(`${hue}-${step}`, c.hex, fmtOklch(c.oklch)));
    L.push('');
  }
  L.push('  /* ---------- brand anchors ---------- */');
  for (const [name, [ref, note]] of Object.entries(F.brandAnchors)) L.push(decl(name, resolveRef(ref), `${ref} — ${note}`));
  L.push('');
  L.push('  /* ---------- type (families and weights; each layer has its own scale) ---------- */');
  for (const [name, list] of Object.entries(F.fonts)) L.push(`  --${name}: ${family(list)};`);
  L.push('  --font-feature-data: "zero" 1;');
  for (const [name, [v, note]] of Object.entries(F.typeShared)) L.push(decl(name, v, note));
  L.push('');
  L.push('  /* ---------- space (4px base, with 2px and 6px half-steps) ---------- */');
  for (const [name, px] of F.space) L.push(decl(`space-${name}`, px === 0 ? '0' : rem(px), `${px}px`));
  L.push('');
  L.push('  /* ---------- shape and strokes ---------- */');
  for (const [name, px, note] of F.radius) L.push(decl(`radius-${name}`, `${px}px`, note));
  for (const [name, px, note] of F.strokes) L.push(decl(name, `${px}px`, note));
  L.push(decl('focus-width', '2px'));
  L.push(decl('focus-offset', '2px'));
  L.push('');
  L.push('  /* ---------- icons (Lucide) ---------- */');
  for (const [name, px, note] of F.iconSizes) L.push(decl(name, rem(px), `${px}px — ${note}`));
  L.push(decl('icon-stroke', '1.5px', 'Rendered stroke at every size'));
  L.push('');
  L.push('  /* ---------- motion ---------- */');
  for (const [name, ms, note] of F.motion.durations) L.push(decl(name, `${ms}ms`, note));
  for (const [name, v, note] of F.motion.easings) L.push(decl(name, `cubic-bezier(${v.join(', ')})`, note));
  L.push('');
  L.push('  /* ---------- breakpoints (reference only; write the em value in @media) ---------- */');
  for (const [name, em, note] of F.breakpoints) L.push(decl(name, `${em}em`, note));
  L.push('}');
  L.push('');
  L.push('/* ---------- shared themes: light and dark ----------');
  L.push('   data-theme on any element scopes a theme to that subtree (a dark band');
  L.push('   on the landing site, a preview in docs). No attribute: follow the OS. */');
  L.push(':root,');
  L.push('[data-theme="light"] {');
  L.push(sharedModeBlock('light'));
  L.push('}');
  L.push('');
  L.push('[data-theme="dark"] {');
  L.push(sharedModeBlock('dark'));
  L.push('}');
  L.push('');
  L.push('@media (prefers-color-scheme: dark) {');
  L.push('  :root:not([data-theme]) {');
  L.push(sharedModeBlock('dark', '    '));
  L.push('  }');
  L.push('}');
  return L.join('\n') + '\n';
}

/* ---------------------------- app-tokens.css ---------------------------- */

function buildAppCss() {
  const L = header('app tokens', 'tools/source/app.mjs');
  L.push('/* Requires foundations.css. Adds the canvas, the hybrid theme, document');
  L.push('   colours, the app type scale, density, grid geometry and layers. */');
  L.push(':root {');
  L.push('  /* ---------- type ---------- */');
  for (const [name, size, lh, weight, role] of A.typeScale) {
    L.push(decl(`text-${name}`, rem(size), `${size}px — ${role}`));
    L.push(decl(`leading-${name}`, rem(lh), `${lh}px`));
    L.push(decl(`weight-${name}`, weight));
  }
  L.push('');
  L.push('  /* ---------- document colours: fixed in every theme ---------- */');
  for (const s of swatches) L.push(decl(s.name, s.hex));
  for (const [name, ref] of Object.entries(A.swatches.conditional)) L.push(decl(name, resolveRef(ref), ref));
  L.push('');
  L.push('  /* ---------- shape ---------- */');
  for (const [name, px, note] of A.radiusApp) L.push(decl(`radius-${name}`, px === 0 ? '0' : `${px}px`, note));
  L.push('');
  L.push('  /* ---------- grid geometry (px x --sheet-zoom) ---------- */');
  for (const [name, px, note] of A.grid) L.push(decl(name, `${px}px`, note));
  L.push('');
  L.push('  /* ---------- layers ---------- */');
  for (const [name, v, note] of A.layers) L.push(decl(name, v, note));
  L.push('}');
  L.push('');
  L.push('/* ---------- canvas colours ----------');
  L.push('   hybrid = the shared dark theme for the shell + light canvas. */');
  L.push(':root,');
  L.push('[data-theme="light"],');
  L.push('[data-theme="hybrid"] {');
  L.push(...tokenBlock(canvas.light));
  L.push('}');
  L.push('');
  L.push('[data-theme="dark"] {');
  L.push(...tokenBlock(canvas.dark));
  L.push('}');
  L.push('');
  L.push('@media (prefers-color-scheme: dark) {');
  L.push('  :root:not([data-theme]) {');
  L.push(...tokenBlock(canvas.dark, '    '));
  L.push('  }');
  L.push('}');
  L.push('');
  L.push('[data-theme="hybrid"] {');
  L.push(sharedModeBlock('dark'));
  L.push('}');
  L.push('');
  L.push('/* ---------- density ----------');
  L.push('   Heights and insets only: never type size, never grid geometry.');
  L.push(`   Default: ${A.density.default}. A coarse pointer forces touch-size floors. */`);
  const defIdx = A.density.modes.indexOf(A.density.default);
  const modeBlock = (i) =>
    Object.entries(A.density.tokens)
      .map(([name, v]) => decl(name, rem(v[i]), `${v[i]}px${i === defIdx ? ` — ${v[3]}` : ''}`))
      .join('\n');
  L.push(':root,');
  L.push(`[data-density="${A.density.default}"] {`);
  L.push(modeBlock(defIdx));
  L.push('}');
  A.density.modes.forEach((m, i) => {
    if (i === defIdx) return;
    L.push(`[data-density="${m}"] {`);
    L.push(modeBlock(i));
    L.push('}');
  });
  L.push('');
  L.push('@media (pointer: coarse) {');
  L.push('  :root,');
  L.push('  [data-density] {');
  for (const [name, px] of Object.entries(A.density.coarse)) L.push(decl(name, rem(px), `${px}px`, '    '));
  for (const [name, [size, lh]] of Object.entries(A.typeCoarse)) {
    L.push(decl(`text-${name}`, rem(size), `${size}px`, '    '));
    L.push(decl(`leading-${name}`, rem(lh), `${lh}px`, '    '));
  }
  L.push('  }');
  L.push('}');
  return L.join('\n') + '\n';
}

/* --------------------------- brand-tokens.css --------------------------- */

const fluid = ([, min, pref, max]) => `clamp(${min}rem, ${pref}, ${max}rem)`;

function buildBrandCss() {
  const L = header('brand tokens (landing site, docs, store listings)', 'tools/source/brand.mjs');
  L.push('/* Requires foundations.css. Adds a fluid reading-first type scale, page');
  L.push('   layout, touch-sized controls and the showcase elevation. */');
  L.push(':root {');
  L.push('  /* ---------- fluid type ---------- */');
  for (const row of B.typeScale) {
    const [name, min, , max, lh, weight, role] = row;
    L.push(decl(`brand-text-${name}`, fluid(row), `${min * 16}–${max * 16}px — ${role}`));
    L.push(decl(`brand-leading-${name}`, lh));
    L.push(decl(`brand-weight-${name}`, weight));
  }
  for (const [name, [v, note]] of Object.entries(B.tracking)) L.push(decl(name, v, note));
  L.push('');
  L.push('  /* ---------- layout ---------- */');
  for (const [name, v, note] of B.layout) L.push(decl(name, v, note));
  L.push('');
  L.push('  /* ---------- controls ---------- */');
  for (const [name, r, note] of B.controls) L.push(decl(name, `${r}rem`, note));
  L.push('');
  L.push('  /* ---------- elevation ---------- */');
  for (const [name, layers] of Object.entries(B.shadows)) L.push(decl(name, cssShadow(layers)));
  L.push('}');
  return L.join('\n') + '\n';
}

/* ------------------------------ DTCG JSON ------------------------------- */

const dtcgColor = (hex, alpha = 1) => {
  const [r, g, b] = hexToRgb(hex).map((v) => +(v / 255).toFixed(4));
  return { colorSpace: 'srgb', components: [r, g, b], ...(alpha === 1 ? {} : { alpha }), hex: hex.toLowerCase() };
};
const dim = (value, unit) => ({ value, unit });
const json = (o) => JSON.stringify({ $schema: SCHEMA, ...o }, null, 2) + '\n';
const group = (type, rows, unit, map = (v) => v, rename = (n) => n) => {
  const g = { $type: type };
  for (const [name, v, note] of rows) g[rename(name)] = { $value: dim(map(v), unit), ...(note ? { $description: note } : {}) };
  return g;
};
const dtcgShadow = (layers) =>
  layers.map(([x, y, blur, spread, ref, a]) => ({
    color: dtcgColor(resolveRef(ref), a),
    offsetX: dim(x, 'px'),
    offsetY: dim(y, 'px'),
    blur: dim(blur, 'px'),
    spread: dim(spread, 'px'),
  }));
const dtcgColors = (tokens) => {
  const out = { $type: 'color' };
  for (const [name, t] of Object.entries(tokens)) {
    out[name] = {
      $value: t.alpha === 1 && !t.ref.startsWith('#') ? `{color.${t.ref}}` : dtcgColor(t.hex, t.alpha),
      ...(t.description ? { $description: t.description } : {}),
    };
  }
  return out;
};

function dtcgFoundations() {
  const color = { $type: 'color' };
  for (const [hue, steps] of Object.entries(palette)) {
    color[hue] = {};
    for (const [step, c] of Object.entries(steps)) color[hue][step] = { $value: dtcgColor(c.hex), $description: fmtOklch(c.oklch) };
  }
  const font = { family: { $type: 'fontFamily' }, weight: { $type: 'fontWeight' } };
  for (const [name, list] of Object.entries(F.fonts)) font.family[name.replace('font-', '')] = { $value: list };
  font.weight.regular = { $value: 400 };
  font.weight.bold = { $value: 700 };
  return {
    $description: `Refrain Sheet Design System v${F.VERSION} — foundations shared by brand and app. Generated by tools/build.mjs.`,
    color,
    font,
    space: group('dimension', F.space, 'rem', (px) => px / 16),
    radius: group('dimension', F.radius, 'px'),
    stroke: group('dimension', F.strokes, 'px', (v) => v, (n) => n.replace('stroke-', '')),
    icon: group('dimension', F.iconSizes, 'rem', (px) => px / 16, (n) => n.replace('icon-', '')),
    duration: group('duration', F.motion.durations, 'ms', (v) => v, (n) => n.replace('duration-', '')),
    easing: Object.fromEntries([['$type', 'cubicBezier'], ...F.motion.easings.map(([n, v, note]) => [n.replace('ease-', ''), { $value: v, $description: note }])]),
  };
}
function dtcgSharedMode(mode) {
  const shadow = { $type: 'shadow' };
  for (const [name, layers] of Object.entries(F.shadows[mode])) shadow[name.replace('shadow-', '')] = { $value: dtcgShadow(layers) };
  return { $description: `Shared semantic colours, ${mode}. Resolve against foundations.tokens.json.`, semantic: dtcgColors(shared[mode]), shadow };
}
function dtcgApp() {
  const typography = { $type: 'typography' };
  for (const [name, size, lh, weight, role] of A.typeScale) {
    typography[name] = {
      $value: { fontFamily: '{font.family.ui}', fontSize: dim(size / 16, 'rem'), fontWeight: weight === 700 ? '{font.weight.bold}' : '{font.weight.regular}', letterSpacing: dim(0, 'px'), lineHeight: +(lh / size).toFixed(4) },
      $description: role,
    };
  }
  const data = { $type: 'color', $description: 'Document colours: identical in every theme.' };
  for (const s of swatches) data[s.name.replace('swatch-', '')] = { $value: dtcgColor(s.hex) };
  for (const [name, ref] of Object.entries(A.swatches.conditional)) data[name] = { $value: `{color.${ref}}` };
  return {
    $description: 'App layer. Resolve against foundations.tokens.json. Generated by tools/build.mjs.',
    typography,
    data,
    grid: group('dimension', A.grid, 'px', (v) => v, (n) => n.replace('grid-', '')),
    layer: Object.fromEntries([['$type', 'number'], ...A.layers.map(([n, v, note]) => [n.replace('z-', ''), { $value: v, $description: note }])]),
  };
}
function dtcgCanvas(theme) {
  const src = theme === 'dark' ? canvas.dark : canvas.light;
  return { $description: `Canvas colours for the "${theme}" app theme${theme === 'hybrid' ? ' (shell uses foundations dark)' : ''}.`, canvas: dtcgColors(src) };
}
function dtcgDensity(i) {
  const size = { $type: 'dimension' };
  for (const [name, v] of Object.entries(A.density.tokens)) size[name] = { $value: dim(v[i] / 16, 'rem'), $description: v[3] };
  return { $description: `Density "${A.density.modes[i]}".`, size };
}
function dtcgBrand() {
  const typography = { $type: 'typography' };
  for (const [name, min, , max, lh, weight, role] of B.typeScale) {
    typography[name] = {
      $value: { fontFamily: '{font.family.ui}', fontSize: dim(max, 'rem'), fontWeight: weight === 700 ? '{font.weight.bold}' : '{font.weight.regular}', letterSpacing: dim(0, 'px'), lineHeight: lh },
      $description: `${role}. Fluid from ${min}rem (see brand-tokens.css); the value is the maximum.`,
    };
  }
  const shadow = { $type: 'shadow' };
  for (const [name, layers] of Object.entries(B.shadows)) shadow[name.replace('brand-shadow-', '')] = { $value: dtcgShadow(layers) };
  return {
    $description: 'Brand layer (landing site, docs, store listings). Resolve against foundations.tokens.json.',
    typography,
    control: group('dimension', B.controls, 'rem', (v) => v, (n) => n.replace('brand-', '')),
    shadow,
  };
}

/* ------------------------------ literal lint ---------------------------- */

const HAND_WRITTEN = ['app/css/base.css', 'app/css/components.css', 'app/css/grid.css', 'brand/css/brand.css'];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
for (const f of HAND_WRITTEN) {
  const text = readFileSync(join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  text.split('\n').forEach((line, i) => {
    if (LITERAL.test(line)) errors.push(`literal colour in ${f}:${i + 1}: ${line.trim()}`);
  });
}

/* -------------------------------- docs ---------------------------------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chip = (css) => `<span class="doc-chip" style="background:${css}"></span>`;
const table = (head, rows) =>
  `<div class="doc-scroll"><table class="doc-table"><thead><tr>${head.map((h) => `<th${h.startsWith('num:') ? ' class="num"' : ''}>${h.replace(/^num:/, '')}</th>`).join('')}</tr></thead><tbody>${rows.join('\n')}</tbody></table></div>`;

function docPalette() {
  return Object.entries(palette)
    .map(([hue, steps]) => `<div class="doc-swatch-row">${Object.entries(steps).map(([step, c]) => `<figure class="doc-swatch">${chip(c.hex)}<figcaption><b>${hue}-${step}</b><br><code>${c.hex}</code><br><small>${fmtOklch(c.oklch).replace('oklch ', '')}</small></figcaption></figure>`).join('')}</div>`)
    .join('\n');
}
function docAnchors() {
  return table(['トークン', '値', '役割'], Object.entries(F.brandAnchors).map(([n, [ref, note]]) => `<tr><th><code>--${n}</code></th><td>${chip(resolveRef(ref))}<code>${resolveRef(ref)}</code> <small>${ref}</small></td><td>${esc(note)}</td></tr>`));
}
function docColorTable(modes, sets) {
  const rows = Object.keys(sets[modes[0]]).map((name) => {
    const cells = modes.map((m) => {
      const v = sets[m][name];
      return `<td>${chip(cssColor(v))}<code>${esc(v.ref)}${v.alpha === 1 ? '' : ` / ${v.alpha}`}</code></td>`;
    });
    return `<tr><th><code>--${name}</code></th>${cells.join('')}<td>${esc(sets[modes[0]][name].description)}</td></tr>`;
  });
  return table(['トークン', ...modes, '用途'], rows);
}
function docSwatches() {
  const byHue = {};
  for (const s of swatches) (byHue[s.hue] ??= []).push(s);
  return Object.entries(byHue).map(([hue, list]) => `<div class="doc-picker-row"><span class="doc-picker-label">${hue}</span>${list.map((s) => `<span class="doc-picker-cell" style="background:${s.hex}" title="--${s.name} ${s.hex}"></span>`).join('')}</div>`).join('\n');
}
function docContrast(audit) {
  const rows = audit.rows.map((a) => `<tr><td>${esc(a.label)}</td><td><code>${esc(a.fg)}</code> / <code>${esc(a.bg)}</code></td><td class="num">${a.min}</td>${audit.names.map((t) => `<td class="num${a.ratios[t] + 1e-9 < a.min ? ' ng' : ''}">${a.ratios[t].toFixed(2)}</td>`).join('')}</tr>`);
  return `<p class="doc-meta">${audit.pass} / ${audit.checks} 合格（${audit.rows.length} 組 × ${audit.names.length} テーマ）</p>` + table(['用途', '前景 / 背景', 'num:下限', ...audit.names.map((t) => `num:${t}`)], rows);
}
const scaleTable = (title, rows, fmt) => `<h4>${title}</h4>` + table(['トークン', 'num:値', '用途'], rows.map((r) => `<tr><th><code>${r[0]}</code></th><td class="num">${fmt(r)}</td><td>${esc(r[2] ?? '')}</td></tr>`));
function docFoundationScales() {
  return [
    scaleTable('余白', F.space.map(([n, px]) => [`--space-${n}`, px, '']), (r) => `${r[1]}px`),
    scaleTable('角丸', F.radius.map(([n, px, note]) => [`--radius-${n}`, px, note]), (r) => `${r[1]}px`),
    scaleTable('線', F.strokes.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    scaleTable('アイコン', F.iconSizes.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    scaleTable('動き', F.motion.durations.map(([n, ms, note]) => [`--${n}`, ms, note]), (r) => `${r[1]}ms`),
    scaleTable('ブレークポイント', F.breakpoints.map(([n, em, note]) => [`--${n}`, em, note]), (r) => `${r[1]}em`),
  ].join('\n');
}
function docAppType() {
  return table(['トークン', 'num:サイズ / 行送り', 'num:ウェイト', '見本', '用途'], A.typeScale.map(([name, size, lh, weight, role]) => `<tr><th><code>--text-${name}</code></th><td class="num">${size}px / ${lh}px</td><td class="num">${weight}</td><td><span style="font-size:var(--text-${name});line-height:var(--leading-${name});font-weight:${weight}">保持する構造 Refrain 123</span></td><td>${esc(role)}</td></tr>`));
}
function docDensity() {
  return table(['トークン', ...A.density.modes.map((m) => `num:${m}${m === A.density.default ? '（既定）' : ''}`), 'num:coarse 下限', '用途'], Object.entries(A.density.tokens).map(([name, v]) => `<tr><th><code>--${name}</code></th>${v.slice(0, 3).map((px) => `<td class="num">${px}px</td>`).join('')}<td class="num">${A.density.coarse[name] ? A.density.coarse[name] + 'px' : '—'}</td><td>${esc(v[3])}</td></tr>`));
}
function docAppScales() {
  return [
    scaleTable('グリッド', A.grid.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    scaleTable('重なり順', A.layers.map(([n, v, note]) => [`--${n}`, v, note]), (r) => r[1]),
  ].join('\n');
}
function docBrandType() {
  return table(['トークン', 'num:最小 – 最大', 'num:行送り', 'num:ウェイト', '見本', '用途'], B.typeScale.map(([name, min, , max, lh, weight, role]) => `<tr><th><code>--brand-text-${name}</code></th><td class="num">${min * 16}–${max * 16}px</td><td class="num">${lh}</td><td class="num">${weight}</td><td><span style="font-size:var(--brand-text-${name});line-height:var(--brand-leading-${name});font-weight:${weight}">保持する構造</span></td><td>${esc(role)}</td></tr>`));
}
function docBrandLayout() {
  return table(['トークン', '値', '用途'], [...B.layout, ...B.controls.map(([n, r, note]) => [n, `${r}rem`, note])].map(([n, v, note]) => `<tr><th><code>--${n}</code></th><td><code>${esc(v)}</code></td><td>${esc(note)}</td></tr>`));
}

const version = `v${F.VERSION} · ${F.RELEASED}`;
const DOCS = {
  'foundations/docs/foundations.html': {
    version,
    palette: docPalette(),
    anchors: docAnchors(),
    semantic: docColorTable(SHARED_MODES, shared),
    scales: docFoundationScales(),
    contrast: docContrast(audits.foundations),
  },
  'app/docs/design-system.html': {
    version,
    canvas: docColorTable(APP_THEMES, { light: canvas.light, dark: canvas.dark, hybrid: canvas.light }),
    swatches: docSwatches(),
    type: docAppType(),
    density: docDensity(),
    scales: docAppScales(),
    contrast: docContrast(audits.app),
  },
  'brand/docs/brand-guidelines.html': {
    version,
    type: docBrandType(),
    layout: docBrandLayout(),
    contrast: docContrast(audits.brand),
  },
};
function fillDoc(path, regions) {
  const html = readFileSync(join(ROOT, path), 'utf8');
  return html.replace(/<!-- gen:([a-z]+) -->[\s\S]*?<!-- \/gen:\1 -->/g, (m, name) => {
    if (!(name in regions)) {
      errors.push(`${path}: unknown generated region "${name}"`);
      return m;
    }
    return `<!-- gen:${name} -->${regions[name]}<!-- /gen:${name} -->`;
  });
}

/* ------------------------------- outputs -------------------------------- */

const outputs = new Map();
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const foundationsCss = buildFoundationsCss();
const appCss = buildAppCss();
const brandCss = buildBrandCss();
outputs.set('foundations/css/foundations.css', foundationsCss);
outputs.set('app/css/app-tokens.css', appCss);
outputs.set('brand/css/brand-tokens.css', brandCss);
outputs.set('app/css/refrain-sheet.css', [foundationsCss, appCss, read('app/css/base.css'), read('app/css/components.css'), read('app/css/grid.css')].join('\n'));
outputs.set('brand/css/refrain-brand.css', [foundationsCss, brandCss, read('brand/css/brand.css')].join('\n'));
outputs.set('foundations/tokens/foundations.tokens.json', json(dtcgFoundations()));
for (const m of SHARED_MODES) outputs.set(`foundations/tokens/theme-${m}.tokens.json`, json(dtcgSharedMode(m)));
outputs.set('app/tokens/app.tokens.json', json(dtcgApp()));
for (const t of APP_THEMES) outputs.set(`app/tokens/canvas-${t}.tokens.json`, json(dtcgCanvas(t)));
A.density.modes.forEach((m, i) => outputs.set(`app/tokens/density-${m}.tokens.json`, json(dtcgDensity(i))));
outputs.set('brand/tokens/brand.tokens.json', json(dtcgBrand()));
for (const [path, regions] of Object.entries(DOCS)) outputs.set(path, fillDoc(path, regions));

const manifest = {
  name: 'Refrain Sheet Design System',
  version: F.VERSION,
  released: F.RELEASED,
  supersedes: '1.0.0',
  layers: {
    foundations: { purpose: 'Shared by brand and app', css: 'foundations/css/foundations.css', docs: 'foundations/docs/foundations.html', themes: SHARED_MODES },
    app: { purpose: 'Application UI', requires: 'foundations', css: 'app/css/refrain-sheet.css', docs: 'app/docs/design-system.html', themes: APP_THEMES, density: A.density.modes, density_default: A.density.default },
    brand: { purpose: 'Landing site, documentation, store listings', requires: 'foundations', guidelines_version: '3.0', css: 'brand/css/refrain-brand.css', docs: 'brand/docs/brand-guidelines.html' },
  },
  source: 'tools/source/*.mjs',
  build: 'node design-system/2.0.0/tools/build.mjs [--check]',
  targets: { primary: 'Windows 11 / Chrome', supported: ['iOS Safari', 'Android Chrome', 'macOS Safari', 'Firefox'] },
  fonts: { webfonts: 0, ui: family(F.fonts['font-ui']), data: family(F.fonts['font-data']), code: family(F.fonts['font-code']), available_weights: [400, 700], min_size_px: 12 },
  color: { space: 'OKLCH', delivery: 'sRGB hex', document_swatches: swatches.length },
  tokens_format: 'Design Tokens Format Module 2025.10',
  accessibility: {
    standard: 'WCAG 2.2 AA',
    contrast: Object.fromEntries(Object.entries(audits).map(([k, a]) => [k, { checks: a.checks, pass: a.pass }])),
  },
};
outputs.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

if (errors.length) {
  for (const e of errors) process.stderr.write(`✗ ${e}\n`);
  process.exit(1);
}

let stale = 0;
for (const [rel, content] of outputs) {
  const p = join(ROOT, rel);
  const current = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (current === content) continue;
  if (CHECK) {
    process.stderr.write(`✗ stale: ${relative(process.cwd(), p)}\n`);
    stale++;
  } else {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    process.stdout.write(`wrote ${relative(process.cwd(), p)}\n`);
  }
}
if (stale) {
  process.stderr.write('Run: node design-system/2.0.0/tools/build.mjs\n');
  process.exit(1);
}
const summary = Object.entries(audits).map(([k, a]) => `${k} ${a.pass}/${a.checks}`).join(', ');
process.stdout.write(`contrast ${summary} · literal colours 0 · ${outputs.size} outputs ${CHECK ? 'current' : 'built'}\n`);
