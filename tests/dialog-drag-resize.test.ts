// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Drag-to-move and drag-to-resize for the shared dialog/popover windows
 * (`src/ui/drag-resize.ts`, wired in `src/ui/dialogs/shared.ts`) — see
 * issue #361. Covers both `openDialog` (the modal `<dialog>` used by Sort,
 * Go to Cell, etc.) and `openPopover` (the anchored, non-modal filter
 * popover), since the issue names both as "popup windows" to make
 * draggable/resizable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterDialogInput } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function filterInput(overrides: Partial<FilterDialogInput> = {}): FilterDialogInput {
  return {
    col: 1,
    colLetter: 'B',
    header: 'name',
    rangeLabel: 'A1:B4',
    headerRow: true,
    hasActiveFilter: false,
    existing: null,
    otherColumns: 0,
    values: ['apple', 'banana', 'cherry'],
    valuesTruncated: false,
    ...overrides,
  };
}

/** jsdom has no PointerEvent constructor; a MouseEvent stands in with
 * `pointerId` grafted on, mirroring the convention in grid-touch.test.ts. */
function pointerEvent(type: string, opts: MouseEventInit & { pointerId?: number } = {}): Event {
  const { pointerId = 1, ...mouseInit } = opts;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...mouseInit });
  Object.defineProperty(event, 'pointerId', { value: pointerId, configurable: true });
  return event;
}

function stubRect(
  node: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  node.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('dialog/popover drag-to-move and drag-to-resize', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);

    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    if (typeof proto.showModal !== 'function') {
      proto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      proto.close = function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  afterEach(() => {
    setLocale(locale);
    document.body.innerHTML = '';
  });

  describe('a modal dialog (openDialog)', () => {
    it('moves when the title bar is dragged, overriding the centered default position', async () => {
      const promise = new Dialogs().promptGoToCell('A1', () => null);
      const dialog = document.querySelector('dialog')!;
      const heading = dialog.querySelector<HTMLElement>('.dialog-title')!;
      stubRect(dialog, { left: 300, top: 200, width: 400, height: 150 });

      heading.dispatchEvent(pointerEvent('pointerdown', { clientX: 320, clientY: 210 }));
      heading.dispatchEvent(pointerEvent('pointermove', { clientX: 370, clientY: 260 }));
      heading.dispatchEvent(pointerEvent('pointerup', { clientX: 370, clientY: 260 }));

      expect(dialog.style.left).toBe('350px'); // 300 + (370 - 320)
      expect(dialog.style.top).toBe('250px'); // 200 + (260 - 210)
      expect(dialog.style.position).toBe('fixed');

      dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
      await promise;
    });

    it('clamps the dragged position so the dialog cannot leave the viewport', async () => {
      const promise = new Dialogs().promptGoToCell('A1', () => null);
      const dialog = document.querySelector('dialog')!;
      const heading = dialog.querySelector<HTMLElement>('.dialog-title')!;
      stubRect(dialog, { left: 300, top: 200, width: 400, height: 150 });

      heading.dispatchEvent(pointerEvent('pointerdown', { clientX: 320, clientY: 210 }));
      heading.dispatchEvent(pointerEvent('pointermove', { clientX: -500, clientY: -500 }));
      heading.dispatchEvent(pointerEvent('pointerup', { clientX: -500, clientY: -500 }));

      expect(dialog.style.left).toBe('4px'); // the 4px viewport margin, not negative
      expect(dialog.style.top).toBe('4px');

      dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
      await promise;
    });

    it('resizes from the corner grip, clamped to a minimum size', async () => {
      const promise = new Dialogs().promptGoToCell('A1', () => null);
      const dialog = document.querySelector('dialog')!;
      const grip = dialog.querySelector<HTMLElement>('.dialog-resize-handle')!;
      stubRect(dialog, { left: 300, top: 200, width: 400, height: 150 });

      grip.dispatchEvent(pointerEvent('pointerdown', { clientX: 700, clientY: 350 }));
      grip.dispatchEvent(pointerEvent('pointermove', { clientX: 750, clientY: 390 }));
      grip.dispatchEvent(pointerEvent('pointerup', { clientX: 750, clientY: 390 }));

      expect(dialog.style.width).toBe('450px'); // 400 + (750 - 700)
      expect(dialog.style.height).toBe('190px'); // 150 + (390 - 350)
      expect(dialog.style.maxWidth).toBe('none');
      expect(dialog.style.maxHeight).toBe('none');

      // Shrinking past the minimum stops at the floor, not a smaller size.
      grip.dispatchEvent(pointerEvent('pointerdown', { clientX: 750, clientY: 390 }));
      grip.dispatchEvent(pointerEvent('pointermove', { clientX: -1000, clientY: -1000 }));
      grip.dispatchEvent(pointerEvent('pointerup', { clientX: -1000, clientY: -1000 }));
      expect(dialog.style.width).toBe('220px');
      expect(dialog.style.height).toBe('140px');

      dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click();
      await promise;
    });
  });

  describe('the anchored filter popover (openPopover)', () => {
    it('moves when the title bar is dragged', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;
      const heading = popover.querySelector<HTMLElement>('.dialog-title')!;
      stubRect(popover, { left: 500, top: 267, width: 300, height: 200 });

      heading.dispatchEvent(pointerEvent('pointerdown', { clientX: 520, clientY: 280 }));
      heading.dispatchEvent(pointerEvent('pointermove', { clientX: 470, clientY: 330 }));
      heading.dispatchEvent(pointerEvent('pointerup', { clientX: 470, clientY: 330 }));

      expect(popover.style.left).toBe('450px'); // 500 - 50
      expect(popover.style.top).toBe('317px'); // 267 + 50

      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('stops following the anchor (no snap-back) once manually moved', async () => {
      const header = document.createElement('div');
      header.setAttribute('data-colhead', '1');
      header.getBoundingClientRect = () =>
        ({ left: 300, top: 40, right: 360, bottom: 60, width: 60, height: 20 }) as DOMRect;
      document.body.append(header);

      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput({ col: 1 }));
      const popover = document.querySelector<HTMLElement>('.filter-popover')!;
      expect(popover.style.left).toBe('300px'); // anchored below the header

      const heading = popover.querySelector<HTMLElement>('.dialog-title')!;
      stubRect(popover, { left: 300, top: 60, width: 300, height: 200 });
      heading.dispatchEvent(pointerEvent('pointerdown', { clientX: 310, clientY: 70 }));
      heading.dispatchEvent(pointerEvent('pointermove', { clientX: 410, clientY: 170 }));
      heading.dispatchEvent(pointerEvent('pointerup', { clientX: 410, clientY: 170 }));
      expect(popover.style.left).toBe('400px');
      expect(popover.style.top).toBe('160px');

      // A window resize would normally re-run positionPopup and reset the
      // element back next to the (still-rendered) header; it must not.
      window.dispatchEvent(new Event('resize'));
      expect(popover.style.left).toBe('400px');
      expect(popover.style.top).toBe('160px');

      popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });
  });
});
