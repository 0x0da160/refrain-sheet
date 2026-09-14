// SPDX-License-Identifier: MIT
import { decodeBytes, encodeText } from '../../core/encoding';
import { pickMarkdownFile, saveBytes, saveBytesAs, type SaveOutcome } from '../file-access';
import { getMaxFileSize } from '../settings';

export interface MarkdownEditorOpenResult {
  name: string;
  text: string;
  handle: FileSystemFileHandle | null;
  /** The picked file exceeded the configured size limit; its bytes were never read. */
  tooLarge?: { name: string; size: number };
}

/**
 * File I/O for the standalone Markdown editor (#433). Unlike the CSV/RSF
 * documents, an edited Markdown file is never added as an application tab
 * or `AppState` document — it is plain UTF-8 text read and written directly
 * through `file-access.ts`, the same primitives every other open/save flow
 * uses, matching the local, non-document-mutating shape of the SQL/diff
 * panels (`commands/sql.ts`, `commands/diff.ts`).
 */
export class MarkdownEditorCommands {
  async open(doc: Document): Promise<MarkdownEditorOpenResult | null> {
    const file = await pickMarkdownFile(doc, getMaxFileSize());
    if (!file) {
      return null;
    }
    if (file.tooLarge) {
      return { name: '', text: '', handle: null, tooLarge: { name: file.name, size: file.size } };
    }
    return { name: file.name, text: decodeBytes(file.bytes, 'utf-8'), handle: file.handle };
  }

  save(doc: Document, name: string, text: string, handle: FileSystemFileHandle | null): Promise<SaveOutcome> {
    return saveBytes(doc, name, encodeText(text, 'utf-8'), handle);
  }

  saveAs(doc: Document, name: string, text: string): Promise<SaveOutcome> {
    return saveBytesAs(doc, name, encodeText(text, 'utf-8'), 'markdown');
  }
}
