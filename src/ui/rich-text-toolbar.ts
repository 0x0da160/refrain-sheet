// SPDX-License-Identifier: MIT
import { Bold, Eraser, Italic, Underline, type IconNode } from 'lucide';
import { t } from '../app/i18n';
import { ensureSwatchList } from './document-colors';
import { el } from './dom';
import { fontFamilySelect, fontSizeSelect } from './font-choices';
import { createIcon } from './icon';

/** What a toolbar button asks the cell editor to do to the selected text. */
export type RichTextAction =
  | { kind: 'toggle'; key: 'bold' | 'italic' | 'underline' }
  /** `null` goes back to the cell's own text color. */
  | { kind: 'color'; color: string | null }
  /** `null` goes back to the cell's own font or size. */
  | { kind: 'fontFamily'; family: string | null }
  | { kind: 'fontSize'; size: number | null }
  | { kind: 'clear' };

/** Whether the selected text is currently all bold / italic / underlined. */
export interface RichTextToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** The selected text's font and size, or null where it uses the cell's (or is mixed). */
  fontFamily: string | null;
  fontSize: number | null;
}

/** The ready-made text colors, by locale key. */
const PALETTE: ReadonlyArray<[string, string]> = [
  ['red', '#d32f2f'],
  ['orange', '#e65100'],
  ['green', '#2e7d32'],
  ['blue', '#1565c0'],
  ['purple', '#7b1fa2'],
  ['gray', '#757575'],
];

/**
 * The small floating toolbar shown over text selected in the cell editor:
 * font, size, bold, italic, underline, a few text colors plus any color, the
 * cell's own color, and removing the selection's own formatting. Its buttons
 * never take focus (so the text selection stays); only the font and size
 * lists and the "any color" picker do, and `onLeave` reports where focus
 * went when one of them gives it up.
 */
export class RichTextToolbar {
  private readonly element: HTMLElement;
  private readonly toggles: Record<'bold' | 'italic' | 'underline', HTMLButtonElement>;
  private readonly fonts: HTMLElement;

  constructor(
    private readonly onAction: (action: RichTextAction) => void,
    private readonly onLeave: (next: EventTarget | null) => void,
  ) {
    const button = (label: string, content: Node, action: RichTextAction, extra = ''): HTMLButtonElement => {
      const node = el('button', {
        className: `rich-toolbar-button${extra}`,
        attrs: { type: 'button', title: label, 'aria-label': label, tabindex: '-1' },
      });
      node.append(content);
      // Keep focus (and the selection) in the text.
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => onAction(action));
      return node;
    };
    const icon = (node: IconNode): SVGElement => createIcon(node, 'rich-toolbar-icon', 16);
    const toggle = (key: 'bold' | 'italic' | 'underline', node: IconNode): HTMLButtonElement => {
      const b = button(t(`menu.format.${key}`), icon(node), { kind: 'toggle', key });
      b.setAttribute('aria-pressed', 'false');
      return b;
    };
    this.toggles = {
      bold: toggle('bold', Bold),
      italic: toggle('italic', Italic),
      underline: toggle('underline', Underline),
    };
    const swatch = (color: string | null, label: string): HTMLButtonElement => {
      const dot = el('span', { className: `rich-toolbar-swatch${color ? '' : ' auto'}` });
      if (color) {
        dot.style.backgroundColor = color;
      }
      return button(label, dot, { kind: 'color', color });
    };
    const custom = el('input', {
      className: 'rich-toolbar-custom',
      attrs: {
        type: 'color',
        title: t('richText.color.custom'),
        'aria-label': t('richText.color.custom'),
        list: ensureSwatchList(),
      },
    }) as HTMLInputElement;
    custom.addEventListener('change', () => onAction({ kind: 'color', color: custom.value.toLowerCase() }));
    custom.addEventListener('blur', (event) => onLeave(event.relatedTarget));
    this.fonts = el('span', { className: 'rich-toolbar-fonts' });
    this.element = el(
      'div',
      {
        className: 'rich-text-toolbar',
        attrs: { role: 'toolbar', 'aria-label': t('richText.toolbar') },
      },
      [
        this.fonts,
        el('span', { className: 'rich-toolbar-divider', attrs: { 'aria-hidden': 'true' } }),
        this.toggles.bold,
        this.toggles.italic,
        this.toggles.underline,
        el('span', { className: 'rich-toolbar-divider', attrs: { 'aria-hidden': 'true' } }),
        swatch(null, t('richText.color.auto')),
        ...PALETTE.map(([name, color]) => swatch(color, t(`richText.color.${name}`))),
        custom,
        el('span', { className: 'rich-toolbar-divider', attrs: { 'aria-hidden': 'true' } }),
        button(t('richText.clear'), icon(Eraser), { kind: 'clear' }),
      ],
    );
    this.element.hidden = true;
    document.body.append(this.element);
  }

  contains(node: Node): boolean {
    return this.element.contains(node);
  }

  /** Show the toolbar just above `anchor` (below it when there is no room). */
  show(anchor: { left: number; top: number; bottom: number }, state: RichTextToolbarState): void {
    for (const key of ['bold', 'italic', 'underline'] as const) {
      this.toggles[key].setAttribute('aria-pressed', String(state[key]));
    }
    this.showFonts(state);
    this.element.hidden = false;
    const height = this.element.offsetHeight || 34;
    const width = this.element.offsetWidth || 320;
    const top = anchor.top - height - 6 >= 0 ? anchor.top - height - 6 : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  /** Rebuild the font and size lists for the selection's current values. */
  private showFonts(state: RichTextToolbarState): void {
    const leave = (node: HTMLElement): HTMLElement => {
      node.className = 'rich-toolbar-select';
      node.addEventListener('blur', (event) => this.onLeave((event as FocusEvent).relatedTarget));
      return node;
    };
    const family = fontFamilySelect(
      state.fontFamily,
      (value) => this.onAction({ kind: 'fontFamily', family: value }),
      {
        title: t('richText.font'),
        'aria-label': t('richText.font'),
      },
      t('richText.font.sameAsCell'),
    );
    const size = fontSizeSelect(
      state.fontSize,
      (value) => this.onAction({ kind: 'fontSize', size: value }),
      {
        title: t('richText.fontSize'),
        'aria-label': t('richText.fontSize'),
      },
      t('richText.fontSize.sameAsCell'),
    );
    this.fonts.replaceChildren(leave(family), leave(size));
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }
}
