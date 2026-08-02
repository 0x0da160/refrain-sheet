// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
/**
 * The AI Assistant's model install progress should use the same shared busy
 * indicator (Commands.setBusy) as every other long-running operation
 * (see progress.test.ts), rather than a bespoke status line — issue #141.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/app-state';
import { Commands, type UiPort } from '../src/app/commands';
import type { LlmInstallProgress } from '../src/app/llm/engine';

function stubUi(overrides: Partial<UiPort> = {}): UiPort {
  return {
    confirmValidation: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => 'discard' as const),
    chooseSaveOptions: vi.fn(async () => null),
    confirmUnrepresentable: vi.fn(async () => false),
    notifyNcr: vi.fn(async () => undefined),
    confirmUndecodableEdit: vi.fn(async () => true),
    chooseReopen: vi.fn(async () => null),
    confirmConvert: vi.fn(async () => true),
    explainRsfSave: vi.fn(async () => true),
    chooseRsfSave: vi.fn(async () => 2),
    chooseExportCsv: vi.fn(async () => null),
    confirmExportXlsx: vi.fn(async () => true),
    chooseInsertShift: vi.fn(async () => null),
    confirmFlashFill: vi.fn(async () => false),
    chooseFilter: vi.fn(async () => null),
    promptSheetName: vi.fn(async () => null),
    confirmDeleteSheet: vi.fn(async () => true),
    chooseExportSheet: vi.fn(async () => null),
    confirmReplaceAllWorkbook: vi.fn(async () => true),
    confirmRangeMoveOverwrite: vi.fn(async () => true),
    promptMoveTarget: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
    showMessage: vi.fn(async () => undefined),
    notify: vi.fn(),
    openFindBar: vi.fn(),
    findNext: vi.fn(),
    showAbout: vi.fn(),
    showFormulaHelp: vi.fn(),
    showAiAssistant: vi.fn(),
    chooseSettings: vi.fn(async () => null),
    chooseTimezone: vi.fn(async () => null),
    chooseDisplayLanguage: vi.fn(async () => null),
    setBusy: vi.fn(),
    ...overrides,
  };
}

/** The label argument of the busy indicator's most recent call. */
function lastBusyLabel(ui: UiPort): string | null | undefined {
  const calls = (ui.setBusy as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0] as string | null | undefined;
}

/**
 * Resolves the panel's dynamically-loaded engine script (for whichever
 * model is currently selected — src/app/llm/model-catalog.ts's first entry
 * unless a test changes the `<select>`) with a fake module.
 */
function resolveLlmEngine(mod: Record<string, unknown>): void {
  const script = document.head.querySelector('script[src^="./assets/llm-engine."]');
  expect(script).not.toBeNull();
  (window as unknown as { __refrainSheetLlmEngine: unknown }).__refrainSheetLlmEngine = mod;
  script?.dispatchEvent(new Event('load'));
}

describe('AiPanel install progress', () => {
  beforeEach(() => {
    (globalThis as unknown as { caches: unknown }).caches = {};
    (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
    // ai-panel.ts caches each loaded engine module at module scope, keyed by
    // the model's own `<script>` load; reset it each test so every test
    // injects and resolves its own fake engine.
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { navigator?: unknown }).navigator;
    delete (window as unknown as { __refrainSheetLlmEngine?: unknown }).__refrainSheetLlmEngine;
    document.head.innerHTML = '';
    localStorage.clear();
  });

  it('reports install progress through the shared busy indicator, not a bespoke status line', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    expect(installButton).not.toBeNull();
    installButton.click();

    let onProgress: ((progress: LlmInstallProgress) => void) | undefined;
    resolveLlmEngine({
      isLlmInstalled: () => false,
      installLlm: (cb: (progress: LlmInstallProgress) => void) => {
        onProgress = cb;
        return new Promise(() => {});
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onProgress).toBeTypeOf('function');
    onProgress?.({ stage: 'loading', progress: 0.42, text: 'downloading' });

    expect(ui.setBusy).toHaveBeenCalledWith(expect.stringContaining('42'), 42);
    // The dialog's own status line no longer duplicates the progress text.
    const status = panel.element.querySelector('.ai-panel-install-status');
    expect(status?.textContent).toBe('');
  });

  it('clears the busy indicator once install finishes', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    resolveLlmEngine({
      isLlmInstalled: () => true,
      installLlm: () => Promise.resolve(),
    });
    await vi.waitFor(() => expect(lastBusyLabel(ui)).toBeNull());
  });

  it('clears the busy indicator and shows the failure message when install fails', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    resolveLlmEngine({
      isLlmInstalled: () => false,
      installLlm: () => Promise.reject(new Error('boom')),
    });
    await vi.waitFor(() => expect(lastBusyLabel(ui)).toBeNull());
    const status = panel.element.querySelector('.ai-panel-install-status');
    expect(status?.textContent).toContain('boom');
    expect(installButton.hasAttribute('disabled')).toBe(false);
  });

  it('shows immediate busy feedback on click, before the engine script has even loaded', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    // No engine script load has been resolved yet, but the busy indicator
    // should already reflect that an install is starting.
    expect(ui.setBusy).toHaveBeenCalledWith(expect.any(String), 0);
    expect(installButton.hasAttribute('disabled')).toBe(true);
  });

  it('renders the install button disabled with an in-progress status if the panel is closed and reopened mid-install', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    resolveLlmEngine({
      isLlmInstalled: () => false,
      installLlm: () => new Promise(() => {}),
    });
    await Promise.resolve();
    await Promise.resolve();

    panel.close();
    panel.show();

    const reopenedButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    expect(reopenedButton.hasAttribute('disabled')).toBe(true);
    const status = panel.element.querySelector('.ai-panel-install-status');
    expect(status?.textContent).toBe('Installing already in progress…');
  });

  it('switches to the chat view once install finishes, even if reopened mid-install', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const ui = stubUi();
    const commands = new Commands(new AppState(), ui, document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    let resolveInstall: (() => void) | undefined;
    resolveLlmEngine({
      isLlmInstalled: () => true,
      installLlm: () => new Promise<void>((resolve) => (resolveInstall = resolve)),
    });
    await Promise.resolve();
    await Promise.resolve();

    panel.close();
    panel.show();

    resolveInstall?.();
    await vi.waitFor(() => expect(panel.element.querySelector('.ai-assistant-input')).not.toBeNull());
  });
});

describe('AiPanel model selection', () => {
  beforeEach(() => {
    (globalThis as unknown as { caches: unknown }).caches = {};
    (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { navigator?: unknown }).navigator;
    delete (window as unknown as { __refrainSheetLlmEngine?: unknown }).__refrainSheetLlmEngine;
    document.head.innerHTML = '';
    localStorage.clear();
  });

  it('offers every catalog model and defaults to the first one', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const { MODEL_CATALOG } = await import('../src/app/llm/model-catalog');
    const commands = new Commands(new AppState(), stubUi(), document);
    const panel = new AiPanel(commands);
    panel.show();

    const select = panel.element.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => o.value)).toEqual(MODEL_CATALOG.map((m) => m.key));
    expect(select.value).toBe(MODEL_CATALOG[0]?.key);
  });

  it('loads the selected model’s own engine script, and persists the choice across reopen', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const { MODEL_CATALOG } = await import('../src/app/llm/model-catalog');
    const commands = new Commands(new AppState(), stubUi(), document);
    const panel = new AiPanel(commands);
    panel.show();

    const select = panel.element.querySelector('select') as HTMLSelectElement;
    const otherModel = MODEL_CATALOG[1];
    expect(otherModel).toBeDefined();
    select.value = otherModel!.key;
    select.dispatchEvent(new Event('change'));

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();

    const script = document.head.querySelector('script') as HTMLScriptElement;
    expect(script.src.endsWith(otherModel!.engineScript.replace('./', ''))).toBe(true);

    panel.close();
    panel.show();
    const reopenedSelect = panel.element.querySelector('select') as HTMLSelectElement;
    expect(reopenedSelect.value).toBe(otherModel!.key);
  });

  it('locks the model select while an install is in progress', async () => {
    const { AiPanel } = await import('../src/ui/ai-panel');
    const commands = new Commands(new AppState(), stubUi(), document);
    const panel = new AiPanel(commands);
    panel.show();

    const installButton = panel.element.querySelector('button.primary') as HTMLButtonElement;
    installButton.click();
    resolveLlmEngine({
      isLlmInstalled: () => false,
      installLlm: () => new Promise(() => {}),
    });
    await Promise.resolve();
    await Promise.resolve();

    panel.close();
    panel.show();
    const select = panel.element.querySelector('select') as HTMLSelectElement;
    expect(select.hasAttribute('disabled')).toBe(true);
  });
});
