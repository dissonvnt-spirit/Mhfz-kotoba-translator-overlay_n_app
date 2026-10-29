const { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// Audited together with the ORT export condition in vite.config.ts. The default
// ORT build selects JSEP even with device:'wasm'; numThreads:1 does not select
// the non-threaded/non-JSEP binary. Do not infer filenames from CPU/GPU settings.
const TRANSFORMERS_VERSION = '3.8.1';
const ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4';
const RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

function runtimeDirectory() {
  const transformersEntry = require.resolve('@huggingface/transformers');
  const transformersVersion = JSON.parse(readFileSync(path.resolve(path.dirname(transformersEntry), '../package.json'))).version;
  const transformersRequire = createRequire(transformersEntry);
  const runtime = path.dirname(transformersRequire.resolve('onnxruntime-web'));
  const ortVersion = JSON.parse(readFileSync(path.resolve(runtime, '../package.json'))).version;
  if (transformersVersion !== TRANSFORMERS_VERSION || ortVersion !== ORT_VERSION) {
    throw new Error('Offline runtime versions changed. Re-audit the loader and verify installed Windows inference before updating the runtime allowlist.');
  }
  return runtime;
}

function copyRuntime(runtime, destination) {
  // Read both first: missing files must fail rather than leave a partial update.
  for (const name of RUNTIME_FILES) readFileSync(path.join(runtime, name));
  mkdirSync(destination, { recursive: true });
  // Clean stale generated runtime files on incremental builds as well as CI.
  // Leave unrelated files alone; this is not a general public-directory cleanup.
  for (const name of readdirSync(destination)) {
    if (/^ort-wasm.*\.(?:wasm|mjs)$/.test(name) && !RUNTIME_FILES.includes(name)) {
      rmSync(path.join(destination, name));
    }
  }
  for (const name of RUNTIME_FILES) {
    copyFileSync(path.join(runtime, name), path.join(destination, name));
  }
}

module.exports = { TRANSFORMERS_VERSION, ORT_VERSION, RUNTIME_FILES, runtimeDirectory, copyRuntime };
