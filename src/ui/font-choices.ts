// SPDX-License-Identifier: MIT
/**
 * The font and size pickers a cell's own font is chosen with (Format >
 * Font…, and the toolbar over selected text in the cell editor). Fonts come
 * from a fixed list of common ones and, where the browser offers it and the
 * user allows it, the fonts installed on this device (`queryLocalFonts`);
 * nothing is typed in by hand. A font this device lacks still shows under
 * its own name and is kept in the file; only its display falls back to the
 * sheet font.
 */
import { t } from '../app/i18n';
import { el } from './dom';

/** The fonts always offered: the sheet fonts plus common Latin ones. */
const PRESET_FONTS: ReadonlyArray<{ family: string; mono: boolean; labelKey?: string; css?: string }> = [
  { family: 'BIZ UDGothic', mono: true, labelKey: 'font.biz-ud', css: 'var(--sheet-font-biz-ud)' },
  { family: 'MS Gothic', mono: true, labelKey: 'font.ms', css: 'var(--sheet-font-ms)' },
  { family: 'Courier New', mono: true },
  { family: 'MS UI Gothic', mono: false, labelKey: 'font.ms-ui', css: 'var(--sheet-font-ms-ui)' },
  { family: 'Noto Sans JP', mono: false, labelKey: 'font.noto-sans-jp' },
  { family: 'Meiryo UI', mono: false, labelKey: 'font.meiryo-ui', css: 'var(--sheet-font-meiryo-ui)' },
  {
    family: 'Yu Gothic UI',
    mono: false,
    labelKey: 'font.yu-gothic-ui',
    css: 'var(--sheet-font-yu-gothic-ui)',
  },
  { family: 'Arial', mono: false },
  { family: 'Times New Roman', mono: false },
];

/** The CSS `font-family` for a stored family name: the font, then the sheet font. */
export function fontFamilyCss(family: string): string {
  const preset = PRESET_FONTS.find((font) => font.family === family)?.css;
  return preset ? `${preset}, var(--font-sheet)` : `"${family}", var(--font-sheet)`;
}

/** Pixels per point (CSS: 1pt = 4/3 px). Sizes are shown and drawn in px; the file keeps points. */
const PX_PER_PT = 4 / 3;

/** A size in points as px, to one decimal (a whole number for every size the menus offer). */
function pointsToPx(points: number): number {
  return Math.round(points * PX_PER_PT * 10) / 10;
}

/**
 * The sizes offered, in px. Each is a whole or half point (what the file
 * stores, `normalizeFontSize`), so a size chosen here is kept exactly.
 */
const FONT_SIZES_PX: readonly number[] = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96];

/** The CSS `font-size` for a size in points, in px, following the sheet's zoom. */
export function fontSizeCss(points: number): string {
  return `calc(${pointsToPx(points)}px * var(--sheet-zoom, 1))`;
}

/**
 * Give `node` a format's own font and size, or (where the format sets none)
 * clear them so it inherits its parent's. Safe on a reused element.
 */
export function paintFont(
  node: HTMLElement,
  format: { fontFamily?: string; fontSize?: number } | null,
): void {
  node.style.fontFamily = format?.fontFamily ? fontFamilyCss(format.fontFamily) : '';
  node.style.fontSize = format?.fontSize ? fontSizeCss(format.fontSize) : '';
}

/** Families found on this device, once the user has asked for them (kept for this page only). */
let localFamilies: string[] | null = null;

interface LocalFontAccess {
  queryLocalFonts?: () => Promise<Array<{ family: string }>>;
}

function canQueryLocalFonts(): boolean {
  return typeof (globalThis as LocalFontAccess).queryLocalFonts === 'function';
}

async function loadLocalFamilies(): Promise<void> {
  try {
    const fonts = (await (globalThis as LocalFontAccess).queryLocalFonts?.()) ?? [];
    const families = new Set(fonts.map((font) => font.family).filter((family) => family.trim() !== ''));
    localFamilies = [...families].sort((a, b) => a.localeCompare(b));
  } catch {
    // Refused or unavailable: the fixed list stays.
    localFamilies = [];
  }
}

const LOAD_LOCAL = '\u0000local';

/**
 * A `<select>` of fonts; the first option (`''`) is the sheet font. Calls
 * `onChange` with the chosen family, or null for the sheet font.
 */
export function fontFamilySelect(
  current: string | null,
  onChange: (family: string | null) => void,
  attrs: Record<string, string> = {},
  defaultLabel = t('font.sheetDefault'),
): HTMLSelectElement {
  const select = el('select', { attrs }) as HTMLSelectElement;
  let selected = current ?? '';
  const fill = (): void => {
    const option = (value: string, label: string): HTMLOptionElement =>
      el('option', { text: label, attrs: { value } }) as HTMLOptionElement;
    const families = new Set<string>();
    const group = (labelKey: string, mono: boolean): HTMLElement =>
      el(
        'optgroup',
        { attrs: { label: t(labelKey) } },
        PRESET_FONTS.filter((font) => font.mono === mono).map((font) => {
          families.add(font.family);
          return option(font.family, font.labelKey ? t(font.labelKey) : font.family);
        }),
      );
    // The fixed list is grouped so it is clear which fonts line characters up.
    const options: HTMLElement[] = [
      option('', defaultLabel),
      group('font.group.monospace', true),
      group('font.group.proportional', false),
    ];
    const others: HTMLOptionElement[] = [];
    for (const family of localFamilies ?? []) {
      if (!families.has(family)) {
        families.add(family);
        others.push(option(family, family));
      }
    }
    if (selected !== '' && !families.has(selected)) {
      others.push(option(selected, selected));
    }
    if (others.length > 0) {
      options.push(el('optgroup', { attrs: { label: t('font.group.other') } }, others));
    }
    if (localFamilies === null && canQueryLocalFonts()) {
      options.push(option(LOAD_LOCAL, t('font.loadLocal')));
    }
    select.replaceChildren(...options);
    select.value = selected;
  };
  fill();
  select.addEventListener('change', () => {
    if (select.value === LOAD_LOCAL) {
      select.value = selected;
      void loadLocalFamilies().then(fill);
      return;
    }
    selected = select.value;
    onChange(selected === '' ? null : selected);
  });
  return select;
}

/**
 * A `<select>` of font sizes shown in px; `current` and `onChange` speak
 * points, as stored (`wholeOnly`: whole points only). The first option
 * (`''`) is the grid's size. A stored size the list lacks (e.g. 11 pt from
 * an older file) is shown at its px value.
 */
export function fontSizeSelect(
  current: number | null,
  onChange: (size: number | null) => void,
  attrs: Record<string, string> = {},
  defaultLabel = t('font.sizeDefault'),
  wholeOnly = false,
): HTMLSelectElement {
  const select = el('select', { attrs }) as HTMLSelectElement;
  // A shape's text takes whole points only (see `wholePixels`).
  const sizes = FONT_SIZES_PX.map((px) => (px * 3) / 4).filter((pt) => !wholeOnly || Number.isInteger(pt));
  if (current !== null && !sizes.includes(current)) {
    sizes.push(current);
    sizes.sort((a, b) => a - b);
  }
  select.append(
    el('option', { text: defaultLabel, attrs: { value: '' } }),
    ...sizes.map((size) => el('option', { text: String(pointsToPx(size)), attrs: { value: String(size) } })),
  );
  select.value = current === null ? '' : String(current);
  select.addEventListener('change', () => onChange(select.value === '' ? null : Number(select.value)));
  return select;
}
