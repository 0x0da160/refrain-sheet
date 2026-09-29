// SPDX-License-Identifier: MIT
/**
 * Cut, Copy and Paste from the menus and the toolbar while a Markdown, JSON,
 * YAML or text sheet is showing. Such a sheet keeps its whole text in one
 * cell, so the grid's clipboard (which cuts and pastes whole cells) must never
 * run there: a toolbar Cut used to empty the entire document. Instead the
 * commands act on the sheet's focused text editor, exactly like its own
 * Ctrl+X / Ctrl+C / Ctrl+V: its selected text, through the browser's editing
 * commands so the edit fires `input` (and is committed and undoable like
 * typing). The toolbar keeps focus in the editor while clicked; a menu takes
 * it, so the editor last used is remembered ({@link rememberTextEditors}) and
 * focused again, which brings back its selection.
 */

/** The source-sheet text editor that last had focus. */
let lastEditor: HTMLTextAreaElement | HTMLInputElement | null = null;

/** Remember the last text editor focused inside `roots` (the source-sheet views). */
export function rememberTextEditors(doc: Document, roots: readonly HTMLElement[]): void {
  doc.addEventListener('focusin', (event) => {
    const target = event.target;
    if (
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) &&
      roots.some((root) => root.contains(target))
    ) {
      lastEditor = target;
    }
  });
}

/** The remembered editor, when it is still on screen. */
function rememberedEditor(): HTMLElement | null {
  return lastEditor?.isConnected && lastEditor.getClientRects().length > 0 ? lastEditor : null;
}

/** The focused text editor (a textarea, text input, or editable region), or null. */
function focusedTextField(doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }
  if (active instanceof HTMLTextAreaElement) {
    return active;
  }
  if (active instanceof HTMLInputElement) {
    return ['text', 'search', ''].includes(active.type) ? active : null;
  }
  return active.isContentEditable ? active : null;
}

/** The focused field's selected text. */
function selectedText(doc: Document, field: HTMLElement): string {
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
  }
  return doc.getSelection()?.toString() ?? '';
}

function isReadOnly(field: HTMLElement): boolean {
  return field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
    ? field.readOnly || field.disabled
    : false;
}

/**
 * Run `action` on the focused text editor. Returns false when no text editor
 * has focus (nothing was done), so the caller can say so.
 */
export async function textFieldClipboard(doc: Document, action: 'cut' | 'copy' | 'paste'): Promise<boolean> {
  const field = focusedTextField(doc) ?? rememberedEditor();
  if (!field) {
    return false;
  }
  field.focus();
  if (action === 'paste') {
    if (isReadOnly(field)) {
      return true;
    }
    const text = await navigator.clipboard.readText();
    // insertText keeps the editor's own undo and fires `input`, like typing.
    doc.execCommand('insertText', false, text);
    return true;
  }
  const text = selectedText(doc, field);
  if (text === '') {
    return true;
  }
  await navigator.clipboard.writeText(text);
  if (action === 'cut' && !isReadOnly(field)) {
    doc.execCommand('delete');
  }
  return true;
}
