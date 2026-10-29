const { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { runtimeDirectory, copyRuntime } = require('./offline-runtime.cjs');

async function prepare() {
  const destination = path.resolve(__dirname, '../public/offline-runtime');
  copyRuntime(runtimeDirectory(), destination);
  // Ship OCR language data as application assets too: a cached translation
  // model alone is not sufficient to read a game while offline.
  const ocrDestination = path.resolve(__dirname, '../public/ocr');
  mkdirSync(ocrDestination, { recursive: true });
  const hashes = {
    jpn: '70304835d33b4feacf5faa60f56176578b64a03de2eeb0801539a3f6e7807ccc',
  };
  for (const language of ['jpn']) {
    const file = path.join(ocrDestination, `${language}.traineddata.gz`);
    let bytes;
    if (existsSync(file)) {
      bytes = readFileSync(file);
    } else {
      const response = await fetch(`https://tessdata.projectnaptha.com/4.0.0/${language}.traineddata.gz`);
      if (!response.ok) throw new Error(`Could not download ${language} OCR data: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== hashes[language]) {
      throw new Error(`Japanese OCR data checksum mismatch: ${language}. Delete the generated file and rebuild.`);
    }
    if (!existsSync(file)) writeFileSync(file, bytes);
  }
  // Clean old generated assets as well as preventing fresh vertical downloads.
  for (const obsolete of ['jpn_vert.traineddata.gz', 'jpn_vert.traineddata']) {
    rmSync(path.join(ocrDestination, obsolete), { force: true });
  }
  console.log('Prepared local ONNX runtime and horizontal Japanese OCR language data.');
}
prepare().catch((error) => { console.error(error); process.exitCode = 1; });
