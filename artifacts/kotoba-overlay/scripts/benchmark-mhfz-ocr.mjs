// Run with Node >=22.18 (native TypeScript stripping).
// Inputs remain local: node scripts/benchmark-mhfz-ocr.mjs LABELS_JSON SCREENSHOTS_DIR train|holdout
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import { MHFZ_NPC_DIALOGUE, dialoguePixelBounds, mhfzTextRows, prepareMhfzLine } from './lib/mhfz-ocr-experiment.ts';
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('@huggingface/transformers'))('sharp');
const root = path.resolve(import.meta.dirname, '../../..');
const [labelPath, imageDirectory, split = 'train'] = process.argv.slice(2);
if (!labelPath || !imageDirectory || !['train', 'holdout'].includes(split)) {
  throw new Error('Usage: benchmark-mhfz-ocr.mjs LABELS_JSON SCREENSHOTS_DIR train|holdout');
}
const manifest = JSON.parse(await readFile(labelPath, 'utf8'));
const samples = manifest[split];
if (!Array.isArray(samples) || !samples.length) throw new Error(`No ${split} samples`);
const output = path.join(root, 'generated-artifacts/mhfz-ocr');
await mkdir(path.join(output, 'cache'), { recursive: true });
const files = await readdir(imageDirectory);
const normalize = text => [...text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '')];
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}
const worker = await createWorker('jpn', undefined, {
  langPath: path.join(root, 'artifacts/kotoba-overlay/public/ocr'),
  cachePath: path.join(output, 'cache'),
});
const results = [];
try {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  for (const sample of samples) {
    const candidates = files.filter(name => name.startsWith(`${sample.id}_`) && name.endsWith('.png')
      && (!manifest.filenameIncludes || name.includes(manifest.filenameIncludes)));
    if (candidates.length !== 1) throw new Error(`Expected one screenshot for sample ${sample.id}`);
    const source = path.join(imageDirectory, candidates[0]);
    const { width, height } = await sharp(source).metadata();
    const bounds = dialoguePixelBounds(MHFZ_NPC_DIALOGUE, width, height);
    // Match the current app's manual-region scaling and gray/contrast preprocessing.
    const cropped = await sharp(source).extract(bounds)
      .resize({ width: Math.round(bounds.width * Math.min(2, 1600 / bounds.width)) })
      .greyscale().linear(1.12, -15.3).png().toBuffer();
    for (const [variant, image] of [['baseline-crop', cropped]]) {
      const { data: result } = await worker.recognize(image);
      const expected = normalize(sample.text);
      const errors = distance(expected, normalize(result.text));
      const entry = { id: sample.id, variant, characters: expected.length, errors, cer: errors / expected.length, text: result.text.trim() };
      results.push(entry);
      console.log(JSON.stringify(entry));
    }
    const raw = await sharp(source).extract(bounds).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rows = mhfzTextRows(raw.data, raw.info.width, raw.info.height);
    const recognized = [];
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    for (const row of rows) {
      const prepared = prepareMhfzLine(raw.data, raw.info.width, raw.info.height, row);
      const line = await sharp(prepared.data, { raw: { width: prepared.width, height: prepared.height, channels: 4 } }).png().toBuffer();
      const result = await worker.recognize(line);
      recognized.push(result.data.text.trim());
    }
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const expected = normalize(sample.text);
    const text = recognized.join('\n');
    const errors = distance(expected, normalize(text));
    const entry = { id: sample.id, variant: 'line-ocr', characters: expected.length, errors, cer: errors / expected.length, text, rows };
    results.push(entry);
    console.log(JSON.stringify(entry));
  }
} finally {
  await worker.terminate();
}
const summary = Object.fromEntries(['baseline-crop', 'line-ocr'].map(variant => {
  const subset = results.filter(result => result.variant === variant);
  const characters = subset.reduce((n, result) => n + result.characters, 0);
  const errors = subset.reduce((n, result) => n + result.errors, 0);
  return [variant, { characters, errors, cer: errors / characters }];
}));
await writeFile(path.join(output, `${split}-results.json`), JSON.stringify({
  labelSource: manifest.labelSource,
  targetFonts: manifest.targetFonts ?? ['MS Gothic', 'Malgun Gothic', 'SimSun'],
  sampleFontsVerified: manifest.sampleFontsVerified ?? false,
  summary, results,
}, null, 2));
console.log('SUMMARY', split, JSON.stringify(summary));
