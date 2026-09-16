// SPDX-License-Identifier: MIT

export interface ElOptions {
  className?: string;
  /** Set via textContent only — never interpreted as HTML. */
  text?: string;
  attrs?: Record<string, string>;
}

/**
 * Small DOM builder. All text goes through textContent, so untrusted CSV
 * content, filenames, and search terms are always rendered as plain text.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Moves DOM focus to `element` without popping the on-screen keyboard on a
 * touch-primary device (`(pointer: coarse)`, the same media query the CSS
 * already uses for touch-specific rules) unless the user actually tapped it
 * themselves — e.g. a dialog/popover/panel autofocusing a text field the
 * instant it opens, or the find bar focusing its search field when opened
 * from the menu (#497). Mirrors the sink-focus technique in `ui/grid.ts`'s
 * `focusGrid()` (#469): briefly marking a text input/textarea `readOnly`
 * around the `.focus()` call is the standard way to move focus without a
 * mobile browser treating it as an editable-field tap; the keyboard still
 * appears normally once the user taps the field themselves, since that tap
 * calls the field's own native focus handling, not this function. A no-op
 * distinction on desktop and for non-text-field elements (buttons, selects,
 * checkboxes, …), which never trigger the on-screen keyboard anyway.
 */
export function focusWithoutKeyboard(element: HTMLElement): void {
  const isTextField = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
  const isTouch =
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: coarse)').matches;
  if (!isTextField || !isTouch) {
    element.focus();
    return;
  }
  element.readOnly = true;
  element.focus();
  element.readOnly = false;
}
