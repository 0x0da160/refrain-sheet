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
import { doc as csvDoc } from './helpers';

function stubUi(): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    promptDriveName: async () => null,
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    confirmExportJson: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    chooseColumnMenu: vi.fn(async () => null),
    chooseSort: vi.fn(async () => null),
    chooseDataValidation: vi.fn(async () => null),
    chooseConditionalFormat: vi.fn(async () => null),
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
    chooseVersionHistory: vi.fn(async () => null),
    confirmHistoryCapExceeded: vi.fn(async () => true),
    chooseTextColor: vi.fn(async () => null),
    chooseBackgroundColor: vi.fn(async () => null),
    chooseBorders: vi.fn(async () => null),
    chooseNumberFormat: vi.fn(async () => null),
    chooseRecentFile: vi.fn(async () => null),
    setBusy: vi.fn(),
  };
}

function menuChecks(): MenuChecks {
  return {
    wrap: () => false,
    stickyFirstRow: () => false,
    stickyFirstColumn: () => false,
    freezeAtSelection: () => false,
    sheetFont: () => 'biz-ud',
    theme: () => 'system',
    density: () => 'standard',
    bandedRows: () => false,
    zoom: () => 100,
    editHints: () => true,
    autoFitOnOpen: () => true,
    commentsPanel: () => false,
    fullscreen: () => false,
    formatActive: () => false,
    driveAvailable: () => false,
    protectedDoc: () => false,
    sheetLocked: () => false,
    headerFilter: () => false,
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
    // With no document open, File > Save is disabled; Reopen, Save Options,
    // Convert, and the export commands are no longer flat File-menu items —
    // they live inside the Export/Document submenus (#518), whose *parent*
    // entries stay clickable regardless of what's disabled inside them. So
    // New, New CSV, Open, Export, Document, and Settings all stay enabled;
    // only Save is skipped.
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

    // New CSV sits directly after New, both enabled, so this single step
    // lands there without skipping anything.
    newItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toContain(t('menu.file.newCsv'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    // The very next command in menu order (Open) is enabled, so this lands
    // there directly.
    expect(document.activeElement?.textContent).toContain(t('menu.file.open'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    // Save (the very next item) is disabled with no document open: one
    // ArrowDown must skip it and land on the Export submenu parent, which is
    // always clickable regardless of its (all-disabled) contents.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toContain(t('menu.file.export'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    // Cycling back up from Export must return to Open, skipping Save.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement?.textContent).toContain(t('menu.file.open'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('menu-bar disabled-item tooltips (#293)', () => {
  it('shows the RSF-only explanation as a tooltip on the disabled Format menu items on a CSV tab', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    state.addTab('t.csv', csvDoc('a,b\n'), null);
    const bar = new MenuBar(commands, menuChecks());
    document.body.append(bar.element);
    const formatButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.format'))!;
    formatButton.click();

    const boldItem = Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.menu-item')).find((b) =>
      b.textContent?.includes(t('menu.format.bold')),
    )!;
    expect(boldItem.disabled).toBe(true);
    expect(boldItem.title).toBe(t('menu.format.csvOnlyTooltip'));
  });

  it('leaves no tooltip on an enabled item', () => {
    const bar = buildBar();
    const fileButton = Array.from(
      bar.element.querySelectorAll<HTMLButtonElement>('.menu-row .menu > button'),
    ).find((b) => b.textContent === t('menu.file'))!;
    fileButton.click();

    const newItem = Array.from(bar.element.querySelectorAll<HTMLButtonElement>('.menu-item')).find((b) =>
      b.textContent?.includes(t('menu.file.new')),
    )!;
    expect(newItem.disabled).toBe(false);
    expect(newItem.title).toBe('');
  });
});
