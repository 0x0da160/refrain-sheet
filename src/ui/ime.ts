// SPDX-License-Identifier: MIT
/**
 * IME composition detection for text editors (the inline cell editor and the
 * formula bar).
 *
 * While an IME composition is active the browser owns every keystroke — Enter
 * confirms a candidate, Escape cancels one, arrows move through candidates — so
 * the app must not treat those keys as commit / navigation / autocomplete /
 * shortcut input. We treat three signals as authoritative, any of which means
 * "composition is in progress, keep hands off":
 *
 *   - `event.isComposing` — the standard flag.
 *   - `event.keyCode === 229` — the legacy sentinel some engines still emit for
 *     the keydown that starts or continues a composition (when `isComposing`
 *     has not flipped to true yet).
 *   - a caller-tracked `active` flag driven by `compositionstart` /
 *     `compositionend`, which covers the confirming keydown on engines that
 *     fire it while composition is still logically active.
 */
export function isComposingKey(event: KeyboardEvent, active = false): boolean {
  return active || event.isComposing || event.keyCode === 229;
}

/**
 * True for a keydown that should begin editing a selected grid cell by typing:
 * a single printable character, or the IME sentinel that means a composition is
 * about to start. Modifier chords (Ctrl/Alt/Meta) are excluded so shortcuts are
 * never swallowed. The initiating key is intentionally NOT consumed — the
 * caller opens an empty editor and lets the browser deliver this key (and any
 * IME composition) into the freshly focused field.
 */
export function beginsTextEntry(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  // A printable character (length 1), or the IME-start sentinel / "Process".
  return event.key.length === 1 || event.keyCode === 229 || event.key === 'Process';
}
