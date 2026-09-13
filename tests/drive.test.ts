// SPDX-License-Identifier: MIT
// Google Drive sync (issue #416). These tests cover the parts that must hold
// without a live Google session: that the feature is inert unless a client id
// was built in, that nothing is fetched until a command runs, and that the
// Drive client speaks the Drive REST protocol correctly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_SCOPE, driveConfigured, RESUMABLE_THRESHOLD_BYTES } from '../src/app/drive/config';
import { __testing as pickerTesting } from '../src/app/drive/picker';
import { DriveApiError, DriveAuthExpired, downloadFile, uploadFile } from '../src/app/drive/client';
import { loadExternalScript, resetLoadedScriptsForTests } from '../src/app/drive/script-loader';

describe('Drive availability', () => {
  it('is off unless a client id was built in', () => {
    // No __DRIVE_CLIENT_ID__ is defined under vitest, which is exactly the
    // offline build's situation: every Drive entry point must stay hidden.
    expect(driveConfigured()).toBe(false);
  });

  it('requests only the per-file scope, never full Drive access', () => {
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(DRIVE_SCOPE).not.toContain('drive.readonly');
  });
});

describe('Picker app id', () => {
  it('derives the Cloud project number from the client id', () => {
    expect(pickerTesting.appIdFromClientId('773250225330-abc.apps.googleusercontent.com')).toBe(
      '773250225330',
    );
  });

  it('yields nothing for a client id with no numeric prefix', () => {
    expect(pickerTesting.appIdFromClientId('not-a-real-client-id')).toBe('');
    expect(pickerTesting.appIdFromClientId('')).toBe('');
  });
});

describe('script loader', () => {
  beforeEach(() => resetLoadedScriptsForTests());
  afterEach(() => resetLoadedScriptsForTests());

  it('injects a script once and shares the pending load', () => {
    const appended: HTMLScriptElement[] = [];
    const doc = {
      createElement: () => {
        const script = {
          src: '',
          async: false,
          listeners: {},
          remove: () => {},
        } as unknown as HTMLScriptElement & {
          listeners: Record<string, () => void>;
        };
        script.addEventListener = ((name: string, fn: () => void) => {
          (script as unknown as { listeners: Record<string, () => void> }).listeners[name] = fn;
        }) as HTMLScriptElement['addEventListener'];
        return script;
      },
      head: {
        appendChild: (node: HTMLScriptElement) => {
          appended.push(node);
        },
      },
    } as unknown as Document;

    const first = loadExternalScript('https://example.test/a.js', doc);
    const second = loadExternalScript('https://example.test/a.js', doc);
    expect(second).toBe(first);
    expect(appended).toHaveLength(1);
  });
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('Drive client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the bearer token and returns the downloaded bytes', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        seen.url = url;
        seen.init = init;
        return new Response(new Uint8Array([1, 2, 3]));
      }),
    );
    const bytes = await downloadFile('file-1', 'tok');
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(seen.url).toContain('/files/file-1?alt=media');
    expect((seen.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('reports an expired token distinctly so the caller can re-authorize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(downloadFile('file-1', 'tok')).rejects.toBeInstanceOf(DriveAuthExpired);
  });

  it('surfaces Drive’s own error message and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Rate limit exceeded' } }, { status: 429 })),
    );
    await expect(downloadFile('f', 'tok')).rejects.toMatchObject({
      name: 'DriveApiError',
      status: 429,
      message: 'Rate limit exceeded',
    });
    await expect(downloadFile('f', 'tok')).rejects.toBeInstanceOf(DriveApiError);
  });

  it('creates with POST and overwrites the same file with PATCH', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method });
        return jsonResponse({ id: 'new-id', name: 'sheet.csv' });
      }),
    );

    await uploadFile({ name: 'sheet.csv', bytes: new Uint8Array([65]), mimeType: 'text/csv' }, 'tok');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).not.toContain('/files/');

    await uploadFile(
      { name: 'sheet.csv', bytes: new Uint8Array([65]), mimeType: 'text/csv', fileId: 'existing' },
      'tok',
    );
    expect(calls[1].method).toBe('PATCH');
    expect(calls[1].url).toContain('/files/existing');
  });

  it('never sets parents when overwriting — Drive rejects that', async () => {
    const bodies: FormData[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(init.body as FormData);
        return jsonResponse({ id: 'id', name: 'n' });
      }),
    );
    await uploadFile(
      {
        name: 'n',
        bytes: new Uint8Array([1]),
        mimeType: 'text/csv',
        fileId: 'existing',
        parentId: 'folder-1',
      },
      'tok',
    );
    const metadata = JSON.parse(await (bodies[0].get('metadata') as Blob).text());
    expect(metadata.parents).toBeUndefined();
  });

  it('switches to a resumable session for a large upload and follows 308s', async () => {
    const ranges: string[] = [];
    let started = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (!started) {
          started = true;
          return new Response('', {
            status: 200,
            headers: { Location: 'https://upload.test/session' },
          });
        }
        expect(url).toBe('https://upload.test/session');
        const range = (init.headers as Record<string, string>)['Content-Range'];
        ranges.push(range);
        const [, endStr, totalStr] = /bytes \d+-(\d+)\/(\d+)/.exec(range)!;
        if (Number(endStr) + 1 < Number(totalStr)) {
          return new Response('', { status: 308, headers: { Range: `bytes=0-${endStr}` } });
        }
        return jsonResponse({ id: 'big', name: 'big.csv' });
      }),
    );

    const bytes = new Uint8Array(RESUMABLE_THRESHOLD_BYTES + 1024);
    const progress: number[] = [];
    const meta = await uploadFile(
      { name: 'big.csv', bytes, mimeType: 'text/csv', onProgress: (f) => progress.push(f) },
      'tok',
    );

    expect(meta.id).toBe('big');
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]).toMatch(/^bytes 0-/);
    // The final chunk must close the range exactly at the last byte.
    expect(ranges[ranges.length - 1]).toContain(`/${bytes.length}`);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
