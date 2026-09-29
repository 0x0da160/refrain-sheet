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
import { FONT_SIZES } from '../core/workbook/text-font';
import { el } from './dom';

/** The fonts always offered: the sheet fonts plus common Latin ones. */
const PRESET_FONTS: ReadonlyArray<{ family: string; labelKey?: string; css?: string }> = [
  { family: 'BIZ UDGothic', labelKey: 'font.biz-ud', css: 'var(--sheet-font-biz-ud)' },
  { family: 'MS Gothic', labelKey: 'font.ms', css: 'var(--sheet-font-ms)' },
  { family: 'MS UI Gothic', labelKey: 'font.ms-ui', css: 'var(--sheet-font-ms-ui)' },
  { family: 'Noto Sans JP', labelKey: 'font.noto-sans-jp' },
  { family: 'Meiryo UI', labelKey: 'font.meiryo-ui', css: 'var(--sheet-font-meiryo-ui)' },
  { family: 'Yu Gothic UI', labelKey: 'font.yu-gothic-ui', css: 'var(--sheet-font-yu-gothic-ui)' },
  { family: 'Arial' },
  { family: 'Times New Roman' },
  { family: 'Courier New' },
];

/** The CSS `font-family` for a stored family name: the font, then the sheet font. */
export function fontFamilyCss(family: string): string {
  const preset = PRESET_FONTS.find((font) => font.family === family)?.css;
  return preset ? `${preset}, var(--font-sheet)` : `"${family}", var(--font-sheet)`;
}

/** The CSS `font-size` for a size in points, following the sheet's zoom. */
export function fontSizeCss(points: number): string {
  return `calc(${points}pt * var(--sheet-zoom, 1))`;
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
    const options = [option('', defaultLabel)];
    for (const font of PRESET_FONTS) {
      families.add(font.family);
      options.push(option(font.family, font.labelKey ? t(font.labelKey) : font.family));
    }
    for (const family of localFamilies ?? []) {
      if (!families.has(family)) {
        families.add(family);
        options.push(option(family, family));
      }
    }
    if (selected !== '' && !families.has(selected)) {
      options.push(option(selected, selected));
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

/** A `<select>` of font sizes in points; the first option (`''`) is the grid's size. */
export function fontSizeSelect(
  current: number | null,
  onChange: (size: number | null) => void,
  attrs: Record<string, string> = {},
  defaultLabel = t('font.sizeDefault'),
): HTMLSelectElement {
  const select = el('select', { attrs }) as HTMLSelectElement;
  const sizes = [...FONT_SIZES];
  if (current !== null && !sizes.includes(current)) {
    sizes.push(current);
    sizes.sort((a, b) => a - b);
  }
  select.append(
    el('option', { text: defaultLabel, attrs: { value: '' } }),
    ...sizes.map((size) => el('option', { text: String(size), attrs: { value: String(size) } })),
  );
  select.value = current === null ? '' : String(current);
  select.addEventListener('change', () => onChange(select.value === '' ? null : Number(select.value)));
  return select;
}
