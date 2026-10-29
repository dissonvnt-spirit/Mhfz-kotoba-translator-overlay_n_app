import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const preparation = await readFile(new URL('./prepare-offline.cjs', import.meta.url), 'utf8');

test('capture uses only the Japanese model and horizontal block segmentation', () => {
  assert.match(app, /createWorker\('jpn',/);
  assert.match(app, /tessedit_pageseg_mode:\s*PSM\.SINGLE_BLOCK,/);
  assert.doesNotMatch(app, /jpn_vert|SINGLE_BLOCK_VERT_TEXT|ocrOrientation|setOcrOrientation/);
  assert.doesNotMatch(app, /PSM\.(AUTO|OSD|SPARSE)/);
});

test('the UI cannot enable vertical OCR or mislabel standard OCR as font-restricted', () => {
  assert.match(app, /Horizontal only/);
  assert.doesNotMatch(app, /select-ocr-orientation|option value="vertical"/);
  for (const font of ['msgothic.ttc', 'malgun.ttf', 'simsun.ttc']) {
    assert.ok(app.includes(font));
  }
  assert.match(app, /Uses standard Japanese OCR, not a font-restricted model/);
});

test('asset preparation downloads only Japanese and removes stale vertical assets', async () => {
  const downloaded = [], removed = [];
  const path = await import('node:path');
  const expectedHash = '70304835d33b4feacf5faa60f56176578b64a03de2eeb0801539a3f6e7807ccc';
  const mocks = {
    'node:fs': {
      mkdirSync() {}, existsSync() { return false; },
      readFileSync() { throw new Error('Unexpected cached asset read'); },
      writeFileSync() {},
      rmSync(file, options) { assert.equal(options.force, true); removed.push(path.basename(file)); },
    },
    // This test covers model selection/cleanup, not the unchanged checksum implementation.
    'node:crypto': { createHash() { return { update() { return this; }, digest() { return expectedHash; } }; } },
    'node:path': path,
    './offline-runtime.cjs': { runtimeDirectory() { return '/runtime'; }, copyRuntime() {} },
  };
  const context = {
    require(name) { assert.ok(name in mocks, `Unexpected dependency: ${name}`); return mocks[name]; },
    __dirname: '/app/scripts', Buffer,
    fetch: async url => {
      downloaded.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    console: { log() {}, error(error) { throw error; } },
    process: { exitCode: 0 },
  };
  // Await the actual preparation entry point, including its error handler.
  await vm.runInNewContext(preparation, context);
  assert.equal(downloaded.length, 1);
  assert.match(downloaded[0], /\/jpn\.traineddata\.gz$/);
  assert.deepEqual(removed, ['jpn_vert.traineddata.gz', 'jpn_vert.traineddata']);
  assert.equal(context.process.exitCode, 0);
});
