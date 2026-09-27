// SPDX-License-Identifier: MIT
import { t } from '../../app/i18n';
import { BAND_LEVELS, isBandLevel, type GridLook, type GridLookLayer } from '../../core/grid-look';
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

/**
 * The grid-look pickers (bands, band strength, gridlines, row/column
 * highlight) for one level of File > Settings…. An empty value means "not
 * specified"; `read` returns the level's values as currently picked.
 */
export function lookFields(
  idPrefix: string,
  current: GridLookLayer,
  unsetKey: string,
): { rows: HTMLElement[]; read: () => GridLookLayer } {
  const selects = new Map<keyof GridLook, HTMLSelectElement>();
  const rows = LOOK_OPTIONS.map(({ key, labelKey, options }) => {
    const id = `${idPrefix}-${key}`;
    const select = el('select', { attrs: { id } }) as HTMLSelectElement;
    select.append(el('option', { text: t(unsetKey), attrs: { value: '' } }));
    for (const [value, textKey] of options) {
      select.append(el('option', { text: t(textKey), attrs: { value } }));
    }
    const value = current[key];
    select.value =
      value === undefined ? '' : typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
    selects.set(key, select);
    return el('div', { className: 'form-row' }, [
      el('label', { text: t(labelKey), attrs: { for: id } }),
      select,
    ]);
  });
  return {
    rows,
    read: () => {
      const look: GridLookLayer = {};
      for (const [key, select] of selects) {
        if (select.value === '') continue;
        if (key === 'bandLevel') {
          const level = Number(select.value);
          if (isBandLevel(level)) look.bandLevel = level;
        } else {
          look[key] = select.value === 'on';
        }
      }
      return look;
    },
  };
}
