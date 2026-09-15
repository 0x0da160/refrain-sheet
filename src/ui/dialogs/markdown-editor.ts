// SPDX-License-Identifier: MIT
import type { MarkdownEditorDialogInput } from '../../app/commands';
import { t } from '../../app/i18n';
import { parseMarkdown } from '../../core/markdown';
import { el } from '../dom';
import { renderMarkdownBlocks } from '../markdown-render';
import { dialogButton, openSidePanel } from './shared';

/**
 * The standalone Markdown editor (#433): a raw-text source pane and a
 * real-time rendered preview pane, plus Open/Save/Save As. Unlike the
 * CSV/RSF tabs, this never touches `AppState` — it edits a single in-memory
 * string, backed by a plain UTF-8 file via `MarkdownEditorDialogInput`'s
 * callbacks (see `src/app/commands.ts`'s `showMarkdownEditor`).
 *
 * The preview is built as DOM nodes from `parseMarkdown`'s AST via `el()`/
 * `textContent` (see `renderInline`/`renderBlock` above) — never as an HTML
 * string — so arbitrary Markdown source (including an embedded `<script>`
 * or other HTML-looking text) can only ever render as literal displayed
 * text, the same guarantee every other surface in this app gives untrusted
 * content (`src/ui/dom.ts`).
 */
export class MarkdownEditorDialogs {
  showMarkdownEditor(input: MarkdownEditorDialogInput): Promise<void> {
    return openSidePanel<void>(t('dialog.markdownEditor.title'), undefined, (body, buttons, close) => {
      body.classList.add('markdown-editor-dialog');
      body.append(el('p', { text: t('dialog.markdownEditor.intro') }));

      let handle: FileSystemFileHandle | null = null;

      const nameLabel = el('label', {
        className: 'form-label',
        text: t('dialog.markdownEditor.name'),
        attrs: { for: 'markdown-editor-name' },
      });
      const nameInput = el('input', {
        attrs: { type: 'text', id: 'markdown-editor-name' },
      }) as HTMLInputElement;
      nameInput.value = input.initialName;
      body.append(el('div', { className: 'form-row' }, [nameLabel, nameInput]));

      const toolbar = el('div', { className: 'markdown-editor-toolbar' });
      const openButton = dialogButton(t('dialog.markdownEditor.open'), false, false, () => void doOpen());
      const saveButton = dialogButton(t('dialog.markdownEditor.save'), false, false, () => void doSave());
      const saveAsButton = dialogButton(
        t('dialog.markdownEditor.saveAs'),
        false,
        false,
        () => void doSaveAs(),
      );
      toolbar.append(openButton, saveButton, saveAsButton);
      body.append(toolbar);

      const panes = el('div', { className: 'markdown-editor-panes' });

      const sourceLabel = el('label', {
        className: 'form-label',
        text: t('dialog.markdownEditor.source'),
        attrs: { for: 'markdown-editor-source' },
      });
      const textarea = el('textarea', {
        className: 'markdown-editor-source',
        attrs: { id: 'markdown-editor-source', spellcheck: 'false' },
      }) as HTMLTextAreaElement;
      const sourcePane = el('div', { className: 'markdown-editor-pane' }, [sourceLabel, textarea]);

      const previewLabel = el('div', { className: 'form-label', text: t('dialog.markdownEditor.preview') });
      const preview = el('div', {
        className: 'markdown-editor-preview',
        attrs: { 'aria-live': 'polite' },
      });
      const previewPane = el('div', { className: 'markdown-editor-pane' }, [previewLabel, preview]);

      panes.append(sourcePane, previewPane);
      body.append(panes);

      const renderPreview = (): void => {
        preview.replaceChildren(...renderMarkdownBlocks(parseMarkdown(textarea.value)));
      };
      textarea.addEventListener('input', renderPreview);
      renderPreview();

      const doOpen = async (): Promise<void> => {
        const opened = await input.open();
        if (!opened) {
          return;
        }
        textarea.value = opened.text;
        nameInput.value = opened.name;
        handle = opened.handle;
        renderPreview();
      };

      const doSave = async (): Promise<void> => {
        const outcome = await input.save(nameInput.value, textarea.value, handle);
        if (outcome?.handle) {
          handle = outcome.handle;
        }
      };

      const doSaveAs = async (): Promise<void> => {
        const outcome = await input.saveAs(nameInput.value, textarea.value);
        if (outcome?.handle) {
          handle = outcome.handle;
          if (outcome.downloadName) {
            nameInput.value = outcome.downloadName;
          }
        }
      };

      buttons.append(dialogButton(t('dialog.markdownEditor.close'), false, true, () => close(undefined)));
    });
  }
}
