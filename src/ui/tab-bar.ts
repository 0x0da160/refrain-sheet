// SPDX-License-Identifier: MIT
import type { AppState } from '../app/app-state';
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { el, clearChildren } from './dom';

/** Tab strip for open files with dirty indicators (●) and close buttons. */
export class TabBar {
  readonly element: HTMLElement;

  constructor(
    private readonly state: AppState,
    private readonly commands: Commands,
  ) {
    this.element = el('div', { className: 'tab-bar', attrs: { role: 'tablist' } });
    this.render();
  }

  render(): void {
    clearChildren(this.element);
    this.element.setAttribute('aria-label', t('tabs.label'));
    for (const tab of this.state.tabs) {
      const active = tab.id === this.state.activeTabId;
      const dirty = tab.doc.isDirty;
      const tabEl = el(
        'div',
        {
          className: 'tab',
          attrs: {
            role: 'tab',
            tabindex: active ? '0' : '-1',
            'aria-selected': active ? 'true' : 'false',
            title: dirty ? `${tab.name} — ${t('tab.dirty')}` : tab.name,
          },
        },
        [
          el('span', {
            className: 'dirty-mark',
            text: dirty ? '● ' : '',
            attrs: dirty ? { 'aria-label': t('tab.dirty') } : { 'aria-hidden': 'true' },
          }),
          el('span', { className: 'tab-label', text: tab.name }),
        ],
      );
      const close = el('button', {
        className: 'tab-close',
        text: '×',
        attrs: { type: 'button', 'aria-label': `${t('tab.close')}: ${tab.name}` },
      });
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        this.state.activateTab(tab.id);
        const target = this.state.activeTab;
        if (target) {
          void this.commands.closeTab(target);
        }
      });
      tabEl.append(close);
      tabEl.addEventListener('click', () => this.state.activateTab(tab.id));
      tabEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.state.activateTab(tab.id);
        }
      });
      this.element.append(tabEl);
    }
  }
}
