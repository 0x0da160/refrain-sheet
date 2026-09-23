// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * Every dockable side panel shares one title bar (`buildSidePanelChrome`):
 * an icon before the title and the same dock/maximize/close (×) buttons.
 * A transient panel (`openSidePanel`) also always ends its footer with a
 * Close button, and applying never closes it when the caller keeps it open
 * (`onApply`) — only Close, the ×, or Escape do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, t } from '../src/app/i18n';
import { Dialogs } from '../src/ui/dialogs';

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.side-panel');
  if (!found) {
    throw new Error('no side panel');
  }
  return found;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!found) {
    throw new Error(`button "${label}" not found`);
  }
  return found;
}

describe('side panel chrome', () => {
  const locale = getLocale();

  beforeEach(() => {
    document.body.textContent = '';
    setLocale('en');
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    setLocale(locale);
    document.body.textContent = '';
  });

  it('gives every transient panel a title icon, a header close button, and a bottom-right Close', async () => {
    const dialogs = new Dialogs();
    const opened: Array<[string, () => Promise<unknown>]> = [
      [t('dialog.borders.title'), () => dialogs.chooseBorders({}, null, null)],
      [t('dialog.color.title.text'), () => dialogs.chooseTextColor(null)],
      [t('dialog.numberFormat.title'), () => dialogs.chooseNumberFormat(null)],
      [
        t('dialog.conditionalFormat.title'),
        () => dialogs.chooseConditionalFormat({ rangeLabel: 'A1:A1', existing: null }),
      ],
      [
        t('dialog.sqlQuery.title'),
        () =>
          dialogs.showSqlQuery({
            sources: [{ id: 's', name: 'Sheet1' }],
            runQuery: async () => ({ ok: true, result: { columns: [], rows: [] } }) as never,
            columns: () => [],
          }),
      ],
    ];
    for (const [title, open] of opened) {
      const promise = open();
      const p = panel();
      const heading = p.querySelector<HTMLElement>('.side-panel-title')!;
      expect(heading.querySelector('.side-panel-title-label')?.textContent).toBe(title);
      expect(heading.querySelector('svg.side-panel-title-icon')).not.toBeNull();
      expect(p.getAttribute('aria-labelledby')).toBe(heading.querySelector('.side-panel-title-text')!.id);

      const footerButtons = p.querySelectorAll<HTMLButtonElement>('.dialog-buttons button');
      const last = footerButtons[footerButtons.length - 1];
      expect(last.textContent).toBe(t('dialog.sidePanel.closeButton'));

      const close = heading.querySelector<HTMLButtonElement>('.side-panel-close-btn')!;
      expect(close.getAttribute('aria-label')).toBe(t('dialog.sidePanel.close'));
      close.click();
      await promise;
      expect(document.querySelector('.side-panel')).toBeNull();
    }
  });

  it('keeps the Borders panel open on Apply when the caller applies in place', async () => {
    const onApply = vi.fn();
    const promise = new Dialogs().chooseBorders({}, null, null, onApply);
    const p = panel();
    p.querySelector<HTMLInputElement>('#format-border-borderTop')!.click();

    button(p, t('dialog.borders.apply')).click();
    button(p, t('dialog.borders.apply')).click();

    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply.mock.calls[0][0]).toMatchObject({ action: 'apply', sides: { borderTop: '#000000' } });
    expect(document.querySelector('.side-panel')).toBe(p);

    button(p, t('dialog.sidePanel.closeButton')).click();
    expect(await promise).toBeNull();
    expect(document.querySelector('.side-panel')).toBeNull();
  });

  it('keeps a panel open on Clear too, and on the window losing focus', async () => {
    const onApply = vi.fn();
    const promise = new Dialogs().chooseNumberFormat(null, onApply);
    const p = panel();

    button(p, t('dialog.numberFormat.clear')).click();
    expect(onApply).toHaveBeenCalledWith({ action: 'clear' });
    window.dispatchEvent(new Event('blur'));
    expect(document.querySelector('.side-panel')).toBe(p);

    p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await promise).toBeNull();
  });

  it('still resolves with the result and closes when no in-place handler is given', async () => {
    const promise = new Dialogs().chooseTextColor('#123456');
    button(panel(), t('dialog.color.apply')).click();
    expect(await promise).toEqual({ action: 'apply', color: '#123456' });
    expect(document.querySelector('.side-panel')).toBeNull();
  });
});
