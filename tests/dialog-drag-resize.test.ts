// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Drag-to-move and drag-to-resize for the shared dialog windows
 * (`src/ui/drag-resize.ts`, wired in `src/ui/dialogs/shared.ts`) — see issue
 * #361. Covers `openDialog` (the modal `<dialog>` used by Go to Cell, etc.)
 * and, since #393 converted Filter/Sort/Format/Data Validation from
 * `openDialog`/`openPopover` to the dockable `openSidePanel`, the side
 * panel's single-axis edge resize and position switching too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterDialogInput } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
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

    it('locks the measured width/height before clearing max-width/max-height, so dragging cannot widen it (#541)', async () => {
      const promise = new Dialogs().promptGoToCell('A1', () => null);
      const dialog = document.querySelector('dialog')!;
      const heading = dialog.querySelector<HTMLElement>('.dialog-title')!;
      stubRect(dialog, { left: 300, top: 200, width: 400, height: 150 });

      heading.dispatchEvent(pointerEvent('pointerdown', { clientX: 320, clientY: 210 }));

      // The very first frame of the drag must already have pinned the box's
      // width/height — never `max-width: none` with no explicit width, which
      // lets a native <dialog> (UA `width: fit-content`) re-shrink-to-fit to
      // its max-content size (e.g. a wide table) and blow out to the viewport
      // edge.
      expect(dialog.style.width).toBe('400px');
      expect(dialog.style.height).toBe('150px');
      expect(dialog.style.maxWidth).toBe('none');
      expect(dialog.style.maxHeight).toBe('none');

      heading.dispatchEvent(pointerEvent('pointermove', { clientX: 370, clientY: 260 }));
      heading.dispatchEvent(pointerEvent('pointerup', { clientX: 370, clientY: 260 }));

      // A move never touches width/height.
      expect(dialog.style.width).toBe('400px');
      expect(dialog.style.height).toBe('150px');

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

  describe('the dockable filter side panel (openSidePanel)', () => {
    it('resizes along its docked axis when the inner edge handle is dragged', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      // Force a known dock side, independent of whatever a previous test in
      // this run left the shared (session-remembered) position at.
      panel.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.right')}"]`)!.click();
      expect(panel.dataset.sidePanelPosition).toBe('right');
      stubRect(panel, { left: 700, top: 0, width: 300, height: 800 });

      const grip = panel.querySelector<HTMLElement>('.side-panel-resize-handle')!;
      // Right-docked: dragging the (left-edge) handle further left grows it.
      grip.dispatchEvent(pointerEvent('pointerdown', { clientX: 700, clientY: 400 }));
      grip.dispatchEvent(pointerEvent('pointermove', { clientX: 650, clientY: 400 }));
      grip.dispatchEvent(pointerEvent('pointerup', { clientX: 650, clientY: 400 }));
      expect(panel.style.width).toBe('350px'); // 300 + (700 - 650)

      // Growing past the viewport margin stops at the cap, not a larger size.
      stubRect(panel, { left: 700, top: 0, width: 350, height: 800 });
      grip.dispatchEvent(pointerEvent('pointerdown', { clientX: 650, clientY: 400 }));
      grip.dispatchEvent(pointerEvent('pointermove', { clientX: -1000, clientY: 400 }));
      grip.dispatchEvent(pointerEvent('pointerup', { clientX: -1000, clientY: 400 }));
      expect(panel.style.width).toBe('840px'); // innerWidth (1000) - the 160px margin

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('switches dock position from the header buttons, updating the panel and its resize axis', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;

      panel.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.top')}"]`)!.click();
      expect(panel.dataset.sidePanelPosition).toBe('top');
      expect(panel.style.top).toBe('0px');
      expect(panel.style.left).toBe('0px');
      expect(panel.style.right).toBe('0px');
      expect(panel.style.bottom).toBe('');

      stubRect(panel, { left: 0, top: 0, width: 1000, height: 300 });
      const grip = panel.querySelector<HTMLElement>('.side-panel-resize-handle')!;
      // Top-docked: dragging the (bottom-edge) handle further down grows it.
      grip.dispatchEvent(pointerEvent('pointerdown', { clientX: 500, clientY: 300 }));
      grip.dispatchEvent(pointerEvent('pointermove', { clientX: 500, clientY: 340 }));
      grip.dispatchEvent(pointerEvent('pointerup', { clientX: 500, clientY: 340 }));
      expect(panel.style.height).toBe('340px'); // 300 + (340 - 300)

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });

    it('maximizes and restores from the header toggle', async () => {
      const dialogs = new Dialogs();
      const promise = dialogs.chooseFilter(filterInput());
      const panel = document.querySelector<HTMLElement>('.side-panel')!;
      panel.querySelector<HTMLButtonElement>(`[title="${t('dialog.sidePanel.position.right')}"]`)!.click();
      stubRect(panel, { left: 700, top: 0, width: 300, height: 800 });

      const maximize = panel.querySelector<HTMLButtonElement>('.side-panel-maximize-btn')!;
      expect(maximize.getAttribute('aria-pressed')).toBe('false');
      const widthBeforeMaximize = panel.style.width;
      maximize.click();
      expect(maximize.getAttribute('aria-pressed')).toBe('true');
      // innerWidth (1000) - the 160px reserved-viewport margin.
      expect(panel.style.width).toBe('840px');

      maximize.click();
      expect(maximize.getAttribute('aria-pressed')).toBe('false');
      expect(panel.style.width).toBe(widthBeforeMaximize); // back to its remembered size

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await promise;
    });
  });
});
