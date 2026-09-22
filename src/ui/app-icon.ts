// SPDX-License-Identifier: MIT
/**
 * The theme-aware application icon and logotype.
 *
 * Four bundled variants exist — `icon.svg`/`logotype.svg` for the light theme
 * and `icon-dark.svg`/`logotype-dark.svg` for the dark one. All four are
 * imported at build time (Vite, `base: './'`), so they resolve under a GitHub
 * Pages base path and via `file://` with no runtime network request of any
 * kind; there is no icon library and nothing is ever fetched.
 *
 * Every product-identity icon is created through {@link createAppIcon}, which
 * tags the element `data-app-icon`; every logotype (icon + wordmark, one
 * fixed piece of artwork per the design system's logo spec — never re-set as
 * separate icon + live text) through {@link createAppLogotype}, tagged
 * `data-app-logotype`. A single resolved-theme observer then rewrites the
 * `src` of every tagged element in place: the element itself is never
 * replaced, its intrinsic `width`/`height` attributes never change, and the
 * box is fixed in CSS — so switching themes cannot shift layout, distort,
 * clip, or re-run the entrance of the image. A `"system"` theme choice tracks
 * `prefers-color-scheme` live through the same observer.
 *
 * `createAppIcon` instances are decorative: adjacent text always states the
 * product name, so they carry `alt=""` plus `aria-hidden="true"` and never
 * produce a second screen-reader announcement of the brand. `createAppLogotype`
 * is the opposite — wherever it's used it is the *only* conveyor of the
 * product name, so it carries a real accessible name instead.
 */
import { getTheme, onResolvedThemeChange, resolveTheme } from '../app/theme';
import { t } from '../app/i18n';
import { el } from './dom';
// Bundled at build time (relative, hashed URLs): all four variants ship in
// the static production build and in the file:// distribution.
import iconDarkUrl from '../assets/icon-dark.svg';
import iconUrl from '../assets/icon.svg';
import logotypeDarkUrl from '../assets/logotype-dark.svg';
import logotypeUrl from '../assets/logotype.svg';

/** Marks an element as a product-identity icon that follows the theme. */
const APP_ICON_ATTR = 'data-app-icon';
/** Marks an element as a product-identity logotype that follows the theme. */
const APP_LOGOTYPE_ATTR = 'data-app-logotype';

/** The logotype master's fixed width:height ratio (573.37 × 120). */
const LOGOTYPE_ASPECT = 573.37 / 120;

/** The icon asset URL for a resolved theme (defaults to the current one). */
export function appIconUrl(resolved: 'light' | 'dark' = resolveTheme(getTheme())): string {
  return resolved === 'dark' ? iconDarkUrl : iconUrl;
}

/** The logotype asset URL for a resolved theme (defaults to the current one). */
export function appLogotypeUrl(resolved: 'light' | 'dark' = resolveTheme(getTheme())): string {
  return resolved === 'dark' ? logotypeDarkUrl : logotypeUrl;
}

/**
 * Point every mounted application icon/logotype at the current theme's asset.
 * Cheap and idempotent: an unchanged `src` is never re-assigned, so the
 * browser neither re-decodes the image nor flashes.
 */
export function refreshAppIcons(root: ParentNode | null = globalThis.document ?? null): void {
  if (!root) {
    return;
  }
  const iconSrc = appIconUrl();
  for (const img of root.querySelectorAll<HTMLImageElement>(`img[${APP_ICON_ATTR}]`)) {
    if (img.getAttribute('src') !== iconSrc) {
      img.setAttribute('src', iconSrc);
    }
  }
  const logotypeSrc = appLogotypeUrl();
  for (const img of root.querySelectorAll<HTMLImageElement>(`img[${APP_LOGOTYPE_ATTR}]`)) {
    if (img.getAttribute('src') !== logotypeSrc) {
      img.setAttribute('src', logotypeSrc);
    }
  }
}

let observing = false;

/**
 * Start following the resolved theme. Called once during bootstrap; safe to
 * call again (the observer is attached exactly once).
 */
export function initAppIcons(): void {
  if (observing) {
    return;
  }
  observing = true;
  onResolvedThemeChange(() => refreshAppIcons());
}

/**
 * Build a decorative application icon sized `size` CSS pixels. The explicit
 * `width`/`height` attributes reserve the box before the SVG loads, so the
 * icon can never shift layout or render at the wrong aspect ratio.
 */
export function createAppIcon(className: string, size: number): HTMLImageElement {
  initAppIcons();
  return el('img', {
    className,
    attrs: {
      src: appIconUrl(),
      alt: '',
      'aria-hidden': 'true',
      width: String(size),
      height: String(size),
      draggable: 'false',
      [APP_ICON_ATTR]: '',
    },
  });
}

/**
 * Build the theme-aware horizontal logotype at `height` CSS pixels, with
 * `width` derived from the fixed master aspect ratio so it reserves its own
 * box before the SVG loads (same rationale as {@link createAppIcon}).
 * Carries a real accessible name (`alt`) rather than being decorative: unlike
 * `createAppIcon`, nothing else nearby also states the product name.
 */
export function createAppLogotype(className: string, height: number): HTMLImageElement {
  initAppIcons();
  return el('img', {
    className,
    attrs: {
      src: appLogotypeUrl(),
      alt: t('app.title'),
      width: String(Math.round(height * LOGOTYPE_ASPECT)),
      height: String(height),
      draggable: 'false',
      [APP_LOGOTYPE_ATTR]: '',
    },
  });
}
