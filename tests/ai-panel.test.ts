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

/** Resolves the panel's dynamically-loaded engine script with a fake module. */
function resolveLlmEngine(mod: Record<string, unknown>): void {
  const script = document.head.querySelector('script[src="./assets/llm-engine.js"]');
  expect(script).not.toBeNull();
  (window as unknown as { __refrainSheetLlmEngine: unknown }).__refrainSheetLlmEngine = mod;
  script?.dispatchEvent(new Event('load'));
}

describe('AiPanel install progress', () => {
  beforeEach(() => {
    (globalThis as unknown as { caches: unknown }).caches = {};
    (globalThis as unknown as { navigator: unknown }).navigator = { gpu: {} };
    // ai-panel.ts caches the loaded engine module at module scope, keyed by
    // the single `<script>` load; reset it each test so every test injects
    // and resolves its own fake engine.
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
    delete (globalThis as { navigator?: unknown }).navigator;
    delete (window as unknown as { __refrainSheetLlmEngine?: unknown }).__refrainSheetLlmEngine;
    document.head.innerHTML = '';
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
    const status = panel.element.querySelector('.dialog-note');
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
    const status = panel.element.querySelector('.dialog-note');
    expect(status?.textContent).toContain('boom');
    expect(installButton.hasAttribute('disabled')).toBe(false);
  });
});
