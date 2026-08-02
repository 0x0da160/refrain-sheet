// SPDX-License-Identifier: MIT
/**
 * Builds a lifecycle wrapper around `@mlc-ai/web-llm`'s `MLCEngine`: install
 * (cache pre-population + engine load) and a minimal chat call. No network
 * access at any point — `installLlm()` writes the embedded model into Cache
 * Storage (see cache-prepopulate.ts) before starting the engine, so WebLLM
 * never calls `fetch()`.
 *
 * Parametrized by a `ModelSource` and that model's manifest so each vendored
 * model gets its own independent engine instance — see
 * src/app/llm/engine-entry.*.ts, one per model in src/app/llm/model-catalog.ts.
 *
 * Requires WebGPU (`navigator.gpu`) and the Cache Storage API (`caches`),
 * neither of which this agent's sandbox can exercise end-to-end — see
 * docs/llm-model.md for what is and is not verified.
 */
import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';
import { createCachePrepopulator, type PrepopulateProgress } from './cache-prepopulate';
import type { ModelFileEntry } from './model-file-entry';
import type { ModelSource } from './model-source';

export type LlmInstallStage = 'preparing' | 'loading';

export interface LlmInstallProgress {
  readonly stage: LlmInstallStage;
  /** 0..1 */
  readonly progress: number;
  readonly text: string;
}

export interface LlmEngine {
  /**
   * Reassembles and verifies the embedded model, pre-populates Cache
   * Storage, then starts the WebLLM engine. Safe to call more than once —
   * concurrent calls share one in-flight install, and a completed install
   * is reused.
   */
  installLlm(onProgress?: (progress: LlmInstallProgress) => void): Promise<void>;
  isLlmInstalled(): boolean;
  /**
   * Sends a single user message and returns the assistant's reply text.
   * Requires `installLlm()` to have completed. An optional `system` message
   * steers the reply's format (see src/core/ai-plan.ts) without changing the
   * plain-chat call sites that omit it. An optional `onToken` callback
   * receives each incremental piece of the reply as it is generated —
   * implemented by src/app/llm/wllama-engine.ts for its native token
   * streaming; this WebLLM-backed engine does not stream and simply invokes
   * it once with the full reply before resolving.
   */
  askLlm(message: string, system?: string, onToken?: (delta: string) => void): Promise<string>;
  /**
   * Disposes the running engine and releases any resources it holds (e.g. a
   * `Blob` URL), returning to the not-installed state so a later
   * `installLlm()` starts fresh. Optional — this WebLLM-backed engine has no
   * meaningful "uninstall" beyond a page reload and does not implement it;
   * src/ui/ai-panel.ts only shows an Uninstall action when this is present.
   */
  uninstallLlm?(): Promise<void>;
}

export function createLlmEngine(modelSource: ModelSource, files: readonly ModelFileEntry[]): LlmEngine {
  const prepopulateModelCache = createCachePrepopulator(modelSource, files);

  let engine: MLCEngine | undefined;
  let installPromise: Promise<MLCEngine> | undefined;

  function installLlm(onProgress?: (progress: LlmInstallProgress) => void): Promise<void> {
    if (engine) {
      return Promise.resolve();
    }
    if (installPromise) {
      return installPromise.then(() => undefined);
    }

    installPromise = (async () => {
      await prepopulateModelCache((p: PrepopulateProgress) => {
        onProgress?.({
          stage: 'preparing',
          progress: p.filesDone / p.filesTotal,
          text: `${p.fileName} (${p.filesDone}/${p.filesTotal})`,
        });
      });

      const created = await CreateMLCEngine(modelSource.modelId, {
        appConfig: modelSource.appConfig,
        initProgressCallback: (report) => {
          onProgress?.({ stage: 'loading', progress: report.progress, text: report.text });
        },
      });
      engine = created;
      return created;
    })();

    installPromise.catch(() => {
      // Allow a subsequent installLlm() call to retry from scratch.
      installPromise = undefined;
    });

    return installPromise.then(() => undefined);
  }

  function isLlmInstalled(): boolean {
    return engine !== undefined;
  }

  async function askLlm(message: string, system?: string): Promise<string> {
    if (!engine) {
      throw new Error('refrain-sheet: installLlm() must complete before askLlm()');
    }
    const completion = await engine.chat.completions.create({
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: message },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  return { installLlm, isLlmInstalled, askLlm };
}
