// SPDX-License-Identifier: MIT
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { checkLlmAvailability } from '../app/llm/availability';
import type { LlmInstallProgress } from '../app/llm/engine';
import { AI_PLAN_SYSTEM_PROMPT, splitAiPlanReply, type AiPlanChange } from '../core/ai-plan';
import { clearChildren, el } from './dom';

/**
 * The local AI assistant's engine embeds a ~190 MB Base64 model payload
 * (see src/llm-gen/), built as its own separate classic script
 * (`assets/llm-engine.js`, see vite.llm.config.ts) rather than pulled into
 * this bundle — a plain `import()` here would not actually defer anything,
 * since the main build inlines every dynamic import into one file so
 * `dist/index.html` keeps working under `file://` (see vite.config.ts).
 * Loaded on demand, by inserting a `<script>` tag, the first time the
 * install or chat flow actually runs; cached after that so repeat calls
 * resolve synchronously. See src/app/llm/engine-entry.ts and issue #116.
 */
type LlmEngineModule = typeof import('../app/llm/engine');
let llmEngineModule: LlmEngineModule | undefined;
let llmEnginePromise: Promise<LlmEngineModule> | undefined;
function loadLlmEngine(): Promise<LlmEngineModule> {
  if (!llmEnginePromise) {
    llmEnginePromise = new Promise<LlmEngineModule>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './assets/llm-engine.js';
      script.addEventListener('load', () => {
        const mod = window.__refrainSheetLlmEngine;
        if (!mod) {
          reject(new Error('refrain-sheet: assets/llm-engine.js did not expose the LLM engine module'));
          return;
        }
        resolve(mod);
      });
      script.addEventListener('error', () =>
        reject(new Error('refrain-sheet: failed to load assets/llm-engine.js')),
      );
      document.head.append(script);
    }).then((mod) => {
      llmEngineModule = mod;
      return mod;
    });
    llmEnginePromise.catch(() => {
      llmEnginePromise = undefined;
    });
  }
  return llmEnginePromise;
}

function actionButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = el('button', { className: primary ? 'primary' : '', text: label, attrs: { type: 'button' } });
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Side panel for the local, on-device AI assistant. Toggled by a button
 * next to the formula bar (see main.ts); a docked drawer on desktop, a
 * full-screen overlay below the existing 700px mobile breakpoint (see
 * styles.css). Plain questions get a plain chat reply, same as before this
 * panel replaced the old modal dialog. A request to change the sheet gets a
 * proposed plan instead — a concrete, previewable list of `ref → value`
 * changes the user must explicitly approve before anything is written;
 * approving applies it through the normal typed-command layer as one
 * atomic, singly-undoable operation (`Commands.applyAiPlan`), so `edit.undo`
 * reverts it exactly like any other edit. Everything runs on-device; the
 * assistant never has network access and proposes only cell-value writes,
 * never structural changes — see src/core/ai-plan.ts and docs/llm-model.md.
 */
export class AiPanel {
  readonly element: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly body: HTMLElement;
  private isOpen = false;

  constructor(private readonly commands: Commands) {
    this.toggleEl = el('button', {
      className: 'ai-panel-toggle',
      attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': t('aiAssistant.toggleButton') },
    });
    this.toggleEl.append(el('span', { text: '✨', attrs: { 'aria-hidden': 'true' } }));
    this.toggleEl.addEventListener('click', () => this.toggle());

    this.body = el('div', { className: 'ai-panel-body' });
    const closeButton = el('button', {
      className: 'ai-panel-close',
      attrs: { type: 'button', 'aria-label': t('dialog.close') },
      text: '×',
    });
    closeButton.addEventListener('click', () => this.close());
    const header = el('div', { className: 'ai-panel-header' }, [
      el('h2', { text: t('aiAssistant.title') }),
      closeButton,
    ]);
    this.element = el(
      'div',
      { className: 'ai-panel', attrs: { role: 'region', 'aria-label': t('aiAssistant.title'), 'aria-hidden': 'true' } },
      [header, this.body],
    );
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
        this.toggleEl.focus();
      }
    });
  }

  /** The entry-point button placed next to the formula bar. */
  get toggleButton(): HTMLButtonElement {
    return this.toggleEl;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.show();
    }
  }

  show(): void {
    this.isOpen = true;
    this.element.classList.add('open');
    this.element.setAttribute('aria-hidden', 'false');
    this.toggleEl.setAttribute('aria-expanded', 'true');
    this.renderBody();
  }

  close(): void {
    this.isOpen = false;
    this.element.classList.remove('open');
    this.element.setAttribute('aria-hidden', 'true');
    this.toggleEl.setAttribute('aria-expanded', 'false');
  }

  private renderBody(): void {
    clearChildren(this.body);
    const availability = checkLlmAvailability();
    if (availability !== 'available') {
      this.body.append(
        el('p', {
          text: t(availability === 'no-webgpu' ? 'aiAssistant.unavailable.noWebgpu' : 'aiAssistant.unavailable.noCacheStorage'),
        }),
      );
      return;
    }
    if (llmEngineModule?.isLlmInstalled()) {
      this.renderChat();
    } else {
      this.renderInstall();
    }
  }

  private renderInstall(): void {
    clearChildren(this.body);
    this.body.append(el('p', { text: t('aiAssistant.intro') }));
    const status = el('p', { className: 'dialog-note', text: t('aiAssistant.installIdle') });
    this.body.append(status);
    const installButton = actionButton(t('aiAssistant.install'), true, () => {
      installButton.setAttribute('disabled', 'true');
      loadLlmEngine()
        .then((mod) =>
          mod.installLlm((progress: LlmInstallProgress) => {
            status.textContent = t('aiAssistant.installProgress', {
              percent: Math.round(progress.progress * 100),
              text: progress.text,
            });
          }),
        )
        .then(() => this.renderChat())
        .catch((err: unknown) => {
          installButton.removeAttribute('disabled');
          status.textContent = t('aiAssistant.installFailed', {
            message: err instanceof Error ? err.message : String(err),
          });
        });
    });
    this.body.append(installButton);
  }

  private renderChat(): void {
    clearChildren(this.body);
    this.body.append(el('p', { className: 'dialog-note', text: t('aiAssistant.ready') }));
    const log = el('div', { className: 'ai-assistant-log' });
    this.body.append(log);
    const input = el('textarea', {
      className: 'ai-assistant-input',
      attrs: { rows: '3', placeholder: t('aiAssistant.placeholder'), 'data-autofocus': 'true' },
    });
    this.body.append(el('div', { className: 'form-row' }, [input]));
    const sendButton = actionButton(t('aiAssistant.send'), true, () => {
      const message = input.value.trim();
      if (!message) {
        return;
      }
      input.value = '';
      sendButton.setAttribute('disabled', 'true');
      log.append(el('p', { className: 'ai-assistant-message user', text: message }));
      const pending = el('p', { className: 'ai-assistant-message pending', text: t('aiAssistant.thinking') });
      log.append(pending);
      log.scrollTop = log.scrollHeight;
      loadLlmEngine()
        .then((mod) => mod.askLlm(message, AI_PLAN_SYSTEM_PROMPT))
        .then((reply) => {
          pending.remove();
          this.renderReply(log, reply);
        })
        .catch((err: unknown) => {
          pending.remove();
          log.append(
            el('p', {
              className: 'ai-assistant-message error',
              text: t('aiAssistant.error', { message: err instanceof Error ? err.message : String(err) }),
            }),
          );
        })
        .finally(() => {
          sendButton.removeAttribute('disabled');
          log.scrollTop = log.scrollHeight;
        });
    });
    this.body.append(sendButton);
    input.focus();
  }

  /** Renders one assistant reply: its prose, and — if present — a plan proposal card. */
  private renderReply(log: HTMLElement, reply: string): void {
    const { prose, plan } = splitAiPlanReply(reply);
    if (prose) {
      log.append(el('p', { className: 'ai-assistant-message assistant', text: prose }));
    }
    if (plan.ok) {
      log.append(this.buildPlanCard(plan.changes));
    } else if (plan.reason !== 'no-plan') {
      log.append(el('p', { className: 'ai-assistant-message error', text: t('aiAssistant.plan.invalid') }));
    } else if (!prose) {
      // Neither prose nor a plan: the model returned nothing usable.
      log.append(el('p', { className: 'ai-assistant-message assistant', text: reply }));
    }
    log.scrollTop = log.scrollHeight;
  }

  private buildPlanCard(changes: AiPlanChange[]): HTMLElement {
    const list = el(
      'ul',
      { className: 'ai-plan-list' },
      changes.map((change) => el('li', { text: t('aiAssistant.plan.change', { ref: change.ref, value: change.value }) })),
    );
    const status = el('p', { className: 'ai-plan-status' });
    const actions = el('div', { className: 'ai-plan-actions' });
    const approve = actionButton(t('aiAssistant.plan.approve'), true, () => {
      const { applied, skipped } = this.commands.applyAiPlan(changes);
      status.textContent =
        skipped > 0
          ? `${t('aiAssistant.plan.applied', { count: applied })} ${t('aiAssistant.plan.skipped', { count: skipped })}`
          : t('aiAssistant.plan.applied', { count: applied });
      actions.remove();
    });
    const cancel = actionButton(t('aiAssistant.plan.cancel'), false, () => {
      status.textContent = t('aiAssistant.plan.cancelled');
      actions.remove();
    });
    actions.append(approve, cancel);
    return el('div', { className: 'ai-plan-card' }, [
      el('p', { className: 'ai-plan-title', text: t('aiAssistant.plan.title') }),
      list,
      actions,
      status,
    ]);
  }
}
