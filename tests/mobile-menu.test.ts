// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * At the mobile breakpoint (`@media (max-width: 700px)` in `src/styles.css`)
 * the top-level menu row (`.menu-row`) now collapses behind a hamburger
 * toggle (`.menu-bar-toggle`) and, once expanded, wraps onto its own
 * full-width row below the logo row instead of scrolling horizontally beside
 * it — see #267, which supersedes the "no toggle, horizontal scroll instead"
 * decision from #246. The old horizontal-scroll strip combined with iOS
 * Safari dispatching a synthetic click at the finger's original touch
 * coordinates after inertial scroll, so a tap could open a different item
 * than the one touched; removing the scroll interaction removes that failure
 * mode entirely. CSS gates the collapse/expand itself on viewport width,
 * which jsdom does not evaluate, so these tests cover the DOM/state contract
 * instead: the toggle's `aria-expanded` and `.menu-row`'s `open` class always
 * agree, regardless of viewport.
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
    chooseCellComment: vi.fn(async () => null),
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

describe('mobile menu bar (hamburger toggle, expands below the logo row)', () => {
  it('starts with the row collapsed behind a toggle whose aria-expanded is false', () => {
    const bar = buildBar();
    const toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(bar.element.querySelector('.menu-row')!.classList.contains('open')).toBe(false);
  });

  it('exposes every top-level menu name in the row once the toggle is expanded', () => {
    const bar = buildBar();
    bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!.click();
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

  it('flips the toggle back to collapsed when clicked a second time', () => {
    const bar = buildBar();
    const toggle = () => bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    toggle().click();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(bar.element.querySelector('.menu-row')!.classList.contains('open')).toBe(false);
  });

  it('opens a top-level menu from the expanded row', () => {
    const bar = buildBar();
    bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!.click();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();
    expect(bar.element.querySelector('.menu-list')).not.toBeNull();
  });

  it('collapses the row again once a command is selected', () => {
    const bar = buildBar();
    bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!.click();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();
    const newSpreadsheet = Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (b) => b.textContent?.includes(t('menu.file.new')),
    )!;
    newSpreadsheet.click();
    expect(bar.element.querySelector('.menu-list')).toBeNull();
    const toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(bar.element.querySelector('.menu-row')!.classList.contains('open')).toBe(false);
  });
});
