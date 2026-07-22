// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Application icon and external links. Covers the header logo icon, the
 * welcome-screen icon, the favicon reference in the production HTML, the
 * README links, and the About-dialog links (localization + accessibility).
 * The icon is a bundled local asset and the links open safely in a new tab;
 * no runtime network request is introduced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imported as raw strings via Vite (no Node type dependency): the exact bytes
// that ship, so the assertions verify the real index.html / README.md.
import indexHtmlRaw from '../index.html?raw';
import readmeRaw from '../README.md?raw';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import { getLocale, setLocale } from '../src/app/i18n';
import { t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';
import { MenuBar, type MenuChecks } from '../src/ui/menu-bar';
import { WelcomeScreen } from '../src/ui/welcome-screen';

const SITE_URL = 'https://0x0da160.github.io/refrain-sheet/';
const RELEASES_URL = 'https://github.com/0x0da160/refrain-sheet/releases/';

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
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    chooseSettings: vi.fn(async () => null),
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

beforeEach(() => {
  document.body.textContent = '';
});

describe('application icon', () => {
  it('renders a decorative icon immediately left of the product name in the header', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const menu = new MenuBar(commands, menuChecks());
    document.body.append(menu.element);
    const icon = menu.element.querySelector<HTMLImageElement>('img.app-icon');
    expect(icon).not.toBeNull();
    // Decorative: the adjacent name conveys the brand, so it is hidden from AT.
    expect(icon!.getAttribute('alt')).toBe('');
    expect(icon!.getAttribute('aria-hidden')).toBe('true');
    // A real local asset URL (bundled), never a remote/CDN reference.
    expect(icon!.getAttribute('src')).toBeTruthy();
    expect(icon!.getAttribute('src')).not.toMatch(/^https?:\/\//);
    // Explicit dimensions prevent layout shift / stretching.
    expect(icon!.getAttribute('width')).toBe('20');
    expect(icon!.getAttribute('height')).toBe('20');
    // Order: the icon precedes the product name in the DOM.
    const name = menu.element.querySelector('.app-name')!;
    expect(icon!.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a decorative icon on the welcome screen', () => {
    const state = new AppState();
    const commands = new Commands(state, stubUi(), document);
    const welcome = new WelcomeScreen(commands);
    const icon = welcome.element.querySelector<HTMLImageElement>('img.welcome-icon');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('alt')).toBe('');
    expect(icon!.getAttribute('aria-hidden')).toBe('true');
    expect(icon!.getAttribute('src')).toBeTruthy();
    expect(icon!.getAttribute('src')).not.toMatch(/^https?:\/\//);
  });
});

describe('favicon', () => {
  it('index.html references a local SVG favicon', () => {
    const html = indexHtmlRaw;
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*>/);
    expect(html).toContain('type="image/svg+xml"');
    expect(html).toContain('favicon.svg');
    // No absolute/remote favicon host — it must resolve to a bundled local file.
    expect(html).not.toMatch(/rel="icon"[^>]*href="https?:\/\//);
  });
});

describe('README links', () => {
  it('links to the web app and the releases page near the top', () => {
    const head = readmeRaw.slice(0, 400);
    expect(head).toContain(`(${SITE_URL})`);
    expect(head).toContain(`(${RELEASES_URL})`);
    expect(head).toContain('Web App');
    expect(head).toContain('Releases');
  });
});

describe('About dialog links', () => {
  const locale = getLocale();
  // jsdom does not implement <dialog>.showModal(); the shim only needs to make
  // the element "open" so the dialog content is queryable in tests.
  beforeEach(() => {
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
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  function openAbout(): HTMLAnchorElement[] {
    void new Dialogs().showAbout();
    const dialog = document.body.querySelector('dialog')!;
    return Array.from(dialog.querySelectorAll<HTMLAnchorElement>('.about-links a'));
  }

  it('shows both external links, opened safely in a new tab', () => {
    setLocale('en');
    const links = openAbout();
    expect(links).toHaveLength(2);
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(SITE_URL);
    expect(hrefs).toContain(RELEASES_URL);
    for (const a of links) {
      // Safe external link: new tab + no window.opener reach-back.
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      // Keyboard/screen-reader accessible via the native anchor with an href
      // and a non-empty accessible name.
      expect(a.textContent?.trim().length).toBeGreaterThan(0);
    }
    expect(links.map((a) => a.textContent)).toEqual([t('dialog.about.webApp'), t('dialog.about.releases')]);
  });

  it('localizes the link labels', () => {
    setLocale('ja');
    const jaLabels = openAbout().map((a) => a.textContent);
    expect(jaLabels).toEqual(['ウェブアプリ', 'リリース']);
    document.querySelectorAll('dialog').forEach((d) => d.remove());
    setLocale('en');
    const enLabels = openAbout().map((a) => a.textContent);
    expect(enLabels).toEqual(['Web App', 'Releases']);
    // The URLs are locale-independent.
    expect(openAbout()[0].getAttribute('href')).toBe(SITE_URL);
  });
});
