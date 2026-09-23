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

/** A tap that moved farther than this (px) is a scroll or drag, left native. */
const TAP_MOVE_TOLERANCE_PX = 10;
/** A touch held longer than this (ms) is a long-press (selection, paste menu), left native. */
const TAP_MAX_MS = 500;

/**
 * Focuses `field` on a plain tap without iOS Safari's reveal scroll (#592).
 * When a tap natively focuses a text field that the on-screen keyboard will
 * cover (e.g. the formula bar at the bottom of a phone screen), Safari
 * scrolls the whole page up — animated — to reveal it, and the app then has
 * to re-fit itself above the keyboard: a visible jolt. A focus made from
 * script with `preventScroll` gets the keyboard without that scroll (the
 * grid's own cell editor, focused this way, shows no page scroll in the
 * on-device `#debug-viewport` log). So a quick tap on the field while it is
 * not yet focused is taken over: the native focus is cancelled on
 * `touchend` and the field focused there instead, caret at the end. Taps
 * on an already focused field (moving the caret), scrolls, and long-presses
 * stay native.
 */
export function focusOnTapWithoutRevealScroll(field: HTMLTextAreaElement | HTMLInputElement): void {
  let start: { x: number; y: number; time: number } | null = null;
  // Typed as HTMLElement so the listeners get `TouchEvent` (the input/textarea
  // union alone resolves to the untyped `addEventListener` overload).
  const target: HTMLElement = field;
  target.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      start =
        event.touches.length === 1 && touch && document.activeElement !== field
          ? { x: touch.clientX, y: touch.clientY, time: Date.now() }
          : null;
    },
    { passive: true },
  );
  target.addEventListener('touchend', (event) => {
    const began = start;
    start = null;
    const touch = event.changedTouches[0];
    if (
      !began ||
      !touch ||
      field.disabled ||
      document.activeElement === field ||
      Date.now() - began.time > TAP_MAX_MS ||
      Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > TAP_MOVE_TOLERANCE_PX
    ) {
      return;
    }
    event.preventDefault();
    field.focus({ preventScroll: true });
    const end = field.value.length;
    field.setSelectionRange(end, end);
  });
}
