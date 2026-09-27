// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installOpenFilesChannel,
  isOpenInAnotherTab,
  uninstallOpenFilesChannel,
  type OpenFilesChannel,
} from '../../src/app/open-elsewhere';

/** A handle that is "the same entry" as any other handle with the same path. */
function handle(path: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name: path,
    path,
    isSameEntry: async (other: { path?: string }) => other.path === path,
  } as unknown as FileSystemFileHandle;
}

/**
 * Two tabs joined by an in-memory channel: whatever one posts reaches the
 * other asynchronously, like a BroadcastChannel (never echoed to the sender).
 */
function channelPair(): [OpenFilesChannel, OpenFilesChannel] {
  const a: OpenFilesChannel = { onmessage: null, postMessage: (m) => deliver(b, m) };
  const b: OpenFilesChannel = { onmessage: null, postMessage: (m) => deliver(a, m) };
  function deliver(to: OpenFilesChannel, data: unknown) {
    setTimeout(() => to.onmessage?.({ data } as MessageEvent), 0);
  }
  return [a, b];
}

afterEach(() => {
  uninstallOpenFilesChannel();
  vi.useRealTimers();
});

describe('asking other tabs whether a file is open', () => {
  it('says yes when the other tab holds the same file', async () => {
    const [mine, other] = channelPair();
    installOpenFilesChannel(
      () => [],
      () => mine,
    );
    // The other tab's answering side, as installOpenFilesChannel sets it up there.
    other.onmessage = (event) => {
      const data = event.data as { kind: string; id: string; handle: FileSystemFileHandle };
      void handle('/a.csv')
        .isSameEntry(data.handle)
        .then((same) => same && other.postMessage({ kind: 'open-here', id: data.id }));
    };
    expect(await isOpenInAnotherTab(handle('/a.csv'))).toBe(true);
    expect(await isOpenInAnotherTab(handle('/b.csv'))).toBe(false);
  });

  it('says no when no other tab answers in time', async () => {
    installOpenFilesChannel(
      () => [],
      () => ({ onmessage: null, postMessage: () => undefined }),
    );
    vi.useFakeTimers();
    const answer = isOpenInAnotherTab(handle('/a.csv'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await answer).toBe(false);
  });

  it('says no without a channel (a browser without BroadcastChannel)', async () => {
    installOpenFilesChannel(
      () => [],
      () => null,
    );
    expect(await isOpenInAnotherTab(handle('/a.csv'))).toBe(false);
  });

  it('answers another tab only for a file this tab has open', async () => {
    const posted: unknown[] = [];
    const channel: OpenFilesChannel = { onmessage: null, postMessage: (m) => posted.push(m) };
    installOpenFilesChannel(
      () => [handle('/a.csv')],
      () => channel,
    );
    channel.onmessage?.({ data: { kind: 'is-open', id: 'q1', handle: handle('/b.csv') } } as MessageEvent);
    channel.onmessage?.({ data: { kind: 'is-open', id: 'q2', handle: handle('/a.csv') } } as MessageEvent);
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toEqual([{ kind: 'open-here', id: 'q2' }]);
  });
});
