// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Opening a dialog/popover/docked panel, or the Find/Replace bar, autofocuses
 * a text field the instant it appears. On a touch-primary device that pops
 * the on-screen keyboard without the user ever tapping the field — the same
 * category of bug already fixed for the grid's tap-to-select (#469) — since
 * it reported reproducing on "入力欄全体" (every input field), not just the
 * grid (#497). `focusWithoutKeyboard` (`ui/dom.ts`) is the shared fix,
 * reusing the sink's own technique: briefly marking a text input/textarea
 * `readOnly` around the `.focus()` call suppresses the keyboard for that one
 * focus transition without preventing DOM focus itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';
import { focusWithoutKeyboard } from '../src/ui/dom';
import { FindBar } from '../src/ui/find-bar';
import { Grid } from '../src/ui/grid';
import { doc } from './helpers';

function stubMatchMedia(coarsePointer: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' && coarsePointer,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })),
  );
}

/** Spies on `field`'s `.focus()`, recording whether it was marked `readOnly`
 * — the standard technique for moving DOM focus without triggering a mobile
 * on-screen keyboard — at the moment each call fired. */
function spyOnFocus(field: HTMLInputElement | HTMLTextAreaElement): {
  readOnlyAtEachFocus: boolean[];
  restore: () => void;
} {
  const readOnlyAtEachFocus: boolean[] = [];
  const proto =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const focusSpy = vi.spyOn(proto, 'focus').mockImplementation(function (
    this: HTMLInputElement | HTMLTextAreaElement,
  ) {
    if (this === field) {
      readOnlyAtEachFocus.push(this.readOnly);
    }
  });
  return { readOnlyAtEachFocus, restore: () => focusSpy.mockRestore() };
}

describe('focusWithoutKeyboard (#497)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('focuses a text input read-only, then restores it, on a coarse-pointer (touch) device', () => {
    stubMatchMedia(true);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    const { readOnlyAtEachFocus, restore } = spyOnFocus(input);
    focusWithoutKeyboard(input);
    expect(readOnlyAtEachFocus).toEqual([true]);
    expect(input.readOnly).toBe(false);
    restore();
    input.remove();
  });

  it('focuses a textarea read-only, then restores it, on a coarse-pointer (touch) device', () => {
    stubMatchMedia(true);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const { readOnlyAtEachFocus, restore } = spyOnFocus(textarea);
    focusWithoutKeyboard(textarea);
    expect(readOnlyAtEachFocus).toEqual([true]);
    expect(textarea.readOnly).toBe(false);
    restore();
    textarea.remove();
  });

  it('focuses a text input normally on a fine-pointer (mouse) device', () => {
    stubMatchMedia(false);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    const { readOnlyAtEachFocus, restore } = spyOnFocus(input);
    focusWithoutKeyboard(input);
    expect(readOnlyAtEachFocus).toEqual([false]);
    restore();
    input.remove();
  });

  it('never touches readOnly on a non-text-field element (no keyboard to suppress)', () => {
    stubMatchMedia(true);
    const button = document.createElement('button');
    document.body.append(button);
    const focusSpy = vi.spyOn(button, 'focus');
    focusWithoutKeyboard(button);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    button.remove();
  });
});

const noopUi: UiPort = {
  confirmValidation: async () => true,
  confirmUnsaved: async () => 'discard',
  chooseSaveOptions: async () => null,
  promptDriveName: async () => null,
  confirmUnrepresentable: async () => false,
  notifyNcr: async () => undefined,
  confirmUndecodableEdit: async () => true,
  chooseReopen: async () => null,
  confirmConvert: async () => true,
  explainRsfSave: async () => true,
  chooseRsfSave: async () => 2,
  chooseExportCsv: async () => ({
    encoding: 'utf-8' as const,
    bom: false,
    lineEnding: 'lf' as const,
    delimiter: 'keep' as const,
    quoteStyle: 'minimal' as const,
  }),
  confirmExportXlsx: vi.fn(async () => true),
  confirmExportJson: vi.fn(async () => true),
  chooseInsertShift: async () => null,
  confirmFlashFill: async () => false,
  chooseFilter: async () => null,
  chooseSort: async () => null,
  chooseDataValidation: async () => null,
  chooseConditionalFormat: async () => null,
  chooseCellComment: async () => null,
  promptSheetName: async () => null,
  confirmDeleteSheet: async () => true,
  chooseExportSheet: async () => null,
  confirmReplaceAllWorkbook: async () => true,
  confirmRangeMoveOverwrite: async () => true,
  promptMoveTarget: async () => null,
  promptGoToCell: async () => null,
  confirm: async () => true,
  showMessage: async () => undefined,
  notify: () => undefined,
  openFindBar: () => undefined,
  findNext: () => undefined,
  showAbout: () => undefined,
  showFormulaHelp: () => undefined,
  showSqlQuery: vi.fn(async () => undefined),
  showDiff: vi.fn(async () => undefined),
  chooseSettings: async () => null,
  chooseTimezone: async () => null,
  chooseDisplayLanguage: async () => null,
  chooseTextColor: async () => null,
  chooseBackgroundColor: async () => null,
  chooseBorders: async () => null,
  chooseNumberFormat: async () => null,
  setBusy: () => undefined,
};

describe('the Find/Replace bar does not pop the on-screen keyboard when opened on a touch device (#497)', () => {
  beforeEach(() => {
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('focuses the find field read-only on a coarse-pointer device, then still selects its text', () => {
    stubMatchMedia(true);
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    state.addTab('data.csv', doc('foo,x\n'), null);
    const findBar = new FindBar(state, commands, grid);
    document.body.append(findBar.element);
    const findInput = findBar.element.querySelector<HTMLInputElement>('input[type="text"]')!;
    findInput.value = 'foo';
    const { readOnlyAtEachFocus, restore } = spyOnFocus(findInput);
    const selectSpy = vi.spyOn(findInput, 'select');
    findBar.open(false);
    expect(readOnlyAtEachFocus).toEqual([true]);
    expect(findInput.readOnly).toBe(false);
    expect(selectSpy).toHaveBeenCalled();
    restore();
  });

  it('focuses the find field normally on a mouse device', () => {
    stubMatchMedia(false);
    const state = new AppState();
    const commands = new Commands(state, noopUi, document);
    const grid = new Grid(state, commands);
    document.body.append(grid.element);
    state.addTab('data.csv', doc('foo,x\n'), null);
    const findBar = new FindBar(state, commands, grid);
    document.body.append(findBar.element);
    const findInput = findBar.element.querySelector<HTMLInputElement>('input[type="text"]')!;
    const { readOnlyAtEachFocus, restore } = spyOnFocus(findInput);
    findBar.open(false);
    expect(readOnlyAtEachFocus).toEqual([false]);
    restore();
  });
});

describe('dialog autofocus does not pop the on-screen keyboard on a touch device (#497)', () => {
  const locale = getLocale();

  // jsdom does not implement <dialog>.showModal(); the shim only needs to
  // make the element "open" so its content is queryable (see
  // dialog-confirm-focus.test.ts).
  beforeEach(() => {
    setLocale('en');
    document.body.textContent = '';
    const proto = HTMLDialogElement.prototype as unknown as {
      showModal?: () => void;
      close?: () => void;
    };
    if (typeof proto.showModal !== 'function') {
      proto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      proto.close = function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  afterEach(() => {
    setLocale(locale);
    vi.unstubAllGlobals();
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  it('autofocuses the move-target text input read-only on a coarse-pointer device', () => {
    stubMatchMedia(true);
    const spy = vi.spyOn(HTMLInputElement.prototype, 'focus');
    let readOnlyAtFocus: boolean | null = null;
    spy.mockImplementation(function (this: HTMLInputElement) {
      if (this.classList.contains('move-target-input')) {
        readOnlyAtFocus = this.readOnly;
      }
    });
    void new Dialogs().promptMoveTarget('A1:B2', 'C1', () => null);
    const input = document.querySelector<HTMLInputElement>('.move-target-input')!;
    expect(readOnlyAtFocus).toBe(true);
    expect(input.readOnly).toBe(false);
    spy.mockRestore();
  });

  it('autofocuses the move-target text input normally on a mouse device', () => {
    stubMatchMedia(false);
    const spy = vi.spyOn(HTMLInputElement.prototype, 'focus');
    let readOnlyAtFocus: boolean | null = null;
    spy.mockImplementation(function (this: HTMLInputElement) {
      if (this.classList.contains('move-target-input')) {
        readOnlyAtFocus = this.readOnly;
      }
    });
    void new Dialogs().promptMoveTarget('A1:B2', 'C1', () => null);
    expect(readOnlyAtFocus).toBe(false);
    spy.mockRestore();
  });
});
