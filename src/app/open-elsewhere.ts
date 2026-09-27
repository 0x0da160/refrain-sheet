// SPDX-License-Identifier: MIT
/**
 * Keeps one file from being open in two browser tabs of this app at once.
 *
 * Each running app answers "is this file open here?" on a same-origin
 * `BroadcastChannel`. Before opening a file that has a File System Access
 * handle, the opener asks every other tab and waits briefly for a "yes". A
 * `FileSystemFileHandle` survives `postMessage`, and `isSameEntry` compares
 * it with the handles the receiving tab holds, so no path or name is ever
 * guessed. Nothing leaves the browser: the channel reaches only other tabs
 * of the same origin on this device.
 *
 * Files opened without a handle (a plain file input or some drag-and-drop
 * paths) cannot be recognised this way and are not checked.
 */

const CHANNEL_NAME = 'refrain-sheet:open-files';
/** How long to wait for another tab to say it has the file open. */
const ANSWER_TIMEOUT_MS = 300;

/** The part of `BroadcastChannel` this module uses (injectable for tests). */
export interface OpenFilesChannel {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface Query {
  kind: 'is-open';
  id: string;
  handle: FileSystemFileHandle;
}

interface Answer {
  kind: 'open-here';
  id: string;
}

let channel: OpenFilesChannel | null = null;
const pending = new Map<string, () => void>();
let nextId = 0;
const instanceId = Math.random().toString(36).slice(2);

async function holds(handles: FileSystemFileHandle[], handle: FileSystemFileHandle): Promise<boolean> {
  for (const own of handles) {
    try {
      if (await own.isSameEntry(handle)) {
        return true;
      }
    } catch {
      // A handle that cannot be compared is treated as a different file.
    }
  }
  return false;
}

/**
 * Start answering other tabs, reporting the handles this tab has open.
 * `create` defaults to a real `BroadcastChannel`; without one (an old
 * browser) nothing is installed and {@link isOpenInAnotherTab} says no.
 */
export function installOpenFilesChannel(
  openHandles: () => FileSystemFileHandle[],
  create: () => OpenFilesChannel | null = () =>
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null,
): void {
  channel = create();
  if (!channel) {
    return;
  }
  channel.onmessage = (event) => {
    const data = event.data as { kind?: unknown; id?: unknown; handle?: FileSystemFileHandle } | null;
    if (data?.kind === 'open-here' && typeof data.id === 'string') {
      pending.get(data.id)?.();
      return;
    }
    if (data?.kind === 'is-open' && typeof data.id === 'string' && data.handle) {
      const { id, handle } = data;
      void holds(openHandles(), handle).then((found) => {
        if (found) {
          channel?.postMessage({ kind: 'open-here', id } satisfies Answer);
        }
      });
    }
  };
}

/** Stop answering and forget the channel (tests, or a page being torn down). */
export function uninstallOpenFilesChannel(): void {
  if (channel) {
    channel.onmessage = null;
  }
  channel = null;
  pending.clear();
}

/** Whether another tab of this app currently has `handle`'s file open. */
export function isOpenInAnotherTab(handle: FileSystemFileHandle): Promise<boolean> {
  const current = channel;
  if (!current) {
    return Promise.resolve(false);
  }
  const id = `${instanceId}-${nextId++}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, ANSWER_TIMEOUT_MS);
    pending.set(id, () => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(true);
    });
    try {
      current.postMessage({ kind: 'is-open', id, handle } satisfies Query);
    } catch {
      // The handle could not be sent (not cloneable here): nothing to compare.
      clearTimeout(timer);
      pending.delete(id);
      resolve(false);
    }
  });
}
