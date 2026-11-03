// SPDX-License-Identifier: MIT
/**
 * View ▸ AI Assistant: a side panel for asking about the active sheet and
 * for asking the assistant to change cells. Hosted build only (see
 * `src/app/ai/model.ts`); the offline build compiles this module out.
 *
 * - Nothing is downloaded until the user presses Download. Opening the
 *   panel only checks whether the model is already stored in this browser.
 * - A stored model is started straight away on later visits, with no
 *   download.
 * - A request to change the sheet comes back as a list of `cell → value`
 *   changes the user must approve. Approving applies them through the
 *   command layer as one undoable edit (`AiAssistantInput.applyChanges`);
 *   the panel itself never writes to the document.
 *
 * The conversation lives in this module, not in the panel element, so
 * closing and reopening the panel keeps it, and a reply that is still being
 * written keeps coming in while the panel is closed.
 */
import { BotMessageSquare } from 'lucide';
import { aiEngine, isAbortError } from '../app/ai/engine';
import { AI_MODEL } from '../app/ai/model';
import { t } from '../app/i18n';
import type { AiAssistantInput } from '../app/ui-port';
import { splitAiPlanReply, type AiPlanChange } from '../core/ai-plan';
import { buildAiMessages, type AiChatMessage } from '../core/ai-prompt';
import { atStart, dialogButton, externalLink } from './dialogs/shared';
import { formSection } from './dialogs/form-layout';
import { openSidePanel } from './dialogs/side-panel';
import { clearChildren, el } from './dom';
import { isComposingKey } from './ime';

type Phase =
  | { kind: 'checking' }
  | { kind: 'absent' }
  | { kind: 'downloading'; loaded: number; total: number; abort: AbortController }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string; retry: 'download' | 'start' };

type PlanStatus = 'pending' | 'applied' | 'discarded';

type LogItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; done: boolean }
  | { kind: 'plan'; changes: AiPlanChange[]; status: PlanStatus; result: string }
  | { kind: 'note'; text: string; error: boolean };

/** Everything the panel shows, kept across close and reopen. */
interface Session {
  phase: Phase;
  log: LogItem[];
  /** The turns sent back to the model with the next question. */
  history: AiChatMessage[];
  /** The reply being written, if any. */
  replying: AbortController | null;
  draft: string;
}

const session: Session = { phase: { kind: 'checking' }, log: [], history: [], replying: null, draft: '' };

/** Redraws the open panel, if there is one. */
let redraw: (() => void) | null = null;
let input: AiAssistantInput | null = null;

/** Asks before a destructive step; the app's own confirm dialog. */
export type AiPanelConfirm = (title: string, message: string, ok: string, cancel: string) => Promise<boolean>;
let confirmStep: AiPanelConfirm = async () => false;

function setPhase(phase: Phase): void {
  session.phase = phase;
  redraw?.();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1_000_000));
}

/** Check storage, and start a stored model. Contacts nothing unless a model is stored. */
async function refreshPhase(): Promise<void> {
  const engine = aiEngine();
  if (engine.isLoaded()) {
    setPhase({ kind: 'ready' });
    return;
  }
  setPhase({ kind: 'checking' });
  let stored: boolean;
  try {
    stored = await engine.isDownloaded();
  } catch (error) {
    setPhase({ kind: 'failed', message: errorText(error), retry: 'start' });
    return;
  }
  if (stored) {
    await startModel();
  } else {
    setPhase({ kind: 'absent' });
  }
}

async function startModel(): Promise<void> {
  setPhase({ kind: 'starting' });
  try {
    await aiEngine().load();
    setPhase({ kind: 'ready' });
  } catch (error) {
    setPhase({ kind: 'failed', message: errorText(error), retry: 'start' });
  }
}

/** The Download button: the only place the model is fetched. */
async function downloadModel(): Promise<void> {
  const abort = new AbortController();
  setPhase({ kind: 'downloading', loaded: 0, total: 0, abort });
  try {
    await aiEngine().download((progress) => {
      if (session.phase.kind === 'downloading' && session.phase.abort === abort) {
        session.phase.loaded = progress.loaded;
        session.phase.total = progress.total;
        redraw?.();
      }
    }, abort.signal);
  } catch (error) {
    if (isAbortError(error) || abort.signal.aborted) {
      setPhase({ kind: 'absent' });
    } else {
      setPhase({ kind: 'failed', message: errorText(error), retry: 'download' });
    }
    return;
  }
  await startModel();
}

async function deleteModel(): Promise<void> {
  session.replying?.abort();
  setPhase({ kind: 'checking' });
  try {
    await aiEngine().deleteModel();
    session.log.push({ kind: 'note', text: t('aiAssistant.deleted'), error: false });
    setPhase({ kind: 'absent' });
  } catch (error) {
    setPhase({ kind: 'failed', message: errorText(error), retry: 'start' });
  }
}

/** Send one question with the sheet as it is now, and show the reply as it is written. */
async function ask(question: string): Promise<void> {
  const context = input?.sheetContext() ?? null;
  const messages = buildAiMessages(context, session.history, question);
  session.log.push({ kind: 'user', text: question });
  const reply: LogItem & { kind: 'assistant' } = { kind: 'assistant', text: '', done: false };
  session.log.push(reply);
  const abort = new AbortController();
  session.replying = abort;
  redraw?.();
  try {
    const full = await aiEngine().chat(
      messages,
      (piece) => {
        reply.text += piece;
        updatePendingReply(reply.text);
      },
      abort.signal,
    );
    finishReply(reply, question, full, context !== null);
  } catch (error) {
    reply.done = true;
    if (!isAbortError(error)) {
      session.log.push({
        kind: 'note',
        text: t('aiAssistant.replyFailed', { message: errorText(error) }),
        error: true,
      });
    } else if (reply.text === '') {
      session.log.push({ kind: 'note', text: t('aiAssistant.stopped'), error: false });
    }
  } finally {
    if (session.replying === abort) {
      session.replying = null;
    }
    redraw?.();
  }
}

/** Split a finished reply into its text and its proposed changes, if any. */
function finishReply(
  reply: LogItem & { kind: 'assistant' },
  question: string,
  full: string,
  canEdit: boolean,
): void {
  const { prose, plan } = splitAiPlanReply(full);
  reply.text = prose;
  reply.done = true;
  session.history.push({ role: 'user', content: question }, { role: 'assistant', content: full });
  if (plan.ok && canEdit) {
    session.log.push({ kind: 'plan', changes: plan.changes, status: 'pending', result: '' });
  } else if (plan.ok || plan.reason !== 'no-plan') {
    session.log.push({
      kind: 'note',
      text: canEdit ? t('aiAssistant.plan.invalid') : t('aiAssistant.plan.noSheet'),
      error: true,
    });
  } else if (prose === '') {
    reply.text = t('aiAssistant.emptyReply');
  }
}

function applyPlan(item: LogItem & { kind: 'plan' }): void {
  if (!input) {
    return;
  }
  const { applied, skipped } = input.applyChanges(item.changes);
  item.status = 'applied';
  item.result =
    applied === 0
      ? t('aiAssistant.plan.nothingApplied')
      : skipped > 0
        ? t('aiAssistant.plan.appliedSkipped', { count: applied, skipped })
        : t('aiAssistant.plan.applied', { count: applied });
  redraw?.();
}

// ----- Rendering -----

/** The panel body while it is open, for the per-token update below. */
let openBody: HTMLElement | null = null;

/**
 * Show a reply's new text without redrawing the panel, so the question
 * field keeps its caret and any IME composition while the reply streams in.
 */
function updatePendingReply(text: string): void {
  const pending = openBody?.querySelector<HTMLElement>('.ai-message-pending');
  if (!pending) {
    redraw?.();
    return;
  }
  pending.textContent = text;
  const log = pending.closest<HTMLElement>('.ai-log');
  if (log) {
    log.scrollTop = log.scrollHeight;
  }
}

function renderModelInfo(): HTMLElement {
  return formSection(t('aiAssistant.model.title'), [
    el('p', { className: 'ai-panel-model-name', text: `${AI_MODEL.name} (${AI_MODEL.quantization})` }),
    el('p', {
      className: 'dialog-note',
      text: t('aiAssistant.model.details', {
        size: String(AI_MODEL.approxSizeMb),
        license: AI_MODEL.license,
      }),
    }),
    el('p', { className: 'dialog-note' }, [externalLink(t('aiAssistant.model.page'), AI_MODEL.pageUrl)]),
  ]);
}

function renderSetup(body: HTMLElement, buttons: HTMLElement): void {
  const phase = session.phase;
  body.append(el('p', { text: t('aiAssistant.intro') }));
  if (phase.kind === 'checking') {
    body.append(
      el('p', { className: 'dialog-note', attrs: { role: 'status' }, text: t('aiAssistant.checking') }),
    );
    return;
  }
  if (phase.kind === 'starting') {
    body.append(
      el('p', { className: 'dialog-note', attrs: { role: 'status' }, text: t('aiAssistant.starting') }),
      el('progress', { className: 'ai-panel-progress', attrs: { 'aria-label': t('aiAssistant.starting') } }),
    );
    return;
  }
  body.append(renderModelInfo());
  if (phase.kind === 'downloading') {
    const status =
      phase.total > 0
        ? t('aiAssistant.downloadProgress', {
            loaded: megabytes(phase.loaded),
            total: megabytes(phase.total),
          })
        : t('aiAssistant.downloadStarting');
    const progress = el('progress', {
      className: 'ai-panel-progress',
      attrs: { max: String(Math.max(1, phase.total)), 'aria-label': t('aiAssistant.download') },
    });
    if (phase.total > 0) {
      progress.value = phase.loaded;
    }
    body.append(progress, el('p', { className: 'dialog-note', attrs: { role: 'status' }, text: status }));
    buttons.append(dialogButton(t('aiAssistant.cancelDownload'), false, false, () => phase.abort.abort()));
    return;
  }
  body.append(el('p', { className: 'dialog-note', text: t('aiAssistant.downloadNote') }));
  if (phase.kind === 'failed') {
    body.append(
      el('p', {
        className: 'dialog-note ai-panel-error',
        attrs: { role: 'alert' },
        text:
          phase.retry === 'download'
            ? t('aiAssistant.downloadFailed', { message: phase.message })
            : t('aiAssistant.startFailed', { message: phase.message }),
      }),
    );
    buttons.append(
      dialogButton(
        t('aiAssistant.retry'),
        true,
        true,
        () => void (phase.retry === 'download' ? downloadModel() : refreshPhase()),
      ),
    );
    return;
  }
  buttons.append(
    dialogButton(t('aiAssistant.download', { size: String(AI_MODEL.approxSizeMb) }), true, true, () => {
      void downloadModel();
    }),
  );
}

function renderPlan(item: LogItem & { kind: 'plan' }): HTMLElement {
  const list = el(
    'ul',
    { className: 'ai-plan-list' },
    item.changes.map((change) =>
      el('li', {}, [
        el('span', { className: 'ai-plan-ref', text: change.ref }),
        el('span', {
          className: 'ai-plan-value',
          text: change.value === '' ? t('aiAssistant.plan.empty') : change.value,
        }),
      ]),
    ),
  );
  const card = el('div', { className: 'ai-plan-card' }, [
    el('p', {
      className: 'ai-plan-title',
      text: t('aiAssistant.plan.title', { count: item.changes.length }),
    }),
    list,
  ]);
  if (item.status === 'pending') {
    card.append(
      el('div', { className: 'ai-plan-actions' }, [
        dialogButton(t('aiAssistant.plan.discard'), false, false, () => {
          item.status = 'discarded';
          item.result = t('aiAssistant.plan.discarded');
          redraw?.();
        }),
        dialogButton(t('aiAssistant.plan.apply'), true, false, () => applyPlan(item)),
      ]),
    );
  } else {
    card.append(el('p', { className: 'ai-plan-status', attrs: { role: 'status' }, text: item.result }));
  }
  return card;
}

function renderLogItem(item: LogItem): HTMLElement {
  switch (item.kind) {
    case 'user':
      return el('p', { className: 'ai-message ai-message-user', text: item.text });
    case 'assistant':
      return el('p', {
        className: `ai-message ai-message-assistant${item.done ? '' : ' ai-message-pending'}`,
        text: item.text === '' && !item.done ? t('aiAssistant.thinking') : item.text,
      });
    case 'plan':
      return renderPlan(item);
    case 'note':
      return el('p', {
        className: `ai-message ai-message-note${item.error ? ' ai-panel-error' : ''}`,
        text: item.text,
      });
  }
}

function renderChat(body: HTMLElement, buttons: HTMLElement): void {
  const log = el('div', { className: 'ai-log', attrs: { role: 'log', 'aria-live': 'polite' } });
  if (session.log.length === 0) {
    log.append(el('p', { className: 'dialog-note', text: t('aiAssistant.ready') }));
  }
  log.append(...session.log.map(renderLogItem));

  const field = el('textarea', {
    className: 'ai-input',
    attrs: {
      id: 'ai-panel-input',
      rows: '3',
      'data-autofocus': 'true',
      placeholder: t('aiAssistant.placeholder'),
    },
  });
  const label = el('label', {
    className: 'ai-input-label',
    text: t('aiAssistant.inputLabel'),
    attrs: { for: 'ai-panel-input' },
  });
  field.value = session.draft;
  const send = (): void => {
    const question = field.value.trim();
    if (question === '' || session.replying) {
      return;
    }
    session.draft = '';
    void ask(question);
  };
  field.addEventListener('input', () => {
    session.draft = field.value;
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposingKey(event)) {
      event.preventDefault();
      send();
    }
  });

  body.append(log, label, field, el('p', { className: 'dialog-note', text: t('aiAssistant.hint') }));
  buttons.append(
    atStart(
      dialogButton(t('aiAssistant.deleteModel'), false, false, () => {
        void confirmStep(
          t('aiAssistant.deleteTitle'),
          t('aiAssistant.deleteConfirm', { size: String(AI_MODEL.approxSizeMb) }),
          t('aiAssistant.deleteModel'),
          t('aiAssistant.deleteCancel'),
        ).then((ok) => {
          if (ok) {
            void deleteModel();
          }
        });
      }),
    ),
  );
  const replying = session.replying;
  if (replying) {
    buttons.append(dialogButton(t('aiAssistant.stop'), false, false, () => replying.abort()));
  } else {
    buttons.append(dialogButton(t('aiAssistant.send'), true, false, send));
  }
  // Keep the newest message in view.
  requestAnimationFrame(() => {
    log.scrollTop = log.scrollHeight;
  });
}

/** Open the panel (once; asking again brings the open one forward). */
export function showAiAssistantPanel(next: AiAssistantInput, confirm: AiPanelConfirm): Promise<void> {
  input = next;
  confirmStep = confirm;
  let draw: (() => void) | null = null;
  const closed = openSidePanel<void>(
    { title: t('aiAssistant.title'), icon: BotMessageSquare, fallback: undefined, key: 'view.aiAssistant' },
    (body, buttons) => {
      body.classList.add('ai-panel');
      const drawPanel = (): void => {
        const focused = document.activeElement;
        const typing = focused instanceof HTMLTextAreaElement && body.contains(focused);
        clearChildren(body);
        clearChildren(buttons);
        if (session.phase.kind === 'ready') {
          renderChat(body, buttons);
        } else {
          renderSetup(body, buttons);
        }
        if (typing) {
          const field = body.querySelector<HTMLTextAreaElement>('.ai-input');
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        }
      };
      draw = drawPanel;
      redraw = drawPanel;
      openBody = body;
      drawPanel();
      if (session.phase.kind === 'checking' || session.phase.kind === 'absent') {
        void refreshPhase();
      }
    },
  );
  return closed.then(() => {
    // Closed: stop drawing into the removed panel. The session stays.
    if (draw && redraw === draw) {
      redraw = null;
      openBody = null;
    }
  });
}

/** Test seam: forget the conversation and the model's state. */
export function resetAiPanelForTests(): void {
  session.replying?.abort();
  session.phase = { kind: 'checking' };
  session.log = [];
  session.history = [];
  session.replying = null;
  session.draft = '';
  redraw = null;
  openBody = null;
}
