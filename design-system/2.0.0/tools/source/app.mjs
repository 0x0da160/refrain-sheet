// SPDX-License-Identifier: MIT
//
// App layer — tokens only the Refrain Sheet application uses, on top of
// foundations.mjs: the canvas (grid and source editors), the hybrid theme,
// document colours, the app type scale, density, grid geometry and layers.

/* ---------------------------------------------------------------------------
   Canvas colours: [light, dark, description]. The hybrid theme is the
   foundations dark theme for everything else plus these canvas tokens in
   light — the shell goes dark, the document stays on paper.
   ------------------------------------------------------------------------- */
export const canvas = {
  'canvas-bg': ['paper.0', 'ink.950', 'Cell background; also source-editor background'],
  'canvas-row-alt': ['paper.50', 'ink.900', 'Optional banded rows (off by default)'],
  'canvas-header-bg': ['paper.50', 'ink.900', 'Row and column headers'],
  'canvas-header-text': ['ink.500', 'ink.150', ''],
  'canvas-header-selected-bg': ['green.100', 'green.900', 'Header of a selected row/column'],
  'canvas-header-selected-text': ['green.800', 'green.200', ''],
  'canvas-grid': ['paper.200', 'ink.700', 'Grid lines'],
  'canvas-grid-strong': ['paper.300', 'ink.600', 'Header edge lines'],
  'canvas-frozen-divider': ['ink.300', 'ink.350', 'Line after frozen rows/columns'],
  'canvas-text': ['ink.900', 'paper.50', 'Cell text in the default style'],
  'canvas-text-muted': ['ink.500', 'ink.150', 'Placeholder and secondary text inside the canvas'],
  'canvas-selection': ['green.50', 'green.900', 'Solid selection fill (single items)'],
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
  'syntax-punct': ['ink.500', 'ink.150', 'Punctuation, comments, Markdown markers'],
};

/* ---------------------------------------------------------------------------
   Document colours — theme-independent. Colours a user puts into a document
   are data: 9 hues x 7 steps in OKLCH (steps share lightness), plus white
   and black, and the defaults for new conditional formats.
   ------------------------------------------------------------------------- */
export const swatches = {
  steps: [
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
  conditional: {
    'cf-highlight-bg': 'red.100',
    'cf-highlight-text': 'red.900',
    'cf-scale-min': 'paper.0',
    'cf-scale-mid': 'amber.100',
    'cf-scale-max': 'green.300',
  },
};

/* ---------------------------------------------------------------------------
   App type scale: [name, px, line-height px, weight, role]. 12px is the
   floor for every script (foundations --text-min); cells stay at the
   app's established 12px x zoom (see grid below).
   ------------------------------------------------------------------------- */
export const typeScale = [
  ['caption', 12, 16, 400, 'Status bar, helper text, tooltips, shortcut hints, counters'],
  ['body', 14, 20, 400, 'Default UI text: menus, buttons, inputs, tabs, dialog and panel content'],
  ['title', 16, 24, 700, 'Dialog, panel and section titles'],
  ['heading', 20, 28, 700, 'Welcome screen and empty-state headings'],
];
// Coarse pointer: text steps up for arm's-length reading, and fields reach
// 16px (iOS Safari zooms on focus below that).
export const typeCoarse = { caption: [14, 20], body: [16, 24] };

/* ---------------------------------------------------------------------------
   Density: [compact, standard (default), comfortable, description].
   Heights and insets only — never type size, never the grid.
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
  coarse: { 'bar-h': 48, 'statusbar-h': 32, 'control-h': 44, 'field-h': 44, 'control-px': 12 },
};

/* ---------------------------------------------------------------------------
   Grid geometry: px multiplied by --sheet-zoom. These are the app's
   established defaults; changing them changes saved layouts' fit.
   ------------------------------------------------------------------------- */
export const grid = [
  ['grid-font-size', 12, 'Cell and header text at 100% zoom'],
  ['grid-row-h', 24, 'Default row height (1px line included)'],
  ['grid-col-w', 104, 'Default column width'],
  ['grid-header-h', 24, 'Column-header row'],
  ['grid-rowhead-min-w', 40, 'Row-number column minimum width'],
  ['grid-cell-px', 6, 'Horizontal cell padding'],
  ['grid-fill-handle', 8, 'Fill handle square'],
  ['grid-mark', 6, 'Comment corner mark'],
];

export const radiusApp = [['cell', 0, 'Grid cells and headers — data is square']];

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

// Canvas pairs, checked in light, dark and hybrid.
export const contrastPairs = [
  ['canvas-text', 'canvas-bg', 4.5, 'Cell text'],
  ['canvas-text', 'canvas-row-alt', 4.5, 'Cell text on a banded row'],
  ['canvas-text', 'canvas-range-fill over canvas-bg', 4.5, 'Cell text inside a selection'],
  ['canvas-text', 'canvas-find-match over canvas-bg', 4.5, 'Cell text in a find match'],
  ['canvas-text', 'state-modified', 4.5, 'Default text on an edited cell'],
  ['canvas-text-muted', 'canvas-bg', 4.5, 'Muted text in the canvas'],
  ['canvas-header-text', 'canvas-header-bg', 4.5, 'Row/column header label'],
  ['canvas-header-selected-text', 'canvas-header-selected-bg', 4.5, 'Selected header label'],
  ['canvas-error-text', 'canvas-bg', 4.5, 'Formula error value'],
  ['canvas-formula-text', 'canvas-bg', 4.5, 'Computed value'],
  ['canvas-formula-text', 'canvas-range-fill over canvas-bg', 4.5, 'Computed value inside a selection'],
  ['state-added-text', 'state-added', 4.5, 'Added cell'],
  ['state-modified-text', 'state-modified', 4.5, 'Modified cell'],
  ['state-removed-text', 'state-removed', 4.5, 'Removed cell'],
  ['state-info-text', 'state-info', 4.5, 'Info cell'],
  ['syntax-key', 'canvas-bg', 4.5, 'Syntax: key'],
  ['syntax-string', 'canvas-bg', 4.5, 'Syntax: string'],
  ['syntax-number', 'canvas-bg', 4.5, 'Syntax: number'],
  ['syntax-literal', 'canvas-bg', 4.5, 'Syntax: literal'],
  ['syntax-punct', 'canvas-bg', 4.5, 'Syntax: punctuation'],
  ['canvas-selection-border', 'canvas-bg', 3, 'Active cell border'],
  ['canvas-focus-ring', 'canvas-bg', 3, 'Focus ring on the canvas'],
  ['canvas-find-current', 'canvas-bg', 3, 'Current find match outline'],
  ['canvas-edited-mark', 'canvas-bg', 3, 'Edited-cell change bar'],
  ['canvas-edited-mark', 'state-modified', 3, 'Change bar on its own edited-cell fill'],
  ['canvas-comment-mark', 'canvas-bg', 3, 'Comment mark'],
  ['canvas-formula-mark', 'canvas-bg', 3, 'Formula mark'],
  ['canvas-frozen-divider', 'canvas-bg', 3, 'Frozen-pane divider'],
  ['ref-1', 'canvas-bg', 3, 'Formula reference 1'],
  ['ref-2', 'canvas-bg', 3, 'Formula reference 2'],
  ['ref-3', 'canvas-bg', 3, 'Formula reference 3'],
  ['ref-4', 'canvas-bg', 3, 'Formula reference 4'],
];
