// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { readFileObject, type OpenedFile } from '../src/app/file-access';
import {
  DEFAULT_MAX_FILE_SIZE,
  MIN_MAX_FILE_SIZE,
  MAX_MAX_FILE_SIZE,
  clampMaxFileSize,
  getMaxFileSize,
  setMaxFileSize,
  bytesToMiB,
  miBToBytes,
} from '../src/app/settings';

const MIB = 1024 * 1024;

beforeEach(() => {
  globalThis.localStorage?.clear();
});

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
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => ({
      encoding: 'utf-8' as const,
      bom: false,
      lineEnding: 'lf' as const,
    })),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
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

describe('settings: file-size limit', () => {
  it('defaults to 512 MiB when nothing is stored', () => {
    expect(getMaxFileSize()).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(DEFAULT_MAX_FILE_SIZE).toBe(512 * MIB);
  });

  it('clamps into the supported range', () => {
    expect(clampMaxFileSize(0)).toBe(MIN_MAX_FILE_SIZE);
    expect(clampMaxFileSize(MIN_MAX_FILE_SIZE - 1)).toBe(MIN_MAX_FILE_SIZE);
    expect(clampMaxFileSize(MAX_MAX_FILE_SIZE + 1)).toBe(MAX_MAX_FILE_SIZE);
    expect(clampMaxFileSize(Number.NaN)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(clampMaxFileSize(64 * MIB)).toBe(64 * MIB);
  });

  it('persists a chosen limit locally and reads it back (clamped)', () => {
    const applied = setMaxFileSize(64 * MIB);
    expect(applied).toBe(64 * MIB);
    expect(getMaxFileSize()).toBe(64 * MIB);

    // Above the max is clamped on write.
    expect(setMaxFileSize(8 * 1024 * MIB)).toBe(MAX_MAX_FILE_SIZE);
    expect(getMaxFileSize()).toBe(MAX_MAX_FILE_SIZE);
  });

  it('recovers from corrupt stored values', () => {
    globalThis.localStorage.setItem('refrain-csv-html.maxFileSize', 'not-a-number');
    expect(getMaxFileSize()).toBe(DEFAULT_MAX_FILE_SIZE);
  });

  it('converts between bytes and MiB', () => {
    expect(bytesToMiB(512 * MIB)).toBe(512);
    expect(miBToBytes(512)).toBe(512 * MIB);
  });
});

describe('settings: enforcement before reading bytes', () => {
  it('does not read an over-limit file into memory', async () => {
    // A fake File-like whose bytes would only be touched via arrayBuffer().
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const file = { name: 'big.csv', size: 100 * MIB, arrayBuffer } as unknown as File;
    const result = await readFileObject(file, null, 16 * MIB);
    expect(result.tooLarge).toBe(true);
    expect(result.bytes.length).toBe(0);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('reads a within-limit file normally', async () => {
    const bytes = new TextEncoder().encode('a,b\n');
    // jsdom's File does not implement arrayBuffer(); a real browser File does.
    const file = {
      name: 'ok.csv',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;
    const result = await readFileObject(file, null, 16 * MIB);
    expect(result.tooLarge).toBeUndefined();
    expect(new TextDecoder().decode(result.bytes)).toBe('a,b\n');
  });

  it('rejects an over-limit file at the command layer without opening a tab', async () => {
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    const tooLarge: OpenedFile = {
      name: 'huge.csv',
      bytes: new Uint8Array(0),
      handle: null,
      size: 900 * MIB,
      tooLarge: true,
    };
    await commands.openFiles([tooLarge], { confirmNonCsv: false });
    expect(ui.showMessage).toHaveBeenCalledOnce();
    expect(state.tabs.length).toBe(0);
  });

  it('honours a raised limit', async () => {
    setMaxFileSize(1024 * MIB);
    const ui = stubUi();
    const state = new AppState();
    const commands = new Commands(state, ui, document);
    // 900 MiB is within the raised limit; a normal (not tooLarge) small file opens.
    await commands.openFiles(
      [{ name: 'a.csv', bytes: new TextEncoder().encode('x,y\n'), handle: null, size: 4 }],
      { confirmNonCsv: false },
    );
    expect(state.tabs.length).toBe(1);
  });
});
