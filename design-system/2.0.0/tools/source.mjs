// SPDX-License-Identifier: MIT
//
// Refrain Sheet Design System v2.0.0 — the single source of every token.
//
// `node tools/build.mjs` turns this file into css/tokens.css, the DTCG token
// files under tokens/, the generated tables in docs/design-system.html, and
// manifest.json. Never hand-edit those outputs; change this file and rebuild.
//
// Colour references are written as 'hue.step' strings that point into
// `palette` (e.g. 'green.600'). A reference with transparency is written as
// { ref: 'green.600', alpha: 0.12 }. Rationale for every value lives in
// docs/decisions.md.

export const VERSION = '2.0.0';
export const RELEASED = '2026-09-26';

/* ---------------------------------------------------------------------------
   1. Colour primitives
   v1.0.0 hues are kept byte-for-byte (they are the brand). v2 adds `ink.250`
   so that dark-theme secondary text clears 4.5:1 on raised surfaces, and the
   `violet` / `teal` hues for formula references and syntax colouring.
   New hues are authored in OKLCH and gamut-mapped to sRGB by the build, which
   reduces chroma until the colour fits.
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

/* ---------------------------------------------------------------------------
   2. Semantic colour, per theme
   Every token is [light, dark]. `scope` decides what the hybrid theme uses:
   hybrid = dark for `chrome` tokens, light for `canvas` tokens.
   ------------------------------------------------------------------------- */
export const semantic = {
  chrome: {
    'chrome-bg': ['paper.50', 'ink.900', 'App background behind bars and panels'],
    'chrome-surface': ['paper.0', 'ink.800', 'Bars, docked panels, cards'],
    'chrome-raised': ['paper.0', 'ink.700', 'Menus, popovers, dialogs, anything floating'],
    'chrome-sunken': ['paper.100', 'ink.950', 'Wells, inset areas, track of a progress bar'],
    'chrome-hover': ['paper.100', 'ink.600', 'Hover fill of menu items, list rows, ghost buttons'],
    'chrome-pressed': ['paper.200', 'ink.500', 'Pressed fill of the same'],
    'chrome-border': ['paper.200', 'ink.600', 'Separators and non-interactive surface edges'],
    'chrome-border-strong': ['paper.300', 'ink.500', 'Edges that must read over a busy surface'],
    'border-control': ['ink.300', 'ink.350', 'Outline of an interactive control (3:1)'],
    'chrome-text': ['ink.900', 'paper.50', 'Primary text'],
    'chrome-text-muted': ['ink.500', 'ink.150', 'Secondary text: helper, metadata, status bar, shortcut hints'],
    'chrome-text-subtle': ['ink.400', 'ink.250', 'Tertiary text: placeholders only'],
    accent: ['green.600', 'green.300', 'Primary action fill, active indicator, checked control'],
    'accent-hover': ['green.700', 'green.200', ''],
    'accent-active': ['green.800', 'green.100', ''],
    'accent-contrast': ['paper.0', 'ink.900', 'Text/icon on an accent fill'],
    'accent-subtle': ['green.50', 'green.900', 'Selected item fill (current tab, chosen list row)'],
    'accent-subtle-text': ['green.800', 'green.200', 'Text on accent-subtle'],
    'accent-text': ['green.700', 'green.300', 'Accent-coloured text and icons'],
    'focus-ring': ['green.600', 'green.300', 'Keyboard focus outline on chrome'],
    danger: ['red.600', 'red.300', 'Destructive action fill, error icon'],
    'danger-hover': ['red.700', 'red.100', ''],
    'danger-contrast': ['paper.0', 'ink.900', 'Text on a danger fill'],
    'danger-text': ['red.700', 'red.300', 'Error message text'],
    'danger-subtle': ['red.100', 'red.900', 'Error banner fill'],
    warning: ['amber.700', 'amber.300', 'Warning icon and stripe'],
    'warning-text': ['amber.900', 'amber.300', 'Warning message text'],
    'warning-subtle': ['amber.100', 'amber.900', 'Warning banner fill'],
    success: ['green.600', 'green.300', 'Success icon'],
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
      'Scrim behind a modal dialog',
    ],
  },
  canvas: {
    'canvas-bg': ['paper.0', 'ink.950', 'Cell background; also source-editor background'],
    'canvas-row-alt': ['paper.50', 'ink.900', 'Optional banded rows (off by default)'],
    'canvas-header-bg': ['paper.50', 'ink.900', 'Row and column headers'],
    'canvas-header-text': ['ink.500', 'ink.200', ''],
    'canvas-header-selected-bg': ['green.100', 'green.900', 'Header of a selected row/column'],
    'canvas-header-selected-text': ['green.800', 'green.200', ''],
    'canvas-grid': ['paper.200', 'ink.700', 'Grid lines'],
    'canvas-grid-strong': ['paper.300', 'ink.600', 'Header edge lines'],
    'canvas-frozen-divider': ['ink.300', 'ink.350', 'Line after frozen rows/columns'],
    'canvas-text': ['ink.900', 'paper.50', 'Cell text in the default style'],
    'canvas-text-muted': ['ink.500', 'ink.200', 'Placeholder and secondary text inside the canvas'],
    'canvas-selection': ['green.50', 'green.900', 'Solid selection fill (headers, single items)'],
    'canvas-range-fill': [
      { ref: 'green.600', alpha: 0.12 },
      { ref: 'green.300', alpha: 0.16 },
      'Selected range: translucent, so user cell fills stay visible',
    ],
    'canvas-selection-border': ['green.600', 'green.300', 'Active cell border, range edge, fill handle'],
    'canvas-focus-ring': ['green.600', 'green.300', 'Focus outline drawn on the canvas'],
    'canvas-find-match': [
      { ref: 'amber.300', alpha: 0.55 },
      { ref: 'amber.700', alpha: 0.55 },
      'Find: every match',
    ],
    'canvas-find-current': ['amber.700', 'amber.300', 'Find: outline of the current match'],
    'canvas-error-text': ['red.700', 'red.300', 'Formula error values (#DIV/0! etc.), bold'],
    'canvas-formula-text': ['green.700', 'green.300', 'Text of a cell whose value is computed'],
    'canvas-formula-mark': ['green.500', 'green.400', 'Formula corner mark (bottom-left)'],
    'canvas-edited-mark': ['amber.600', 'amber.500', 'Edited-cell change bar (inline-start edge)'],
    'canvas-comment-mark': ['blue.600', 'blue.300', 'Comment corner mark (top-right)'],
    'state-added': ['green.100', 'green.900', 'Diff: added'],
    'state-added-text': ['green.800', 'green.200', ''],
    'state-modified': ['amber.100', 'amber.900', 'Diff / unsaved edit: modified'],
    'state-modified-text': ['amber.900', 'amber.300', ''],
    'state-removed': ['red.100', 'red.900', 'Diff: removed'],
    'state-removed-text': ['red.900', 'red.300', ''],
    'state-info': ['blue.100', 'blue.900', ''],
    'state-info-text': ['blue.900', 'blue.300', ''],
    'ref-1': ['blue.600', 'blue.300', 'Formula reference 1 (solid border)'],
    'ref-2': ['violet.600', 'violet.300', 'Formula reference 2 (dashed border)'],
    'ref-3': ['amber.700', 'amber.300', 'Formula reference 3 (dotted border)'],
    'ref-4': ['teal.600', 'teal.300', 'Formula reference 4 (double border)'],
    'ref-1-fill': [{ ref: 'blue.600', alpha: 0.12 }, { ref: 'blue.300', alpha: 0.16 }, ''],
    'ref-2-fill': [{ ref: 'violet.600', alpha: 0.12 }, { ref: 'violet.300', alpha: 0.16 }, ''],
    'ref-3-fill': [{ ref: 'amber.700', alpha: 0.12 }, { ref: 'amber.300', alpha: 0.16 }, ''],
    'ref-4-fill': [{ ref: 'teal.600', alpha: 0.12 }, { ref: 'teal.300', alpha: 0.16 }, ''],
    'syntax-key': ['blue.700', 'blue.300', 'JSON/YAML keys, Markdown link targets'],
    'syntax-string': ['green.700', 'green.300', 'Strings'],
    'syntax-number': ['amber.700', 'amber.300', 'Numbers'],
    'syntax-literal': ['violet.700', 'violet.300', 'true / false / null, function names'],
    'syntax-punct': ['ink.500', 'ink.200', 'Punctuation, comments, Markdown markers'],
  },
};

// Shadows: v1 values. Light shadows are soft; dark ones must be much denser
// to read at all against ink surfaces.
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
   3. Data colours — theme-independent
   Colours a user puts *into a document* (cell text/fill, conditional
   formats) are data, not theme. They render the same in every theme, so
   they are generated here as fixed swatches: 9 hues x 7 steps in OKLCH,
   plus white and black. Steps share lightness across hues so a row of the
   picker reads as one tone.
   ------------------------------------------------------------------------- */
export const swatches = {
  steps: [
    // [step, L, chroma cap]
    [1, 0.965, 0.03],
    [2, 0.905, 0.06],
    [3, 0.8, 0.1],
    [4, 0.69, 0.13],
    [5, 0.58, 0.15],
    [6, 0.46, 0.13],
    [7, 0.33, 0.09],
  ],
  hues: {
    gray: [256, 0.012],
    red: [27, null],
    orange: [55, null],
    yellow: [95, null],
    green: [150, null],
    teal: [195, null],
    blue: [252, null],
    violet: [300, null],
    pink: [350, null],
  },
  // Defaults the app should offer for new conditional formats.
  conditional: {
    'cf-highlight-bg': 'red.100',
    'cf-highlight-text': 'red.900',
    'cf-scale-min': 'paper.0',
    'cf-scale-mid': 'amber.100',
    'cf-scale-max': 'green.300',
  },
};

/* ---------------------------------------------------------------------------
   4. Typography
   ------------------------------------------------------------------------- */
export const fonts = {
  'font-ui': [
    'BIZ UDPGothic',
    'Yu Gothic UI',
    'Hiragino Sans',
    'Noto Sans JP',
    'system-ui',
    'sans-serif',
  ],
  // Grid cells, numbers, the formula bar. Must end in sans-serif, not
  // monospace: on macOS/iOS/Android a generic monospace is a Latin-only face.
  'font-data': [
    'BIZ UDGothic',
    'MS Gothic',
    'Hiragino Sans',
    'Noto Sans CJK JP',
    'Noto Sans JP',
    'sans-serif',
  ],
  // Source editors (JSON / YAML / Markdown / text) and inline code.
  'font-code': ['BIZ UDGothic', 'Consolas', 'SFMono-Regular', 'Menlo', 'monospace'],
};

// [token, size px, line-height px, weight, role]
export const typeScale = [
  ['caption', 12, 16, 400, 'Latin/numerals only: shortcut hints, counters, units. No Japanese.'],
  ['meta', 13, 18, 400, 'Status bar, helper text, tooltips, secondary lines'],
  ['body', 14, 20, 400, 'Default UI text: menus, buttons, inputs, tabs, dialog and panel content'],
  ['title', 16, 24, 700, 'Dialog, panel and section titles'],
  ['heading', 20, 28, 700, 'Welcome screen and empty-state headings'],
  ['display', 28, 36, 700, 'Documentation and landing pages only'],
];

// On a coarse pointer the body steps up so touch UIs read at arm's length,
// and editable fields reach 16px (iOS Safari zooms on focus below that).
export const typeCoarse = { meta: [14, 20], body: [16, 24] };

export const typeMisc = {
  'leading-prose': [1.75, 'Multi-line reading text: help, Markdown preview'],
  'weight-regular': [400, ''],
  'weight-bold': [700, 'The only other weight. BIZ UD ships 400 and 700 only.'],
  'tracking-caps': ['0.04em', 'All-caps Latin labels only'],
};

/* ---------------------------------------------------------------------------
   5. Space, shape, size
   ------------------------------------------------------------------------- */
// [name, px]
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
];

export const radius = [
  ['cell', 0, 'Grid cells, headers — data is square'],
  ['xs', 2, 'Marks and chips inside a cell, fill handle'],
  ['sm', 4, 'Menu items, inline controls up to 28px, tabs'],
  ['md', 6, 'Buttons and fields (32px and up)'],
  ['lg', 8, 'Menus, popovers, cards, docked-panel sections (= sm + 4px inset)'],
  ['xl', 12, 'Dialogs, toasts, bottom sheets'],
  ['full', 999, 'Pills, status dots, switches'],
];

export const borders = [
  ['border-thin', 1, 'Default: separators, fields, cards, grid lines'],
  ['border-strong', 2, 'Active cell, selected-tab indicator, focus ring'],
  ['border-thick', 4, 'Banner stripe'],
];

export const iconSizes = [
  ['icon-sm', 16, 'Menus, bars, buttons (default)'],
  ['icon-md', 20, 'Coarse pointer, empty states'],
  ['icon-lg', 24, 'Welcome screen, large empty states'],
];

/* ---------------------------------------------------------------------------
   6. Density modes
   Density changes heights and insets only — never type size, never the grid.
   [compact, standard (default), comfortable]
   ------------------------------------------------------------------------- */
export const density = {
  modes: ['compact', 'standard', 'comfortable'],
  default: 'standard',
  tokens: {
    'bar-h': [28, 32, 40, 'Menu bar, tab row, formula bar, sheet strip'],
    'statusbar-h': [24, 24, 32, 'Status bar'],
    'control-h': [24, 28, 32, 'Inline controls in bars and menus, menu items, tabs, list rows'],
    'field-h': [28, 32, 40, 'Buttons and fields in dialogs and panels'],
    'control-px': [6, 8, 12, 'Horizontal padding of controls and menu items'],
    inset: [8, 12, 16, 'Padding inside panels, dialogs, popovers'],
    'stack-gap': [8, 12, 16, 'Vertical gap between form rows'],
  },
  // A coarse pointer forces these floors whatever the mode (WCAG 2.5.8 is
  // 24px; 44px is the platform touch convention).
  coarse: { 'bar-h': 48, 'statusbar-h': 32, 'control-h': 44, 'field-h': 44, 'control-px': 12 },
};

/* ---------------------------------------------------------------------------
   7. Grid geometry (px, multiplied by --sheet-zoom; see docs)
   ------------------------------------------------------------------------- */
export const grid = [
  ['grid-font-size', 13, 'Cell and header text at 100% zoom'],
  ['grid-row-h', 24, 'Default row height (1px line included)'],
  ['grid-col-w', 104, 'Default column width'],
  ['grid-header-h', 24, 'Column-header row'],
  ['grid-rowhead-min-w', 40, 'Row-number column minimum width'],
  ['grid-cell-px', 6, 'Horizontal cell padding'],
  ['grid-fill-handle', 8, 'Fill handle square'],
  ['grid-mark', 6, 'Edited / comment corner mark'],
];

/* ---------------------------------------------------------------------------
   8. Motion and layers
   ------------------------------------------------------------------------- */
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

export const layers = [
  ['z-base', 0, 'Document flow'],
  ['z-raised', 10, 'Sticky headers inside one scroll area'],
  ['z-panel', 100, 'Docked side panels, floating non-modal dialogs'],
  ['z-popover', 120, 'Autocomplete, pickers, filter popovers'],
  ['z-menu', 150, 'Menu-bar drop-downs and context menus'],
  ['z-submenu', 160, 'Submenus'],
  ['z-modal', 200, 'Modal dialog and its scrim'],
  ['z-overlay', 250, 'Blocking overlays: file drop, loading'],
  ['z-toast', 300, 'Toasts'],
  ['z-tooltip', 400, 'Tooltips'],
];

export const breakpoints = [
  ['bp-sm', 30, '480px — smallest phone layout'],
  ['bp-md', 48, '768px — below this: mobile layout'],
  ['bp-lg', 64, '1024px — desktop'],
  ['bp-xl', 90, '1440px — wide'],
];

/* ---------------------------------------------------------------------------
   9. Contrast audit — [fg, bg, minimum, label]. `bg` may be 'a over b' to
   composite a translucent token over another. Built for every theme; the
   build fails if any pair falls under its minimum.
   ------------------------------------------------------------------------- */
export const contrastPairs = [
  // text 4.5:1
  ['chrome-text', 'chrome-bg', 4.5, 'Body text on app background'],
  ['chrome-text', 'chrome-raised', 4.5, 'Body text in menus and dialogs'],
  ['chrome-text', 'chrome-hover', 4.5, 'Text on a hovered item'],
  ['chrome-text', 'chrome-pressed', 4.5, 'Text on a pressed item'],
  ['chrome-text-muted', 'chrome-bg', 4.5, 'Secondary text on app background'],
  ['chrome-text-muted', 'chrome-surface', 4.5, 'Secondary text on bars'],
  ['chrome-text-muted', 'chrome-raised', 4.5, 'Secondary text in menus'],
  ['chrome-text-muted', 'chrome-hover', 4.5, 'Shortcut hint on a hovered menu item'],
  ['chrome-text-subtle', 'chrome-surface', 4.5, 'Placeholder in a field'],
  ['chrome-text-subtle', 'chrome-raised', 4.5, 'Placeholder in a dialog field'],
  ['accent-contrast', 'accent', 4.5, 'Primary button label'],
  ['accent-contrast', 'accent-hover', 4.5, 'Primary button label, hovered'],
  ['accent-text', 'chrome-bg', 4.5, 'Accent text'],
  ['accent-text', 'chrome-raised', 4.5, 'Accent text in menus'],
  ['accent-subtle-text', 'accent-subtle', 4.5, 'Selected item text'],
  ['danger-contrast', 'danger', 4.5, 'Destructive button label'],
  ['danger-text', 'chrome-bg', 4.5, 'Error message'],
  ['danger-text', 'chrome-raised', 4.5, 'Error message in a dialog'],
  ['warning-text', 'chrome-bg', 4.5, 'Warning message'],
  ['warning-text', 'warning-subtle', 4.5, 'Warning banner text'],
  ['danger-text', 'danger-subtle', 4.5, 'Error banner text'],
  ['info-text', 'info-subtle', 4.5, 'Information banner text'],
  ['chrome-text', 'warning-subtle', 4.5, 'Body text in a warning banner'],
  ['info-text', 'chrome-bg', 4.5, 'Information message'],
  ['link', 'chrome-bg', 4.5, 'Link'],
  ['link-visited', 'chrome-bg', 4.5, 'Visited link'],
  ['inverse-text', 'inverse-bg', 4.5, 'Tooltip / toast text'],
  ['inverse-text-muted', 'inverse-bg', 4.5, 'Tooltip shortcut hint'],
  ['canvas-text', 'canvas-bg', 4.5, 'Cell text'],
  ['canvas-text', 'canvas-row-alt', 4.5, 'Cell text on a banded row'],
  ['canvas-text', 'canvas-range-fill over canvas-bg', 4.5, 'Cell text inside a selection'],
  ['canvas-text', 'canvas-find-match over canvas-bg', 4.5, 'Cell text in a find match'],
  ['canvas-text-muted', 'canvas-bg', 4.5, 'Muted text in the canvas'],
  ['canvas-header-text', 'canvas-header-bg', 4.5, 'Row/column header label'],
  ['canvas-header-selected-text', 'canvas-header-selected-bg', 4.5, 'Selected header label'],
  ['canvas-error-text', 'canvas-bg', 4.5, 'Formula error value'],
  ['canvas-formula-text', 'canvas-bg', 4.5, 'Computed value'],
  ['canvas-formula-text', 'canvas-range-fill over canvas-bg', 4.5, 'Computed value inside a selection'],
  ['canvas-text', 'state-modified', 4.5, 'Default text on an edited cell'],
  ['state-added-text', 'state-added', 4.5, 'Added cell'],
  ['state-modified-text', 'state-modified', 4.5, 'Modified cell'],
  ['state-removed-text', 'state-removed', 4.5, 'Removed cell'],
  ['state-info-text', 'state-info', 4.5, 'Info cell'],
  ['syntax-key', 'canvas-bg', 4.5, 'Syntax: key'],
  ['syntax-string', 'canvas-bg', 4.5, 'Syntax: string'],
  ['syntax-number', 'canvas-bg', 4.5, 'Syntax: number'],
  ['syntax-literal', 'canvas-bg', 4.5, 'Syntax: literal'],
  ['syntax-punct', 'canvas-bg', 4.5, 'Syntax: punctuation'],
  // UI graphics 3:1
  ['border-control', 'chrome-bg', 3, 'Field outline'],
  ['border-control', 'chrome-surface', 3, 'Field outline on a bar'],
  ['border-control', 'chrome-raised', 3, 'Field outline in a dialog'],
  ['accent', 'chrome-bg', 3, 'Accent fill / indicator'],
  ['accent', 'chrome-surface', 3, 'Selected-tab indicator on a bar'],
  ['focus-ring', 'chrome-surface', 3, 'Focus ring on a bar'],
  ['focus-ring', 'chrome-raised', 3, 'Focus ring in a dialog'],
  ['danger', 'chrome-bg', 3, 'Error icon'],
  ['warning', 'chrome-bg', 3, 'Warning icon'],
  ['info', 'chrome-bg', 3, 'Info icon'],
  ['canvas-selection-border', 'canvas-bg', 3, 'Active cell border'],
  ['canvas-focus-ring', 'canvas-bg', 3, 'Focus ring on the canvas'],
  ['canvas-find-current', 'canvas-bg', 3, 'Current find match outline'],
  ['canvas-edited-mark', 'canvas-bg', 3, 'Edited-cell mark'],
  ['canvas-comment-mark', 'canvas-bg', 3, 'Comment mark'],
  ['canvas-formula-mark', 'canvas-bg', 3, 'Formula mark'],
  ['canvas-edited-mark', 'state-modified', 3, 'Change bar on its own edited-cell fill'],
  ['canvas-frozen-divider', 'canvas-bg', 3, 'Frozen-pane divider'],
  ['ref-1', 'canvas-bg', 3, 'Formula reference 1'],
  ['ref-2', 'canvas-bg', 3, 'Formula reference 2'],
  ['ref-3', 'canvas-bg', 3, 'Formula reference 3'],
  ['ref-4', 'canvas-bg', 3, 'Formula reference 4'],
];
