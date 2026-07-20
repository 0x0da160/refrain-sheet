// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { t } from '../src/app/i18n';
import { FormulaBar } from '../src/ui/formula-bar';
import { StatusBar } from '../src/ui/status-bar';
import { WelcomeScreen } from '../src/ui/welcome-screen';
import { doc } from './helpers';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRcsvSave: vi.fn(async () => true),
    chooseRcsvSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    chooseInsertShift: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** Mirror main.ts's wiring: the welcome screen shows exactly when no tab is open. */
function setup(overrides: Partial<UiPort> = {}) {
  const ui = stubUi(overrides);
  const state = new AppState();
  const commands = new Commands(state, ui, document);
  const welcome = new WelcomeScreen(commands);
  document.body.append(welcome.element);
  const refresh = () => welcome.refresh(state.tabs.length === 0);
  state.subscribe(refresh);
  refresh();
  return { ui, state, commands, welcome };
}

beforeEach(() => {
  document.body.textContent = '';
});

describe('welcome screen (initial screen)', () => {
  it('is shown on first launch with localized entry points and offline guidance', () => {
    const { welcome } = setup();
    expect(welcome.element.hidden).toBe(false);
    const buttons = welcome.element.querySelectorAll<HTMLButtonElement>('.welcome-action');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe(t('welcome.open'));
    expect(buttons[1].textContent).toBe(t('welcome.new'));
    expect(welcome.element.querySelector('.welcome-drop')!.textContent).toBe(t('welcome.drop'));
    expect(welcome.element.querySelector('.welcome-note')!.textContent).toBe(t('welcome.offline'));
  });

  it('the New Spreadsheet entry point creates a document and hides the screen', () => {
    const { state, welcome } = setup();
    welcome.element.querySelectorAll<HTMLButtonElement>('.welcome-action')[1].click();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].doc.kind).toBe('rcsv');
    expect(welcome.element.hidden).toBe(true);
  });

  it('returns after the last clean tab is closed', async () => {
    const { state, commands, welcome } = setup();
    const tab = state.addTab('a.csv', doc('x,y\n'), null);
    expect(welcome.element.hidden).toBe(true);
    await commands.closeTab(tab);
    expect(state.tabs).toHaveLength(0);
    expect(welcome.element.hidden).toBe(false);
  });

  it('does not return while other tabs remain open', async () => {
    const { state, commands, welcome } = setup();
    const first = state.addTab('a.csv', doc('x\n'), null);
    state.addTab('b.csv', doc('y\n'), null);
    await commands.closeTab(first);
    expect(state.tabs).toHaveLength(1);
    expect(welcome.element.hidden).toBe(true);
  });

  it('closing the final dirty tab after Save completes the save first, then returns', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    const confirmUnsaved = vi.fn(async () => 'save' as const);
    const { state, commands, welcome } = setup({ confirmUnsaved });
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    state.editCell(tab, 0, 0, 'edited');
    expect(tab.doc.isDirty).toBe(true);
    await commands.closeTab(tab);
    expect(confirmUnsaved).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled(); // the save actually ran
    expect(state.tabs).toHaveLength(0);
    expect(welcome.element.hidden).toBe(false);
  });

  it('closing the final dirty tab after Discard returns without saving', async () => {
    const confirmUnsaved = vi.fn(async () => 'discard' as const);
    const { state, commands, welcome } = setup({ confirmUnsaved });
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    state.editCell(tab, 0, 0, 'edited');
    await commands.closeTab(tab);
    expect(state.tabs).toHaveLength(0);
    expect(welcome.element.hidden).toBe(false);
  });

  it('cancelling the close keeps the tab open and the welcome screen hidden', async () => {
    const confirmUnsaved = vi.fn(async () => 'cancel' as const);
    const { state, commands, welcome } = setup({ confirmUnsaved });
    const tab = state.addTab('a.csv', doc('a,b\n'), null);
    state.editCell(tab, 0, 0, 'edited');
    await commands.closeTab(tab);
    expect(state.tabs).toHaveLength(1);
    expect(tab.doc.getValue(0, 0)).toBe('edited');
    expect(welcome.element.hidden).toBe(true);
  });

  it('document-specific UI state is cleared when the last tab closes', async () => {
    const { state, commands } = setup();
    const statusBar = new StatusBar(state, () => undefined);
    const formulaBar = new FormulaBar(state, commands, () => undefined);
    state.subscribe(() => {
      statusBar.render();
      formulaBar.refresh(true);
    });
    const tab = state.addTab('a.csv', doc('hello,world\n'), null);
    statusBar.render();
    formulaBar.refresh(true);
    // Document-specific info is present while the tab is open.
    expect(statusBar.element.textContent).toContain(t('status.encoding'));
    await commands.closeTab(tab);
    // No encoding/selection/dirty info remains; only the app subtitle.
    expect(statusBar.element.textContent).toBe(t('app.subtitle'));
    const textarea = formulaBar.element.querySelector('textarea')!;
    expect(textarea.value).toBe('');
    expect(textarea.disabled).toBe(true);
  });
});
