// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
// The hosted build's update notice (src/ui/update-banner.ts). It stays until the
// person acts on it or dismisses it, shows its text as text only, and leaves the
// action to the shell: running the action must not hide the notice on its own.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../src/app/i18n';
import { UpdateBanner } from '../../src/ui/update-banner';

function part<T extends HTMLElement>(banner: UpdateBanner, selector: string): T {
  const node = banner.element.querySelector<T>(selector);
  if (!node) {
    throw new Error(`the update notice has no ${selector}`);
  }
  return node;
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('starts hidden and is announced as a status message', () => {
    const banner = new UpdateBanner(() => undefined);
    expect(banner.element.hidden).toBe(true);
    expect(banner.element.getAttribute('role')).toBe('status');
  });

  it('shows its text with the reload action and a labelled dismiss button', () => {
    const banner = new UpdateBanner(() => undefined);
    banner.show(t('update.ready'));
    expect(banner.element.hidden).toBe(false);
    expect(part(banner, '.update-banner-message').textContent).toBe(t('update.ready'));
    expect(part(banner, '.update-banner-action').textContent).toBe(t('update.reload'));
    expect(part(banner, '.update-banner-close').getAttribute('aria-label')).toBe(t('toast.close'));
  });

  it('shows text as text, never as markup', () => {
    const banner = new UpdateBanner(() => undefined);
    banner.show('<img src="x" onerror="alert(1)">');
    expect(part(banner, '.update-banner-message').textContent).toBe('<img src="x" onerror="alert(1)">');
    expect(banner.element.querySelector('img')).toBeNull();
  });

  it('replaces its text when shown again', () => {
    const banner = new UpdateBanner(() => undefined);
    banner.show(t('update.ready'));
    banner.show(t('update.unsaved'));
    expect(part(banner, '.update-banner-message').textContent).toBe(t('update.unsaved'));
  });

  it('runs its action and stays visible, so the shell can explain the outcome', () => {
    const onAction = vi.fn();
    const banner = new UpdateBanner(onAction);
    banner.show(t('update.ready'));
    part<HTMLButtonElement>(banner, '.update-banner-action').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(banner.element.hidden).toBe(false);
  });

  it('hides when dismissed, without running the action', () => {
    const onAction = vi.fn();
    const banner = new UpdateBanner(onAction);
    banner.show(t('update.ready'));
    part<HTMLButtonElement>(banner, '.update-banner-close').click();
    expect(banner.element.hidden).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('can be hidden and shown again', () => {
    const banner = new UpdateBanner(() => undefined);
    banner.show(t('update.ready'));
    banner.hide();
    expect(banner.element.hidden).toBe(true);
    banner.show(t('update.ready'));
    expect(banner.element.hidden).toBe(false);
  });
});
