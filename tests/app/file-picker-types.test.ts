// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The native open dialog and the fallback file chooser offer the same file
 * types, so whichever one the browser has filters the files the same way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickFiles } from '../../src/app/file-access';

interface PickerOptions {
  multiple?: boolean;
  types?: Array<{ accept: Record<string, string[]> }>;
}

function setNativePicker(): ReturnType<typeof vi.fn> {
  const picker = vi.fn(async () => []);
  (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker = picker;
  return picker;
}

function extensionsOf(list: string): string[] {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('.'));
}

afterEach(() => {
  delete (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  document.body.textContent = '';
});

describe('pickFiles file types', () => {
  it('gives the native open dialog the app file types, with multiple selection', async () => {
    const picker = setNativePicker();
    await pickFiles(document, 1_000_000);
    const options = picker.mock.calls[0][0] as PickerOptions;
    expect(options.multiple).toBe(true);
    const offered = Object.values(options.types![0].accept).flat();
    expect(offered).toEqual(expect.arrayContaining(['.csv', '.rsf', '.xlsx', '.md']));
  });

  it('offers the same extensions as the fallback chooser', async () => {
    // Without a native picker, pickFiles falls back to a hidden file input.
    const fallback = pickFiles(document, 1_000_000);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const fallbackExtensions = extensionsOf(input!.accept).sort();
    input!.dispatchEvent(new Event('cancel'));
    await expect(fallback).resolves.toEqual([]);

    const picker = setNativePicker();
    await pickFiles(document, 1_000_000);
    const options = picker.mock.calls[0][0] as PickerOptions;
    const nativeExtensions = Object.values(options.types![0].accept).flat().sort();
    expect(nativeExtensions).toEqual(fallbackExtensions);
  });

  it('narrows the native dialog to a caller-supplied list', async () => {
    const picker = setNativePicker();
    await pickFiles(document, 1_000_000, '.json');
    const options = picker.mock.calls[0][0] as PickerOptions;
    expect(Object.values(options.types![0].accept).flat()).toEqual(['.json']);
  });
});
