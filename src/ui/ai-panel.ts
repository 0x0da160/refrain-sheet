// SPDX-License-Identifier: MIT
import type { Commands } from '../app/commands';
import { t } from '../app/i18n';
import { checkLlmAvailability } from '../app/llm/availability';
import type { LlmEngine, LlmInstallProgress } from '../app/llm/engine';
import { getModelCatalogEntry, MODEL_CATALOG } from '../app/llm/model-catalog';
import { getSelectedAiModel, setSelectedAiModel } from '../app/settings';
import { AI_PLAN_SYSTEM_PROMPT, splitAiPlanReply, type AiPlanChange } from '../core/ai-plan';
import { clearChildren, el } from './dom';

/**
 * Each vendored model's engine embeds that model's own Base64 payload (see
 * src/llm-gen/ and src/app/llm/model-catalog.ts), built as its own separate
 * classic script (`assets/llm-engine.<key>.js`, see vite.llm.config.ts)
 * rather than pulled into this bundle — a plain `import()` here would not
 * actually defer anything, since the main build inlines every dynamic
 * import into one file so `dist/index.html` keeps working under `file://`
 * (see vite.config.ts). Loaded on demand, by inserting a `<script>` tag,
 * the first time the install or chat flow actually runs for the currently
 * selected model; cached per model after that so repeat calls resolve
 * synchronously without re-inserting the script tag. Switching the selected
 * model (see renderInstall()) loads a different script and gets its own
 * independent engine instance. See src/app/llm/engine-entry.*.ts and issue
 * #116 / #166.
 */
const llmEngineModules = new Map<string, LlmEngine>();
const llmEnginePromises = new Map<string, Promise<LlmEngine>>();
function loadLlmEngine(modelKey: string): Promise<LlmEngine> {
  const cached = llmEngineModules.get(modelKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  let promise = llmEnginePromises.get(modelKey);
  if (!promise) {
    const entry = getModelCatalogEntry(modelKey);
    promise = new Promise<LlmEngine>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = entry.engineScript;
      script.addEventListener('load', () => {
        const mod = window.__refrainSheetLlmEngine;
        if (!mod) {
          reject(new Error(`refrain-sheet: ${entry.engineScript} did not expose the LLM engine module`));
          return;
        }
        resolve(mod);
      });
      script.addEventListener('error', () => reject(new Error(`refrain-sheet: failed to load ${entry.engineScript}`)));
      document.head.append(script);
    }).then((mod) => {
      llmEngineModules.set(modelKey, mod);
      return mod;
    });
    llmEnginePromises.set(modelKey, promise);
    promise.catch(() => {
      llmEnginePromises.delete(modelKey);
    });
  }
  return promise;
}

/**
 * Tracks a single in-flight install across panel re-renders (close/reopen).
 * `installLlm()` in engine.ts already dedupes concurrent calls onto one
 * promise, but that alone doesn't stop `renderBody()` from drawing a fresh,
 * clickable Install button on reopen — this lets `renderInstall()` render it
 * disabled with an "already installing" status instead. See issue #159.
 */
let currentInstall: Promise<void> | undefined;

function actionButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = el('button', {
    className: primary ? 'primary' : '',
    text: label,
    attrs: { type: 'button' },
  });
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Side panel for the local, on-device AI assistant. Toggled by a button
 * next to the formula bar (see main.ts); a split view on desktop — opening
 * it shrinks the sheet's column instead of covering it — that falls back to
 * a full-screen overlay below the existing 700px mobile breakpoint (see
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
  /** The model to install/chat with next; persisted so it survives a reload — see src/app/settings.ts. */
  private selectedModelKey: string = getSelectedAiModel();

  constructor(private readonly commands: Commands) {
    this.toggleEl = el('button', {
      className: 'ai-panel-toggle',
      attrs: {
        type: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        'aria-label': t('aiAssistant.toggleButton'),
      },
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
      {
        className: 'ai-panel',
        attrs: { role: 'region', 'aria-label': t('aiAssistant.title'), 'aria-hidden': 'true' },
      },
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
          text: t(
            availability === 'no-webgpu'
              ? 'aiAssistant.unavailable.noWebgpu'
              : 'aiAssistant.unavailable.noCacheStorage',
          ),
        }),
      );
      return;
    }
    if (llmEngineModules.get(this.selectedModelKey)?.isLlmInstalled()) {
      this.renderChat();
    } else {
      this.renderInstall();
    }
  }

  private renderInstall(): void {
    clearChildren(this.body);
    this.body.append(el('p', { text: t('aiAssistant.intro') }));

    // Only one install (of either model) runs at a time — the select and
    // install button are both locked while `currentInstall` is in flight,
    // so the status text never needs to distinguish "installing this model"
    // from "installing the other one".
    const statusText = () => (currentInstall ? t('aiAssistant.installInProgress') : t('aiAssistant.installIdle'));

    const modelSelectId = 'ai-panel-model-select';
    const modelSelect = el('select', { attrs: { id: modelSelectId } }) as HTMLSelectElement;
    for (const entry of MODEL_CATALOG) {
      const option = el('option', {
        text: t(entry.labelKey),
        attrs: { value: entry.key },
      }) as HTMLOptionElement;
      if (entry.key === this.selectedModelKey) {
        option.selected = true;
      }
      modelSelect.append(option);
    }
    if (currentInstall) {
      modelSelect.setAttribute('disabled', 'true');
    }

    const description = el('p', {
      className: 'dialog-note',
      text: t(getModelCatalogEntry(this.selectedModelKey).descriptionKey),
    });
    const status = el('p', { className: 'dialog-note', text: statusText() });
    const installButton = actionButton(t('aiAssistant.install'), true, () =>
      this.startInstall(installButton, status),
    );
    if (currentInstall) {
      installButton.setAttribute('disabled', 'true');
    }

    modelSelect.addEventListener('change', () => {
      this.selectedModelKey = modelSelect.value;
      setSelectedAiModel(this.selectedModelKey);
      description.textContent = t(getModelCatalogEntry(this.selectedModelKey).descriptionKey);
    });

    this.body.append(
      el('div', { className: 'form-row' }, [
        el('label', { text: t('aiAssistant.model.label'), attrs: { for: modelSelectId } }),
        modelSelect,
      ]),
      description,
      status,
      installButton,
    );
  }

  /**
   * Kicks off the install. `commands.setBusy` is called synchronously here,
   * before the ~190 MB engine script even starts loading, so there is
   * immediate feedback rather than a silent gap until the first progress
   * callback — see issue #159. Success always re-renders the body as chat,
   * even if the panel was closed and reopened mid-install (so `status` is a
   * stale, detached element by then): otherwise a reopened panel would keep
   * showing the disabled "installing" view forever. A failure instead only
   * updates `installButton`/`status` if they're still live, since the
   * subsequent reopen already recovers on its own — `currentInstall` is
   * cleared below, so the next `renderInstall()` renders an idle, retryable
   * button either way.
   */
  private startInstall(installButton: HTMLButtonElement, status: HTMLElement): void {
    const modelKey = this.selectedModelKey;
    installButton.setAttribute('disabled', 'true');
    status.textContent = '';
    this.commands.setBusy(t('aiAssistant.installStarting'), 0);
    currentInstall = loadLlmEngine(modelKey)
      .then((mod) =>
        mod.installLlm((progress: LlmInstallProgress) => {
          const percent = Math.round(progress.progress * 100);
          this.commands.setBusy(t('aiAssistant.installProgress', { percent, text: progress.text }), percent);
        }),
      )
      .then(() => {
        this.commands.setBusy(null);
        this.renderChat();
      })
      .catch((err: unknown) => {
        this.commands.setBusy(null);
        if (this.body.contains(status)) {
          installButton.removeAttribute('disabled');
          status.textContent = t('aiAssistant.installFailed', {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        currentInstall = undefined;
      });
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
      loadLlmEngine(this.selectedModelKey)
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
      changes.map((change) =>
        el('li', { text: t('aiAssistant.plan.change', { ref: change.ref, value: change.value }) }),
      ),
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
