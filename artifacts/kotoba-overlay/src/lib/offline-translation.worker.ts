import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { safeModelFile, type OfflineStage, type OfflineErrorCode } from './offline-errors';

// Pin model assets so a remote repository update cannot change installed code/data.
const MODEL = 'Xenova/opus-mt-ja-en';
const REVISION = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';
let cacheFailure = false;
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  // Open on request rather than at module import: a rejected eager promise can
  // become an unhandled worker error before the UI even registers a job.
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('kotoba-offline-models', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Model storage is blocked.'));
  });
}

async function storageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    cacheFailure = true;
    throw error;
  }
}

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(key: string) {
    return storageOperation(async () => {
      const db = await openDatabase();
      const blob = await new Promise<Blob | undefined>((resolve, reject) => {
        const transaction = db.transaction('files');
        const request = transaction.objectStore('files').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return blob ? new Response(blob) : undefined;
    });
  },
  async put(key: string, response: Response) {
    await storageOperation(async () => {
      const blob = await response.blob();
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('files', 'readwrite');
        transaction.objectStore('files').put(blob, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Model storage failed.'));
      });
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
  let stage: OfflineStage = 'storage';
  let file: string | undefined;
  cacheFailure = false;
  try {
    // Fail before downloading if WebView storage is unavailable. A committed
    // write (not merely opening IndexedDB) is necessary to prove it is writable.
    if (allowDownload) {
      await env.customCache!.put('kotoba-storage-check', new Response('ok'));
      const check = await env.customCache!.match('kotoba-storage-check');
      if (!check || await check.text() !== 'ok') {
        cacheFailure = true;
        throw new Error('Model storage check failed.');
      }
    } else {
      await storageOperation(openDatabase);
    }
    // Transformers.js rejects local_files_only before checking custom caches
    // unless local models are enabled. Preparation still skips local URL probes.
    env.allowLocalModels = !allowDownload;
    env.allowRemoteModels = allowDownload;
    // Executable WASM and its glue are bundled, not fetched from a CDN.
    if (env.backends.onnx.wasm) {
      env.backends.onnx.wasm.wasmPaths = assetBase;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }
    stage = 'download';
    const downloadedModels = new Set<string>();
    translator ??= pipeline('translation', MODEL, {
      revision: REVISION,
      device: 'wasm',
      dtype: 'q8',
      // Only explicit preparation can download assets. Ordinary translation is
      // cache-only, including after restarting the app without internet.
      local_files_only: !allowDownload,
      progress_callback: (progress) => {
        if ('file' in progress) file = safeModelFile(progress.file);
        if (progress.status === 'done' && file?.endsWith('.onnx')) {
          downloadedModels.add(file);
          if (downloadedModels.size === 2) {
            stage = 'runtime';
            self.postMessage({ id, progress: { status: 'runtime' } });
          }
        }
        self.postMessage({ id, progress });
      },
    }).catch((error: unknown) => {
      translator = undefined;
      throw error;
    });
    const engine = await translator;
    if (allowDownload && cacheFailure) {
      throw new Error('Model storage failed.');
    }
    // Download completion alone does not demonstrate working inference. Only
    // synthetic text is used, never captured dialogue or a cloud service.
    if (allowDownload) {
      stage = 'self-test';
      file = undefined;
      self.postMessage({ id, progress: { status: 'self-test' } });
      const output = await engine('こんにちは。');
      const first = Array.isArray(output) ? output[0] : output;
      const translated = (first as { translation_text?: string }).translation_text?.trim();
      if (!translated || !/[a-z]/i.test(translated) || /[\u3040-\u30ff\u3400-\u9fff]/u.test(translated)) {
        throw new Error('The local model self-test failed.');
      }
    }
    let translatedText: string | undefined;
    if (text !== undefined) {
      stage = 'translation';
      const output = await engine(text);
      const first = Array.isArray(output) ? output[0] : output;
      translatedText = (first as { translation_text?: string }).translation_text?.trim();
      if (!translatedText) throw new Error('The local model returned no translation.');
    }
    self.postMessage({ id, ready: true, translatedText });
  } catch (error) {
    translator = undefined;
    const failureStage = stage as OfflineStage; // The progress callback also updates the stage.
    // Classify locally; do not send the underlying exception to the UI.
    const code: OfflineErrorCode = cacheFailure || stage === 'storage' ? 'LOCAL-STORAGE'
      : stage === 'self-test' || stage === 'translation' ? 'LOCAL-INFERENCE'
      : !allowDownload ? 'LOCAL-MISSING'
      : failureStage === 'runtime' || /wasm|webassembly|backend|session|memory|dynamically imported module/i.test(error instanceof Error ? error.message : '') ? 'LOCAL-RUNTIME'
      : 'LOCAL-DOWNLOAD';
    self.postMessage({ id, error: code, stage, file });
  } finally {
    active = false;
  }
};
