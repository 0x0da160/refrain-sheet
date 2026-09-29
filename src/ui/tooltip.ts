// SPDX-License-Identifier: MIT
/**
 * The app's own tooltip for icon buttons (the toolbar, the right-click
 * menu's format row). A browser's `title` tooltip waits about a second and
 * cannot be made faster, which is too slow for a row of icons; this one
 * appears after {@link SHOW_DELAY_MS}, and at once while moving from one
 * button to the next. It looks like the design system's `.rs-tooltip`
 * (`src/styles/app-toolbar.css`) and sits above everything else (D-14).
 *
 * A button opts in with `data-tooltip` (the text; a disabled reason goes on a
 * second line) and keeps its own `aria-label`, so the tooltip is visual only
 * and never the accessible name. Touch presses show nothing. Text is set with
 * `textContent`, never HTML.
 */

/** How long the pointer rests on a button before its tooltip shows. */
export const SHOW_DELAY_MS = 300;
/** After a tooltip hides, the next one within this long shows at once. */
const WARM_MS = 500;
/** Gap between the button and the tooltip. */
const GAP_PX = 6;

let tip: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let shownFor: HTMLElement | null = null;
let hiddenAt = 0;
/** The button last pressed: no tooltip on it again until the pointer leaves it. */
let pressedOn: HTMLElement | null = null;

function tipElement(doc: Document): HTMLElement {
  if (!tip || tip.ownerDocument !== doc || !tip.isConnected) {
    tip = doc.createElement('div');
    tip.className = 'app-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    doc.body.append(tip);
  }
  return tip;
}

function show(target: HTMLElement): void {
  const text = target.dataset.tooltip;
  if (!text || !target.isConnected) {
    return;
  }
  const doc = target.ownerDocument;
  const node = tipElement(doc);
  node.replaceChildren(
    ...text.split('\n').map((line, i) => {
      const span = doc.createElement('span');
      span.className = i === 0 ? 'app-tooltip-line' : 'app-tooltip-line app-tooltip-note';
      span.textContent = line;
      return span;
    }),
  );
  node.hidden = false;
  // Below the button, or above when there is no room; kept inside the window.
  const box = target.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const view = doc.documentElement;
  const left = Math.max(4, Math.min(box.left + box.width / 2 - width / 2, view.clientWidth - width - 4));
  const below = box.bottom + GAP_PX;
  const top = below + height > view.clientHeight ? box.top - GAP_PX - height : below;
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(Math.max(4, top))}px`;
  shownFor = target;
}

/** Hide the tooltip if its button was replaced (a surface re-rendered under the pointer). */
export function dropDetachedTooltip(): void {
  if (shownFor && !shownFor.isConnected) {
    hideTooltip();
  }
}

/** Hide the tooltip now (and cancel one about to show). */
export function hideTooltip(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (tip && !tip.hidden) {
    tip.hidden = true;
    hiddenAt = Date.now();
  }
  shownFor = null;
}

function schedule(target: HTMLElement): void {
  if (shownFor === target) {
    return;
  }
  const warm = shownFor !== null || Date.now() - hiddenAt < WARM_MS;
  hideTooltip();
  if (warm) {
    show(target);
  } else {
    showTimer = setTimeout(() => {
      showTimer = null;
      show(target);
    }, SHOW_DELAY_MS);
  }
}

function tooltipTarget(container: HTMLElement, node: EventTarget | null): HTMLElement | null {
  const found = node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
  return found && container.contains(found) ? found : null;
}

/** Show `[data-tooltip]` tooltips for the buttons inside `container`. */
export function installTooltips(container: HTMLElement): void {
  container.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') {
      return;
    }
    const target = tooltipTarget(container, event.target);
    if (target && target !== pressedOn) {
      schedule(target);
    }
  });
  container.addEventListener('pointerout', (event) => {
    const from = tooltipTarget(container, event.target);
    const to = tooltipTarget(container, event.relatedTarget);
    if (from && from !== to) {
      pressedOn = null;
      hideTooltip();
    }
  });
  // Keyboard focus shows the tooltip too; a pointer press never keeps one up.
  container.addEventListener('focusin', (event) => {
    const target = tooltipTarget(container, event.target);
    if (target && target.matches(':focus-visible')) {
      schedule(target);
    }
  });
  container.addEventListener('focusout', () => hideTooltip());
  container.addEventListener('pointerdown', (event) => {
    pressedOn = tooltipTarget(container, event.target);
    hideTooltip();
  });
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideTooltip();
    }
  });
  container.ownerDocument.addEventListener('scroll', () => hideTooltip(), { capture: true, passive: true });
}
