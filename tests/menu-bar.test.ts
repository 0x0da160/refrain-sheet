// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Arrow-key cycling through an open menu-bar dropdown must skip disabled
 * items, exactly like the shared `ContextMenu` surface already does (see
 * `tests/context-menu.test.ts`). Regression test for #66.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { MenuBar, type MenuChecks } from '../src/ui/menu-bar';

function stubUi(): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showSqlQuery: vi.fn(async () => undefined),
    showDiff: vi.fn(async () => undefined),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    setBusy: vi.fn(),
  };
}

function menuChecks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    stickyFirstColumn: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    zoom: () => 100,
    editHints: () => true,
    formatActive: () => false,
  };
}

function buildBar(): MenuBar {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const bar = new MenuBar(commands, menuChecks());
  document.body.append(bar.element);
  return bar;
}

describe('menu-bar dropdown keyboard navigation', () => {
  it('skips disabled items when cycling with ArrowDown, like context-menu.ts', () => {
    // With no document open, several File-menu commands (e.g. Reopen,
    // Save) are disabled — only New, Open, and Settings stay enabled.
    const bar = buildBar();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();

    const newItem = Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.menu-item')).find((b) =>
      b.textContent?.includes(t('menu.file.new')),
    )!;
    expect(newItem.disabled).toBe(false);
    newItem.focus();

    newItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // The very next command in menu order (Reopen) is disabled; navigation
    // must land on the next *enabled* item (Open) instead of stopping on it.
    expect(document.activeElement?.textContent).toContain(t('menu.file.open'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    // A run of several disabled commands follows Open (Reopen, Convert, Save,
    // Save Options, Export CSV, Export XLSX — all disabled with no document
    // open): one more ArrowDown must skip all of them in a single press and
    // land on the next enabled item (Settings), never stopping on any of them.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toContain(t('menu.file.settings'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    // Cycling back up from Settings must likewise skip that whole run and
    // return to Open, not stop on any disabled item along the way.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement?.textContent).toContain(t('menu.file.open'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('menu-bar horizontal scroll position', () => {
  it('preserves .menu-row scrollLeft across a re-render triggered by opening a menu', () => {
    // On a narrow/mobile viewport `.menu-row` scrolls horizontally so every
    // menu button fits. Regression test for #261: render() used to rebuild
    // `.menu-row` from scratch on every state change (including every menu
    // open), which reset scrollLeft to 0 and made a tap land on the wrong
    // menu after the user had scrolled the row.
    const bar = buildBar();
    const row = bar.element.querySelector<HTMLElement>('.menu-row')!;
    row.scrollLeft = 40;

    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();

    const rowAfter = bar.element.querySelector<HTMLElement>('.menu-row')!;
    expect(rowAfter.scrollLeft).toBe(40);
  });
});
