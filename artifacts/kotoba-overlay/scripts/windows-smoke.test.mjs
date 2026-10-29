import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = async (path) => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('physical resize targets match authored CSS corner and edge grips', async () => {
  const css = await read('../src/index.css');
  const geometry = await read('./windows-smoke-geometry.ps1');
  const overlay = await read('../src/components/overlay-window.tsx');
  assert.match(css, /\.overlay-resize-NorthEast,[^{]+\{ width: 16px; height: 16px; \}/);
  assert.match(css, /\.overlay-resize-SouthEast \{ bottom: 0; right: 0;/);
  assert.match(geometry, /8 \* \$Dpi \/ 96\.0/);
  assert.match(geometry, /4 \* \$Dpi \/ 96\.0/);
  assert.match(overlay, /onMouseDown=\{\(event\) => nativeDrag\(event, direction\)\}/);
  assert.match(overlay, /nativeWindow\.startResizeDragging\(direction\)/);
});

test('native smoke requires all directions, real mouse growth, minimum enforcement and recovery', async () => {
  const smoke = await read('./windows-smoke.ps1');
  const resize = await read('./windows-smoke-resize.ps1');
  const overlay = await read('../src/components/overlay-window.tsx');
  const app = await read('../src/App.tsx');
  assert.match(smoke, /GetClientRect\(\$Handle, \[ref\]\$rect\)/);
  assert.match(smoke, /ClientToScreen\(\$Handle, \[ref\]\$origin\)/);
  const directions = overlay.match(/const resizeDirections = \[([^\]]+)\]/)[1];
  for (const direction of directions.matchAll(/'([^']+)'/g)) {
    assert.ok(resize.includes(`'${direction[1]}'`), `${direction[1]} must be exercised natively`);
  }
  assert.match(resize, /Get-OverlayResizeTarget \$before \$dpi \$direction/);
  assert.match(resize, /WindowFromPoint\(\$point\)/);
  assert.match(resize, /Drag-Mouse \$target\.x \$target\.y \$dx \$dy/);
  assert.match(resize, /@\('grow', 'minimum', 'recover'\)/);
  assert.match(resize, /\$after\.width -ge \$before\.width \+ 30 \* \$scale/);
  assert.match(resize, /\$after\.height -ge \$before\.height \+ 20 \* \$scale/);
  assert.match(resize, /Test-OverlayResizeAnchors \$before \$after \$direction/);
  assert.match(app, /minWidth: 360,\s+minHeight: 170/);
  assert.match(resize, /\$before\.width - 360 \* \$scale \+ 40 \* \$scale/);
  assert.match(resize, /\$before\.height - 170 \* \$scale \+ 40 \* \$scale/);
  assert.match(resize, /Assert-Alive \$Overlay 1/);
  assert.match(resize, /Assert-Alive \$Main 1/);
  assert.match(resize, /Get-Control \$Overlay 'Close overlay' \$true/);
  const stages = ['overlay-mouse-resize', 'overlay-reuse', 'overlay-close-and-reopen', 'complete'];
  let position = -1;
  for (const stage of stages) {
    const next = smoke.indexOf(`Set-Stage '${stage}'`);
    assert.ok(next > position, `${stage} must remain required and ordered`);
    position = next;
  }
  assert.match(smoke, /if \(\$report\.status -ne 'passed'\) \{ exit 1 \}/);
});

test('release is gated by isolated, measured real desktop DPI runs', async () => {
  const workflow = await read('../../../.github/workflows/kotoba-windows-x64.yml');
  const smoke = await read('./windows-smoke.ps1');
  const resize = await read('./windows-smoke-resize.ps1');
  const display = await read('./windows-smoke-display.ps1');
  assert.match(workflow, /scaling: \[100, 125, 150, 200\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /-ScalingPercent \$\{\{ matrix.scaling \}\}/);
  assert.match(workflow, /name: windows-smoke-diagnostics-\$\{\{ matrix.scaling \}\}/);
  assert.match(workflow, /needs: \[build, windows-controls\]/);
  assert.match(smoke, /Set-SmokeDisplay \$ScalingPercent/);
  assert.match(smoke, /\$report\.mainDpi -ne \(96 \* \$ScalingPercent \/ 100\)/);
  assert.match(smoke, /\$report\.overlayDpi -ne \(96 \* \$ScalingPercent \/ 100\)/);
  assert.match(resize, /\$dpi -ne \$expectedDpi/);
  assert.match(display, /DisplayConfigSetDeviceInfo\(ref set\)/);
  assert.match(display, /get\.Current != relative/);
  assert.match(display, /ChangeDisplaySettingsEx/);
});

test('Windows exercises DPI, hidden frame and negative-origin geometry in PowerShell', { skip: process.platform !== 'win32' }, () => {
  for (const script of ['windows-smoke-geometry.test.ps1', 'windows-smoke-contract.test.ps1']) {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL(script, import.meta.url)),
    ], { stdio: 'inherit' });
  }
});
