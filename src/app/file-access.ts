// SPDX-License-Identifier: MIT

/** Default safety limit: whole files are kept in memory. */
export const MAX_FILE_SIZE = 512 * 1024 * 1024;

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Present only when the File System Access API provided a writable handle. */
  handle: FileSystemFileHandle | null;
  size: number;
}

export type SaveMode = 'overwrite' | 'download';

export interface SaveOutcome {
  mode: SaveMode;
  /** Filename used for a download save. */
  downloadName?: string;
  /** The overwrite attempt failed and the save fell back to a download. */
  fellBack: boolean;
}

interface FilePickerCapableWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle[]>;
}

export function fileSystemAccessAvailable(): boolean {
  return typeof (globalThis as FilePickerCapableWindow).showOpenFilePicker === 'function';
}

export async function readFileObject(file: File, handle: FileSystemFileHandle | null): Promise<OpenedFile> {
  const buffer = await file.arrayBuffer();
  return { name: file.name, bytes: new Uint8Array(buffer), handle, size: file.size };
}

/**
 * Ask the user to pick one or more files. Uses the File System Access API
 * when available (so saves can overwrite the original file); otherwise falls
 * back to a hidden <input type="file"> element.
 */
export async function pickFiles(doc: Document): Promise<OpenedFile[]> {
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
      out.push(await readFileObject(await handle.getFile(), handle));
    }
    return out;
  }
  return new Promise((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      Promise.all(files.map((f) => readFileObject(f, null))).then(resolve, reject);
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
      return { mode: 'overwrite', fellBack: false };
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
