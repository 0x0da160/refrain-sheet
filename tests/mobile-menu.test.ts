// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The mobile hamburger toggle (`.menu-bar-toggle`) added in front of the
 * top-level menu row (`.menu-row`). CSS gates its visibility on viewport
 * width, which jsdom does not evaluate, so these tests cover the DOM/state
 * contract instead: the toggle exists, flips `aria-expanded` and the
 * `mobile-open` class, is reachable via a localized accessible name, and a
 * command selection collapses it again.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { getLocale, setLocale, t } from '../src/app/i18n';
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
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    setBusy: vi.fn(),
  };
}

function menuChecks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    zoom: () => 100,
    editHints: () => true,
  };
}

function buildBar(): MenuBar {
  const state = new AppState();
  const commands = new Commands(state, stubUi(), document);
  const bar = new MenuBar(commands, menuChecks());
  document.body.append(bar.element);
  return bar;
}

describe('mobile hamburger menu toggle', () => {
  it('renders a toggle button with a localized accessible name, collapsed by default', () => {
    setLocale('en');
    const bar = buildBar();
    const toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-label')).toBe(t('menu.mobileToggle'));
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(bar.element.classList.contains('mobile-open')).toBe(false);
    // Decorative glyph: the accessible name comes from aria-label, not the
    // visible character, so it must not double-announce.
    const glyph = toggle!.querySelector('.menu-bar-toggle-icon');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('localizes the accessible name', () => {
    const locale = getLocale();
    try {
      setLocale('ja');
      const bar = buildBar();
      const toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
      expect(toggle.getAttribute('aria-label')).toBe('メニュー');
    } finally {
      setLocale(locale);
    }
  });

  it('reveals the menu row and flips aria-expanded when tapped', () => {
    const bar = buildBar();
    const toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    toggle.click();
    expect(bar.element.classList.contains('mobile-open')).toBe(true);
    const reopenedToggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    expect(reopenedToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses again on a second tap', () => {
    const bar = buildBar();
    let toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    toggle.click();
    toggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    toggle.click();
    expect(bar.element.classList.contains('mobile-open')).toBe(false);
    const finalToggle = bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!;
    expect(finalToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('still opens a top-level menu from the revealed row, unchanged from desktop', () => {
    const bar = buildBar();
    bar.element.querySelector<HTMLButtonElement>('.menu-bar-toggle')!.click();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();
    expect(bar.element.querySelector('.menu-list')).not.toBeNull();
  });

  it('collapses the hamburger row after a command is selected', () => {
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
    expect(bar.element.classList.contains('mobile-open')).toBe(false);
    expect(bar.element.querySelector('.menu-bar-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });
});
