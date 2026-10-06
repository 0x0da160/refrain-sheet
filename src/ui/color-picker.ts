// SPDX-License-Identifier: MIT
/**
 * The one color picker every color choice in the app uses: cell text and
 * fill, borders, sheet tabs, shapes, charts, conditional formats and rich
 * text. From the top:
 *
 * - "No color", when the choice can be removed;
 * - the colors chosen recently and the favorites (kept in this browser, see
 *   `app/color-prefs.ts`);
 * - the colors already used in this file, to keep a file consistent;
 * - the design system's palette (nine hues in seven steps, white and black);
 * - "More colors": a `#rrggbb` code or a CSS color name, the browser's own
 *   free color chooser, and a star to keep the current color as a favorite.
 *
 * Picking a color calls `onPick` at once; there is no separate Apply.
 * Arrow keys move between swatches.
 */
import { Star } from 'lucide';
import { getFavoriteColors, getRecentColors, rememberColor, toggleFavoriteColor } from '../app/color-prefs';
import { t } from '../app/i18n';
import { normalizeHexColor } from '../core/workbook/cell-style';
import { openAnchoredPopover } from './anchored-popover';
import { CSS_NAMED_COLORS } from './css-named-colors';
import { SWATCH_COLORS } from './document-colors';
import { el } from './dom';
import { createIcon } from './icon';

/** Swatches per row in every section, the palette's nine hues. */
const COLUMNS = 9;

const NAMED_LIST_ID = 'css-named-colors';

let documentColors: () => readonly string[] = () => [];

/** Tell the picker where to find the colors used in the open file (wired by the shell). */
export function setDocumentColorSource(source: () => readonly string[]): void {
  documentColors = source;
}

export interface ColorPickerOptions {
  /** The color shown as chosen, or null for none (or a mixed selection). */
  readonly current: string | null;
  /** Offer "No color" (removing the color) with this label. */
  readonly noneLabel?: string;
  /** Called with the chosen `#rrggbb`, or null for "No color". */
  readonly onPick: (color: string | null) => void;
}

/** Turn a `#rgb`/`#rrggbb` code or a CSS color name into `#rrggbb`, or null. */
export function parseColorInput(text: string): string | null {
  const value = text.trim().toLowerCase();
  const named = CSS_NAMED_COLORS.find(([name]) => name === value);
  if (named) {
    return named[1];
  }
  const hex = value.startsWith('#') ? value : `#${value}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${[...hex.slice(1)].map((d) => d + d).join('')}`;
  }
  return normalizeHexColor(hex);
}

/** The CSS name of `hex`, if it has one. */
function colorName(hex: string): string | undefined {
  return CSS_NAMED_COLORS.find(([, value]) => value === hex)?.[0];
}

const HUES = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const;

/** A palette color's name ("Blue 5", "White"), if it is one. */
function paletteName(color: string): string | undefined {
  const index = SWATCH_COLORS.indexOf(color);
  if (index < 0) {
    return undefined;
  }
  if (index >= HUES.length * 7) {
    return t(index === HUES.length * 7 ? 'colorPicker.white' : 'colorPicker.black');
  }
  return `${t(`colorPicker.hue.${HUES[Math.floor(index / 7)]}`)} ${(index % 7) + 1}`;
}

function swatch(color: string, current: string | null, pick: (color: string) => void): HTMLButtonElement {
  const name = paletteName(color) ?? colorName(color);
  const label = name ? `${name} (${color})` : color;
  const button = el('button', {
    className: 'color-swatch',
    attrs: {
      type: 'button',
      'aria-label': label,
      'data-tooltip': label,
      'data-color': color,
      'aria-pressed': color === current ? 'true' : 'false',
    },
  }) as HTMLButtonElement;
  button.style.backgroundColor = color;
  button.addEventListener('click', () => pick(color));
  return button;
}

function section(
  title: string,
  colors: readonly string[],
  current: string | null,
  pick: (c: string) => void,
) {
  return el('div', { className: 'color-picker-section' }, [
    el('div', { className: 'color-picker-heading', text: title }),
    el(
      'div',
      { className: 'color-picker-swatches', attrs: { role: 'group', 'aria-label': title } },
      colors.map((color) => swatch(color, current, pick)),
    ),
  ]);
}

/** The palette laid out with one hue per column, light to dark down the rows. */
function paletteOrder(): string[] {
  const out: string[] = [];
  for (let step = 0; step < 7; step++) {
    for (let hue = 0; hue < COLUMNS; hue++) {
      out.push(SWATCH_COLORS[hue * 7 + step]);
    }
  }
  return [...out, ...SWATCH_COLORS.slice(COLUMNS * 7)];
}

function ensureNamedList(): string {
  if (!document.getElementById(NAMED_LIST_ID)) {
    document.body.append(
      el(
        'datalist',
        { attrs: { id: NAMED_LIST_ID } },
        CSS_NAMED_COLORS.map(([name]) => el('option', { attrs: { value: name } })),
      ),
    );
  }
  return NAMED_LIST_ID;
}

/** Arrow keys move focus between the swatches, row by row. */
function wireArrowKeys(root: HTMLElement): void {
  root.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('color-swatch')) {
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (step === undefined) {
      return;
    }
    const swatches = [...root.querySelectorAll<HTMLElement>('.color-swatch')];
    const next = swatches[swatches.indexOf(target) + step];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });
}

/** "More colors": a code or name, the browser's chooser, and the favorite star. */
function moreColors(current: string | null, pick: (color: string) => void): HTMLElement {
  const code = el('input', {
    className: 'color-picker-code',
    attrs: {
      type: 'text',
      list: ensureNamedList(),
      placeholder: t('colorPicker.codePlaceholder'),
      'aria-label': t('colorPicker.code'),
      spellcheck: 'false',
      value: current ?? '',
    },
  }) as HTMLInputElement;
  const useCode = (): void => {
    const color = parseColorInput(code.value);
    code.setAttribute('aria-invalid', color ? 'false' : 'true');
    if (color) {
      pick(color);
    }
  };
  code.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      useCode();
    }
  });
  code.addEventListener('change', useCode);
  const free = el('input', {
    className: 'color-picker-free',
    attrs: {
      type: 'color',
      value: current ?? '#000000',
      'aria-label': t('colorPicker.free'),
      'data-tooltip': t('colorPicker.free'),
    },
  }) as HTMLInputElement;
  free.addEventListener('change', () => pick(free.value.toLowerCase()));
  const star = el('button', {
    className: 'color-picker-star',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  star.append(createIcon(Star, 'color-picker-star-icon', 16));
  const syncStar = (): void => {
    const color = parseColorInput(code.value);
    const favorite = color !== null && getFavoriteColors().includes(color);
    star.disabled = color === null;
    star.setAttribute('aria-pressed', favorite ? 'true' : 'false');
    const label = t(favorite ? 'colorPicker.unfavorite' : 'colorPicker.favorite');
    star.setAttribute('aria-label', label);
    star.dataset.tooltip = label;
  };
  star.addEventListener('click', () => {
    const color = parseColorInput(code.value);
    if (color) {
      toggleFavoriteColor(color);
      syncStar();
      star.dispatchEvent(new CustomEvent('favorites-changed', { bubbles: true }));
    }
  });
  code.addEventListener('input', syncStar);
  syncStar();
  return el('div', { className: 'color-picker-section' }, [
    el('div', { className: 'color-picker-heading', text: t('colorPicker.more') }),
    el('div', { className: 'color-picker-more' }, [code, free, star]),
  ]);
}

/** Build the picker. It redraws itself when a favorite is added or removed. */
export function buildColorPicker(options: ColorPickerOptions): HTMLElement {
  const root = el('div', { className: 'color-picker' });
  const pick = (color: string | null): void => {
    if (color !== null) {
      rememberColor(color);
    }
    options.onPick(color);
  };
  const draw = (): void => {
    const current = options.current === null ? null : normalizeHexColor(options.current);
    const parts: HTMLElement[] = [];
    if (options.noneLabel !== undefined) {
      const none = el('button', {
        className: 'color-picker-none',
        text: options.noneLabel,
        attrs: { type: 'button', 'aria-pressed': options.current === null ? 'true' : 'false' },
      });
      none.addEventListener('click', () => pick(null));
      parts.push(none);
    }
    const recent = getRecentColors();
    if (recent.length > 0) {
      parts.push(section(t('colorPicker.recent'), recent, current, pick));
    }
    const favorites = getFavoriteColors();
    if (favorites.length > 0) {
      parts.push(section(t('colorPicker.favorites'), favorites, current, pick));
    }
    const used = documentColors().slice(0, COLUMNS * 2);
    if (used.length > 0) {
      parts.push(section(t('colorPicker.inFile'), used, current, pick));
    }
    parts.push(section(t('colorPicker.palette'), paletteOrder(), current, pick));
    parts.push(moreColors(current, pick));
    root.replaceChildren(...parts);
  };
  root.addEventListener('favorites-changed', () => {
    draw();
    root.querySelector<HTMLElement>('.color-picker-star')?.focus();
  });
  wireArrowKeys(root);
  draw();
  return root;
}

/**
 * A form field for a color: a button showing the color that opens the picker
 * next to it. Its `value` is the chosen `#rrggbb`, like a color input's, and
 * it fires `input` and `change` when a color is picked.
 */
export function colorField(id: string | null, value: string, label?: string): HTMLButtonElement {
  const button = el('button', {
    className: 'color-field form-swatch',
    attrs: { type: 'button', 'aria-haspopup': 'dialog', ...(id === null ? {} : { id }) },
  }) as HTMLButtonElement;
  const show = (): void => {
    button.style.backgroundColor = button.value;
    const text = label ? `${label}: ${button.value}` : button.value;
    button.setAttribute('aria-label', text);
    button.dataset.tooltip = text;
  };
  button.value = value;
  show();
  // Keep the swatch in step when code sets `value` directly.
  const descriptor = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'value');
  if (descriptor?.get && descriptor.set) {
    const { get, set } = descriptor;
    Object.defineProperty(button, 'value', {
      configurable: true,
      get: () => get.call(button) as string,
      set: (next: string) => {
        set.call(button, next);
        show();
      },
    });
  }
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect();
    void openAnchoredPopover({
      placement: { kind: 'below', rect },
      label: label ?? t('colorPicker.title'),
      className: 'color-popover',
      container: button.closest('dialog') ?? undefined,
      build: (root, close) => {
        root.append(
          buildColorPicker({
            current: button.value,
            onPick: (color) => {
              if (color !== null) {
                button.value = color;
                button.dispatchEvent(new Event('input', { bubbles: true }));
                button.dispatchEvent(new Event('change', { bubbles: true }));
              }
              close();
              button.focus();
            },
          }),
        );
      },
    });
  });
  return button;
}
