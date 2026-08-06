// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * At the mobile breakpoint (`@media (max-width: 700px)` in `src/styles.css`)
 * the top-level menu row (`.menu-row`) now scrolls horizontally instead of
 * collapsing behind a hamburger toggle — see #246. CSS gates the scrolling
 * itself on viewport width, which jsdom does not evaluate, so these tests
 * cover the DOM/state contract instead: the row and every top-level menu
 * button are always present (never hidden behind a toggle that has to be
 * tapped first), and there is no leftover hamburger toggle markup or state.
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
    promptGoToCell: vi.fn(async () => null),
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

describe('mobile menu bar (horizontally scrolling, no hamburger toggle)', () => {
  it('renders the top-level menu row directly, with no toggle button or collapsed state', () => {
    const bar = buildBar();
    expect(bar.element.querySelector('.menu-bar-toggle')).toBeNull();
    expect(bar.element.classList.contains('mobile-open')).toBe(false);
    const row = bar.element.querySelector('.menu-row');
    expect(row).not.toBeNull();
    expect(row!.getAttribute('hidden')).toBeNull();
  });

  it('exposes every top-level menu name in the row without any prior interaction', () => {
    const bar = buildBar();
    const labels = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).map((b) => b.textContent);
    expect(labels).toEqual([
      t('menu.file'),
      t('menu.edit'),
      t('menu.search'),
      t('menu.sheet'),
      t('menu.format'),
      t('menu.data'),
      t('menu.view'),
      t('menu.help'),
    ]);
  });

  it('opens a top-level menu directly from the row, with no toggle to tap first', () => {
    const bar = buildBar();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();
    expect(bar.element.querySelector('.menu-list')).not.toBeNull();
  });

  it('closes the open dropdown after a command is selected, and the row stays visible', () => {
    const bar = buildBar();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();
    const newSpreadsheet = Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (b) => b.textContent?.includes(t('menu.file.new')),
    )!;
    newSpreadsheet.click();
    expect(bar.element.querySelector('.menu-list')).toBeNull();
    expect(bar.element.querySelector('.menu-row')).not.toBeNull();
  });
});
