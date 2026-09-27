// SPDX-License-Identifier: MIT
import { CircleAlert, CircleCheck } from 'lucide';
import { t } from '../app/i18n';
import type { SourceProblem } from '../core/source-validation';
import { el } from './dom';
import { createIcon } from './icon';

/**
 * The syntax-check line under a JSON or YAML worksheet's editor: either "no
 * syntax errors" or the first error with its line and column, and a button
 * that puts the caret on it. The owning view calls {@link check} whenever the
 * text changes (it rides the view's coalesced preview render, so a burst of
 * typing is checked once).
 */
export class SourceProblemBar {
  readonly element: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly text: HTMLElement;
  private readonly goTo: HTMLButtonElement;
  private problem: SourceProblem | null = null;

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly validate: (text: string) => SourceProblem | null,
    /** Locale key of the "no syntax errors" message, e.g. `sourceCheck.validJson`. */
    private readonly validKey: string,
  ) {
    this.icon = el('span', { className: 'source-problem-icon' });
    this.text = el('span', { className: 'source-problem-text' });
    this.goTo = el('button', {
      className: 'source-problem-goto',
      text: t('sourceCheck.goTo'),
      attrs: { type: 'button' },
    }) as HTMLButtonElement;
    this.goTo.addEventListener('click', () => this.revealProblem());
    this.element = el('div', { className: 'source-problem-bar', attrs: { role: 'status' } }, [
      this.icon,
      this.text,
      this.goTo,
    ]);
    this.check();
  }

  /** The error currently shown, or null when the text has none. */
  get current(): SourceProblem | null {
    return this.problem;
  }

  /** Re-check the textarea's current text and update the line. */
  check(): void {
    const problem = this.validate(this.textarea.value);
    this.problem = problem;
    this.element.classList.toggle('has-problem', problem !== null);
    this.goTo.hidden = problem === null;
    this.icon.replaceChildren(createIcon(problem ? CircleAlert : CircleCheck, 'source-problem-glyph', 14));
    if (!problem) {
      this.text.textContent = t(this.validKey);
      this.text.removeAttribute('title');
      return;
    }
    const where = t('sourceCheck.error', { line: problem.line, col: problem.col, message: problem.message });
    this.text.textContent =
      problem.count > 1 ? `${where} ${t('sourceCheck.moreErrors', { n: problem.count - 1 })}` : where;
    this.text.title = this.text.textContent;
  }

  /** Put the caret on the error and bring it into view. */
  private revealProblem(): void {
    if (!this.problem) {
      return;
    }
    const offset = Math.min(this.problem.offset, this.textarea.value.length);
    this.textarea.focus();
    this.textarea.setSelectionRange(offset, offset);
    // Scroll the caret's line into view: textareas do not always do it on a
    // programmatic selection change.
    const lineHeight = Number.parseFloat(getComputedStyle(this.textarea).lineHeight) || 20;
    const top = (this.problem.line - 1) * lineHeight;
    if (
      top < this.textarea.scrollTop ||
      top > this.textarea.scrollTop + this.textarea.clientHeight - lineHeight
    ) {
      this.textarea.scrollTop = Math.max(0, top - this.textarea.clientHeight / 3);
    }
  }
}
