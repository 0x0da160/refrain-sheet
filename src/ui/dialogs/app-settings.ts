// SPDX-License-Identifier: MIT
import { t, type LocaleId } from '../../app/i18n';
import {
  bytesToMiB,
  miBToBytes,
  clampMaxFileSize,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
  type LocalSettings,
} from '../../app/settings';
import { listTimeZones } from '../../core/workbook/timezone';
import { el } from '../dom';
import { browserFallback, displayLevelFields, labelUnset } from './display-level-fields';
import { dialogButton, helpDetails, openDialog, submitOnEnter } from './shared';

/**
 * App-level settings dialogs: the local settings (max file size), timezone,
 * and display-language prompts (Help's panels are in `help-panels.ts`, File
 * Version History's in `version-history-panel.ts`). Extracted from `Dialogs` as
 * a cohesive slice (see issue #182, following the `FileIoDialogs` split from
 * #133 and the `SheetOpsDialogs` split from #181) — `Dialogs` still
 * implements the same `UiPort` dialog surface, delegating to an instance of
 * this class.
 */
export class AppSettingsDialogs {
  /**
   * Edit local settings: the maximum file-size limit (in MiB), what
   * Ctrl+Shift+V pastes, whether the toolbar and the pixel pets show, and
   * the browser- and file-level zoom/wrap (the file level only when the
   * active tab is an RSF file). Returns the chosen settings, or null when
   * cancelled. The size is clamped into the supported
   * range before being returned.
   */
  chooseSettings(current: LocalSettings): Promise<LocalSettings | null> {
    return openDialog<LocalSettings | null>(t('dialog.settings.title'), null, (body, buttons, close) => {
      const minMiB = bytesToMiB(MIN_MAX_FILE_SIZE);
      const maxMiB = bytesToMiB(MAX_MAX_FILE_SIZE);
      const input = el('input', {
        attrs: {
          type: 'number',
          min: String(minMiB),
          max: String(maxMiB),
          step: '1',
          'data-autofocus': 'true',
          'aria-describedby': 'settings-maxsize-help',
        },
      });
      input.value = String(bytesToMiB(current.maxFileSize));

      const pasteId = 'settings-shift-paste';
      const pasteSelect = el('select', { attrs: { id: pasteId } }) as HTMLSelectElement;
      for (const mode of ['values', 'formats'] as const) {
        const option = el('option', {
          text: t(`dialog.settings.shiftPaste.${mode}`),
          attrs: { value: mode },
        });
        (option as HTMLOptionElement).selected = mode === current.shiftPaste;
        pasteSelect.append(option);
      }

      const toolbarId = 'settings-show-toolbar';
      const toolbarCheck = el('input', { attrs: { type: 'checkbox', id: toolbarId } }) as HTMLInputElement;
      toolbarCheck.checked = current.showToolbar;

      const petsId = 'settings-show-pets';
      const petsCheck = el('input', { attrs: { type: 'checkbox', id: petsId } }) as HTMLInputElement;
      petsCheck.checked = current.showPets;

      // "Not specified" names what then applies: for this browser, the
      // default (zoom and wrap: the value last used); for the file, this
      // browser's choice as currently picked, so it follows edits above.
      const browserFields = displayLevelFields('settings-browser', current.browserDisplay);
      labelUnset(browserFields, browserFallback, (key) =>
        key === 'zoom' || key === 'wrap' ? 'dialog.settings.unsetLastUsed' : 'dialog.settings.unsetDefault',
      );
      const fileFields = current.fileDisplay
        ? displayLevelFields('settings-file', current.fileDisplay)
        : null;
      if (fileFields) {
        const relabel = (): void =>
          labelUnset(
            fileFields,
            (key) => browserFields.selects.get(key)!.value || browserFallback(key),
            () => 'dialog.settings.unsetBrowser',
          );
        relabel();
        for (const select of browserFields.selects.values()) select.addEventListener('change', relabel);
      }

      body.append(
        el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.settings.maxFileSize') }, [
            input,
            el('span', { className: 'form-unit', text: t('dialog.settings.mib') }),
          ]),
        ]),
        el('p', {
          className: 'dialog-note',
          text: t('dialog.settings.range', { min: minMiB, max: maxMiB }),
          attrs: { id: 'settings-maxsize-help' },
        }),
        helpDetails(t('dialog.settings.note')),
        el('div', { className: 'form-row' }, [
          el('label', { text: t('dialog.settings.shiftPaste'), attrs: { for: pasteId } }),
          pasteSelect,
        ]),
        helpDetails(t('dialog.settings.shiftPasteNote')),
        el('div', { className: 'form-row' }, [
          toolbarCheck,
          el('label', { text: t('dialog.settings.showToolbar'), attrs: { for: toolbarId } }),
        ]),
        el('div', { className: 'form-row' }, [
          petsCheck,
          el('label', { text: t('dialog.settings.showPets'), attrs: { for: petsId } }),
        ]),
        el('h3', { text: t('dialog.settings.display') }),
        el('p', { className: 'dialog-note', text: t('dialog.settings.displayOrder') }),
        el('h4', { text: t('dialog.settings.browserLevel') }),
        ...browserFields.rows,
      );
      if (fileFields) {
        body.append(
          el('h4', { text: t('dialog.settings.fileLevel') }),
          ...fileFields.rows,
          el('p', { className: 'dialog-note', text: t('dialog.settings.fileLevelNote') }),
        );
      }
      body.append(helpDetails(t('dialog.settings.sheetLevelNote'), t('dialog.settings.local')));

      const submit = (): void => {
        const mib = Number(input.value);
        if (!Number.isFinite(mib) || mib <= 0) {
          close(null);
          return;
        }
        close({
          maxFileSize: clampMaxFileSize(miBToBytes(mib)),
          shiftPaste: pasteSelect.value === 'formats' ? 'formats' : 'values',
          showToolbar: toolbarCheck.checked,
          showPets: petsCheck.checked,
          browserDisplay: browserFields.read(),
          fileDisplay: fileFields ? fileFields.read() : null,
        });
      };
      submitOnEnter(input, submit);

      buttons.append(
        dialogButton(t('dialog.settings.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.settings.save'), true, false, submit),
      );
    });
  }

  /**
   * The workbook Timezone… dialog: a searchable-by-typing native `<select>`
   * listing every IANA zone the runtime knows (see `listTimeZones`), with
   * `current` preselected. Resolves with the chosen zone, or null when
   * cancelled — the caller treats "unchanged" and "cancelled" the same way.
   */
  chooseTimezone(current: string): Promise<string | null> {
    return openDialog<string | null>(t('dialog.timezone.title'), null, (body, buttons, close) => {
      const selectId = 'timezone-select';
      const select = el('select', {
        attrs: { id: selectId, 'data-autofocus': 'true' },
      }) as HTMLSelectElement;
      for (const zone of listTimeZones()) {
        const option = el('option', { text: zone, attrs: { value: zone } }) as HTMLOptionElement;
        if (zone === current) {
          option.selected = true;
        }
        select.append(option);
      }
      body.append(
        el('label', { text: t('dialog.timezone.label'), attrs: { for: selectId } }),
        select,
        el('p', { className: 'dialog-note', text: t('dialog.timezone.note') }),
        helpDetails(t('dialog.timezone.help')),
      );
      buttons.append(
        dialogButton(t('dialog.timezone.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.timezone.ok'), true, false, () => close(select.value)),
      );
    });
  }

  /**
   * The workbook Display language… dialog: a two-option `<select>` (English /
   * Japanese, the app's only two catalogs), with `current` preselected.
   * Resolves with the chosen language, or null when cancelled — the caller
   * treats "unchanged" and "cancelled" the same way.
   */
  chooseDisplayLanguage(current: LocaleId): Promise<LocaleId | null> {
    return openDialog<LocaleId | null>(t('dialog.displayLanguage.title'), null, (body, buttons, close) => {
      const selectId = 'display-language-select';
      const select = el('select', {
        attrs: { id: selectId, 'data-autofocus': 'true' },
      }) as HTMLSelectElement;
      const options: LocaleId[] = ['en', 'ja'];
      for (const language of options) {
        const option = el('option', { text: t(`language.${language}`), attrs: { value: language } });
        (option as HTMLOptionElement).selected = language === current;
        select.append(option);
      }
      body.append(
        el('label', { text: t('dialog.displayLanguage.label'), attrs: { for: selectId } }),
        select,
        el('p', { className: 'dialog-note', text: t('dialog.displayLanguage.note') }),
        helpDetails(t('dialog.displayLanguage.help')),
      );
      buttons.append(
        dialogButton(t('dialog.displayLanguage.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.displayLanguage.ok'), true, false, () => close(select.value as LocaleId)),
      );
    });
  }
}
