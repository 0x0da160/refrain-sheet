// SPDX-License-Identifier: MIT

/**
 * The scroll offset that puts a band (a row, `start`..`start + size` in
 * scroll-content coordinates) at the middle of a `view`-long viewport,
 * clamped to the scrollable range `0..maxScroll`. Used to center the edited
 * cell when an on-screen keyboard shrinks the grid (see
 * `Grid.keyboardOpenChanged`).
 */
export function centeredScrollOffset(start: number, size: number, view: number, maxScroll: number): number {
  const target = Math.round(start + size / 2 - view / 2);
  return Math.max(0, Math.min(target, Math.max(0, maxScroll)));
}
