// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The standalone Markdown editor dialog (`MarkdownEditorDialogs.showMarkdownEditor`,
 * #433): a docked side panel (like the SQL/Diff panels) with a source
 * textarea and a real-time rendered preview, plus Open/Save/Save As. It
 * never touches `AppState` — file I/O is injected via
 * `MarkdownEditorDialogInput`'s callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownEditorDialogInput } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { MarkdownEditorDialogs } from '../src/ui/dialogs/markdown-editor';

function input(overrides: Partial<MarkdownEditorDialogInput> = {}): MarkdownEditorDialogInput {
  return {
    initialName: 'untitled.md',
    open: vi.fn(async () => null),
    save: vi.fn(async () => ({ mode: 'overwrite' as const, fellBack: false })),
    saveAs: vi.fn(async () => ({ mode: 'overwrite' as const, fellBack: false })),
    ...overrides,
  };
}

describe('MarkdownEditorDialogs.showMarkdownEditor', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    setLocale(locale);
    document.body.innerHTML = '';
  });

  it('renders as a dockable side panel with a source textarea and a preview pane', async () => {
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input());

    const panel = document.querySelector('.side-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.markdown-editor-dialog')).not.toBeNull();
    const textarea = panel!.querySelector('.markdown-editor-source');
    const preview = panel!.querySelector('.markdown-editor-preview');
    expect(textarea).not.toBeNull();
    expect(preview).not.toBeNull();

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('updates the preview in real time as the source textarea is typed into', async () => {
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input());
    const panel = document.querySelector('.side-panel')!;
    const textarea = panel.querySelector('.markdown-editor-source') as HTMLTextAreaElement;
    const preview = panel.querySelector('.markdown-editor-preview')!;

    textarea.value = '# Hello **world**';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(preview.querySelector('h1')?.textContent).toBe('Hello world');
    expect(preview.querySelector('strong')?.textContent).toBe('world');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('never renders a script-like source as an actual executable element, only as literal preview text', async () => {
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input());
    const panel = document.querySelector('.side-panel')!;
    const textarea = panel.querySelector('.markdown-editor-source') as HTMLTextAreaElement;
    const preview = panel.querySelector('.markdown-editor-preview')!;

    textarea.value = '<script>window.__pwned = true;</script>';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(preview.querySelector('script')).toBeNull();
    expect(preview.textContent).toContain('<script>window.__pwned = true;</script>');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('loads opened text into the source textarea and the filename field', async () => {
    const open = vi.fn(async () => ({
      name: 'notes.md',
      text: 'opened content',
      handle: null,
    }));
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input({ open }));
    const panel = document.querySelector('.side-panel')!;

    const openButton = Array.from(panel.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open'),
    ) as HTMLButtonElement;
    openButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(open).toHaveBeenCalledOnce();
    const textarea = panel.querySelector('.markdown-editor-source') as HTMLTextAreaElement;
    const nameInput = panel.querySelector('#markdown-editor-name') as HTMLInputElement;
    expect(textarea.value).toBe('opened content');
    expect(nameInput.value).toBe('notes.md');
    expect(panel.querySelector('.markdown-editor-preview')?.textContent).toContain('opened content');

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('calls save with the current name/text on Save', async () => {
    const save = vi.fn(async () => ({ mode: 'overwrite' as const, fellBack: false }));
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input({ save, initialName: 'draft.md' }));
    const panel = document.querySelector('.side-panel')!;
    const textarea = panel.querySelector('.markdown-editor-source') as HTMLTextAreaElement;
    textarea.value = 'draft text';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    const saveButton = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save',
    ) as HTMLButtonElement;
    saveButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledWith('draft.md', 'draft text', null);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });

  it('calls saveAs on Save As, not save', async () => {
    const save = vi.fn(async () => ({ mode: 'overwrite' as const, fellBack: false }));
    const saveAs = vi.fn(async () => ({ mode: 'overwrite' as const, fellBack: false }));
    const dialogs = new MarkdownEditorDialogs();
    const promise = dialogs.showMarkdownEditor(input({ save, saveAs }));
    const panel = document.querySelector('.side-panel')!;

    const saveAsButton = Array.from(panel.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save As'),
    ) as HTMLButtonElement;
    saveAsButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(saveAs).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;
  });
});
