// SPDX-License-Identifier: MIT
/**
 * Lifecycle wrapper around `@mlc-ai/web-llm`'s `MLCEngine`: install (cache
 * pre-population + engine load) and a minimal chat call. No network access
 * at any point — `install()` writes the embedded model into Cache Storage
 * (see cache-prepopulate.ts) before starting the engine, so WebLLM never
 * calls `fetch()`.
 *
 * Requires WebGPU (`navigator.gpu`) and the Cache Storage API (`caches`),
 * neither of which this agent's sandbox can exercise end-to-end — see
 * docs/llm-model.md for what is and is not verified.
 */
import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';
import { prepopulateModelCache, type PrepopulateProgress } from './cache-prepopulate';
import { MODEL_APP_CONFIG, MODEL_ID } from './model-source';

export type LlmInstallStage = 'preparing' | 'loading';

export interface LlmInstallProgress {
  readonly stage: LlmInstallStage;
  /** 0..1 */
  readonly progress: number;
  readonly text: string;
}

let engine: MLCEngine | undefined;
let installPromise: Promise<MLCEngine> | undefined;

/**
 * Reassembles and verifies the embedded model, pre-populates Cache Storage,
 * then starts the WebLLM engine. Safe to call more than once — concurrent
 * calls share one in-flight install, and a completed install is reused.
 */
export function installLlm(onProgress?: (progress: LlmInstallProgress) => void): Promise<MLCEngine> {
  if (engine) {
    return Promise.resolve(engine);
  }
  if (installPromise) {
    return installPromise;
  }

  installPromise = (async () => {
    await prepopulateModelCache((p: PrepopulateProgress) => {
      onProgress?.({
        stage: 'preparing',
        progress: p.filesDone / p.filesTotal,
        text: `${p.fileName} (${p.filesDone}/${p.filesTotal})`,
      });
    });

    const created = await CreateMLCEngine(MODEL_ID, {
      appConfig: MODEL_APP_CONFIG,
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

  return installPromise;
}

export function isLlmInstalled(): boolean {
  return engine !== undefined;
}

/** Sends a single user message and returns the assistant's reply text. Requires `installLlm()` to have completed. */
export async function askLlm(message: string): Promise<string> {
  if (!engine) {
    throw new Error('refrain-sheet: installLlm() must complete before askLlm()');
  }
  const completion = await engine.chat.completions.create({
    messages: [{ role: 'user', content: message }],
  });
  return completion.choices[0]?.message?.content ?? '';
}
