import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DialogueGate, DIALOGUE_SETTLE_MS, approveReview } from '../src/lib/dialogue-review.ts';

test('typewriter updates restart the full three-second buffer', () => {
  const gate = new DialogueGate();
  gate.observe('こん', 1000);
  assert.equal(gate.claim(3999), false);
  gate.observe('こんにちは。', 4000);
  assert.equal(gate.claim(6999), false);
  gate.observe('こんにちは。', 7000);
  assert.equal(gate.claim(7000), true);
  assert.equal(DIALOGUE_SETTLE_MS, 3000);
});

test('one page gets one automatic attempt, including after failures', () => {
  const gate = new DialogueGate();
  gate.observe('こんにちは。', 0);
  gate.observe('こんにちは。', 3000);
  assert.equal(gate.claim(3000), true);
  for (let time = 6000; time < 120000; time += 3000) {
    gate.observe('こんにちは。', time);
    assert.equal(gate.claim(time), false);
  }
});

test('OCR whitespace changes do not cause repeated translations', () => {
  const gate = new DialogueGate();
  gate.observe('こんにちは。\n次の行', 0);
  gate.observe('こ ん に ち は。 次の行', 3000);
  assert.equal(gate.claim(3000), true);
  gate.observe('こんにちは。次の行', 6000);
  assert.equal(gate.claim(6000), false);
});

test('an explicitly submitted line is not automatically translated again from capture', () => {
  const gate = new DialogueGate();
  gate.observe('こんにちは。', 0);
  gate.markAttempted('こんにちは。');
  gate.observe('こんにちは。', 3000);
  assert.equal(gate.claim(3000), false);
});

test('new dialogue settles independently and can differ by one character', () => {
  const gate = new DialogueGate();
  gate.observe('炎', 0);
  gate.observe('炎', 3000);
  assert.equal(gate.claim(3000), true);
  gate.observe('氷', 4000);
  assert.equal(gate.claim(6999), false);
  gate.observe('氷', 7000);
  assert.equal(gate.claim(7000), true);
});

test('pause interrupts settling without rearming an already handled page', () => {
  const gate = new DialogueGate();
  gate.observe('こんにちは。', 0);
  gate.interrupt();
  gate.observe('こんにちは。', 50000);
  assert.equal(gate.claim(50000), false);
  gate.observe('こんにちは。', 53000);
  assert.equal(gate.claim(53000), true);
  gate.interrupt();
  gate.observe('こんにちは。', 100000);
  gate.observe('こんにちは。', 103000);
  assert.equal(gate.claim(103000), false);
});

test('a stable blank separates new occurrences of identical dialogue', () => {
  const gate = new DialogueGate();
  gate.observe('はい。', 0);
  gate.observe('はい。', 3000);
  assert.equal(gate.claim(3000), true);
  gate.observe('', 4000);
  gate.observe('', 7000);
  gate.observe('はい。', 8000);
  gate.observe('はい。', 11000);
  assert.equal(gate.claim(11000), true);
});

test('a single blank after pausing does not rearm the approved page', () => {
  const gate = new DialogueGate();
  gate.observe('はい。', 0);
  gate.observe('はい。', 3000);
  assert.equal(gate.claim(3000), true);
  gate.interrupt();
  gate.observe('', 100000);
  gate.observe('はい。', 100100);
  gate.observe('はい。', 103100);
  assert.equal(gate.claim(103100), false);
});

const pending = { id: 'attempt-1', sourceText: 'こんにちは。', translatedText: 'Hello.',
  timestamp: 100, status: 'pending' };

test('approval alone creates a journal entry and stale/double approvals do nothing', () => {
  assert.equal(approveReview(pending, 'old-id', [], 500), null);
  const result = approveReview(pending, pending.id, [], 500);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].translatedText, 'Hello.');
  assert.equal(result.review.status, 'accepted');
  assert.equal(approveReview(result.review, pending.id, result.lines, 500), null);
  for (const status of ['error', 'translating']) {
    assert.equal(approveReview({ ...pending, status }, pending.id, [], 500), null);
  }
});

test('full journals are not overwritten and reviewed timestamps remain unique', () => {
  const previous = [{ sourceText: '前', translatedText: 'Previous', timestamp: 100 }];
  assert.throws(() => approveReview(pending, pending.id, previous, 1), /Journal full/);
  assert.equal(previous.length, 1);
  const result = approveReview(pending, pending.id, previous, 500);
  assert.equal(result.lines[0].timestamp, 101);
  assert.deepEqual(result.lines[1], previous[0]);
});

test('the capture path claims before translating and has no timed automatic retry', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.indexOf('dialogueGateRef.current.claim(') < app.indexOf("translateText(detectedText, false, 'capture')"));
  assert.doesNotMatch(app, /retryTextRef|recentTextRef|automatic retry\./);
  assert.match(app, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(approved\.lines\)\)/);
  assert.match(app, /request-state/);
  assert.match(app, /accept-review/);
  assert.match(app, /retry-review/);
});
