// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The shared color picker: its sections, picking (remembered as recent),
 * codes and CSS names, favorites, the colors used in the file, the color
 * form field, and the popover the toolbar and right-click menu open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecentColors } from '../../src/app/color-prefs';
import { setLocale, t } from '../../src/app/i18n';
import { noteInvoker } from '../../src/ui/anchored-popover';
import {
  buildColorPicker,
  colorField,
  parseColorInput,
  setDocumentColorSource,
} from '../../src/ui/color-picker';
import { Dialogs } from '../../src/ui/dialogs';

const headings = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.color-picker-heading')].map((h) => h.textContent ?? '');

describe('color picker', () => {
  beforeEach(() => {
    setLocale('en');
    localStorage.clear();
    setDocumentColorSource(() => []);
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('reads color codes and CSS color names', () => {
    expect(parseColorInput('#ABC')).toBe('#aabbcc');
    expect(parseColorInput('1a73e8')).toBe('#1a73e8');
    expect(parseColorInput(' SteelBlue ')).toBe('#4682b4');
    expect(parseColorInput('blueish')).toBeNull();
  });

  it('shows the palette and More colors, and No Color only when offered', () => {
    const plain = buildColorPicker({ current: null, onPick: () => {} });
    expect(headings(plain)).toEqual([t('colorPicker.palette'), t('colorPicker.more')]);
    expect(plain.querySelector('.color-picker-none')).toBeNull();
    expect(plain.querySelectorAll('.color-swatch')).toHaveLength(65);
    const withNone = buildColorPicker({ current: null, noneLabel: 'No Color', onPick: () => {} });
    expect(withNone.querySelector('.color-picker-none')?.textContent).toBe('No Color');
  });

  it('picks at once and remembers the color as recent', () => {
    const onPick = vi.fn();
    const picker = buildColorPicker({ current: null, noneLabel: 'None', onPick });
    picker.querySelector<HTMLButtonElement>('.color-swatch[data-color="#287ccf"]')!.click();
    expect(onPick).toHaveBeenCalledWith('#287ccf');
    expect(getRecentColors()).toEqual(['#287ccf']);
    picker.querySelector<HTMLButtonElement>('.color-picker-none')!.click();
    expect(onPick).toHaveBeenLastCalledWith(null);
    const again = buildColorPicker({ current: '#287ccf', onPick });
    expect(headings(again)[0]).toBe(t('colorPicker.recent'));
  });

  it('shows the colors used in the file', () => {
    setDocumentColorSource(() => ['#123456']);
    const picker = buildColorPicker({ current: null, onPick: () => {} });
    expect(headings(picker)).toContain(t('colorPicker.inFile'));
    expect(picker.querySelector('.color-swatch[data-color="#123456"]')).not.toBeNull();
  });

  it('marks the typed color as a favorite with the star', () => {
    const picker = buildColorPicker({ current: '#123456', onPick: () => {} });
    picker.querySelector<HTMLButtonElement>('.color-picker-star')!.click();
    expect(headings(picker)).toContain(t('colorPicker.favorites'));
    expect(picker.querySelector('.color-picker-star')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves between swatches with the arrow keys', () => {
    const picker = buildColorPicker({ current: null, onPick: () => {} });
    document.body.append(picker);
    const swatches = [...picker.querySelectorAll<HTMLButtonElement>('.color-swatch')];
    swatches[0].focus();
    swatches[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(swatches[9]);
  });

  it('a color field opens the picker and takes the picked color', () => {
    const field = colorField('field', '#000000', 'Line');
    document.body.append(field);
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    field.click();
    document.querySelector<HTMLButtonElement>('.color-popover .color-swatch[data-color="#1b9247"]')!.click();
    expect(field.value).toBe('#1b9247');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.color-popover')).toBeNull();
  });

  it('opens Text Color as a popover by the toolbar button, applying and closing on a pick', async () => {
    const onApply = vi.fn();
    noteInvoker({ kind: 'below', rect: { left: 10, top: 10, right: 38, bottom: 36 } });
    const result = new Dialogs().chooseTextColor(null, onApply);
    expect(document.querySelector('.side-panel')).toBeNull();
    document.querySelector<HTMLButtonElement>('.color-popover .color-swatch[data-color="#c35047"]')!.click();
    expect(onApply).toHaveBeenCalledWith({ action: 'apply', color: '#c35047' });
    expect(await result).toBeNull();
    expect(document.querySelector('.color-popover')).toBeNull();
  });

  it('closes the popover on Escape without applying', async () => {
    const onApply = vi.fn();
    noteInvoker({ kind: 'point', x: 5, y: 5 });
    const result = new Dialogs().chooseBackgroundColor('#ffffff', onApply);
    document
      .querySelector('.color-popover')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});
