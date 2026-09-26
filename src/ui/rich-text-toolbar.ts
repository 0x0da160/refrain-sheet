// SPDX-License-Identifier: MIT
import { Bold, Eraser, Italic, Underline, type IconNode } from 'lucide';
import { t } from '../app/i18n';
import { el } from './dom';
import { createIcon } from './icon';

/** What a toolbar button asks the cell editor to do to the selected text. */
export type RichTextAction =
  | { kind: 'toggle'; key: 'bold' | 'italic' | 'underline' }
  /** `null` goes back to the cell's own text color. */
  | { kind: 'color'; color: string | null }
  | { kind: 'clear' };

/** Whether the selected text is currently all bold / italic / underlined. */
export interface RichTextToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
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
 * bold, italic, underline, a few text colors plus any color, the cell's own
 * color, and removing the selection's own formatting. Its buttons never
 * take focus (so the text selection stays); only the "any color" picker
 * does, and `onLeave` reports where focus went when it gives it up.
 */
export class RichTextToolbar {
  private readonly element: HTMLElement;
  private readonly toggles: Record<'bold' | 'italic' | 'underline', HTMLButtonElement>;

  constructor(onAction: (action: RichTextAction) => void, onLeave: (next: EventTarget | null) => void) {
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
      attrs: { type: 'color', title: t('richText.color.custom'), 'aria-label': t('richText.color.custom') },
    }) as HTMLInputElement;
    custom.addEventListener('change', () => onAction({ kind: 'color', color: custom.value.toLowerCase() }));
    custom.addEventListener('blur', (event) => onLeave(event.relatedTarget));
    this.element = el(
      'div',
      {
        className: 'rich-text-toolbar',
        attrs: { role: 'toolbar', 'aria-label': t('richText.toolbar') },
      },
      [
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
    this.element.hidden = false;
    const height = this.element.offsetHeight || 34;
    const width = this.element.offsetWidth || 320;
    const top = anchor.top - height - 6 >= 0 ? anchor.top - height - 6 : anchor.bottom + 6;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
    this.element.style.top = `${top}px`;
    this.element.style.left = `${left}px`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }
}
