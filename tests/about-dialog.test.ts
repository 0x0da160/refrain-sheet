// SPDX-License-Identifier: MIT
/**
 * The About dialog's offline/network-behavior claim must not be an
 * unconditional "runs fully offline; no data ever leaves this page" — that
 * is only true for the offline HTML build. The hosted build
 * (app.refrain-sheet.com) offers opt-in Google Drive sync, so its copy
 * must describe that instead (#520).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, t } from '../src/app/i18n';

// jsdom does not implement <dialog>.showModal(); the shim only needs to make
// the element "open" so its content is queryable (see branding.test.ts).
beforeEach(() => {
  setLocale('en');
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
  setLocale(getLocale());
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  vi.resetModules();
});

describe('About dialog: offline build', () => {
  it('keeps the unconditional offline / no-data-leaves-the-page claim', async () => {
    vi.resetModules();
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().showAbout();
    const dialog = document.querySelector('dialog')!;
    const paragraphs = Array.from(dialog.querySelectorAll('.dialog-body p')).map((p) => p.textContent);
    expect(paragraphs).toContain(t('dialog.about.body'));
    expect(paragraphs).not.toContain(t('dialog.about.bodyHosted'));
  });
});

describe('About dialog: hosted build (Drive sync configured)', () => {
  it('describes optional Google Drive sync instead of an unconditional offline claim', async () => {
    vi.resetModules();
    vi.doMock('../src/app/drive/config', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/app/drive/config')>();
      return { ...actual, driveConfigured: () => true };
    });
    const { Dialogs } = await import('../src/ui/dialogs');
    void new Dialogs().showAbout();
    const dialog = document.querySelector('dialog')!;
    const paragraphs = Array.from(dialog.querySelectorAll('.dialog-body p')).map((p) => p.textContent);
    expect(paragraphs).toContain(t('dialog.about.bodyHosted'));
    expect(paragraphs).not.toContain(t('dialog.about.body'));
    vi.doUnmock('../src/app/drive/config');
  });
});
