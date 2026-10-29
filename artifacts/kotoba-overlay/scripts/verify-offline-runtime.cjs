const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { RUNTIME_FILES, runtimeDirectory } = require('./offline-runtime.cjs');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

function verify(directory) {
  const runtime = path.join(directory, 'offline-runtime');
  assert.deepEqual(readdirSync(runtime).sort(), [...RUNTIME_FILES].sort(), 'Unexpected or missing runtime payload');
  const source = runtimeDirectory();
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  for (const name of RUNTIME_FILES) {
    assert.equal(hash(path.join(runtime, name)), hash(path.join(source, name)), `Runtime differs from pinned dependency: ${name}`);
  }
  const all = files(directory);
  const duplicates = all.filter((file) => /^ort-wasm.*\.(wasm|mjs)$/.test(path.basename(file)) && path.dirname(file) !== runtime);
  assert.deepEqual(duplicates, [], 'Duplicate ONNX assets: check Vite external-WASM condition (including workers)');
  const report = {
    frontendBytes: all.reduce((total, file) => total + statSync(file).size, 0),
    runtimeFiles: RUNTIME_FILES.map((name) => ({ name, bytes: statSync(path.join(runtime, name)).size })),
  };
  return report;
}

module.exports = { verify };
if (require.main === module) {
  console.log(JSON.stringify(verify(path.resolve(__dirname, '../dist/public')), null, 2));
}
