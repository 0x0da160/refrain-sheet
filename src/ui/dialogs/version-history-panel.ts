// SPDX-License-Identifier: MIT
/**
 * Sheet ▸ File Version History…, as a side panel beside the sheet (design
 * system D-46): whether this file keeps a version on every save that changed
 * something, how many it keeps, and the kept versions, newest first, each
 * with Preview and Restore.
 */
import { History } from 'lucide';
import type { VersionHistoryChoice } from '../../app/commands';
import { getLocale, t } from '../../app/i18n';
import {
  DEFAULT_HISTORY_SNAPSHOT_LIMIT,
  MAX_RSF_HISTORY_SNAPSHOTS,
  type RsfHistorySnapshot,
} from '../../core/workbook/rsf-codec';
import { el } from '../dom';
import { formCheck, formSection } from './form-layout';
import { dialogButton, helpDetails } from './shared';
import { openSidePanel } from './side-panel';
import { openVersionHistoryPreview } from './version-preview';

/** Formats a stored timestamp for display, in the app's current UI language. */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(getLocale() === 'ja' ? 'ja-JP' : 'en-US');
}

type CapMode = 'default' | 'custom' | 'unlimited';

/**
 * Save Settings closes the panel with `{ kind: 'save' }`; Restore closes it
 * with `{ kind: 'restore' }` at once, and the caller confirms and performs
 * the restore, a separate and more consequential decision. Closing with ×
 * or Escape resolves null: nothing changes. Preview opens the version
 * read-only on top and leaves the panel as it is. The panel never deletes
 * anything; clearing kept versions is the separate, confirmed
 * `sheet.clearVersionHistory`.
 */
export function chooseVersionHistoryPanel(
  current: boolean,
  maxOverride: number | null | undefined,
  history: readonly RsfHistorySnapshot[],
): Promise<VersionHistoryChoice | null> {
  return openSidePanel<VersionHistoryChoice | null>(
    { title: t('dialog.versionHistory.title'), icon: History, fallback: null, key: 'sheet.versionHistory' },
    (body, buttons, apply) => {
      const checkbox = el('input', {
        attrs: { type: 'checkbox', 'data-autofocus': 'true' },
      }) as HTMLInputElement;
      checkbox.checked = current;
      const cap = capChoices(maxOverride);
      body.append(
        formSection(null, [
          formCheck(checkbox, t('dialog.versionHistory.label')),
          el('p', { className: 'dialog-note', text: t('dialog.versionHistory.note') }),
          helpDetails(t('dialog.versionHistory.help')),
        ]),
        formSection(t('dialog.versionHistory.keep'), [cap.element]),
        versionList(history, (index) => apply({ kind: 'restore', index })),
      );
      buttons.append(
        dialogButton(t('dialog.versionHistory.ok'), true, false, () =>
          apply({ kind: 'save', enabled: checkbox.checked, maxOverride: cap.read() }),
        ),
      );
    },
  );
}

/** The kept-versions cap: default / an explicit number / unlimited. */
function capChoices(maxOverride: number | null | undefined): {
  element: HTMLElement;
  read: () => number | null | undefined;
} {
  const mode: CapMode = maxOverride === undefined ? 'default' : maxOverride === null ? 'unlimited' : 'custom';
  const radio = (value: CapMode): HTMLInputElement => {
    const input = el('input', {
      attrs: { type: 'radio', name: 'version-history-max-mode', value },
    }) as HTMLInputElement;
    input.checked = mode === value;
    return input;
  };
  const defaultRadio = radio('default');
  const customRadio = radio('custom');
  const unlimitedRadio = radio('unlimited');
  const customInput = el('input', {
    className: 'version-history-max-input',
    attrs: {
      type: 'number',
      min: '1',
      max: String(MAX_RSF_HISTORY_SNAPSHOTS),
      step: '1',
      'aria-label': t('dialog.versionHistory.maxCustom'),
    },
  }) as HTMLInputElement;
  customInput.value = String(typeof maxOverride === 'number' ? maxOverride : DEFAULT_HISTORY_SNAPSHOT_LIMIT);
  const refreshCustomInput = (): void => {
    customInput.disabled = !customRadio.checked;
  };
  refreshCustomInput();
  for (const r of [defaultRadio, customRadio, unlimitedRadio]) {
    r.addEventListener('change', refreshCustomInput);
  }
  const element = el('div', { className: 'form-choices', attrs: { role: 'radiogroup' } }, [
    formCheck(defaultRadio, t('dialog.versionHistory.maxDefault', { n: DEFAULT_HISTORY_SNAPSHOT_LIMIT })),
    el('div', { className: 'form-inline' }, [
      formCheck(customRadio, t('dialog.versionHistory.maxCustom')),
      customInput,
    ]),
    formCheck(unlimitedRadio, t('dialog.versionHistory.maxUnlimited')),
  ]);
  const read = (): number | null | undefined => {
    if (unlimitedRadio.checked) {
      return null;
    }
    if (customRadio.checked) {
      const parsed = Math.round(Number(customInput.value));
      return Number.isFinite(parsed)
        ? Math.max(1, Math.min(MAX_RSF_HISTORY_SNAPSHOTS, parsed))
        : DEFAULT_HISTORY_SNAPSHOT_LIMIT;
    }
    return undefined;
  };
  return { element, read };
}

/**
 * The kept versions, newest first, each with Preview and Restore. `index`
 * still refers to the caller's oldest-first `history`, which is what
 * `restoreFromSnapshot` and the caller's confirmation expect.
 */
function versionList(history: readonly RsfHistorySnapshot[], restore: (index: number) => void): HTMLElement {
  if (history.length === 0) {
    return formSection(t('dialog.versionHistory.versions'), [
      el('p', { className: 'dialog-note', text: t('dialog.versionHistory.countNone') }),
    ]);
  }
  const list = el('ul', { className: 'version-history-list' });
  for (let index = history.length - 1; index >= 0; index--) {
    const snapshot = history[index];
    const previous = index > 0 ? history[index - 1] : null;
    list.append(
      el('li', { className: 'version-history-entry' }, [
        el('span', { text: formatWhen(snapshot.timestamp) }),
        el('div', { className: 'version-history-entry-actions' }, [
          dialogButton(t('dialog.versionHistory.preview'), false, false, () =>
            openVersionHistoryPreview(
              snapshot,
              formatWhen(snapshot.timestamp),
              previous ? { snapshot: previous, when: formatWhen(previous.timestamp) } : null,
            ),
          ),
          dialogButton(t('dialog.versionHistory.restore'), false, false, () => restore(index)),
        ]),
      ]),
    );
  }
  return formSection(t('dialog.versionHistory.versions'), [
    el('p', { className: 'dialog-note', text: t('dialog.versionHistory.count', { n: history.length }) }),
    list,
  ]);
}
