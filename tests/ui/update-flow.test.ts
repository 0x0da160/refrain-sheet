// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
// The hosted update flow (src/ui/shell/update-flow.ts). The notice appears when a
// newer version waits, and its action applies it only when nothing is unsaved.
// The browser's service worker container is a fake installed on navigator.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../src/app/i18n';
import type { AppState } from '../../src/app/state';
import type { Surfaces } from '../../src/ui/shell/surfaces';
import { installUpdateFlow } from '../../src/ui/shell/update-flow';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  readonly postMessage = vi.fn();
}

/** Puts a service worker container on navigator, with `waiting` as the newer version. */
function installServiceWorkers(waiting: FakeWorker): void {
  const registration = Object.assign(new EventTarget(), {
    installing: null,
    waiting,
    update: vi.fn(async () => undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: new FakeWorker(),
    register: vi.fn(async () => registration),
  });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
}

function fakeSurfaces() {
  const flushed = { markdown: vi.fn(), json: vi.fn(), yaml: vi.fn(), text: vi.fn() };
  const surfaces = {
    markdownSheetView: { flushCommit: flushed.markdown },
    jsonSheetView: { flushCommit: flushed.json },
    yamlSheetView: { flushCommit: flushed.yaml },
    textSheetView: { flushCommit: flushed.text },
  } as unknown as Surfaces;
  return { surfaces, flushed };
}

function fakeState(dirty: boolean): AppState {
  return { tabs: [{ doc: { isDirty: dirty } }] } as unknown as AppState;
}

function noticeText(element: HTMLElement): string {
  return element.querySelector('.update-banner-message')?.textContent ?? '';
}

function action(element: HTMLElement): HTMLButtonElement {
  const button = element.querySelector<HTMLButtonElement>('.update-banner-action');
  if (!button) {
    throw new Error('the update notice has no action');
  }
  return button;
}

/** Lets the registration and the notice set up in the background finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installUpdateFlow', () => {
  beforeEach(() => {
    setLocale('en');
  });

  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it('shows the notice once a newer version is waiting', async () => {
    installServiceWorkers(new FakeWorker());
    const banner = installUpdateFlow(fakeState(false), fakeSurfaces().surfaces);
    await settle();
    expect(banner.element.hidden).toBe(false);
    expect(noticeText(banner.element)).toBe(t('update.ready'));
  });

  it('applies the update when nothing is unsaved', async () => {
    const waiting = new FakeWorker();
    installServiceWorkers(waiting);
    const banner = installUpdateFlow(fakeState(false), fakeSurfaces().surfaces);
    await settle();
    action(banner.element).click();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('holds the update, and says why, while a document has unsaved changes', async () => {
    const waiting = new FakeWorker();
    installServiceWorkers(waiting);
    const { surfaces, flushed } = fakeSurfaces();
    const banner = installUpdateFlow(fakeState(true), surfaces);
    await settle();
    action(banner.element).click();
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(noticeText(banner.element)).toBe(t('update.unsaved'));
    // Pending cell edits are committed before the check, so they count as unsaved.
    expect(flushed.markdown).toHaveBeenCalledTimes(1);
    expect(flushed.json).toHaveBeenCalledTimes(1);
    expect(flushed.yaml).toHaveBeenCalledTimes(1);
    expect(flushed.text).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the action is used before offline support has started', () => {
    const waiting = new FakeWorker();
    installServiceWorkers(waiting);
    const banner = installUpdateFlow(fakeState(false), fakeSurfaces().surfaces);
    action(banner.element).click();
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('leaves the page alone where the browser has no service workers', async () => {
    const banner = installUpdateFlow(fakeState(false), fakeSurfaces().surfaces);
    await settle();
    expect(banner.element.hidden).toBe(true);
    expect(() => action(banner.element).click()).not.toThrow();
  });
});
