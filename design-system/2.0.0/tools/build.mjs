// SPDX-License-Identifier: MIT
//
// Build the Refrain Sheet Design System from tools/source.mjs.
//
//   node design-system/2.0.0/tools/build.mjs          write every output
//   node design-system/2.0.0/tools/build.mjs --check  verify outputs are current
//
// Outputs: css/tokens.css, css/refrain-sheet.css (bundle), tokens/*.tokens.json
// (Design Tokens Format Module 2025.10), manifest.json, and the regions of
// docs/design-system.html between <!-- gen:NAME --> and <!-- /gen:NAME -->.
// Fails (exit 1) when a contrast pair is under its minimum, when a hand-written
// stylesheet contains a literal colour, or, with --check, when an output is
// stale. No dependencies beyond Node.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import * as S from './source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const out = (s) => process.stdout.write(s + '\n');
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
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
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

/** hue -> step -> { hex, oklch, authored } */
const palette = {};
for (const [hue, steps] of Object.entries(S.palette)) {
  palette[hue] = {};
  for (const [step, v] of Object.entries(steps)) {
    const hex = typeof v === 'string' ? v.toUpperCase() : oklchToHex(v.oklch);
    palette[hue][step] = { hex, oklch: hexToOklch(hex), authored: typeof v === 'string' ? 'hex' : 'oklch' };
  }
}

function resolveRef(ref) {
  if (ref.startsWith('#')) return ref.toUpperCase();
  const [hue, step] = ref.split('.');
  const c = palette[hue]?.[step];
  if (!c) throw new Error(`unknown colour reference: ${ref}`);
  return c.hex;
}

/** { hex, alpha, ref } for a semantic value. */
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

const THEMES = ['light', 'dark', 'hybrid'];

/** theme -> token -> { hex, alpha, ref, description, scope } */
const themes = Object.fromEntries(THEMES.map((t) => [t, {}]));
for (const [scope, tokens] of Object.entries(S.semantic)) {
  for (const [name, [light, dark, description]] of Object.entries(tokens)) {
    const L = { ...resolveValue(light), description, scope };
    const D = { ...resolveValue(dark), description, scope };
    themes.light[name] = L;
    themes.dark[name] = D;
    themes.hybrid[name] = scope === 'canvas' ? L : D;
  }
}

const shadowFor = (theme) => S.shadows[theme === 'light' ? 'light' : 'dark'];
const cssShadow = (layers) =>
  layers
    .map(([x, y, blur, spread, ref, a]) => {
      const [r, g, b] = hexToRgb(resolveRef(ref));
      return `${x}px ${y}px ${blur}px${spread ? ` ${spread}px` : ''} rgb(${r} ${g} ${b} / ${a})`;
    })
    .join(', ');

/* ------------------------------- swatches ------------------------------- */

const swatches = [];
for (const [hue, [H, fixedC]] of Object.entries(S.swatches.hues)) {
  for (const [step, L, cap] of S.swatches.steps) {
    const hex = oklchToHex([L, fixedC ?? cap, H]);
    swatches.push({ name: `swatch-${hue}-${step}`, hue, step, hex });
  }
}
swatches.push({ name: 'swatch-white', hue: 'base', step: 0, hex: '#FFFFFF' });
swatches.push({ name: 'swatch-black', hue: 'base', step: 8, hex: '#000000' });

/* ------------------------------ contrast -------------------------------- */

function colourOf(theme, expr) {
  const [top, , under] = expr.split(' ');
  const t = themes[theme][top];
  if (!t) throw new Error(`contrast pair names unknown token: ${top}`);
  const rgb = hexToRgb(t.hex);
  if (under) {
    const base = colourOf(theme, under);
    return composite(rgb, t.alpha, base);
  }
  if (t.alpha !== 1) return composite(rgb, t.alpha, hexToRgb(themes[theme]['canvas-bg'].hex));
  return rgb;
}

const audit = S.contrastPairs.map(([fg, bg, min, label]) => {
  const ratios = Object.fromEntries(THEMES.map((t) => [t, contrast(colourOf(t, fg), colourOf(t, bg))]));
  for (const t of THEMES) {
    if (ratios[t] + 1e-9 < min) errors.push(`contrast ${fg} / ${bg} in ${t}: ${ratios[t].toFixed(2)} < ${min}`);
  }
  return { fg, bg, min, label, ratios };
});
const auditChecks = audit.length * THEMES.length;
const auditPass = audit.reduce((n, a) => n + THEMES.filter((t) => a.ratios[t] + 1e-9 >= a.min).length, 0);

/* ------------------------------ tokens.css ------------------------------ */

const rem = (px) => `${+(px / 16).toFixed(4)}rem`;
const pad = (s, n = 36) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));
const decl = (name, value, comment = '') => `  ${pad(`--${name}: ${value};`)}${comment ? `/* ${comment} */` : ''}`.trimEnd();
const family = (list) => list.map((f) => (/^[a-z-]+$/.test(f) ? f : `"${f}"`)).join(', ');

function themeBlock(theme, indent = '') {
  const lines = [];
  lines.push(`${indent}  color-scheme: ${theme === 'light' ? 'light' : 'dark'};`);
  let scope = '';
  for (const [name, t] of Object.entries(themes[theme])) {
    if (t.scope !== scope) {
      scope = t.scope;
      lines.push(`${indent}  /* ${scope} */`);
    }
    lines.push(indent + decl(name, cssColor(t), t.ref));
  }
  lines.push(`${indent}  /* elevation */`);
  for (const [name, layers] of Object.entries(shadowFor(theme))) lines.push(indent + decl(name, cssShadow(layers)));
  return lines.join('\n');
}

function buildTokensCss() {
  const L = [];
  L.push(`/*! Refrain Sheet Design System — tokens  v${S.VERSION}  (${S.RELEASED})`);
  L.push(' *');
  L.push(' *  GENERATED by tools/build.mjs from tools/source.mjs. Do not edit by hand.');
  L.push(' *');
  L.push(' *  Units: rem for anything that belongs to text (type, control heights,');
  L.push(' *  spacing) so the user\'s default font size scales the UI; px for hairlines,');
  L.push(' *  shadows, radii and the grid (which multiplies px by --sheet-zoom); em in');
  L.push(' *  media queries. Colour is designed in OKLCH and delivered as sRGB hex.');
  L.push(' */');
  L.push('');
  L.push(':root {');
  L.push('  /* ---------- colour primitives ---------- */');
  for (const [hue, steps] of Object.entries(palette)) {
    for (const [step, c] of Object.entries(steps)) L.push(decl(`${hue}-${step}`, c.hex, fmtOklch(c.oklch)));
    L.push('');
  }
  L.push('  /* ---------- data colours: fixed in every theme ---------- */');
  for (const s of swatches) L.push(decl(s.name, s.hex));
  for (const [name, ref] of Object.entries(S.swatches.conditional)) L.push(decl(name, resolveRef(ref), ref));
  L.push('');
  L.push('  /* ---------- fonts (OS-installed only; zero web fonts) ---------- */');
  for (const [name, list] of Object.entries(S.fonts)) L.push(`  --${name}: ${family(list)};`);
  L.push('  --font-feature-data: "zero" 1;');
  L.push('');
  L.push('  /* ---------- type ---------- */');
  for (const [name, size, lh, weight, role] of S.typeScale) {
    L.push(decl(`text-${name}`, rem(size), `${size}px — ${role}`));
    L.push(decl(`leading-${name}`, rem(lh), `${lh}px`));
    L.push(decl(`weight-${name}`, weight));
  }
  for (const [name, [v, note]] of Object.entries(S.typeMisc)) L.push(decl(name, v, note));
  L.push('');
  L.push('  /* ---------- space (4px base, 2px and 6px half-steps for dense UI) ---------- */');
  for (const [name, px] of S.space) L.push(decl(`space-${name}`, px === 0 ? '0' : rem(px), `${px}px`));
  L.push('');
  L.push('  /* ---------- shape ---------- */');
  for (const [name, px, note] of S.radius) L.push(decl(`radius-${name}`, px === 0 ? '0' : `${px}px`, note));
  for (const [name, px, note] of S.borders) L.push(decl(name, `${px}px`, note));
  for (const [name, px, note] of S.iconSizes) L.push(decl(name, rem(px), `${px}px — ${note}`));
  L.push(decl('icon-stroke', '1.5px', 'Rendered stroke, at every icon size'));
  L.push(decl('focus-width', '2px'));
  L.push(decl('focus-offset', '2px'));
  L.push('');
  L.push('  /* ---------- grid geometry (px x --sheet-zoom) ---------- */');
  for (const [name, px, note] of S.grid) L.push(decl(name, `${px}px`, note));
  L.push('');
  L.push('  /* ---------- motion ---------- */');
  for (const [name, ms, note] of S.motion.durations) L.push(decl(name, `${ms}ms`, note));
  for (const [name, v, note] of S.motion.easings) L.push(decl(name, `cubic-bezier(${v.join(', ')})`, note));
  L.push('');
  L.push('  /* ---------- layers ---------- */');
  for (const [name, v, note] of S.layers) L.push(decl(name, v, note));
  L.push('');
  L.push('  /* ---------- breakpoints (reference only; write the em value in @media) ---------- */');
  for (const [name, em, note] of S.breakpoints) L.push(decl(name, `${em}em`, note));
  L.push('}');
  L.push('');
  L.push('/* ---------- themes ----------');
  L.push('   light  — shell and sheet both on paper');
  L.push('   dark   — shell and sheet both on ink');
  L.push('   hybrid — shell on ink, sheet (canvas-*, state-*, ref-*, syntax-*) on paper');
  L.push('   No data-theme attribute: follow prefers-color-scheme. */');
  L.push(':root,');
  L.push('[data-theme="light"] {');
  L.push(themeBlock('light'));
  L.push('}');
  L.push('');
  for (const t of ['dark', 'hybrid']) {
    L.push(`[data-theme="${t}"] {`);
    L.push(themeBlock(t));
    L.push('}');
    L.push('');
  }
  L.push('@media (prefers-color-scheme: dark) {');
  L.push('  :root:not([data-theme]) {');
  L.push(themeBlock('dark', '  '));
  L.push('  }');
  L.push('}');
  L.push('');
  L.push('/* ---------- density ----------');
  L.push('   Changes heights and insets only: never type size, never grid geometry.');
  L.push(`   Default: ${S.density.default}. A coarse pointer forces touch-size floors. */`);
  const modeBlock = (i) =>
    Object.entries(S.density.tokens)
      .map(([name, v]) => decl(name, rem(v[i]), `${v[i]}px${i === defIdx ? ` — ${v[3]}` : ''}`))
      .join('\n');
  const defIdx = S.density.modes.indexOf(S.density.default);
  L.push(`:root,`);
  L.push(`[data-density="${S.density.default}"] {`);
  L.push(modeBlock(defIdx));
  L.push('}');
  S.density.modes.forEach((m, i) => {
    if (m === S.density.default) return;
    L.push(`[data-density="${m}"] {`);
    L.push(modeBlock(i));
    L.push('}');
  });
  L.push('');
  L.push('@media (pointer: coarse) {');
  L.push('  :root,');
  L.push('  [data-density] {');
  for (const [name, px] of Object.entries(S.density.coarse)) L.push('  ' + decl(name, rem(px), `${px}px`));
  for (const [name, [size, lh]] of Object.entries(S.typeCoarse)) {
    L.push('  ' + decl(`text-${name}`, rem(size), `${size}px`));
    L.push('  ' + decl(`leading-${name}`, rem(lh), `${lh}px`));
  }
  L.push('  }');
  L.push('}');
  return L.join('\n') + '\n';
}

/* ------------------------------ DTCG JSON ------------------------------- */

const dtcgColor = (hex, alpha = 1) => {
  const [r, g, b] = hexToRgb(hex).map((v) => +(v / 255).toFixed(4));
  return { colorSpace: 'srgb', components: [r, g, b], ...(alpha === 1 ? {} : { alpha }), hex: hex.toLowerCase() };
};
const dim = (value, unit) => ({ value, unit });

function buildDtcgBase() {
  const color = { $type: 'color' };
  for (const [hue, steps] of Object.entries(palette)) {
    color[hue] = {};
    for (const [step, c] of Object.entries(steps)) {
      color[hue][step] = { $value: dtcgColor(c.hex), $description: fmtOklch(c.oklch) };
    }
  }
  const data = { $type: 'color', $description: 'Document colours: identical in every theme.' };
  for (const s of swatches) data[s.name.replace('swatch-', '')] = { $value: dtcgColor(s.hex) };
  for (const [name, ref] of Object.entries(S.swatches.conditional)) data[name] = { $value: `{color.${ref}}` };

  const font = { family: { $type: 'fontFamily' }, weight: { $type: 'fontWeight' } };
  for (const [name, list] of Object.entries(S.fonts)) font.family[name.replace('font-', '')] = { $value: list };
  font.weight.regular = { $value: 400 };
  font.weight.bold = { $value: 700 };

  const typography = { $type: 'typography' };
  for (const [name, size, lh, weight, role] of S.typeScale) {
    typography[name] = {
      $value: {
        fontFamily: '{font.family.ui}',
        fontSize: dim(size / 16, 'rem'),
        fontWeight: weight === 700 ? '{font.weight.bold}' : '{font.weight.regular}',
        letterSpacing: dim(0, 'px'),
        lineHeight: lh / size,
      },
      $description: role,
    };
  }

  const group = (type, rows, unit, map = (v) => v) => {
    const g = { $type: type };
    for (const [name, v, note] of rows) g[name] = { $value: dim(map(v), unit), ...(note ? { $description: note } : {}) };
    return g;
  };

  return {
    $description: `Refrain Sheet Design System v${S.VERSION} — base tokens (Design Tokens Format Module 2025.10). Generated by tools/build.mjs.`,
    color,
    data,
    font,
    typography,
    space: group('dimension', S.space.map(([n, px]) => [n, px]), 'rem', (px) => px / 16),
    radius: group('dimension', S.radius, 'px'),
    border: group('dimension', S.borders, 'px'),
    icon: group('dimension', S.iconSizes, 'rem', (px) => px / 16),
    grid: group('dimension', S.grid, 'px'),
    duration: group('duration', S.motion.durations, 'ms'),
    easing: Object.fromEntries([
      ['$type', 'cubicBezier'],
      ...S.motion.easings.map(([n, v, note]) => [n.replace('ease-', ''), { $value: v, $description: note }]),
    ]),
    layer: Object.fromEntries([
      ['$type', 'number'],
      ...S.layers.map(([n, v, note]) => [n.replace('z-', ''), { $value: v, $description: note }]),
    ]),
  };
}

function buildDtcgTheme(theme) {
  const out = { $description: `Theme "${theme}" — semantic colours. Generated by tools/build.mjs.`, color: { $type: 'color' } };
  for (const [name, t] of Object.entries(themes[theme])) {
    const ref = t.ref.startsWith('#') ? null : `{color.${t.ref}}`;
    out.color[name] = {
      $value: t.alpha === 1 && ref ? ref : dtcgColor(t.hex, t.alpha),
      ...(t.description ? { $description: t.description } : {}),
    };
  }
  out.shadow = { $type: 'shadow' };
  for (const [name, layers] of Object.entries(shadowFor(theme))) {
    out.shadow[name.replace('shadow-', '')] = {
      $value: layers.map(([x, y, blur, spread, ref, a]) => ({
        color: dtcgColor(resolveRef(ref), a),
        offsetX: dim(x, 'px'),
        offsetY: dim(y, 'px'),
        blur: dim(blur, 'px'),
        spread: dim(spread, 'px'),
      })),
    };
  }
  return out;
}

function buildDtcgDensity(i) {
  const out = { $description: `Density "${S.density.modes[i]}". Generated by tools/build.mjs.`, size: { $type: 'dimension' } };
  for (const [name, v] of Object.entries(S.density.tokens)) {
    out.size[name] = { $value: dim(v[i] / 16, 'rem'), $description: v[3] };
  }
  return out;
}

/* ------------------------------ literal lint ---------------------------- */

const HAND_WRITTEN = ['css/base.css', 'css/components.css', 'css/grid.css'];
// Colour literals and colour functions. System colours (Canvas, Highlight…)
// and currentColor/transparent are allowed: they are not theme colours.
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

function docPalette() {
  const rows = [];
  for (const [hue, steps] of Object.entries(palette)) {
    const cells = Object.entries(steps)
      .map(
        ([step, c]) =>
          `<figure class="doc-swatch">${chip(c.hex)}<figcaption><b>${hue}-${step}</b><br><code>${c.hex}</code><br><small>${fmtOklch(c.oklch).replace('oklch ', '')}</small></figcaption></figure>`,
      )
      .join('');
    rows.push(`<div class="doc-swatch-row">${cells}</div>`);
  }
  return rows.join('\n');
}

function docSemantic() {
  const head = '<thead><tr><th>トークン</th><th>light</th><th>dark</th><th>hybrid</th><th>用途</th></tr></thead>';
  const body = [];
  let scope = '';
  for (const name of Object.keys(themes.light)) {
    const t = themes.light[name];
    if (t.scope !== scope) {
      scope = t.scope;
      body.push(`<tr class="doc-group"><th colspan="5">${scope === 'chrome' ? 'シェル（chrome）' : 'キャンバス（canvas）'}</th></tr>`);
    }
    const cell = (th) => {
      const v = themes[th][name];
      return `<td>${chip(cssColor(v))}<code>${esc(v.ref)}${v.alpha === 1 ? '' : ` / ${v.alpha}`}</code></td>`;
    };
    body.push(`<tr><th><code>--${name}</code></th>${cell('light')}${cell('dark')}${cell('hybrid')}<td>${esc(t.description)}</td></tr>`);
  }
  return `<div class="doc-scroll"><table class="doc-table">${head}<tbody>${body.join('\n')}</tbody></table></div>`;
}

function docSwatches() {
  const byHue = {};
  for (const s of swatches) (byHue[s.hue] ??= []).push(s);
  return Object.entries(byHue)
    .map(
      ([hue, list]) =>
        `<div class="doc-picker-row"><span class="doc-picker-label">${hue}</span>${list
          .map((s) => `<span class="doc-picker-cell" style="background:${s.hex}" title="--${s.name} ${s.hex}"></span>`)
          .join('')}</div>`,
    )
    .join('\n');
}

function docContrast() {
  const head = `<thead><tr><th>用途</th><th>前景 / 背景</th><th class="num">下限</th>${THEMES.map((t) => `<th class="num">${t}</th>`).join('')}</tr></thead>`;
  const body = audit.map((a) => {
    const cells = THEMES.map((t) => `<td class="num${a.ratios[t] + 1e-9 < a.min ? ' ng' : ''}">${a.ratios[t].toFixed(2)}</td>`).join('');
    return `<tr><td>${esc(a.label)}</td><td><code>${esc(a.fg)}</code> / <code>${esc(a.bg)}</code></td><td class="num">${a.min}</td>${cells}</tr>`;
  });
  return `<p class="doc-meta">${auditPass} / ${auditChecks} 合格（${audit.length} 組 × 3 テーマ）</p><div class="doc-scroll"><table class="doc-table">${head}<tbody>${body.join('\n')}</tbody></table></div>`;
}

function docType() {
  const rows = S.typeScale.map(
    ([name, size, lh, weight, role]) =>
      `<tr><th><code>--text-${name}</code></th><td class="num">${size}px / ${lh}px</td><td class="num">${weight}</td><td><span style="font-size:var(--text-${name});line-height:var(--leading-${name});font-weight:${weight}">${name === 'caption' ? 'Ctrl+Shift+S · 1,234 rows' : '保持する構造 Refrain 123'}</span></td><td>${esc(role)}</td></tr>`,
  );
  return `<div class="doc-scroll"><table class="doc-table"><thead><tr><th>トークン</th><th class="num">サイズ / 行送り</th><th class="num">ウェイト</th><th>見本</th><th>用途</th></tr></thead><tbody>${rows.join('\n')}</tbody></table></div>`;
}

function docDensity() {
  const head = `<thead><tr><th>トークン</th>${S.density.modes.map((m) => `<th class="num">${m}${m === S.density.default ? '（既定）' : ''}</th>`).join('')}<th class="num">coarse 下限</th><th>用途</th></tr></thead>`;
  const rows = Object.entries(S.density.tokens).map(
    ([name, v]) =>
      `<tr><th><code>--${name}</code></th>${v.slice(0, 3).map((px) => `<td class="num">${px}px</td>`).join('')}<td class="num">${S.density.coarse[name] ? S.density.coarse[name] + 'px' : '—'}</td><td>${esc(v[3])}</td></tr>`,
  );
  return `<div class="doc-scroll"><table class="doc-table">${head}<tbody>${rows.join('\n')}</tbody></table></div>`;
}

function docScales() {
  const table = (title, rows, fmt) =>
    `<h4>${title}</h4><div class="doc-scroll"><table class="doc-table"><tbody>${rows.map((r) => `<tr><th><code>${r[0]}</code></th><td class="num">${fmt(r)}</td><td>${esc(r[2] ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
  return [
    table('余白', S.space.map(([n, px]) => [`--space-${n}`, px, '']), (r) => `${r[1]}px`),
    table('角丸', S.radius.map(([n, px, note]) => [`--radius-${n}`, px, note]), (r) => `${r[1]}px`),
    table('線', S.borders.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    table('アイコン', S.iconSizes.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    table('グリッド', S.grid.map(([n, px, note]) => [`--${n}`, px, note]), (r) => `${r[1]}px`),
    table('モーション', S.motion.durations.map(([n, ms, note]) => [`--${n}`, ms, note]), (r) => `${r[1]}ms`),
    table('重なり順', S.layers.map(([n, v, note]) => [`--${n}`, v, note]), (r) => r[1]),
  ].join('\n');
}

function fillDocs(html) {
  const regions = {
    palette: docPalette(),
    semantic: docSemantic(),
    swatches: docSwatches(),
    contrast: docContrast(),
    type: docType(),
    density: docDensity(),
    scales: docScales(),
    version: `v${S.VERSION} · ${S.RELEASED}`,
  };
  return html.replace(/<!-- gen:([a-z]+) -->[\s\S]*?<!-- \/gen:\1 -->/g, (m, name) => {
    if (!(name in regions)) {
      errors.push(`docs: unknown generated region "${name}"`);
      return m;
    }
    return `<!-- gen:${name} -->${regions[name]}<!-- /gen:${name} -->`;
  });
}

/* ------------------------------- outputs -------------------------------- */

const outputs = new Map();
const tokensCss = buildTokensCss();
outputs.set('css/tokens.css', tokensCss);
const bundle = [tokensCss, ...HAND_WRITTEN.map((f) => readFileSync(join(ROOT, f), 'utf8'))].join('\n');
outputs.set('css/refrain-sheet.css', bundle);
const json = (o) => JSON.stringify(o, null, 2) + '\n';
outputs.set('tokens/base.tokens.json', json(buildDtcgBase()));
for (const t of THEMES) outputs.set(`tokens/theme-${t}.tokens.json`, json(buildDtcgTheme(t)));
S.density.modes.forEach((m, i) => outputs.set(`tokens/density-${m}.tokens.json`, json(buildDtcgDensity(i))));
const docPath = 'docs/design-system.html';
outputs.set(docPath, fillDocs(readFileSync(join(ROOT, docPath), 'utf8')));

// manifest last: it records the sizes of everything else.
function sizeOf(rel) {
  if (outputs.has(rel)) return Buffer.byteLength(outputs.get(rel));
  const p = join(ROOT, rel);
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p, { recursive: true })
    .map((f) => join(p, f))
    .filter((f) => statSync(f).isFile())
    .reduce((n, f) => n + statSync(f).size, 0);
}
const manifest = {
  name: 'Refrain Sheet Design System',
  version: S.VERSION,
  released: S.RELEASED,
  supersedes: '1.0.0',
  source: 'tools/source.mjs',
  build: 'node design-system/2.0.0/tools/build.mjs [--check]',
  targets: { primary: 'Windows 11 / Chrome', supported: ['iOS Safari', 'Android Chrome', 'macOS Safari', 'Firefox'] },
  fonts: { webfonts: 0, ui: family(S.fonts['font-ui']), data: family(S.fonts['font-data']), code: family(S.fonts['font-code']), available_weights: [400, 700] },
  color: { space: 'OKLCH', delivery: 'sRGB hex', themes: THEMES, data_swatches: swatches.length },
  density: { modes: S.density.modes, default: S.density.default, coarse_pointer_floor_px: S.density.coarse['control-h'] },
  tokens_format: 'Design Tokens Format Module 2025.10',
  accessibility: { standard: 'WCAG 2.2 AA', contrast_checks: auditChecks, contrast_pass: auditPass },
  files: Object.fromEntries(
    [
      'css/tokens.css',
      'css/base.css',
      'css/components.css',
      'css/grid.css',
      'css/refrain-sheet.css',
      'tokens/',
      'tools/',
      'logo/',
      'icons/',
      'docs/design-system.html',
      'docs/decisions.md',
      'docs/research.md',
      'docs/migration.md',
      'docs/brand-guidelines.html',
    ].map((f) => [f, sizeOf(f)]),
  ),
};
outputs.set('manifest.json', json(manifest));

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
    writeFileSync(p, content);
    out(`wrote ${relative(process.cwd(), p)}`);
  }
}
if (stale) {
  process.stderr.write('Run: node design-system/2.0.0/tools/build.mjs\n');
  process.exit(1);
}
out(`contrast ${auditPass}/${auditChecks} pass · literal colours 0 · ${outputs.size} outputs ${CHECK ? 'current' : 'built'}`);
