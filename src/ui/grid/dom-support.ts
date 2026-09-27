// SPDX-License-Identifier: MIT
/** Small DOM and event helpers used by the `Grid` class (`./index.ts`). */
import { t } from '../../app/i18n';
import { el } from '../dom';

/**
 * Create a text measurer configured from an element's *computed* style via
 * `CanvasRenderingContext2D.measureText` — the same font family, size,
 * weight, and style the grid actually renders with (letter spacing is added
 * per character; CSS box chrome is accounted for separately by the caller).
 * Returns null where no 2D canvas context exists (e.g. jsdom); callers fall
 * back to DOM `scrollWidth` measurement there.
 */
export function createTextMeasurer(sample: Element): ((text: string) => number) | null {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return null;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.measureText !== 'function') {
    return null;
  }
  const cs = getComputedStyle(sample);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = Number.parseFloat(cs.letterSpacing);
  const extra = Number.isFinite(spacing) && spacing > 0 ? spacing : 0;
  return (text: string) => ctx.measureText(text).width + extra * text.length;
}

/**
 * Leading-edge per-frame coalescing for high-frequency pointer events (drag
 * selection, column resizing, fill preview). The first event applies
 * immediately for instant feedback; further events within the same frame
 * only remember the latest argument, which is applied on the next frame.
 */
export function frameCoalesced<T>(apply: (arg: T) => void): (arg: T) => void {
  let queued: { arg: T } | null = null;
  let scheduled = false;
  return (arg: T) => {
    if (scheduled) {
      queued = { arg };
      return;
    }
    apply(arg);
    scheduled = true;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
    const schedule = typeof raf === 'function' ? raf : (fn: () => void) => setTimeout(fn, 16);
    schedule(() => {
      scheduled = false;
      if (queued) {
        const { arg: latest } = queued;
        queued = null;
        apply(latest);
      }
    });
  };
}

/** Ctrl+B / Ctrl+I / Ctrl+U (Cmd on macOS): the text property the key toggles, else null. */
export function richFormatKeyOf(event: KeyboardEvent): 'bold' | 'italic' | 'underline' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  return key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null;
}

/** A new grid sink textarea (see `Grid.sink`), not yet wired or mounted. */
export function createSink(): HTMLTextAreaElement {
  return el('textarea', {
    className: 'grid-sink',
    attrs: {
      rows: '1',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      tabindex: '-1',
      'aria-label': t('grid.label'),
    },
  });
}
