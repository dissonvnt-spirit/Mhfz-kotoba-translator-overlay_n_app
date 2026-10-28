import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';

// Pin model assets so a remote repository update cannot change installed code/data.
const MODEL = 'Xenova/opus-mt-ja-en';
const REVISION = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';
let cacheFailure: unknown;
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('kotoba-offline-models', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(key: string) {
    const db = await database;
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return blob ? new Response(blob) : undefined;
  },
  async put(key: string, response: Response) {
    const blob = await response.blob();
    const db = await database;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').put(blob, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Model storage failed.'));
    }).catch((error: unknown) => {
      cacheFailure = error;
      throw error;
    });
  },
};

let translator: Promise<TranslationPipeline> | undefined;
let active = false;
self.onmessage = async (event: MessageEvent<{ id: number; text?: string; assetBase: string; allowDownload: boolean }>) => {
  const { id, text, assetBase, allowDownload } = event.data;
  if (active) {
    self.postMessage({ id, error: 'The local translator is busy. Try again shortly.' });
    return;
  }
  active = true;
  try {
    // Transformers.js rejects local_files_only before checking custom caches
    // unless local models are enabled. Preparation still skips local URL probes.
    env.allowLocalModels = !allowDownload;
    // Executable WASM and its glue are bundled, not fetched from a CDN.
    if (env.backends.onnx.wasm) {
      env.backends.onnx.wasm.wasmPaths = assetBase;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
    translator ??= pipeline('translation', MODEL, {
      revision: REVISION,
      device: 'wasm',
      dtype: 'q8',
      // Only explicit preparation can download assets. Ordinary translation is
      // cache-only, including after restarting the app without internet.
      local_files_only: !allowDownload,
      progress_callback: (progress) => self.postMessage({ id, progress }),
    }).catch((error: unknown) => {
      translator = undefined;
      throw error;
    });
    const engine = await translator;
    if (allowDownload && cacheFailure) {
      translator = undefined;
      cacheFailure = undefined;
      throw new Error('Not enough persistent storage to save the model. Free disk space and retry.');
    }
    let translatedText: string | undefined;
    if (text !== undefined) {
      const output = await engine(text);
      const first = Array.isArray(output) ? output[0] : output;
      translatedText = (first as { translation_text?: string }).translation_text?.trim();
      if (!translatedText) throw new Error('The local model returned no translation.');
    }
    self.postMessage({ id, ready: true, translatedText });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Offline translation failed.' });
  } finally {
    active = false;
  }
};
