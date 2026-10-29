import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = async (path) => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('physical resize target matches the authored CSS southeast grip', async () => {
  const css = await read('../src/index.css');
  const geometry = await read('./windows-smoke-geometry.ps1');
  const overlay = await read('../src/components/overlay-window.tsx');
  assert.match(css, /\.overlay-resize-NorthEast,[^{]+\{ width: 16px; height: 16px; \}/);
  assert.match(css, /\.overlay-resize-SouthEast \{ bottom: 0; right: 0;/);
  assert.match(geometry, /8 \* \$Dpi \/ 96\.0/);
  assert.match(overlay, /onMouseDown=\{\(event\) => nativeDrag\(event, direction\)\}/);
  assert.match(overlay, /nativeWindow\.startResizeDragging\(direction\)/);
});

test('native smoke uses client screen bounds and still requires real mouse growth before reuse and reopen', async () => {
  const smoke = await read('./windows-smoke.ps1');
  assert.match(smoke, /GetClientRect\(\$Handle, \[ref\]\$rect\)/);
  assert.match(smoke, /ClientToScreen\(\$Handle, \[ref\]\$origin\)/);
  assert.match(smoke, /Get-OverlayResizeTarget \$client/);
  assert.match(smoke, /WindowFromPoint\(\$point\)/);
  assert.match(smoke, /Drag-Mouse \$target\.x \$target\.y 80 60/);
  assert.ok(smoke.includes('$after.width -ge ($before.width + 30) -and $after.height -ge ($before.height + 20)'));
  const stages = ['overlay-mouse-resize', 'overlay-reuse', 'overlay-close-and-reopen', 'complete'];
  let position = -1;
  for (const stage of stages) {
    const next = smoke.indexOf(`Set-Stage '${stage}'`);
    assert.ok(next > position, `${stage} must remain required and ordered`);
    position = next;
  }
  assert.match(smoke, /if \(\$report\.status -ne 'passed'\) \{ exit 1 \}/);
});

test('Windows exercises DPI, hidden frame and negative-origin geometry in PowerShell', { skip: process.platform !== 'win32' }, () => {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./windows-smoke-geometry.test.ps1', import.meta.url)),
  ], { stdio: 'inherit' });
});
