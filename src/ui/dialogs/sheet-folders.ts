// SPDX-License-Identifier: MIT
/**
 * The sheet folder dialogs: a folder's name, and Move to Folder (see
 * `SheetFolderCommands`). `Dialogs` delegates to these.
 */
import type { FolderPickerInput } from '../../app/ui-port';
import { t } from '../../app/i18n';
import { MAX_SHEET_NAME_LENGTH } from '../../core/formula';
import { el } from '../dom';
import { formFieldWithStatus } from './form-layout';
import { dialogButton, openDialog, submitOnEnter } from './shared';

/** Ask for a folder name; resolves with it trimmed, or null when cancelled. */
export function promptFolderName(
  mode: 'create' | 'rename',
  current: string,
  validate: (name: string) => string | null,
): Promise<string | null> {
  return openDialog<string | null>(
    t(`dialog.folderName.title.${mode}`),
    null,
    (body, buttons, close) => {
      const input = el('input', {
        className: 'sheet-name-input',
        attrs: {
          type: 'text',
          id: 'folder-name-input',
          maxlength: String(MAX_SHEET_NAME_LENGTH),
          'aria-describedby': 'folder-name-error',
          'data-autofocus': 'true',
        },
      }) as HTMLInputElement;
      input.value = current;
      const error = el('p', {
        className: 'dialog-error',
        attrs: { id: 'folder-name-error', role: 'status', 'aria-live': 'polite' },
      });
      const okButton = dialogButton(t(`dialog.folderName.ok.${mode}`), true, false, () => submit());
      const refresh = (): boolean => {
        const message = validate(input.value);
        error.textContent = message ?? '';
        okButton.disabled = message !== null;
        return message === null;
      };
      const submit = (): void => {
        if (refresh()) {
          close(input.value.trim());
        }
      };
      input.addEventListener('input', () => refresh());
      submitOnEnter(input, submit);
      body.append(formFieldWithStatus(t('dialog.folderName.label'), input, error));
      refresh();
      buttons.append(
        dialogButton(t('dialog.folderName.cancel'), false, false, () => close(null)),
        okButton,
      );
    },
    'sm',
  );
}

/**
 * Move to Folder: the top level and every folder as a radio list, indented
 * by depth, with where the item is now preselected.
 */
export function chooseFolder(input: FolderPickerInput): Promise<{ folderId: string | null } | null> {
  return openDialog<{ folderId: string | null } | null>(
    t(`dialog.moveToFolder.title.${input.subject}`, { name: input.name }),
    null,
    (body, buttons, close) => {
      let selected = input.current;
      const list = el('div', {
        className: 'folder-picker',
        attrs: { role: 'radiogroup', 'aria-label': t('dialog.moveToFolder.label') },
      });
      input.options.forEach((option, index) => {
        const radio = el('input', {
          attrs: { type: 'radio', name: 'folder-picker', id: `folder-picker-${index}` },
        }) as HTMLInputElement;
        radio.checked = option.id === input.current;
        if (radio.checked) {
          radio.dataset.autofocus = 'true';
        }
        radio.addEventListener('change', () => {
          if (radio.checked) {
            selected = option.id;
          }
        });
        const label = el('label', { className: 'folder-picker-option', attrs: { for: radio.id } }, [
          radio,
          el('span', { text: option.name }),
        ]);
        // The top level has no indent; a folder is indented by its depth.
        label.style.paddingInlineStart = `calc(var(--space-2) + ${option.id === null ? 0 : option.depth + 1} * var(--space-4))`;
        list.append(label);
      });
      body.append(list);
      buttons.append(
        dialogButton(t('dialog.moveToFolder.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.moveToFolder.ok'), true, false, () => close({ folderId: selected })),
      );
    },
    'sm',
  );
}
