// SPDX-License-Identifier: MIT

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Present only when the File System Access API provided a writable handle. */
  handle: FileSystemFileHandle | null;
  size: number;
  /**
   * The file exceeded the configured size limit, so its bytes were never read
   * into memory. The command layer reports it and skips loading.
   */
  tooLarge?: boolean;
}

export type SaveMode = 'overwrite' | 'download';

export interface SaveOutcome {
  mode: SaveMode;
  /** Filename used for a download save. */
  downloadName?: string;
  /** The overwrite attempt failed and the save fell back to a download. */
  fellBack: boolean;
  /** Handle obtained from a save picker, reusable for future saves. */
  handle?: FileSystemFileHandle;
}

interface FilePickerCapableWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle>;
}

export function fileSystemAccessAvailable(): boolean {
  return typeof (globalThis as FilePickerCapableWindow).showOpenFilePicker === 'function';
}

/**
 * Read a file's bytes into memory, enforcing the size limit first. When the
 * file is larger than `maxSize` its bytes are never read; the returned entry
 * is flagged `tooLarge` so the caller can report it without allocating.
 */
export async function readFileObject(
  file: File,
  handle: FileSystemFileHandle | null,
  maxSize: number,
): Promise<OpenedFile> {
  if (file.size > maxSize) {
    return { name: file.name, bytes: new Uint8Array(0), handle, size: file.size, tooLarge: true };
  }
  const buffer = await file.arrayBuffer();
  return { name: file.name, bytes: new Uint8Array(buffer), handle, size: file.size };
}

/**
 * Ask the user to pick one or more files. Uses the File System Access API
 * when available (so saves can overwrite the original file); otherwise falls
 * back to a hidden <input type="file"> element. The configured size limit is
 * enforced before any file's bytes are read into memory.
 */
export async function pickFiles(doc: Document, maxSize: number): Promise<OpenedFile[]> {
  const picker = (globalThis as FilePickerCapableWindow).showOpenFilePicker;
  if (typeof picker === 'function') {
    let handles: FileSystemFileHandle[];
    try {
      handles = await picker.call(globalThis, { multiple: true });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return [];
      }
      throw err;
    }
    const out: OpenedFile[] = [];
    for (const handle of handles) {
      out.push(await readFileObject(await handle.getFile(), handle, maxSize));
    }
    return out;
  }
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // `.rsf` is the current spreadsheet format; `.rcsv` is the legacy name,
    // still accepted so existing files open (then re-save as `.rsf`).
    input.accept = '.csv,.tsv,.txt,.rsf,.rcsv,text/csv,text/tab-separated-values,text/plain,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      Promise.all(files.map((f) => readFileObject(f, null, maxSize))).then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    doc.body.appendChild(input);
    input.click();
  });
}

function triggerDownload(doc: Document, name: string, bytes: Uint8Array): void {
  // Copy into a fresh ArrayBuffer-backed view so the Blob never sees a
  // SharedArrayBuffer-typed buffer.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Save bytes back to the original file when a writable handle exists,
 * otherwise (or when writing fails / permission is denied) produce a
 * download. The outcome reports which mode actually happened, so the caller
 * never treats a download as an in-place overwrite.
 */
export async function saveBytes(
  doc: Document,
  name: string,
  bytes: Uint8Array,
  handle: FileSystemFileHandle | null,
): Promise<SaveOutcome> {
  if (handle && typeof handle.createWritable === 'function') {
    try {
      const writable = await handle.createWritable();
      await writable.write(bytes.slice());
      await writable.close();
      return { mode: 'overwrite', fellBack: false, handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // NotAllowedError, SecurityError, quota problems, etc.: fall back.
      triggerDownload(doc, name, bytes);
      return { mode: 'download', downloadName: name, fellBack: true };
    }
  }
  triggerDownload(doc, name, bytes);
  return { mode: 'download', downloadName: name, fellBack: false };
}

const SAVE_PICKER_TYPES = {
  rsf: [
    {
      description: 'Refrain Sheet (RSF)',
      accept: { 'application/octet-stream': ['.rsf'] },
    },
  ],
  csv: [
    {
      description: 'CSV',
      accept: { 'text/csv': ['.csv'] },
    },
  ],
} as const;

/**
 * Open the "Save as" file picker and return the chosen file handle, WITHOUT
 * writing anything yet. This calls `showSaveFilePicker`, which the browser
 * only permits while a user activation (a click, key press, …) is active, so
 * it MUST be invoked synchronously from the user-gesture handler — before any
 * `await` for compression, a dialog transition, a worker request, or a
 * timeout, all of which discard the activation. Awaiting the returned promise
 * afterwards is fine; only the *call* has to happen inside the gesture.
 *
 * Resolves to `null` when the File System Access API is unavailable (for
 * example a `file://` page), so the caller can encode and then fall back to a
 * download. Rejects with `AbortError` when the user cancels the picker.
 */
export function requestSaveHandle(
  name: string,
  kind: keyof typeof SAVE_PICKER_TYPES,
): Promise<FileSystemFileHandle | null> {
  const picker = (globalThis as FilePickerCapableWindow).showSaveFilePicker;
  if (typeof picker !== 'function') {
    return Promise.resolve(null);
  }
  return picker.call(globalThis, {
    suggestedName: name,
    types: SAVE_PICKER_TYPES[kind],
  }) as Promise<FileSystemFileHandle | null>;
}

/**
 * Save to a user-chosen location. Where the File System Access API save
 * picker exists, the user picks the destination and the returned handle is
 * reported for reuse; otherwise this falls back to a download (the original
 * file is never overwritten). AbortError (user cancelled) is rethrown.
 *
 * Note: this calls the picker *after* being invoked, so it is only safe from
 * flows with no async work before the save. Flows that compress or show a
 * dialog first must instead acquire the handle up front with
 * {@link requestSaveHandle} and then write through {@link saveBytes}.
 */
export async function saveBytesAs(
  doc: Document,
  name: string,
  bytes: Uint8Array,
  kind: keyof typeof SAVE_PICKER_TYPES,
): Promise<SaveOutcome> {
  const picker = (globalThis as FilePickerCapableWindow).showSaveFilePicker;
  if (typeof picker === 'function') {
    const handle = await picker.call(globalThis, {
      suggestedName: name,
      types: SAVE_PICKER_TYPES[kind],
    });
    const writable = await handle.createWritable();
    await writable.write(bytes.slice());
    await writable.close();
    return { mode: 'overwrite', fellBack: false, handle };
  }
  triggerDownload(doc, name, bytes);
  return { mode: 'download', downloadName: name, fellBack: false };
}
