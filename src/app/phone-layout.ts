// SPDX-License-Identifier: MIT

/**
 * True on a phone held upright: the width and orientation the phone layout CSS
 * (`@media (max-width: 43.75em) and (orientation: portrait)`) uses. A default
 * that differs only on a phone reads this, so the UI and the commands agree.
 */
export function isPhonePortrait(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(max-width: 43.75em) and (orientation: portrait)').matches
  );
}
