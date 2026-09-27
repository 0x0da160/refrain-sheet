// SPDX-License-Identifier: MIT
/**
 * The pickers for one level of File > Settings…'s layered display settings
 * (this browser, or the RSF file): zoom, wrap, font, and the grid look. Each
 * picker's first option is "not specified", labelled with the value that then
 * applies, so the choice is never a mystery: for this browser, the default
 * (or, for zoom and wrap, the value last used); for the file, this browser's.
 */
import { t } from '../../app/i18n';
import { getSheetZoom, getWrapCells, SHEET_ZOOM_LEVELS, type DisplayLevelSettings } from '../../app/settings';
import { DEFAULT_SHEET_FONT, isSheetFontId, SHEET_FONTS, sheetFontLabelKey } from '../../app/sheet-font';
import {
  BAND_LEVELS,
  DEFAULT_GRID_LOOK,
  isBandLevel,
  type GridLook,
  type GridLookLayer,
} from '../../core/grid-look';
import { el } from '../dom';

/** Option values and labels of each grid-look picker; `''` (not specified) comes first. */
const LOOK_OPTIONS: Array<{
  key: keyof GridLook;
  labelKey: string;
  options: Array<[string, string]>;
}> = [
  {
    key: 'bands',
    labelKey: 'dialog.settings.bands',
    options: [
      ['on', 'dialog.settings.show'],
      ['off', 'dialog.settings.hide'],
    ],
  },
  {
    key: 'bandLevel',
    labelKey: 'dialog.settings.bandLevel',
    options: BAND_LEVELS.map((level) => [String(level), `dialog.settings.bandLevel.${level}`]),
  },
  {
    key: 'gridlines',
    labelKey: 'dialog.settings.gridlines',
    options: [
      ['on', 'dialog.settings.show'],
      ['off', 'dialog.settings.hide'],
    ],
  },
  {
    key: 'rowHighlight',
    labelKey: 'dialog.settings.rowHighlight',
    options: [
      ['on', 'dialog.settings.highlightOn'],
      ['off', 'dialog.settings.highlightOff'],
    ],
  },
  {
    key: 'colHighlight',
    labelKey: 'dialog.settings.colHighlight',
    options: [
      ['on', 'dialog.settings.highlightOn'],
      ['off', 'dialog.settings.highlightOff'],
    ],
  },
];

/** The pickers of one level, keyed `zoom`, `wrap`, `font`, or a grid-look key. */
export interface LevelFields {
  rows: HTMLElement[];
  selects: Map<string, HTMLSelectElement>;
  read: () => DisplayLevelSettings;
}

const onOff = (value: boolean | undefined): string => (value === undefined ? '' : value ? 'on' : 'off');

function picker(
  id: string,
  label: string,
  options: Array<[string, string]>,
  value: string,
): { row: HTMLElement; select: HTMLSelectElement } {
  const select = el('select', { attrs: { id } }) as HTMLSelectElement;
  select.append(el('option', { attrs: { value: '' } }));
  for (const [optionValue, text] of options) {
    select.append(el('option', { text, attrs: { value: optionValue } }));
  }
  select.value = value;
  const row = el('div', { className: 'form-row' }, [
    el('label', { text: label, attrs: { for: id } }),
    select,
  ]);
  return { row, select };
}

/** Build one level's pickers. Call {@link labelUnset} afterwards to name what "not specified" means. */
export function displayLevelFields(idPrefix: string, current: DisplayLevelSettings): LevelFields {
  const levels: number[] = [...SHEET_ZOOM_LEVELS];
  if (current.zoom !== undefined && !levels.includes(current.zoom)) {
    levels.push(current.zoom);
    levels.sort((a, b) => a - b);
  }
  const specs: Array<[string, string, Array<[string, string]>, string]> = [
    [
      'zoom',
      t('dialog.settings.zoom'),
      levels.map((level) => [String(level), `${level}%`]),
      current.zoom === undefined ? '' : String(current.zoom),
    ],
    [
      'wrap',
      t('dialog.settings.wrap'),
      [
        ['on', t('dialog.settings.wrapOn')],
        ['off', t('dialog.settings.wrapOff')],
      ],
      onOff(current.wrap),
    ],
    [
      'font',
      t('dialog.settings.font'),
      SHEET_FONTS.map((font) => [font, t(sheetFontLabelKey(font))]),
      current.font ?? '',
    ],
    ...LOOK_OPTIONS.map(({ key, labelKey, options }): [string, string, Array<[string, string]>, string] => {
      const value = current.look[key];
      return [
        key,
        t(labelKey),
        options.map(([optionValue, textKey]) => [optionValue, t(textKey)]),
        typeof value === 'boolean' ? onOff(value) : value === undefined ? '' : String(value),
      ];
    }),
  ];
  const rows: HTMLElement[] = [];
  const selects = new Map<string, HTMLSelectElement>();
  for (const [key, label, options, value] of specs) {
    const { row, select } = picker(`${idPrefix}-${key}`, label, options, value);
    rows.push(row);
    selects.set(key, select);
  }
  const value = (key: string): string => selects.get(key)!.value;
  return {
    rows,
    selects,
    read: () => {
      const look: GridLookLayer = {};
      for (const { key } of LOOK_OPTIONS) {
        if (value(key) === '') continue;
        if (key === 'bandLevel') {
          const level = Number(value(key));
          if (isBandLevel(level)) look.bandLevel = level;
        } else {
          look[key] = value(key) === 'on';
        }
      }
      const font = value('font');
      return {
        zoom: value('zoom') === '' ? undefined : Number(value('zoom')),
        wrap: value('wrap') === '' ? undefined : value('wrap') === 'on',
        font: isSheetFontId(font) ? font : undefined,
        look,
      };
    },
  };
}

/** What applies in this browser when its own level specifies nothing, as an option value. */
export function browserFallback(key: string): string {
  if (key === 'zoom') return String(getSheetZoom());
  if (key === 'wrap') return onOff(getWrapCells());
  if (key === 'font') return DEFAULT_SHEET_FONT;
  const value = DEFAULT_GRID_LOOK[key as keyof GridLook];
  return typeof value === 'boolean' ? onOff(value) : String(value);
}

/** The text an option value shows in `select` (a zoom that is not a preset reads `N%`). */
function optionText(select: HTMLSelectElement, value: string): string {
  const option = [...select.options].find((o) => o.value === value && value !== '');
  return option?.textContent ?? `${value}%`;
}

/**
 * Label each picker's "not specified" option with the value that then
 * applies: `inherited(key)` gives it as an option value, and `templateKey(key)`
 * the message that wraps it (`{value}`).
 */
export function labelUnset(
  fields: LevelFields,
  inherited: (key: string) => string,
  templateKey: (key: string) => string,
): void {
  for (const [key, select] of fields.selects) {
    select.options[0].textContent = t(templateKey(key), { value: optionText(select, inherited(key)) });
  }
}
