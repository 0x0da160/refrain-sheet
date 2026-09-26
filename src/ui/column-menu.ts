// SPDX-License-Identifier: MIT
/**
 * The header-row column menu: a compact popover that a filter button on a
 * header cell opens (see `Grid`'s header-row filter buttons and
 * `FilterCommands.columnMenu`). It puts the two things people reach for most
 * on a column within one click — ordering the rows by this column, and
 * picking which of its values stay visible — while the full Filter side
 * panel (comparison conditions, AND/OR) stays one button away.
 *
 * Layout, wording, and icons are this app's own: a title line naming the
 * column, a pair of direction buttons, a search field over a checkbox list
 * whose first entry toggles every listed value, and a footer with the
 * Conditions… hand-over and Apply. Everything is text-only (`textContent`).
 *
 * Behavior: opens below the button (flipped/clamped by {@link positionPopup}),
 * focuses the search field, and resolves exactly once — with the chosen
 * action, or null on Escape, an outside pointer interaction, window blur,
 * resize, or a scroll outside the popover (the anchor has moved away).
 */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ListFilter } from 'lucide';
import type { ColumnMenuInput, ColumnMenuResult } from '../app/commands';
import { t } from '../app/i18n';
import { el, focusWithoutKeyboard } from './dom';
import { createIcon } from './icon';
import { positionPopup } from './popup';

/** Values beyond this many are not rendered (mirrors the Filter panel's list cap). */
const VALUE_DISPLAY_CAP = 200;

let openClose: (() => void) | null = null;

/** Close the column menu if one is open (resolving it with null). */
export function closeColumnMenu(): void {
  openClose?.();
}

export function openColumnMenu(input: ColumnMenuInput): Promise<ColumnMenuResult | null> {
  closeColumnMenu();
  return new Promise((resolve) => {
    const title = input.header !== '' ? input.header : input.colLetter;
    const root = el('div', {
      className: 'column-menu',
      attrs: {
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': t('columnMenu.label', { letter: input.colLetter, header: title }),
      },
    });
    const listeners: Array<() => void> = [];
    let done = false;
    const finish = (result: ColumnMenuResult | null): void => {
      if (done) {
        return;
      }
      done = true;
      openClose = null;
      for (const off of listeners) {
        off();
      }
      root.remove();
      resolve(result);
    };
    openClose = () => finish(null);
    const on = (
      target: EventTarget,
      type: string,
      handler: (event: Event) => void,
      capture = false,
    ): void => {
      target.addEventListener(type, handler, capture);
      listeners.push(() => target.removeEventListener(type, handler, capture));
    };

    // ----- Title -----
    root.append(
      el('div', { className: 'column-menu-title' }, [
        el('span', { className: 'column-menu-letter', text: input.colLetter }),
        el('span', { className: 'column-menu-header', text: title }),
      ]),
    );

    // ----- Order by this column -----
    const sortButton = (ascending: boolean): HTMLButtonElement => {
      const pressed = input.sorted === (ascending ? 'asc' : 'desc');
      const label = t(ascending ? 'columnMenu.sortAsc' : 'columnMenu.sortDesc');
      const button = el('button', {
        className: `panel-button column-menu-sort${pressed ? ' active' : ''}`,
        attrs: { type: 'button', 'aria-pressed': pressed ? 'true' : 'false' },
      });
      button.append(
        createIcon(ascending ? ArrowUpNarrowWide : ArrowDownWideNarrow, 'column-menu-icon', 14),
        el('span', { text: label }),
      );
      button.addEventListener('click', () =>
        finish(pressed ? { action: 'clearSort' } : { action: 'sort', ascending }),
      );
      return button;
    };
    root.append(
      el(
        'div',
        { className: 'column-menu-sorts', attrs: { role: 'group', 'aria-label': t('columnMenu.sortGroup') } },
        [sortButton(true), sortButton(false)],
      ),
    );
    if (input.sorted !== null) {
      root.append(el('p', { className: 'column-menu-note', text: t('columnMenu.sortedNote') }));
    }

    // ----- Values to show -----
    const search = el('input', {
      className: 'column-menu-search',
      attrs: {
        type: 'search',
        placeholder: t('dialog.filter.searchValues'),
        'aria-label': t('dialog.filter.searchValues'),
      },
    }) as HTMLInputElement;
    const allCheck = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    const allLabel = el('span');
    const list = el('div', {
      className: 'column-menu-values',
      attrs: { role: 'group', 'aria-label': t('columnMenu.valuesGroup') },
    });
    root.append(
      search,
      el('label', { className: 'column-menu-value column-menu-all' }, [allCheck, allLabel]),
      list,
    );
    if (input.valuesTruncated) {
      root.append(el('p', { className: 'column-menu-note', text: t('dialog.filter.valuesTruncated') }));
    }
    if (input.hasConditions) {
      root.append(el('p', { className: 'column-menu-note', text: t('columnMenu.conditionsNote') }));
    }

    const selected = input.selected === null ? null : new Set(input.selected);
    const checked = new Set(input.values.filter((v) => selected === null || selected.has(v)));
    let matches: string[] = input.values;

    // ----- Footer -----
    const moreBtn = el('button', {
      className: 'panel-button column-menu-more',
      text: t('columnMenu.more'),
      attrs: { type: 'button' },
    });
    moreBtn.prepend(createIcon(ListFilter, 'column-menu-icon', 14));
    moreBtn.addEventListener('click', () => finish({ action: 'more' }));
    const applyBtn = el('button', {
      className: 'panel-button primary',
      text: t('columnMenu.apply'),
      attrs: { type: 'button' },
    });
    const apply = (): void => {
      if (checked.size === 0) {
        return;
      }
      const all = checked.size === input.values.length && !input.valuesTruncated;
      finish({ action: 'apply', values: all ? null : input.values.filter((v) => checked.has(v)) });
    };
    applyBtn.addEventListener('click', apply);
    const foot = el('div', { className: 'column-menu-foot' }, [moreBtn]);
    if (input.hasColumnFilter) {
      const clearBtn = el('button', {
        className: 'panel-button',
        text: t('columnMenu.clearColumn'),
        attrs: { type: 'button' },
      });
      clearBtn.addEventListener('click', () => finish({ action: 'clearColumn' }));
      foot.append(clearBtn);
    }
    foot.append(applyBtn);
    root.append(foot);

    const syncAll = (): void => {
      const count = matches.filter((v) => checked.has(v)).length;
      allCheck.checked = matches.length > 0 && count === matches.length;
      allCheck.indeterminate = count > 0 && count < matches.length;
      allCheck.disabled = matches.length === 0;
      allLabel.textContent =
        search.value === ''
          ? t('columnMenu.all', { n: input.values.length })
          : t('columnMenu.allMatches', { n: matches.length });
      applyBtn.disabled = checked.size === 0;
    };
    const renderValues = (): void => {
      const term = search.value.toLowerCase();
      matches = term === '' ? input.values : input.values.filter((v) => v.toLowerCase().includes(term));
      const shown = matches.slice(0, VALUE_DISPLAY_CAP);
      const rows: HTMLElement[] = shown.map((v) => {
        const cb = el('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
        cb.checked = checked.has(v);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            checked.add(v);
          } else {
            checked.delete(v);
          }
          syncAll();
        });
        return el('label', { className: 'column-menu-value' }, [
          cb,
          el('span', {
            className: v === '' ? 'column-menu-blank' : '',
            text: v === '' ? t('dialog.filter.blankValue') : v,
          }),
        ]);
      });
      if (matches.length > shown.length) {
        rows.push(
          el('p', {
            className: 'column-menu-note',
            text: t('dialog.filter.valuesMore', { n: matches.length - shown.length }),
          }),
        );
      }
      if (matches.length === 0) {
        rows.push(el('p', { className: 'column-menu-note', text: t('columnMenu.noMatches') }));
      }
      list.replaceChildren(...rows);
      syncAll();
    };
    allCheck.addEventListener('change', () => {
      for (const v of matches) {
        if (allCheck.checked) {
          checked.add(v);
        } else {
          checked.delete(v);
        }
      }
      renderValues();
    });
    search.addEventListener('input', renderValues);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        apply();
      }
    });
    renderValues();

    // ----- Dismissal -----
    root.addEventListener('keydown', (event) => {
      event.stopPropagation(); // keys typed here never reach the grid or app shortcuts
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        finish(null);
      }
    });
    const outside = (event: Event): void => {
      const target = event.target as Node | null;
      if (!target || !root.contains(target)) {
        finish(null);
      }
    };
    on(document, 'mousedown', outside, true);
    on(document, 'touchstart', outside, true);
    on(document, 'scroll', outside, true);
    on(window, 'resize', () => finish(null));
    on(window, 'blur', () => finish(null));

    document.body.append(root);
    const a = input.anchor;
    if (a) {
      positionPopup(root, { kind: 'below', rect: a });
    } else {
      positionPopup(root, { kind: 'point', x: 16, y: 16 });
    }
    focusWithoutKeyboard(search);
  });
}
