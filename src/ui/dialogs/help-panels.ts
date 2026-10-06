// SPDX-License-Identifier: MIT
/**
 * The Help menu's side panels: Formula and Function Help, Keyboard
 * Shortcuts, and About. Each is something read while working on the sheet,
 * so each opens as a side panel beside the grid rather than a dialog over it
 * (design system D-46), only once at a time, and closes with its × or
 * Escape.
 */
import { FunctionSquare, Info, Keyboard } from 'lucide';
import { driveConfigured } from '../../app/drive/config';
import { t } from '../../app/i18n';
import { displayShortcutKeys, isMacPlatform, SHORTCUT_GROUPS } from '../../app/shortcuts';
import { APP_VERSION_DISPLAY } from '../../app/version';
import { FUNCTION_INFOS, type FunctionCategory } from '../../core/formula';
import { el } from '../dom';
import { formSection } from './form-layout';
import { externalLink, helpDetails } from './shared';
import { openSidePanel } from './side-panel';

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

/** Help ▸ About: what the app is, its version, and where it lives. */
export function showAboutPanel(): Promise<void> {
  return openSidePanel<void>(
    { title: t('dialog.about.title'), icon: Info, fallback: undefined, key: 'help.about' },
    (body) => {
      body.classList.add('about-panel');
      body.append(
        formSection(null, [
          el('p', {
            className: 'about-version',
            text: t('dialog.about.version', { version: APP_VERSION_DISPLAY }),
          }),
          el('p', { text: t('dialog.about.tagline') }),
          el('p', { text: driveConfigured() ? t('dialog.about.bodyHosted') : t('dialog.about.body') }),
        ]),
        formSection(t('dialog.about.links'), [
          el('ul', { className: 'about-links' }, [
            el('li', {}, [externalLink(t('dialog.about.webApp'), SITE_URL)]),
            el('li', {}, [externalLink(t('dialog.about.releases'), RELEASES_URL)]),
          ]),
        ]),
        el('p', { className: 'dialog-note', text: 'MIT License — Copyright (c) 2026 0x0da160' }),
      );
    },
  );
}

/** Help ▸ Keyboard Shortcuts: every shortcut, grouped by task, named for this platform. */
export function showShortcutsPanel(): Promise<void> {
  return openSidePanel<void>(
    { title: t('dialog.shortcuts.title'), icon: Keyboard, fallback: undefined, key: 'help.shortcuts' },
    (body) => {
      body.append(helpDetails(t('dialog.shortcuts.note'), t('dialog.shortcuts.appearanceNote')));
      const mac = isMacPlatform();
      for (const group of SHORTCUT_GROUPS) {
        const table = el('table', { className: 'shortcut-table' });
        for (const { keys, descKey } of group.items) {
          table.append(
            el('tr', {}, [
              el('td', { text: displayShortcutKeys(keys, mac) }),
              el('td', { text: t(descKey) }),
            ]),
          );
        }
        body.append(formSection(t(group.titleKey), [table]));
      }
    },
  );
}

/**
 * Help ▸ Formula and Function Help: an offline, searchable reference.
 * Function entries are built from `FUNCTION_INFOS` (the same source
 * autocomplete and the evaluator use), so the help can never list a
 * function that is not implemented. The search box filters both the topic
 * sections and the function entries.
 */
export function showFormulaHelpPanel(): Promise<void> {
  return openSidePanel<void>(
    { title: t('dialog.formulaHelp.title'), icon: FunctionSquare, fallback: undefined, key: 'help.formula' },
    (body) => {
      body.classList.add('formula-help');
      const search = el('input', {
        className: 'formula-help-search',
        attrs: {
          type: 'search',
          'data-autofocus': 'true',
          placeholder: t('dialog.formulaHelp.search'),
          'aria-label': t('dialog.formulaHelp.search'),
        },
      }) as HTMLInputElement;
      body.append(el('p', { text: t('dialog.formulaHelp.intro') }), search);

      const entries: HelpEntry[] = [];
      const section = (headingKey: string, ...blocks: HTMLElement[]): HTMLElement => {
        const sec = formSection(t(headingKey), blocks);
        sec.classList.add('help-section');
        entries.push({ el: sec, text: sec.textContent?.toLowerCase() ?? '' });
        return sec;
      };
      const { funcSection, categoryGroups } = functionList();
      const topics = topicSections(section);
      body.append(...topics.slice(0, 4), funcSection, ...topics.slice(4));

      const noResults = el('p', { className: 'dialog-note', text: t('dialog.formulaHelp.noResults') });
      noResults.hidden = true;
      body.append(noResults);
      search.addEventListener('input', () =>
        filterHelp(search.value.trim().toLowerCase(), entries, categoryGroups, funcSection, noResults),
      );
    },
  );
}

interface HelpEntry {
  el: HTMLElement;
  text: string;
}

interface FunctionGroup {
  el: HTMLElement;
  rows: HelpEntry[];
}

type SectionBuilder = (headingKey: string, ...blocks: HTMLElement[]) => HTMLElement;

const helpCode = (text: string): HTMLElement => el('code', { className: 'help-code', text });

/** Code samples on one line, separated by spaces. */
function helpCodeList(samples: string[]): HTMLElement {
  return el(
    'p',
    { className: 'help-examples' },
    samples.flatMap((s, i) => (i === 0 ? [helpCode(s)] : [document.createTextNode(' '), helpCode(s)])),
  );
}

/**
 * Every topic section, in order: the four on formula syntax (shown before
 * the functions), then errors and the feature-area topics (after them).
 */
function topicSections(section: SectionBuilder): HTMLElement[] {
  const p = (key: string): HTMLElement => el('p', { text: t(key) });
  const s = 'dialog.formulaHelp.section.';
  return [
    section(`${s}syntax`, p('dialog.formulaHelp.syntaxBody')),
    section(
      `${s}references`,
      p('dialog.formulaHelp.referencesBody'),
      helpCodeList(['A1', 'B2', 'AA10', '$A$1', '$A1', 'A$1']),
    ),
    section(
      `${s}ranges`,
      p('dialog.formulaHelp.rangesBody'),
      helpCodeList(['A1:B10', 'A:A', 'A:C', '1:1', '2:10']),
    ),
    section(
      `${s}operators`,
      p('dialog.formulaHelp.operatorsBody'),
      helpCodeList(['+', '-', '*', '/', '&', '( )', '=', '<>', '<', '>', '<=', '>=']),
    ),
    section(`${s}errors`, p('dialog.formulaHelp.errorsIntro'), helpErrorList()),
    section(
      `${s}criteria`,
      p('dialog.formulaHelp.criteriaBody'),
      helpCodeList(['"apple"', '"<>apple"', '">10"', '"<=5"', '"*text*"', '"?"', '"~*"']),
    ),
    section(
      `${s}lookups`,
      p('dialog.formulaHelp.lookupsBody'),
      helpCodeList(['=XLOOKUP(A1,B:B,C:C,"none")', '=VLOOKUP(A1,B1:D9,3,FALSE)', '=MATCH(A1,B1:B9,0)']),
    ),
    section(
      `${s}dates`,
      p('dialog.formulaHelp.datesBody'),
      helpCodeList(['=DATE(2026,7,25)', '=YEAR(A1)', '=DATEDIF(A1,B1,"Y")', '=TODAY()', '=NOW()']),
    ),
    section(
      `${s}text`,
      p('dialog.formulaHelp.textBody'),
      helpCodeList(['=LEN(A1)', '=MID(A1,2,3)', '=TEXTJOIN(", ",TRUE,A1:A9)', '=SUBSTITUTE(A1,"-","/")']),
    ),
    section(
      `${s}arrays`,
      p('dialog.formulaHelp.arraysBody'),
      helpCodeList(['=SORT(A1:C9,2,FALSE)', '=UNIQUE(A1:A9)', '=FILTER(A1:C9,B1:B9>5)', '=SEQUENCE(5,2)']),
    ),
    section(`${s}filterVsFilter`, p('dialog.formulaHelp.filterVsFilterBody')),
    section(`${s}autocomplete`, p('dialog.formulaHelp.autocompleteBody')),
  ];
}

/**
 * The functions (from the shared source of truth), grouped by category so
 * the list reads as a reference rather than one long alphabetical wall;
 * FUNCTION_INFOS is already name-sorted, so each category stays
 * alphabetical too. Each function is one entry (signature, description,
 * example stacked) so it reads in a narrow panel; entries carry their
 * searchable text.
 */
function functionList(): { funcSection: HTMLElement; categoryGroups: FunctionGroup[] } {
  const funcSection = formSection(t('dialog.formulaHelp.section.functions'), []);
  funcSection.classList.add('help-section');
  const categoryGroups: FunctionGroup[] = [];
  for (const category of FUNCTION_CATEGORY_ORDER) {
    const infos = FUNCTION_INFOS.filter((info) => info.category === category);
    if (infos.length === 0) {
      continue;
    }
    const list = el('dl', { className: 'help-fn-list' });
    const rows: HelpEntry[] = [];
    for (const info of infos) {
      const desc = t(`formula.fn.${info.name}`);
      const row = el('div', { className: 'help-fn' }, [
        el('dt', {}, [helpCode(info.signature)]),
        el('dd', { text: desc }),
        el('dd', { className: 'help-fn-example' }, [helpCode(info.example)]),
      ]);
      list.append(row);
      rows.push({ el: row, text: `${info.name} ${info.signature} ${desc} ${info.example}`.toLowerCase() });
    }
    const group = el('div', { className: 'help-fn-group' }, [
      el('h4', { text: t(FUNCTION_CATEGORY_LABEL_KEY[category]) }),
      list,
    ]);
    categoryGroups.push({ el: group, rows });
    funcSection.append(group);
  }
  return { funcSection, categoryGroups };
}

/** Every formula error value with its explanation. */
function helpErrorList(): HTMLElement {
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
    errorList.append(el('li', {}, [helpCode(errCode), document.createTextNode(` — ${t(descKey)}`)]));
  }
  return errorList;
}

/** Show only the help sections and function entries matching `q` (all when empty). */
function filterHelp(
  q: string,
  entries: HelpEntry[],
  categoryGroups: FunctionGroup[],
  funcSection: HTMLElement,
  noResults: HTMLElement,
): void {
  let anyVisible = false;
  for (const entry of entries) {
    const show = q === '' || entry.text.includes(q);
    entry.el.hidden = !show;
    anyVisible = anyVisible || show;
  }
  let anyRow = false;
  for (const group of categoryGroups) {
    let anyInGroup = false;
    for (const { el: row, text } of group.rows) {
      const show = q === '' || text.includes(q);
      row.hidden = !show;
      anyInGroup = anyInGroup || show;
    }
    group.el.hidden = !anyInGroup;
    anyRow = anyRow || anyInGroup;
  }
  funcSection.hidden = !anyRow;
  noResults.hidden = anyVisible || anyRow;
}
