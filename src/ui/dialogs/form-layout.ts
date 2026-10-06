// SPDX-License-Identifier: MIT
/**
 * The one form layout of every dialog and side panel (design system D-47,
 * D-48): sections stacked `--section-gap` apart with a rule between titled
 * ones, fields `--stack-gap` apart, each a label above a full-width control
 * with its hint below. The styles are `.form-layout` in
 * `src/styles/form-layout.css`; a body takes that class to get them.
 */
import { el } from '../dom';

let fieldSeq = 0;

/**
 * One labelled control: the label on its own line above a full-width
 * control, so every field lines up on the same left edge whatever the
 * length of its label, and the hint (if any) below it.
 */
export function formField(label: string, control: HTMLElement, hint?: string): HTMLElement {
  if (!control.id) {
    control.id = `form-field-${++fieldSeq}`;
  }
  const children: Node[] = [
    el('label', { className: 'form-field-label', text: label, attrs: { for: control.id } }),
    control,
  ];
  if (hint) {
    children.push(el('p', { className: 'dialog-note form-field-hint', text: hint }));
  }
  return el('div', { className: 'form-field' }, children);
}

/**
 * A {@link formField} whose control has a live status line (what is wrong
 * with the entry) right under it, before the hint.
 */
export function formFieldWithStatus(
  label: string,
  control: HTMLElement,
  status: HTMLElement,
  hint?: string,
): HTMLElement {
  const field = formField(label, control, hint);
  control.after(status);
  return field;
}

/** A checkbox or radio button with its label beside it, aligned on one row. */
export function formCheck(input: HTMLInputElement, label: string): HTMLLabelElement {
  return el('label', { className: 'form-check' }, [input, el('span', { text: label })]);
}

/**
 * A group of fields, titled or not; a titled section after another is
 * separated from it by a rule.
 */
export function formSection(title: string | null, children: Node[]): HTMLElement {
  const section = el('section', { className: 'form-section' });
  if (title) {
    section.append(el('h3', { className: 'form-section-title', text: title }));
  }
  section.append(...children);
  return section;
}

/**
 * Short related fields side by side (paper and orientation, color and line
 * style): two columns in a dialog, as many as fit in a panel.
 */
export function formGrid(children: Node[]): HTMLElement {
  return el('div', { className: 'form-grid' }, children);
}
