// SPDX-License-Identifier: MIT
/**
 * The theme-aware application icon.
 *
 * Two bundled variants exist — `icon.svg` for the light theme and
 * `icon-dark.svg` for the dark one. Both are imported at build time (Vite,
 * `base: './'`), so they resolve under a GitHub Pages base path and via
 * `file://` with no runtime network request of any kind; there is no icon
 * library and nothing is ever fetched.
 *
 * Every product-identity icon in the application is created through
 * {@link createAppIcon}, which tags the element `data-app-icon`. A single
 * resolved-theme observer then rewrites the `src` of every tagged element in
 * place: the element itself is never replaced, its intrinsic `width`/`height`
 * attributes never change, and the box is fixed in CSS — so switching themes
 * cannot shift layout, distort, clip, or re-run the entrance of the image.
 * A `"system"` theme choice tracks `prefers-color-scheme` live through the
 * same observer.
 *
 * All instances are decorative: adjacent text always states the product name,
 * so they carry `alt=""` plus `aria-hidden="true"` and never produce a second
 * screen-reader announcement of the brand.
 */
import { getTheme, onResolvedThemeChange, resolveTheme } from '../app/theme';
import { el } from './dom';
// Bundled at build time (relative, hashed URLs): both variants ship in the
// static production build and in the file:// distribution.
import iconDarkUrl from '../assets/icon-dark.svg';
import iconUrl from '../assets/icon.svg';

/** Marks an element as a product-identity icon that follows the theme. */
export const APP_ICON_ATTR = 'data-app-icon';

/** The icon asset URL for a resolved theme (defaults to the current one). */
export function appIconUrl(resolved: 'light' | 'dark' = resolveTheme(getTheme())): string {
  return resolved === 'dark' ? iconDarkUrl : iconUrl;
}

/**
 * Point every mounted application icon at the current theme's asset. Cheap and
 * idempotent: an unchanged `src` is never re-assigned, so the browser neither
 * re-decodes the image nor flashes.
 */
export function refreshAppIcons(root: ParentNode | null = globalThis.document ?? null): void {
  if (!root) {
    return;
  }
  const url = appIconUrl();
  for (const img of root.querySelectorAll<HTMLImageElement>(`img[${APP_ICON_ATTR}]`)) {
    if (img.getAttribute('src') !== url) {
      img.setAttribute('src', url);
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
