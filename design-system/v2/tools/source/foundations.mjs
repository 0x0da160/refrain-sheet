// SPDX-License-Identifier: MIT
//
// Foundations — the layer shared by the brand (landing site, docs, store
// listings) and the app UI. Anything both need lives here exactly once:
// colour primitives, the shared semantic colours (light / dark), type
// families and weights, space, shape, strokes, motion, focus, icons,
// breakpoints and elevation. Brand and app layers only add to it.
//
// Colour references are 'hue.step' strings into `palette`; translucent
// values are { ref, alpha }. Rationale: docs/decisions.md.

export const VERSION = '2.3.0';
export const RELEASED = '2026-09-26';

/* ---------------------------------------------------------------------------
   Colour primitives. v1.0.0 hues are kept byte-for-byte (they are the
   brand). Additions are authored in OKLCH and gamut-mapped to sRGB.
   ------------------------------------------------------------------------- */
export const palette = {
  green: {
    50: '#EEF9EC',
    100: '#DAECD8',
    200: '#B3D5B3',
    300: '#8BC191',
    400: '#5DA56C',
    500: '#3D9156',
    600: '#147F43',
    700: '#006335',
    800: '#004A29',
    900: '#002F1B',
  },
  paper: {
    0: '#FFFFFF',
    50: '#F4F4EB',
    100: '#EDEDE4',
    200: '#DDDDD4',
    300: '#CBCBC3',
    400: '#B2B2AA',
  },
  ink: {
    150: { oklch: [0.745, 0.014, 256] },
    200: '#999FA7',
    250: { oklch: [0.66, 0.014, 256] },
    300: '#81878F',
    350: '#6F757D',
    400: '#5C636D',
    500: '#474E57',
    600: '#323941',
    700: '#232932',
    800: '#1B2129',
    900: '#141A22',
    950: '#0B1118',
    1000: '#04080E',
  },
  amber: {
    100: '#F6E5CE',
    300: '#D6B890',
    500: '#B99056',
    600: '#A6762A',
    700: '#865900',
    900: '#472D00',
  },
  red: {
    100: '#FFDDD9',
    300: '#E49C93',
    500: '#C5675D',
    600: '#B44B43',
    700: '#9E2321',
    900: '#5D0004',
  },
  blue: {
    100: '#D8EAFF',
    300: '#95BBE7',
    500: '#4F89C9',
    600: '#2D74BC',
    700: '#0059A1',
    900: '#002E59',
  },
  violet: {
    100: { oklch: [0.93, 0.034, 300] },
    300: { oklch: [0.78, 0.085, 300] },
    500: { oklch: [0.62, 0.13, 300] },
    600: { oklch: [0.551, 0.15, 300] },
    700: { oklch: [0.461, 0.15, 300] },
    900: { oklch: [0.3, 0.1, 300] },
  },
  teal: {
    100: { oklch: [0.93, 0.034, 195] },
    300: { oklch: [0.78, 0.075, 195] },
    500: { oklch: [0.62, 0.09, 195] },
    600: { oklch: [0.551, 0.09, 195] },
    700: { oklch: [0.461, 0.08, 195] },
    900: { oklch: [0.3, 0.055, 195] },
  },
};

// The five brand anchors: fixed names so artwork and copy can refer to them.
export const brandAnchors = {
  'brand-green': ['green.600', 'Preserve — dominant brand colour, app-icon ground'],
  'brand-paper': ['paper.50', 'Paper — page and shell background in light'],
  'brand-mist': ['green.100', 'Mist — quiet structure'],
  'brand-leaf': ['green.300', 'Leaf — accent on dark'],
  'brand-ink': ['ink.900', 'Ink — text, and the ground of dark surfaces'],
};

/* ---------------------------------------------------------------------------
   Shared semantic colours: [light, dark, description]. The app's hybrid
   theme and the landing site's dark bands both use `dark` from here.
   ------------------------------------------------------------------------- */
export const semantic = {
  'bg-page': ['paper.50', 'ink.900', 'Page / app background'],
  'bg-surface': ['paper.0', 'ink.800', 'Bars, cards, docked panels, fields'],
  'bg-raised': ['paper.0', 'ink.700', 'Menus, popovers, dialogs — anything floating'],
  'bg-sunken': ['paper.100', 'ink.950', 'Wells, inset areas, progress track'],
  'bg-feature': ['green.100', 'green.900', 'Landing site: the one Mist panel behind the first view'],
  'bg-hover': ['paper.100', 'ink.600', 'Hover fill of items and ghost buttons'],
  'bg-pressed': ['paper.200', 'ink.500', 'Pressed fill of the same'],
  'border-default': ['paper.200', 'ink.600', 'Separators and non-interactive edges'],
  'border-strong': ['paper.300', 'ink.500', 'Edges that must read over a busy surface'],
  'border-control': ['ink.300', 'ink.350', 'Outline of an interactive control (3:1)'],
  'fg-default': ['ink.900', 'paper.50', 'Primary text'],
  'fg-muted': ['ink.500', 'ink.150', 'Secondary text: helper, metadata, shortcut hints'],
  'fg-subtle': ['ink.400', 'ink.250', 'Placeholders only'],
  accent: ['green.600', 'green.300', 'Primary action fill, active indicator, checked control'],
  'accent-hover': ['green.700', 'green.200', ''],
  'accent-active': ['green.800', 'green.100', ''],
  'accent-contrast': ['paper.0', 'ink.900', 'Text/icon on an accent fill'],
  'accent-subtle': ['green.50', 'green.900', 'Selected item fill'],
  'accent-subtle-text': ['green.800', 'green.200', 'Text on accent-subtle'],
  'accent-text': ['green.700', 'green.300', 'Accent-coloured text and icons'],
  'focus-ring': ['green.600', 'green.300', 'Keyboard focus outline'],
  danger: ['red.600', 'red.300', 'Destructive action fill, error icon'],
  'danger-hover': ['red.700', 'red.100', ''],
  'danger-contrast': ['paper.0', 'ink.900', 'Text on a danger fill'],
  'danger-text': ['red.700', 'red.300', 'Error message text'],
  'danger-subtle': ['red.100', 'red.900', 'Error banner fill'],
  warning: ['amber.600', 'amber.300', 'Warning icon and stripe'],
  'warning-text': ['amber.700', 'amber.300', 'Warning message text'],
  'warning-subtle': ['amber.100', 'amber.900', 'Warning banner fill'],
  success: ['green.600', 'green.300', 'Success icon'],
  'success-text': ['green.700', 'green.300', 'Success message text'],
  'success-subtle': ['green.100', 'green.900', 'Success banner fill'],
  info: ['blue.600', 'blue.300', 'Information icon and stripe'],
  'info-text': ['blue.700', 'blue.300', 'Information message text'],
  'info-subtle': ['blue.100', 'blue.900', 'Information banner fill'],
  link: ['green.700', 'green.300', ''],
  'link-visited': ['green.900', 'green.200', ''],
  'inverse-bg': ['ink.800', 'paper.100', 'Tooltips and toasts: the opposite of the theme'],
  'inverse-text': ['paper.50', 'ink.900', ''],
  'inverse-text-muted': ['ink.200', 'ink.500', ''],
  overlay: [
    { ref: 'ink.1000', alpha: 0.45 },
    { ref: 'ink.1000', alpha: 0.65 },
    'Scrim behind a modal',
  ],
};

export const shadows = {
  light: {
    'shadow-xs': [[0, 1, 2, 0, 'ink.1000', 0.06]],
    'shadow-sm': [
      [0, 1, 3, 0, 'ink.1000', 0.1],
      [0, 1, 2, 0, 'ink.1000', 0.06],
    ],
    'shadow-md': [
      [0, 4, 6, 0, 'ink.1000', 0.08],
      [0, 2, 4, 0, 'ink.1000', 0.06],
    ],
    'shadow-lg': [
      [0, 10, 15, 0, 'ink.1000', 0.08],
      [0, 4, 6, 0, 'ink.1000', 0.05],
    ],
  },
  dark: {
    'shadow-xs': [[0, 1, 2, 0, '#000000', 0.3]],
    'shadow-sm': [
      [0, 1, 3, 0, '#000000', 0.4],
      [0, 1, 2, 0, '#000000', 0.3],
    ],
    'shadow-md': [
      [0, 4, 8, 0, '#000000', 0.45],
      [0, 2, 4, 0, '#000000', 0.3],
    ],
    'shadow-lg': [
      [0, 12, 20, 0, '#000000', 0.5],
      [0, 4, 8, 0, '#000000', 0.35],
    ],
  },
};

/* ---------------------------------------------------------------------------
   Type: families and weights are shared; each layer has its own scale.
   ------------------------------------------------------------------------- */
export const fonts = {
  // UI and brand text. OS-installed only: zero web fonts in both layers.
  // Windows (the app's primary target) resolves BIZ UDPGothic; older Windows
  // installs fall through the UI-condensed and regular Windows families.
  // macOS/iOS reach Hiragino; Android and Linux reach Noto CJK. This is the
  // chain the app shipped and tested before v2.0.0 took it over.
  'font-ui': [
    'BIZ UDPGothic', 'Yu Gothic UI', 'Meiryo UI', 'Meiryo', 'Yu Gothic', 'MS UI Gothic',
    'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'sans-serif',
  ],
  // Cells, numbers, paths: the app's default spreadsheet font. Fixed-pitch
  // Windows families first (BIZ UDGothic, MS Gothic, under both their Latin
  // and Japanese names), then families whose kana/kanji stay full-width.
  // Ends in sans-serif: a generic monospace is Latin-only on
  // macOS/iOS/Android and would break Japanese cells.
  'font-data': [
    'BIZ UDGothic', 'BIZ UDゴシック', 'MS Gothic', 'ＭＳ ゴシック', 'Meiryo', 'Yu Gothic',
    'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'sans-serif',
  ],
  // Code, source editors, shortcut labels, eyebrows.
  'font-code': ['BIZ UDGothic', 'Consolas', 'SFMono-Regular', 'Menlo', 'monospace'],
};

export const typeShared = {
  'weight-regular': [400, 'Default'],
  'weight-bold': [700, 'The only other weight: BIZ UD ships 400 and 700 only'],
  'text-min': ['0.75rem', '12px — the smallest text anywhere, Japanese included'],
  'tracking-caps': ['0.08em', 'All-caps Latin labels only; never on Japanese'],
  'leading-prose': [1.75, 'Multi-line reading text'],
  'leading-display': [1.3, 'Multi-line headings on reading pages'],
};

/* ---------------------------------------------------------------------------
   Space, shape, strokes, icons, motion, breakpoints
   ------------------------------------------------------------------------- */
export const space = [
  ['0', 0],
  ['0-5', 2],
  ['1', 4],
  ['1-5', 6],
  ['2', 8],
  ['3', 12],
  ['4', 16],
  ['5', 20],
  ['6', 24],
  ['8', 32],
  ['10', 40],
  ['12', 48],
  ['16', 64],
  ['20', 80],
  ['24', 96],
];

export const radius = [
  ['xs', 2, 'Marks and chips inside dense UI'],
  ['sm', 4, 'Menu items, inline controls up to 28px, tabs'],
  ['md', 6, 'Buttons and fields'],
  ['lg', 8, 'Menus, popovers, cards in the app (= sm + 4px inset)'],
  ['xl', 12, 'Dialogs, toasts; cards on the landing site'],
  ['2xl', 16, 'Screenshot frames and hero media on the landing site'],
  ['full', 999, 'Pills, status dots'],
];

export const strokes = [
  ['stroke-thin', 1, 'Separators, fields, cards, grid lines'],
  ['stroke-medium', 2, 'Active cell, selected-tab indicator, focus ring'],
  ['stroke-thick', 4, 'Banner stripe'],
];

// The focus ring is a medium stroke, drawn outside the element.
export const focus = [
  ['focus-width', 'var(--stroke-medium)', '2px — the medium stroke'],
  ['focus-offset', '2px', 'Gap between the element and the ring'],
];

/* Target sizes: [name, px, role]. Every interactive target meets
   target-min. Touch sizes apply under `pointer: coarse` and in a product's
   phone layout (below --bp-md); a target never shrinks to meet them. */
export const targets = [
  ['target-min', 24, 'WCAG 2.5.8 minimum, every pointer'],
  ['target-touch', 44, 'Touch: actions, menu items, fields, dialog buttons'],
  ['target-touch-dense', 40, 'Touch: items in a strip of many (tabs, status-bar items)'],
];

export const iconSizes = [
  ['icon-sm', 16, 'Menus, bars, buttons (default)'],
  ['icon-md', 20, 'Coarse pointer, landing-site feature lists'],
  ['icon-lg', 24, 'Welcome screen, landing-site feature cards'],
];
// Rendered stroke width at every icon size (vector-effect: non-scaling-stroke).
export const iconStroke = 1.5;

export const motion = {
  durations: [
    ['duration-instant', 80, 'Press feedback'],
    ['duration-fast', 120, 'Hover, colour changes'],
    ['duration-base', 200, 'Open/close of menus, popovers, panels'],
    ['duration-slow', 320, 'Drawers and bottom sheets'],
  ],
  easings: [
    ['ease-out', [0.2, 0, 0, 1], 'Default: things entering'],
    ['ease-in-out', [0.4, 0, 0.2, 1], 'Things moving between two places'],
  ],
};

// Breakpoints are where content breaks, not device classes: these are the
// widths the app and the landing site actually switch at. Query with
// `max-width` for "below": (max-width: 43.75em) is the phone layout.
export const breakpoints = [
  ['bp-sm', 32.5, '520px — at or below: the narrowest phone adjustments'],
  ['bp-md', 43.75, '700px — at or below: the phone layout (app); landing-site stat rows stack'],
  ['bp-lg', 56.25, '900px — at or below: landing-site columns stack, header links fold'],
  ['bp-xl', 90, '1440px — reserved; nothing switches here yet'],
];

// [fg, bg, minimum, label], checked in light and dark.
export const contrastPairs = [
  ['fg-default', 'bg-page', 4.5, 'Body text on the page'],
  ['fg-default', 'bg-surface', 4.5, 'Body text on bars and cards'],
  ['fg-default', 'bg-raised', 4.5, 'Body text in menus and dialogs'],
  ['fg-default', 'bg-hover', 4.5, 'Text on a hovered item'],
  ['fg-default', 'bg-pressed', 4.5, 'Text on a pressed item'],
  ['fg-muted', 'bg-page', 4.5, 'Secondary text on the page'],
  ['fg-muted', 'bg-surface', 4.5, 'Secondary text on bars and cards'],
  ['fg-muted', 'bg-raised', 4.5, 'Secondary text in menus'],
  ['fg-muted', 'bg-hover', 4.5, 'Shortcut hint on a hovered item'],
  ['fg-subtle', 'bg-surface', 4.5, 'Placeholder in a field'],
  ['fg-subtle', 'bg-raised', 4.5, 'Placeholder in a dialog field'],
  ['accent-contrast', 'accent', 4.5, 'Primary button label'],
  ['accent-contrast', 'accent-hover', 4.5, 'Primary button label, hovered'],
  ['accent-text', 'bg-page', 4.5, 'Accent text'],
  ['accent-text', 'bg-surface', 4.5, 'Accent text on bars and cards'],
  ['accent-text', 'bg-raised', 4.5, 'Accent text in menus'],
  ['accent-subtle-text', 'accent-subtle', 4.5, 'Selected item text'],
  ['danger-contrast', 'danger', 4.5, 'Destructive button label'],
  ['danger-text', 'bg-page', 4.5, 'Error message'],
  ['danger-text', 'bg-surface', 4.5, 'Error message on a bar'],
  ['danger-text', 'bg-raised', 4.5, 'Error message in a dialog'],
  ['danger-text', 'danger-subtle', 4.5, 'Error banner text'],
  ['warning-text', 'bg-page', 4.5, 'Warning message'],
  ['warning-text', 'warning-subtle', 4.5, 'Warning banner text'],
  ['fg-default', 'warning-subtle', 4.5, 'Body text in a warning banner'],
  ['success-text', 'bg-page', 4.5, 'Success message'],
  ['success-text', 'bg-raised', 4.5, 'Success message in a dialog'],
  ['success-text', 'success-subtle', 4.5, 'Success banner text'],
  ['info-text', 'bg-page', 4.5, 'Information message'],
  ['info-text', 'info-subtle', 4.5, 'Information banner text'],
  ['link', 'bg-page', 4.5, 'Link'],
  ['link', 'bg-raised', 4.5, 'Link in a dialog'],
  ['link-visited', 'bg-page', 4.5, 'Visited link'],
  ['inverse-text', 'inverse-bg', 4.5, 'Tooltip / toast text'],
  ['inverse-text-muted', 'inverse-bg', 4.5, 'Tooltip shortcut hint'],
  ['border-control', 'bg-page', 3, 'Field outline'],
  ['border-control', 'bg-surface', 3, 'Field outline on a bar or card'],
  ['border-control', 'bg-raised', 3, 'Field outline in a dialog'],
  ['accent', 'bg-page', 3, 'Accent fill / indicator'],
  ['accent', 'bg-surface', 3, 'Selected-tab indicator on a bar'],
  ['focus-ring', 'bg-surface', 3, 'Focus ring on a bar or card'],
  ['focus-ring', 'bg-raised', 3, 'Focus ring in a dialog'],
  ['danger', 'bg-page', 3, 'Error icon'],
  ['warning', 'bg-page', 3, 'Warning icon'],
  ['warning', 'warning-subtle', 3, 'Warning stripe on its banner'],
  ['info', 'bg-page', 3, 'Info icon'],
  ['success', 'bg-page', 3, 'Success icon'],
];
