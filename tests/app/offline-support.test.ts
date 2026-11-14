// SPDX-License-Identifier: MIT
// Guards the hosted build's update flow in the page (src/app/offline-support.ts)
// without a browser. The service worker container, the registration and the
// workers are small EventTarget fakes that fire the events a browser fires.
import { describe, expect, it, vi } from 'vitest';
import {
  SERVICE_WORKER_URL,
  startOfflineSupport,
  type OfflineSupportOptions,
} from '../../src/app/offline-support';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  readonly postMessage = vi.fn();
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  readonly update = vi.fn(async () => undefined);
}

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function fakeContainer(controller: FakeWorker | null, register: () => Promise<unknown>) {
  return Object.assign(new EventTarget(), { controller, register: vi.fn(register) });
}

/** Starts offline support against fakes. `waiting` is a version left over from an earlier visit. */
function start({
  controlled = false,
  waiting = null,
  refuse = false,
}: { controlled?: boolean; waiting?: FakeWorker | null; refuse?: boolean } = {}) {
  const registration = new FakeRegistration();
  registration.waiting = waiting;
  const container = fakeContainer(controlled ? new FakeWorker() : null, async () => {
    if (refuse) {
      throw new TypeError('registration refused');
    }
    return registration;
  });
  const page = new FakePage();
  const reload = vi.fn();
  const onUpdateReady = vi.fn();
  const options: OfflineSupportOptions = {
    container: container as unknown as ServiceWorkerContainer,
    document: page as unknown as Document,
    reload,
    onUpdateReady,
  };
  return { container, registration, page, reload, onUpdateReady, starting: startOfflineSupport(options) };
}

describe('startOfflineSupport', () => {
  it('registers the worker at ./sw.js', async () => {
    const { container, starting } = start();
    await starting;
    expect(SERVICE_WORKER_URL).toBe('./sw.js');
    expect(container.register).toHaveBeenCalledWith('./sw.js');
  });

  it('resolves to null when the browser refuses the registration, and announces nothing', async () => {
    const { onUpdateReady, starting } = start({ refuse: true });
    await expect(starting).resolves.toBeNull();
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('does not announce a first install, which replaces nothing', async () => {
    const { registration, onUpdateReady, starting } = start();
    await starting;
    const installing = new FakeWorker();
    registration.installing = installing;
    registration.dispatchEvent(new Event('updatefound'));
    installing.state = 'installed';
    installing.dispatchEvent(new Event('statechange'));
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('announces a newer version once it has installed over the running one', async () => {
    const { registration, onUpdateReady, starting } = start({ controlled: true });
    await starting;
    const installing = new FakeWorker();
    registration.installing = installing;
    registration.dispatchEvent(new Event('updatefound'));
    installing.dispatchEvent(new Event('statechange'));
    expect(onUpdateReady).not.toHaveBeenCalled();
    installing.state = 'installed';
    installing.dispatchEvent(new Event('statechange'));
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('ignores an update event that has no installing worker', async () => {
    const { registration, onUpdateReady, starting } = start({ controlled: true });
    await starting;
    registration.dispatchEvent(new Event('updatefound'));
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('announces a version that an earlier visit left waiting', async () => {
    const { onUpdateReady, starting } = start({ controlled: true, waiting: new FakeWorker() });
    await starting;
    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('checks for a newer version each time the app is shown again', async () => {
    const { registration, page, starting } = start();
    await starting;
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).not.toHaveBeenCalled();
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not fail when a background check cannot reach the network', async () => {
    const { registration, page, starting } = start();
    await starting;
    registration.update.mockRejectedValueOnce(new Error('offline'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    // Let the rejected check settle. An unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('asks the waiting version to take over, and reloads once it has', async () => {
    const waiting = new FakeWorker();
    const { container, reload, starting } = start({ controlled: true, waiting });
    const support = await starting;
    if (!support) {
      throw new Error('offline support did not start');
    }
    support.applyUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when no newer version is waiting', async () => {
    const { reload, starting } = start({ controlled: true });
    const support = await starting;
    if (!support) {
      throw new Error('offline support did not start');
    }
    support.applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
