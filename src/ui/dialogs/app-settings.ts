// SPDX-License-Identifier: MIT
import type { VersionHistoryChoice } from '../../app/commands';
import { driveConfigured } from '../../app/drive/config';
import { getLocale, t, type LocaleId } from '../../app/i18n';
import { isSheetFontId, SHEET_FONTS, sheetFontLabelKey } from '../../app/sheet-font';
import { BAND_LEVELS, isBandLevel, type GridLook, type GridLookLayer } from '../../core/grid-look';
import { displayShortcutKeys, isMacPlatform, SHORTCUT_GROUPS } from '../../app/shortcuts';
import { FUNCTION_INFOS, type FunctionCategory } from '../../core/formula';
import {
  bytesToMiB,
  miBToBytes,
  clampMaxFileSize,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
  SHEET_ZOOM_LEVELS,
  type DisplayLevelSettings,
  type LocalSettings,
} from '../../app/settings';
import {
  DEFAULT_HISTORY_SNAPSHOT_LIMIT,
  MAX_RSF_HISTORY_SNAPSHOTS,
  type RsfHistorySnapshot,
} from '../../core/rsf-codec';
import { listTimeZones } from '../../core/timezone';
import { APP_VERSION_DISPLAY } from '../../app/version';
import { el } from '../dom';
import { dialogButton, externalLink, helpDetails, openDialog, submitOnEnter } from './shared';
import { openVersionHistoryPreview } from './version-preview';

/** Formats a stored timestamp for display, in the app's current UI language. */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
}

/** Canonical external links (also listed at the top of README.md). */
const SITE_URL = 'https://app.refrain-sheet.com/';
const RELEASES_URL = 'https://github.com/0x0da160/refrain-sheet/releases/';

/** Display order and heading for each function-help category. */
const FUNCTION_CATEGORY_ORDER: readonly FunctionCategory[] = [
  'math',
  'conditional',
  'logical',
  'lookup',
  'text',
  'date',
  'statistics',
  'arrays',
];
const FUNCTION_CATEGORY_LABEL_KEY: Record<FunctionCategory, string> = {
  math: 'dialog.formulaHelp.category.math',
  conditional: 'dialog.formulaHelp.category.conditional',
  logical: 'dialog.formulaHelp.category.logical',
  lookup: 'dialog.formulaHelp.category.lookup',
  text: 'dialog.formulaHelp.category.text',
  date: 'dialog.formulaHelp.category.date',
  statistics: 'dialog.formulaHelp.category.statistics',
  arrays: 'dialog.formulaHelp.category.arrays',
};

/** Option values and labels of each grid-look picker; `''` (not specified) comes first. */
const LOOK_OPTIONS: Array<{
  key: keyof GridLook;
  labelKey: string;
  options: Array<[string, string]>;
}> = [
  {
    key: 'bands',
    labelKey: 'dialog.settings.bands',
    options: [
      ['on', 'dialog.settings.show'],
      ['off', 'dialog.settings.hide'],
    ],
  },
  {
    key: 'bandLevel',
    labelKey: 'dialog.settings.bandLevel',
    options: BAND_LEVELS.map((level) => [String(level), `dialog.settings.bandLevel.${level}`]),
  },
  {
    key: 'gridlines',
    labelKey: 'dialog.settings.gridlines',
    options: [
      ['on', 'dialog.settings.show'],
      ['off', 'dialog.settings.hide'],
    ],
  },
  {
    key: 'rowHighlight',
    labelKey: 'dialog.settings.rowHighlight',
    options: [
      ['on', 'dialog.settings.highlightOn'],
      ['off', 'dialog.settings.highlightOff'],
    ],
  },
  {
    key: 'colHighlight',
    labelKey: 'dialog.settings.colHighlight',
    options: [
      ['on', 'dialog.settings.highlightOn'],
      ['off', 'dialog.settings.highlightOff'],
    ],
  },
];

/** The grid-look pickers for one settings level (see {@link displayLevelFields}). */
function lookFields(
  idPrefix: string,
  current: GridLookLayer,
  unsetKey: string,
): { rows: HTMLElement[]; read: () => GridLookLayer } {
  const selects = new Map<keyof GridLook, HTMLSelectElement>();
  const rows = LOOK_OPTIONS.map(({ key, labelKey, options }) => {
    const id = `${idPrefix}-${key}`;
    const select = el('select', { attrs: { id } }) as HTMLSelectElement;
    select.append(el('option', { text: t(unsetKey), attrs: { value: '' } }));
    for (const [value, textKey] of options) {
      select.append(el('option', { text: t(textKey), attrs: { value } }));
    }
    const value = current[key];
    select.value =
      value === undefined ? '' : typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
    selects.set(key, select);
    return el('div', { className: 'form-row' }, [
      el('label', { text: t(labelKey), attrs: { for: id } }),
      select,
    ]);
  });
  return {
    rows,
    read: () => {
      const look: GridLookLayer = {};
      for (const [key, select] of selects) {
        if (select.value === '') continue;
        if (key === 'bandLevel') {
          const level = Number(select.value);
          if (isBandLevel(level)) look.bandLevel = level;
        } else {
          look[key] = select.value === 'on';
        }
      }
      return look;
    },
  };
}

/**
 * The zoom, wrap, and font pickers for one level of the layered display settings
 * (browser or file). An empty value means "not specified" — the next level
 * decides. `read` returns the level's values as currently picked.
 */
function displayLevelFields(
  idPrefix: string,
  current: DisplayLevelSettings,
  unsetKey: string,
  fontUnsetKey: string,
  lookUnsetKey: string,
): { rows: HTMLElement[]; read: () => DisplayLevelSettings } {
  const zoomId = `${idPrefix}-zoom`;
  const zoomSelect = el('select', { attrs: { id: zoomId } }) as HTMLSelectElement;
  const levels: number[] = [...SHEET_ZOOM_LEVELS];
  if (current.zoom !== undefined && !levels.includes(current.zoom)) {
    levels.push(current.zoom);
    levels.sort((a, b) => a - b);
  }
  zoomSelect.append(el('option', { text: t(unsetKey), attrs: { value: '' } }));
  for (const level of levels) {
    zoomSelect.append(el('option', { text: `${level}%`, attrs: { value: String(level) } }));
  }
  zoomSelect.value = current.zoom === undefined ? '' : String(current.zoom);

  const wrapId = `${idPrefix}-wrap`;
  const wrapSelect = el('select', { attrs: { id: wrapId } }) as HTMLSelectElement;
  wrapSelect.append(
    el('option', { text: t(unsetKey), attrs: { value: '' } }),
    el('option', { text: t('dialog.settings.wrapOn'), attrs: { value: 'on' } }),
    el('option', { text: t('dialog.settings.wrapOff'), attrs: { value: 'off' } }),
  );
  wrapSelect.value = current.wrap === undefined ? '' : current.wrap ? 'on' : 'off';

  const fontId = `${idPrefix}-font`;
  const fontSelect = el('select', { attrs: { id: fontId } }) as HTMLSelectElement;
  fontSelect.append(el('option', { text: t(fontUnsetKey), attrs: { value: '' } }));
  for (const font of SHEET_FONTS) {
    fontSelect.append(el('option', { text: t(sheetFontLabelKey(font)), attrs: { value: font } }));
  }
  fontSelect.value = current.font ?? '';

  const look = lookFields(idPrefix, current.look, lookUnsetKey);

  return {
    rows: [
      el('div', { className: 'form-row' }, [
        el('label', { text: t('dialog.settings.zoom'), attrs: { for: zoomId } }),
        zoomSelect,
      ]),
      el('div', { className: 'form-row' }, [
        el('label', { text: t('dialog.settings.wrap'), attrs: { for: wrapId } }),
        wrapSelect,
      ]),
      el('div', { className: 'form-row' }, [
        el('label', { text: t('dialog.settings.font'), attrs: { for: fontId } }),
        fontSelect,
      ]),
      ...look.rows,
    ],
    read: () => ({
      zoom: zoomSelect.value === '' ? undefined : Number(zoomSelect.value),
      wrap: wrapSelect.value === '' ? undefined : wrapSelect.value === 'on',
      font: isSheetFontId(fontSelect.value) ? fontSelect.value : undefined,
      look: look.read(),
    }),
  };
}

/**
 * App-level settings and help dialogs: the local settings (max file size),
 * timezone, and display-language prompts, the About/keyboard-shortcuts
 * panel, and the offline formula-help reference. Extracted from `Dialogs` as
 * a cohesive slice (see issue #182, following the `FileIoDialogs` split from
 * #133 and the `SheetOpsDialogs` split from #181) — `Dialogs` still
 * implements the same `UiPort` dialog surface, delegating to an instance of
 * this class.
 */
export class AppSettingsDialogs {
  /**
   * Edit local settings: the maximum file-size limit (in MiB), what
   * Ctrl+Shift+V pastes, and the browser- and file-level zoom/wrap (the file
   * level only when the active tab is an RSF file). Returns the chosen
   * settings, or null when cancelled. The size is clamped into the supported
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

      const browserFields = displayLevelFields(
        'settings-browser',
        current.browserDisplay,
        'dialog.settings.followFile',
        'dialog.settings.fontDefault',
        'dialog.settings.lookDefault',
      );
      const fileFields = current.fileDisplay
        ? displayLevelFields(
            'settings-file',
            current.fileDisplay,
            'dialog.settings.followSheet',
            'dialog.settings.followSheet',
            'dialog.settings.followSheet',
          )
        : null;

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

  /**
   * The Sheet ▸ File Version History… dialog: a checkbox controlling whether
   * this file records a snapshot on every successful save, the per-file
   * retained-snapshot cap (default / a custom number / unlimited), and the
   * recorded snapshots themselves (newest first) each with a Restore action.
   * Clicking Restore closes the dialog immediately with `{ kind: 'restore' }`
   * — the caller confirms and performs the actual restore, since it is a
   * separate, more consequential decision than the enabled/cap settings this
   * dialog's own OK button saves. Cancel (or Escape) resolves null, treated
   * the same as "nothing changed" by the caller. This dialog never deletes
   * anything; clearing recorded snapshots is the separate, explicitly
   * confirmed `sheet.clearVersionHistory`.
   */
  chooseVersionHistory(
    current: boolean,
    maxOverride: number | null | undefined,
    history: readonly RsfHistorySnapshot[],
  ): Promise<VersionHistoryChoice | null> {
    return openDialog<VersionHistoryChoice | null>(
      t('dialog.versionHistory.title'),
      null,
      (body, buttons, close) => {
        const checkboxId = 'version-history-enabled';
        const checkbox = el('input', {
          attrs: { type: 'checkbox', id: checkboxId, 'data-autofocus': 'true' },
        }) as HTMLInputElement;
        checkbox.checked = current;
        body.append(
          el('div', { className: 'form-row' }, [
            checkbox,
            el('label', { text: t('dialog.versionHistory.label'), attrs: { for: checkboxId } }),
          ]),
          el('p', { className: 'dialog-note', text: t('dialog.versionHistory.note') }),
          helpDetails(t('dialog.versionHistory.help')),
        );

        // Retained-snapshot cap: default / an explicit number / unlimited.
        const maxGroupName = 'version-history-max-mode';
        const mode: 'default' | 'custom' | 'unlimited' =
          maxOverride === undefined ? 'default' : maxOverride === null ? 'unlimited' : 'custom';
        const radio = (value: typeof mode): HTMLInputElement =>
          el('input', {
            attrs: { type: 'radio', name: maxGroupName, id: `${maxGroupName}-${value}`, value },
          }) as HTMLInputElement;
        const defaultRadio = radio('default');
        const customRadio = radio('custom');
        const unlimitedRadio = radio('unlimited');
        defaultRadio.checked = mode === 'default';
        customRadio.checked = mode === 'custom';
        unlimitedRadio.checked = mode === 'unlimited';
        const customInput = el('input', {
          className: 'version-history-max-input',
          attrs: {
            type: 'number',
            min: '1',
            max: String(MAX_RSF_HISTORY_SNAPSHOTS),
            step: '1',
          },
        }) as HTMLInputElement;
        customInput.value = String(
          typeof maxOverride === 'number' ? maxOverride : DEFAULT_HISTORY_SNAPSHOT_LIMIT,
        );
        const refreshCustomInput = (): void => {
          customInput.disabled = !customRadio.checked;
        };
        refreshCustomInput();
        for (const r of [defaultRadio, customRadio, unlimitedRadio]) {
          r.addEventListener('change', refreshCustomInput);
        }
        body.append(
          el('div', { className: 'form-row' }, [
            defaultRadio,
            el('label', {
              text: t('dialog.versionHistory.maxDefault', { n: DEFAULT_HISTORY_SNAPSHOT_LIMIT }),
              attrs: { for: defaultRadio.id },
            }),
          ]),
          el('div', { className: 'form-row' }, [
            customRadio,
            el('label', { text: t('dialog.versionHistory.maxCustom'), attrs: { for: customRadio.id } }),
            customInput,
          ]),
          el('div', { className: 'form-row' }, [
            unlimitedRadio,
            el('label', { text: t('dialog.versionHistory.maxUnlimited'), attrs: { for: unlimitedRadio.id } }),
          ]),
        );

        if (history.length === 0) {
          body.append(el('p', { className: 'dialog-note', text: t('dialog.versionHistory.countNone') }));
        } else {
          body.append(
            el('p', {
              className: 'dialog-note',
              text: t('dialog.versionHistory.count', { n: history.length }),
            }),
          );
          const list = el('ul', { className: 'version-history-list' });
          // Newest first for display; `index` still refers to the caller's
          // oldest-first `history` array, which is what `restoreFromSnapshot`
          // and the caller's confirmation expect.
          for (let index = history.length - 1; index >= 0; index--) {
            const snapshot = history[index];
            const previewButton = dialogButton(t('dialog.versionHistory.preview'), false, false, () =>
              this.previewVersionSnapshot(snapshot),
            );
            const restoreButton = dialogButton(t('dialog.versionHistory.restore'), false, false, () =>
              close({ kind: 'restore', index }),
            );
            list.append(
              el('li', { className: 'version-history-entry' }, [
                el('span', { text: formatWhen(snapshot.timestamp) }),
                el('div', { className: 'version-history-entry-actions' }, [previewButton, restoreButton]),
              ]),
            );
          }
          body.append(list);
        }

        const readMaxOverride = (): number | null | undefined => {
          if (unlimitedRadio.checked) {
            return null;
          }
          if (customRadio.checked) {
            const parsed = Math.round(Number(customInput.value));
            return Number.isFinite(parsed)
              ? Math.max(1, Math.min(MAX_RSF_HISTORY_SNAPSHOTS, parsed))
              : DEFAULT_HISTORY_SNAPSHOT_LIMIT;
          }
          return undefined;
        };
        buttons.append(
          dialogButton(t('dialog.versionHistory.cancel'), false, false, () => close(null)),
          dialogButton(t('dialog.versionHistory.ok'), true, false, () =>
            close({ kind: 'save', enabled: checkbox.checked, maxOverride: readMaxOverride() }),
          ),
        );
      },
    );
  }

  /**
   * The "Preview" action next to each version-history entry's Restore
   * button: decodes that snapshot's stored bytes and shows its worksheets
   * read-only, so the user can confirm it is the right one before
   * committing to Restore. Purely informational — it never touches the
   * live document — so it opens on top of the version-history dialog
   * rather than closing it (see `openVersionHistoryPreview`, which builds
   * the actual full-screen, read-only book UI).
   */
  private previewVersionSnapshot(snapshot: RsfHistorySnapshot): void {
    openVersionHistoryPreview(snapshot, formatWhen(snapshot.timestamp));
  }

  /**
   * The About dialog identifies the app itself; Keyboard Shortcuts is an
   * independent Help-menu entry (see `showShortcuts` below) so each stays a
   * single, focused topic instead of one dialog covering both.
   */
  showAbout(section: 'about' | 'shortcuts' = 'about'): Promise<void> {
    return section === 'shortcuts' ? this.showShortcuts() : this.showAboutOnly();
  }

  private showAboutOnly(): Promise<void> {
    return openDialog<void>(t('dialog.about.title'), undefined, (body, buttons, close) => {
      body.append(
        el('p', {
          className: 'about-version',
          text: t('dialog.about.version', { version: APP_VERSION_DISPLAY }),
        }),
      );
      body.append(el('p', { text: t('dialog.about.tagline') }));
      body.append(
        el('p', { text: driveConfigured() ? t('dialog.about.bodyHosted') : t('dialog.about.body') }),
      );
      body.append(el('h3', { text: t('dialog.about.links') }));
      body.append(
        el('ul', { className: 'about-links' }, [
          el('li', {}, [externalLink(t('dialog.about.webApp'), SITE_URL)]),
          el('li', {}, [externalLink(t('dialog.about.releases'), RELEASES_URL)]),
        ]),
      );
      body.append(el('p', { className: 'dialog-note', text: 'MIT License — Copyright (c) 2026 0x0da160' }));
      buttons.append(dialogButton(t('dialog.close'), true, true, () => close(undefined)));
    });
  }

  private showShortcuts(): Promise<void> {
    return openDialog<void>(t('dialog.shortcuts.title'), undefined, (body, buttons, close) => {
      body.append(helpDetails(t('dialog.shortcuts.note'), t('dialog.shortcuts.appearanceNote')));
      // Grouped by task, each key named for this platform (Cmd on macOS).
      const mac = isMacPlatform();
      for (const group of SHORTCUT_GROUPS) {
        body.append(el('h3', { text: t(group.titleKey) }));
        const table = el('table', { className: 'shortcut-table' });
        for (const { keys, descKey } of group.items) {
          table.append(
            el('tr', {}, [
              el('td', { text: displayShortcutKeys(keys, mac) }),
              el('td', { text: t(descKey) }),
            ]),
          );
        }
        body.append(table);
      }
      buttons.append(dialogButton(t('dialog.close'), true, true, () => close(undefined)));
    });
  }

  /**
   * Offline, searchable formula & function help. Function entries are built
   * from `FUNCTION_INFOS` (the same source autocomplete and the evaluator use),
   * so the help can never list a function that is not implemented. Fully
   * keyboard operable via the native <dialog>; the search box filters both the
   * reference sections and the function rows.
   */
  showFormulaHelp(): Promise<void> {
    return openDialog<void>(t('dialog.formulaHelp.title'), undefined, (body, buttons, close) => {
      body.classList.add('formula-help');
      body.append(el('p', { text: t('dialog.formulaHelp.intro') }));

      // ----- Search box -----
      const search = el('input', {
        className: 'formula-help-search',
        attrs: {
          type: 'search',
          'data-autofocus': 'true',
          placeholder: t('dialog.formulaHelp.search'),
          'aria-label': t('dialog.formulaHelp.search'),
        },
      });
      body.append(el('div', { className: 'form-row' }, [search]));

      // Each entry is a searchable block; `text` is matched case-insensitively.
      const entries: Array<{ el: HTMLElement; text: string }> = [];
      const section = (headingKey: string, ...blocks: HTMLElement[]): HTMLElement => {
        const sec = el('section', { className: 'help-section' }, [
          el('h3', { text: t(headingKey) }),
          ...blocks,
        ]);
        entries.push({ el: sec, text: sec.textContent?.toLowerCase() ?? '' });
        return sec;
      };
      const p = (key: string): HTMLElement => el('p', { text: t(key) });
      const code = (text: string): HTMLElement => el('code', { className: 'help-code', text });
      const codeList = (samples: string[]): HTMLElement =>
        el(
          'p',
          { className: 'help-examples' },
          samples.flatMap((s, i) => (i === 0 ? [code(s)] : [document.createTextNode(' '), code(s)])),
        );

      body.append(section('dialog.formulaHelp.section.syntax', p('dialog.formulaHelp.syntaxBody')));
      body.append(
        section(
          'dialog.formulaHelp.section.references',
          p('dialog.formulaHelp.referencesBody'),
          codeList(['A1', 'B2', 'AA10', '$A$1', '$A1', 'A$1']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.ranges',
          p('dialog.formulaHelp.rangesBody'),
          codeList(['A1:B10', 'A:A', 'A:C', '1:1', '2:10']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.operators',
          p('dialog.formulaHelp.operatorsBody'),
          codeList(['+', '-', '*', '/', '( )', '=', '<>', '<', '>', '<=', '>=']),
        ),
      );

      // ----- Functions table (from the shared source of truth), grouped by
      // category so the list reads as a reference rather than one long
      // alphabetical wall; FUNCTION_INFOS is already name-sorted, so each
      // category's rows stay alphabetical too. -----
      const funcSection = el('section', { className: 'help-section' }, [
        el('h3', { text: t('dialog.formulaHelp.section.functions') }),
      ]);
      const categoryGroups: Array<{ el: HTMLElement; rows: Array<{ row: HTMLElement; text: string }> }> = [];
      for (const category of FUNCTION_CATEGORY_ORDER) {
        const infos = FUNCTION_INFOS.filter((info) => info.category === category);
        if (infos.length === 0) {
          continue;
        }
        const table = el('table', { className: 'help-fn-table' });
        table.append(
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: t('dialog.formulaHelp.col.function') }),
              el('th', { text: t('dialog.formulaHelp.col.description') }),
              el('th', { text: t('dialog.formulaHelp.col.example') }),
            ]),
          ]),
        );
        const tbody = el('tbody');
        const rows: Array<{ row: HTMLElement; text: string }> = [];
        for (const info of infos) {
          const desc = t(`formula.fn.${info.name}`);
          const row = el('tr', {}, [
            el('td', {}, [code(info.signature)]),
            el('td', { text: desc }),
            el('td', {}, [code(info.example)]),
          ]);
          tbody.append(row);
          rows.push({ row, text: `${info.name} ${info.signature} ${desc} ${info.example}`.toLowerCase() });
        }
        table.append(tbody);
        const group = el('div', { className: 'help-fn-group' }, [
          el('h4', { text: t(FUNCTION_CATEGORY_LABEL_KEY[category]) }),
          table,
        ]);
        categoryGroups.push({ el: group, rows });
        funcSection.append(group);
      }
      body.append(funcSection);

      // ----- Errors -----
      const errorList = el('ul', { className: 'help-errors' });
      const errors: Array<[string, string]> = [
        ['#ERROR!', 'dialog.formulaHelp.err.error'],
        ['#NAME?', 'dialog.formulaHelp.err.name'],
        ['#VALUE!', 'dialog.formulaHelp.err.value'],
        ['#DIV/0!', 'dialog.formulaHelp.err.div0'],
        ['#REF!', 'dialog.formulaHelp.err.ref'],
        ['#CYCLE!', 'dialog.formulaHelp.err.cycle'],
        ['#N/A', 'dialog.formulaHelp.err.na'],
        ['#NUM!', 'dialog.formulaHelp.err.num'],
        ['#SPILL!', 'dialog.formulaHelp.err.spill'],
        ['#CALC!', 'dialog.formulaHelp.err.calc'],
      ];
      for (const [errCode, descKey] of errors) {
        errorList.append(el('li', {}, [code(errCode), document.createTextNode(` — ${t(descKey)}`)]));
      }
      body.append(
        section('dialog.formulaHelp.section.errors', p('dialog.formulaHelp.errorsIntro'), errorList),
      );

      // ----- Topic sections for the feature areas the functions cover -----
      body.append(
        section(
          'dialog.formulaHelp.section.criteria',
          p('dialog.formulaHelp.criteriaBody'),
          codeList(['"apple"', '"<>apple"', '">10"', '"<=5"', '"*text*"', '"?"', '"~*"']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.lookups',
          p('dialog.formulaHelp.lookupsBody'),
          codeList(['=XLOOKUP(A1,B:B,C:C,"none")', '=VLOOKUP(A1,B1:D9,3,FALSE)', '=MATCH(A1,B1:B9,0)']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.dates',
          p('dialog.formulaHelp.datesBody'),
          codeList(['=DATE(2026,7,25)', '=YEAR(A1)', '=DATEDIF(A1,B1,"Y")', '=TODAY()', '=NOW()']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.text',
          p('dialog.formulaHelp.textBody'),
          codeList(['=LEN(A1)', '=MID(A1,2,3)', '=TEXTJOIN(", ",TRUE,A1:A9)', '=SUBSTITUTE(A1,"-","/")']),
        ),
      );
      body.append(
        section(
          'dialog.formulaHelp.section.arrays',
          p('dialog.formulaHelp.arraysBody'),
          codeList(['=SORT(A1:C9,2,FALSE)', '=UNIQUE(A1:A9)', '=FILTER(A1:C9,B1:B9>5)', '=SEQUENCE(5,2)']),
        ),
      );
      body.append(
        section('dialog.formulaHelp.section.filterVsFilter', p('dialog.formulaHelp.filterVsFilterBody')),
      );

      body.append(
        section('dialog.formulaHelp.section.autocomplete', p('dialog.formulaHelp.autocompleteBody')),
      );

      const noResults = el('p', { className: 'dialog-note', text: t('dialog.formulaHelp.noResults') });
      noResults.hidden = true;
      body.append(noResults);

      const applyFilter = (): void => {
        const q = search.value.trim().toLowerCase();
        let anyVisible = false;
        for (const entry of entries) {
          const show = q === '' || entry.text.includes(q);
          entry.el.hidden = !show;
          anyVisible = anyVisible || show;
        }
        let anyRow = false;
        for (const group of categoryGroups) {
          let anyInGroup = false;
          for (const { row, text } of group.rows) {
            const show = q === '' || text.includes(q);
            row.hidden = !show;
            anyInGroup = anyInGroup || show;
          }
          group.el.hidden = !anyInGroup;
          anyRow = anyRow || anyInGroup;
        }
        funcSection.hidden = !anyRow;
        anyVisible = anyVisible || anyRow;
        noResults.hidden = anyVisible;
      };
      search.addEventListener('input', applyFilter);

      buttons.append(dialogButton(t('dialog.close'), true, false, () => close(undefined)));
    });
  }
}
