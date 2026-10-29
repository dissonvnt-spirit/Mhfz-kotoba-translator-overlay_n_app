import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dialoguePixelBounds, mhfzTextRows, prepareMhfzLine } from './lib/mhfz-ocr-experiment.ts';

test('normalized dialogue bounds remain inside the image', () => {
  assert.deepEqual(dialoguePixelBounds({ x: -1, y: .9, width: 2, height: 1 }, 100, 100),
    { left: 0, top: 90, width: 100, height: 10 });
});

test('green cursor/red prompts are not treated as horizontal dialogue', () => {
  for (const rgb of [[20, 230, 20], [230, 30, 30]]) {
    const pixels = new Uint8ClampedArray(40 * 20 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
    assert.deepEqual(mhfzTextRows(pixels, 40, 20), []);
  }
});

test('white and yellow dialogue bands can be detected without altering glyphs', () => {
  for (const rgb of [[230, 230, 230], [240, 220, 20]]) {
    const pixels = new Uint8ClampedArray(40 * 20 * 4);
    for (let y = 5; y < 12; y++) {
      for (let x = 5; x < 35; x++) pixels.set([...rgb, 255], (y * 40 + x) * 4);
    }
    assert.deepEqual(mhfzTextRows(pixels, 40, 20), [{ top: 2, height: 13 }]);
  }
});

test('prepared line retains opaque pixels and white border', () => {
  const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(255);
  const result = prepareMhfzLine(pixels, 10, 10, { top: 0, height: 10 });
  assert.equal(result.width, 36);
  assert.equal(result.height, 36);
  assert.equal(result.data.length, 36 * 36 * 4);
  assert.ok(result.data.every(value => value === 255));
});
