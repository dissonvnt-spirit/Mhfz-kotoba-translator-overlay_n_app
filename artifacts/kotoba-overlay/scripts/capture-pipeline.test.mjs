import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureGeometry, captureFailureMessage, CapturePipelineError,
  readableJapanese, waitForCaptureFrame, withCaptureDeadline,
} from '../src/lib/capture-pipeline.ts';

test('full HD and supplied screenshot resolutions are not reduced to 1200 pixels', () => {
  assert.equal(captureGeometry(1920, 1080, null).width, 1920);
  assert.equal(captureGeometry(2559, 1438, null).width, 2559);
});
test('crop rounding clamps the bottom/right edges and rejects empty crops', () => {
  const crop = captureGeometry(1920, 1080, { x: .99, y: .99, width: .5, height: .5 });
  assert.equal(crop.left + crop.cropWidth, 1920);
  assert.equal(crop.top + crop.cropHeight, 1080);
  assert.throws(() => captureGeometry(1920, 1080, { x: 1, y: 0, width: .2, height: 1 }), /outside/);
  assert.throws(() => captureGeometry(1920, 1080, { x: NaN, y: 0, width: 1, height: 1 }), /invalid/);
});
test('selected dialogue is enlarged without changing normalized crop placement', () => {
  const crop = captureGeometry(1920, 1080, { x: .375, y: .8, width: .25, height: .1 });
  assert.deepEqual(crop, { left: 720, top: 864, cropWidth: 480, cropHeight: 108, width: 960, height: 216 });
});
test('Japanese OCR spacing is normalized without merging Latin player names', () => {
  assert.equal(readableJapanese('こ ん に ち は 。\nSpirit さん'), 'こんにちは。\nSpirit さん');
  assert.equal(readableJapanese('炎'), '炎');
  assert.equal(readableJapanese('Next GPU CPU'), '');
});
test('deadline failure has a stage and disposes a worker that arrives too late', async () => {
  let resolve;
  let disposed = false;
  const pending = new Promise(r => { resolve = r; });
  const result = withCaptureDeadline(pending, 5, new CapturePipelineError('ocr-start', 'OCR timeout'),
    () => { disposed = true; });
  await assert.rejects(result, error => error.phase === 'ocr-start');
  resolve({});
  await Promise.resolve();
  assert.equal(disposed, true);
});
test('OCR errors never blame the cloud service', () => {
  assert.match(captureFailureMessage(new Error(), 'ocr-start'), /bundled OCR/);
  assert.match(captureFailureMessage(new Error(), 'ocr-read'), /No text/);
});
class Video extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  play() { return Promise.resolve(); }
}
test('play resolution alone does not prove video frames exist', async () => {
  const video = new Video();
  await assert.rejects(waitForCaptureFrame(video, 5), error => error.phase === 'frames');
});
test('decoded dimensions and data unblock OCR startup', async () => {
  const video = new Video();
  const ready = waitForCaptureFrame(video, 500);
  video.readyState = 2;
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  video.dispatchEvent(new Event('loadeddata'));
  await ready;
});
