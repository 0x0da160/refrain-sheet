// SPDX-License-Identifier: MIT
/**
 * The display theme of the Markdown sheet's preview and Formatted editor,
 * picked from the sheet's toolbar. A per-browser preference kept in
 * `localStorage` only, never in a file: it changes how Markdown is shown,
 * not the Markdown text. `standard` is the app's own look.
 */
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './storage';

const KEY = 'refrain-csv-html.markdownTheme';

/** The themes, in the order the toolbar lists them. */
export const MARKDOWN_THEMES = ['standard', 'reading', 'paper', 'dark', 'contrast'] as const;
export type MarkdownTheme = (typeof MARKDOWN_THEMES)[number];

function isMarkdownTheme(value: string | null): value is MarkdownTheme {
  return (MARKDOWN_THEMES as readonly (string | null)[]).includes(value);
}

export function getMarkdownTheme(): MarkdownTheme {
  const stored = safeStorageGet(KEY);
  return isMarkdownTheme(stored) ? stored : 'standard';
}

export function setMarkdownTheme(theme: MarkdownTheme): void {
  if (theme === 'standard') {
    safeStorageRemove(KEY);
  } else {
    safeStorageSet(KEY, theme);
  }
}
