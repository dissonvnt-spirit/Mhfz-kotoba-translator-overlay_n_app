import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const source = (name) => readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
// Execute the real worker/controller logic with injected browser primitives.
// This verifies boundaries/retry behavior, not native WASM inference.
function load(name, globals = {}, imports = {}) {
  const code = ts.transpileModule(source(name)
    .replaceAll('import.meta.env.BASE_URL', '"/"')
    .replaceAll('import.meta.url', '"https://app.test/assets/main.js"'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, Error, Blob, Response, setTimeout, clearTimeout,
    require: (id) => {
      assert.ok(id in imports, `Unexpected import: ${id}`);
      return imports[id];
    },
    ...globals,
  });
  return exports;
}
const errors = load('offline-errors');

function idb({ blocked = false, quota = false } = {}) {
  const files = new Map();
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (blocked) { request.onblocked(); return; }
        request.result = {
          transaction() {
            const transaction = {
              objectStore: () => ({
                put(blob, key) {
                  queueMicrotask(() => {
                    if (quota) {
                      transaction.error = new Error('private path or signed URL');
                      transaction.onabort();
                    } else {
                      files.set(key, blob);
                      transaction.oncomplete();
                    }
                  });
                },
                get(key) {
                  const get = {};
                  queueMicrotask(() => {
                    get.result = files.get(key);
                    get.onsuccess();
                  });
                  return get;
                },
              }),
            };
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
}

function worker({ storage = {}, pipeline = async () => async () => [{ translation_text: 'Hello.' }] } = {}) {
  const messages = [];
  const self = { postMessage: (message) => messages.push(message) };
  const env = { backends: { onnx: { wasm: {} } } };
  load('offline-translation.worker', { self, indexedDB: idb(storage) }, {
    '@huggingface/transformers': { env, pipeline },
    './offline-errors': errors,
  });
  return {
    env, messages,
    run: (allowDownload, text) => self.onmessage({ data: { id: 1, allowDownload, text, assetBase: 'https://app.test/offline-runtime/' } }),
  };
}

test('safe diagnostics never include arbitrary filenames or raw exceptions', () => {
  assert.equal(errors.safeModelFile('https://host.test/model?secret=private'), undefined);
  assert.equal(errors.safeModelFile('onnx/encoder_model_quantized.onnx'), 'onnx/encoder_model_quantized.onnx');
  const message = errors.offlineError('LOCAL-DOWNLOAD', 'download', 'private/path');
  assert.match(message, /LOCAL-DOWNLOAD; download/);
  assert.doesNotMatch(message, /private\/path/);
  assert.match(message, /No dialogue was sent to the cloud/);
  assert.doesNotMatch(errors.offlineFailureMessage(new Error('private dialogue')), /private dialogue/);
});

test('preparation checks writable storage before model requests', async () => {
  for (const storage of [{ blocked: true }, { quota: true }]) {
    let calls = 0;
    const harness = worker({ storage, pipeline: async () => { calls++; } });
    await harness.run(true);
    assert.equal(calls, 0);
    assert.equal(harness.messages.at(-1).error, 'LOCAL-STORAGE');
    assert.doesNotMatch(JSON.stringify(harness.messages), /private path/);
  }
});

test('preparation does not report ready until synthetic Japanese inference succeeds', async () => {
  let release;
  let options;
  const harness = worker({
    pipeline: async (task, model, config) => {
      assert.equal(task, 'translation');
      assert.equal(model, 'Xenova/opus-mt-ja-en');
      options = config;
      return async (text) => {
        assert.equal(text, 'こんにちは。');
        await new Promise((resolve) => { release = resolve; });
        return [{ translation_text: 'Hello.' }];
      };
    },
  });
  const preparation = harness.run(true);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!harness.messages.some((message) => message.ready));
  assert.equal(options.local_files_only, false);
  assert.equal(options.device, 'wasm');
  assert.equal(harness.env.backends.onnx.wasm.numThreads, 1);
  release();
  await preparation;
  assert.equal(harness.messages.at(-1).ready, true);
});

test('failed inference is not mistaken for successful preparation', async () => {
  const harness = worker({ pipeline: async () => async () => [{ translation_text: 'こんにちは。' }] });
  await harness.run(true);
  assert.equal(harness.messages.at(-1).error, 'LOCAL-INFERENCE');
  assert.ok(!harness.messages.some((message) => message.ready));
});

test('download errors are safe and keep the last known stage and allowlisted file', async () => {
  const harness = worker({
    pipeline: async (_task, _model, options) => {
      options.progress_callback({ status: 'initiate', file: 'tokenizer.json' });
      throw new Error('Failed to fetch https://host.test?signature=private');
    },
  });
  await harness.run(true);
  const failure = harness.messages.at(-1);
  assert.equal(failure.error, 'LOCAL-DOWNLOAD');
  assert.equal(failure.file, 'tokenizer.json');
  assert.equal(failure.stage, 'download');
  assert.doesNotMatch(JSON.stringify(harness.messages), /private|signature/);
});

test('ordinary translation is cache-only with remote models disabled', async () => {
  let config;
  const harness = worker({
    pipeline: async (_task, _model, options) => {
      config = options;
      return async (text) => {
        assert.equal(text, 'ありがとう。');
        return [{ translation_text: 'Thank you.' }];
      };
    },
  });
  await harness.run(false, 'ありがとう。');
  assert.equal(config.local_files_only, true);
  assert.equal(harness.env.allowRemoteModels, false);
  assert.equal(harness.messages.at(-1).translatedText, 'Thank you.');
});

test('a rejected cache write cannot silently make preparation succeed', async () => {
  let env;
  const harness = worker({
    pipeline: async () => {
      // Transformers.js catches cache write failures internally. The worker must
      // still reject preparation even when the pipeline itself resolves.
      await env.customCache.put('model', { blob: async () => { throw new Error('private'); } }).catch(() => {});
      return async () => [{ translation_text: 'Hello.' }];
    },
  });
  env = harness.env;
  await harness.run(true);
  assert.equal(harness.messages.at(-1).error, 'LOCAL-STORAGE');
});

test('retry replaces a worker whose ONNX initialization failed', { timeout: 5000 }, async (t) => {
  const workers = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  }
  const { OfflineTranslator } = load('offline-translation', {
    Worker, navigator: {}, location: { origin: 'https://app.test' },
  }, { './offline-errors': errors });
  const translator = new OfflineTranslator();
  t.after(() => translator.dispose());
  const preparation = translator.prepare(() => {});
  await Promise.resolve(); // prepare awaits the best-effort persistence request.
  workers[0].onmessage({ data: { id: 1, error: 'LOCAL-RUNTIME', stage: 'runtime' } });
  await assert.rejects(preparation, /LOCAL-RUNTIME/);
  assert.equal(workers[0].terminated, true);
  const retry = translator.prepare(() => {});
  await Promise.resolve();
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { id: 2, ready: true } });
  await retry;
  translator.dispose();
});
