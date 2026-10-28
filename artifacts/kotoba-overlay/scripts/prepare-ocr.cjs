const { copyFileSync, mkdirSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const tesseractRequire = createRequire(require.resolve("tesseract.js"));
const coreDirectory = path.dirname(
  tesseractRequire.resolve("tesseract.js-core/package.json"),
);
const destination = path.resolve(__dirname, "../public/ocr");
mkdirSync(destination, { recursive: true });
copyFileSync(
  require.resolve("tesseract.js/dist/worker.min.js"),
  path.join(destination, "worker.min.js"),
);

// createWorker uses LSTM-only recognition. Include each CPU-feature variant so
// Tesseract can select the supported engine without fetching executable code.
for (const name of readdirSync(coreDirectory)) {
  if (/^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm(?:\.js)?$/.test(name)) {
    copyFileSync(path.join(coreDirectory, name), path.join(destination, name));
  }
}
console.log("Prepared local Japanese OCR worker and WebAssembly engines.");
