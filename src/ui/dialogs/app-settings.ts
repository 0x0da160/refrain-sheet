// SPDX-License-Identifier: MIT
import { t, type LocaleId } from '../../app/i18n';
import { SHORTCUT_DOCS } from '../../app/shortcuts';
import { FUNCTION_INFOS, type FunctionCategory } from '../../core/formula';
import {
  bytesToMiB,
  miBToBytes,
  clampMaxFileSize,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
} from '../../app/settings';
import { listTimeZones } from '../../core/timezone';
import { APP_VERSION_DISPLAY } from '../../app/version';
import { el } from '../dom';
import { dialogButton, externalLink, openDialog } from './shared';

/** Canonical external links (also listed at the top of README.md). */
const SITE_URL = 'https://0x0da160.github.io/refrain-sheet/';
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
   * Edit local settings. Currently the maximum file-size limit (in MiB).
   * Returns the chosen limit in bytes, or null when cancelled. The value is
   * clamped into the supported range before being returned.
   */
  chooseSettings(currentMaxFileSize: number): Promise<number | null> {
    return openDialog<number | null>(t('dialog.settings.title'), null, (body, buttons, close) => {
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
      input.value = String(bytesToMiB(currentMaxFileSize));

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
        el('p', { className: 'dialog-note', text: t('dialog.settings.note') }),
        el('p', { className: 'dialog-note', text: t('dialog.settings.local') }),
      );

      buttons.append(
        dialogButton(t('dialog.settings.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.settings.save'), true, false, () => {
          const mib = Number(input.value);
          if (!Number.isFinite(mib) || mib <= 0) {
            close(null);
            return;
          }
          close(clampMaxFileSize(miBToBytes(mib)));
        }),
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
      );
      buttons.append(
        dialogButton(t('dialog.displayLanguage.cancel'), false, false, () => close(null)),
        dialogButton(t('dialog.displayLanguage.ok'), true, false, () => close(select.value as LocaleId)),
      );
    });
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
      body.append(el('p', { text: t('dialog.about.body') }));
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
      body.append(el('p', { className: 'dialog-note', text: t('dialog.shortcuts.note') }));
      const table = el('table', { className: 'shortcut-table' });
      for (const { keys, descKey } of SHORTCUT_DOCS) {
        table.append(el('tr', {}, [el('td', { text: keys }), el('td', { text: t(descKey) })]));
      }
      body.append(table);
      body.append(el('h3', { text: t('dialog.shortcuts.appearance') }));
      body.append(el('p', { className: 'dialog-note', text: t('dialog.shortcuts.appearanceNote') }));
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
