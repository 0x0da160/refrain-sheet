// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The AI assistant panel (View ▸ AI Assistant) with a fake engine: opening
 * it never downloads, the Download button is the only way the model is
 * fetched, a stored model starts without a download, and a proposed change
 * is applied only when the user approves it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiEngineForTests, type AiEngine } from '../../src/app/ai/engine';
import { setLocale, t } from '../../src/app/i18n';
import { GEMMA_MODEL, QWEN_MODEL, setAiModelForTests } from '../../src/app/ai/model';
import type { AiAssistantInput } from '../../src/app/ui-port';
import { resetAiPanelForTests, showAiAssistantPanel } from '../../src/ui/ai-panel';

interface FakeEngine extends AiEngine {
  stored: boolean;
  loaded: boolean;
  reply: string;
}

function fakeEngine(stored: boolean): FakeEngine {
  const engine: FakeEngine = {
    stored,
    loaded: false,
    reply: '',
    isDownloaded: vi.fn(async () => engine.stored),
    download: vi.fn(async (onProgress: (p: { loaded: number; total: number }) => void) => {
      onProgress({ loaded: 50, total: 100 });
      engine.stored = true;
    }),
    load: vi.fn(async () => {
      if (!engine.stored) throw new Error('not downloaded');
      engine.loaded = true;
    }),
    isLoaded: () => engine.loaded,
    chat: vi.fn(async (_messages, onText: (text: string) => void) => {
      onText(engine.reply);
      return engine.reply;
    }),
    deleteModel: vi.fn(async () => {
      engine.stored = false;
      engine.loaded = false;
    }),
  };
  return engine;
}

function input(): AiAssistantInput & { applyChanges: ReturnType<typeof vi.fn> } {
  return {
    sheetContext: () => 'Sheet: data.csv (2 rows x 2 columns)',
    applyChanges: vi.fn(() => ({ applied: 1, skipped: 0 })),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.side-panel button')].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function panelText(): string {
  return document.querySelector('.side-panel')?.textContent ?? '';
}

function close(): void {
  document
    .querySelector('.side-panel')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

beforeEach(() => {
  setLocale('en');
  setAiModelForTests(GEMMA_MODEL);
  resetAiPanelForTests();
  document.body.textContent = '';
});

afterEach(() => {
  setAiEngineForTests(null);
  setAiModelForTests(null);
  resetAiPanelForTests();
  document.body.textContent = '';
});

describe('AI assistant panel', () => {
  it('downloads nothing when opened, and offers the download with its size', async () => {
    const engine = fakeEngine(false);
    setAiEngineForTests(engine);
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    expect(engine.isDownloaded).toHaveBeenCalled();
    expect(engine.download).not.toHaveBeenCalled();
    expect(engine.load).not.toHaveBeenCalled();
    expect(panelText()).toContain('gemma3-270m-japanese-webllm-04');
    expect(panelText()).toContain('Gemma Terms of Use');
    expect(panelText()).not.toContain(t('aiAssistant.model.noWebGpu'));
    expect(panelText()).toContain(t('aiAssistant.downloadNote'));
    expect(button(t('aiAssistant.download', { size: '190' }))).toBeTruthy();
  });

  it('offers the CPU model, and says why, in a browser without WebGPU', async () => {
    setAiModelForTests(QWEN_MODEL);
    setAiEngineForTests(fakeEngine(false));
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    expect(panelText()).toContain('Qwen2.5-0.5B-Instruct');
    expect(panelText()).toContain(t('aiAssistant.model.noWebGpu'));
    expect(button(t('aiAssistant.download', { size: '490' }))).toBeTruthy();
  });

  it('downloads and starts the model only after Download is pressed', async () => {
    const engine = fakeEngine(false);
    setAiEngineForTests(engine);
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    button(t('aiAssistant.download', { size: '190' })).click();
    await settle();
    await settle();
    expect(engine.download).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(panelText()).toContain(t('aiAssistant.ready'));
  });

  it('starts a model stored by an earlier visit without downloading', async () => {
    const engine = fakeEngine(true);
    setAiEngineForTests(engine);
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    await settle();
    expect(engine.download).not.toHaveBeenCalled();
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ai-input')).not.toBeNull();
  });

  it('answers a question with the sheet in the prompt', async () => {
    const engine = fakeEngine(true);
    engine.reply = 'The total is 30.';
    setAiEngineForTests(engine);
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    await settle();
    const field = document.querySelector<HTMLTextAreaElement>('.ai-input')!;
    field.value = 'What is the total?';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    const messages = vi.mocked(engine.chat).mock.calls[0][0];
    expect(messages[0].content).toContain('Sheet: data.csv');
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'What is the total?' });
    expect(panelText()).toContain('The total is 30.');
    expect(document.querySelector('.ai-plan-card')).toBeNull();
  });

  it('shows proposed changes and applies them only when approved', async () => {
    const engine = fakeEngine(true);
    engine.reply = 'I will put 0 in B2.\nPLAN: {"changes":[{"ref":"B2","value":"0"}]}';
    setAiEngineForTests(engine);
    const panelInput = input();
    void showAiAssistantPanel(panelInput, async () => true);
    await settle();
    await settle();
    const field = document.querySelector<HTMLTextAreaElement>('.ai-input')!;
    field.value = 'Put 0 in B2';
    button(t('aiAssistant.send')).click();
    await settle();
    expect(panelText()).toContain('I will put 0 in B2.');
    expect(panelText()).not.toContain('PLAN:');
    expect(document.querySelector('.ai-plan-card')?.textContent).toContain('B2');
    expect(panelInput.applyChanges).not.toHaveBeenCalled();
    button(t('aiAssistant.plan.apply')).click();
    expect(panelInput.applyChanges).toHaveBeenCalledWith([{ row: 1, col: 1, ref: 'B2', value: '0' }]);
    expect(panelText()).toContain(t('aiAssistant.plan.applied', { count: 1 }));
  });

  it('keeps the conversation when closed and reopened', async () => {
    const engine = fakeEngine(true);
    engine.reply = 'Hello.';
    setAiEngineForTests(engine);
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    await settle();
    document.querySelector<HTMLTextAreaElement>('.ai-input')!.value = 'Hi';
    button(t('aiAssistant.send')).click();
    await settle();
    close();
    await settle();
    expect(document.querySelector('.side-panel')).toBeNull();
    void showAiAssistantPanel(input(), async () => true);
    await settle();
    expect(panelText()).toContain('Hello.');
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it('deletes the stored model only after confirmation', async () => {
    const engine = fakeEngine(true);
    setAiEngineForTests(engine);
    const confirm = vi.fn(async () => false);
    void showAiAssistantPanel(input(), confirm);
    await settle();
    await settle();
    button(t('aiAssistant.deleteModel')).click();
    await settle();
    expect(confirm).toHaveBeenCalled();
    expect(engine.deleteModel).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    button(t('aiAssistant.deleteModel')).click();
    await settle();
    await settle();
    expect(engine.deleteModel).toHaveBeenCalledTimes(1);
    expect(button(t('aiAssistant.download', { size: '190' }))).toBeTruthy();
  });
});
