import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = new URL('../', import.meta.url);
// Git on Windows may check text out with CRLF. Content checks must not depend
// on the host's checkout newline convention.
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');

test('the installed version has substantive release-specific notes', async () => {
  const { version, productName } = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const notes = await read(`releases/v${version}.md`);
  assert.equal(productName, 'MHFZ-Z Translator Overlay');
  assert.ok(notes.startsWith(`# ${productName} v${version}\n`));
  for (const title of ['Changes', 'Windows downloads', 'Updating', 'Requirements and known limitations']) {
    const section = notes.split(`## ${title}\n`)[1]?.split('\n## ')[0].trim();
    assert.ok(section && section.length >= 30, `Missing or empty ${title} section`);
  }
  assert.doesNotMatch(notes, /\b(?:TODO|TBD|PLACEHOLDER)\b/i, 'Release notes must be finished before release');
});

test('historical release notes retain their original product name', async () => {
  for (const version of ['0.1.1', '0.2.0', '0.2.1', '0.2.2', '0.2.3']) {
    assert.ok((await read(`releases/v${version}.md`)).startsWith(`# Kotoba Overlay v${version}\n`));
  }
});

test('native release versions match and upgrade identity remains stable', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const cargo = await read('src-tauri/Cargo.toml');
  const lock = await read('src-tauri/Cargo.lock');
  assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], config.version);
  assert.equal(lock.match(/\[\[package\]\]\nname = "kotoba-overlay"\nversion = "([^"]+)"/)?.[1], config.version);
  assert.match(cargo, /^name = "kotoba-overlay"$/m);
  assert.equal(config.identifier, 'com.kotoba.overlay');
  assert.equal(config.app.windows[0].label, 'main');
  assert.equal(config.app.windows[0].title, config.productName);
  const app = await read('src/App.tsx');
  assert.ok(app.includes("const label = 'translation-overlay'"));
  assert.ok(app.includes("title: 'MHFZ-Z Translator Overlay - Dialogue'"));
  const smoke = await read('scripts/windows-smoke.ps1');
  assert.ok(smoke.includes("Get-AppWindows 'MHFZ-Z Translator Overlay'"));
  assert.ok(smoke.includes("Get-AppWindows 'MHFZ-Z Translator Overlay - Dialogue'"));
  const emptyState = 'Japanese dialogue will appear here once the hunt begins.';
  assert.ok(app.includes(emptyState), 'Smoke empty-state text must match the rendered companion window');
  assert.equal(smoke.split(`Get-Control $overlay '${emptyState}'`).length - 1, 1);
  assert.equal(smoke.split(`Get-Control $reopened '${emptyState}'`).length - 1, 1);
});

test('GitHub releases publish version-specific notes plus generated change history', async () => {
  const workflow = await read('../../.github/workflows/kotoba-windows-x64.yml');
  const release = workflow.split('\n  release:\n')[1];
  assert.ok(release);
  assert.match(release, /actions\/checkout@v4/, 'Release job must check out its notes');
  assert.ok(release.includes('--notes-file "artifacts/kotoba-overlay/releases/$GITHUB_REF_NAME.md"'));
  assert.ok(release.includes('--generate-notes'));
  assert.ok(workflow.includes('run test:release-notes'));
});

test('application source has no GitHub update checks, notices, or release opener', async () => {
  async function check(directory) {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await check(path);
      else if (/\.(?:ts|tsx|rs)$/.test(entry.name)) {
        assert.doesNotMatch(await read(path),
          /DesktopUpdateNotice|checkForUpdate|open_official_releases|api\.github\.com\/repos\/|desktop-update-notice/,
          `Unexpected in-app update functionality in ${path}`);
      }
    }
  }
  await check('src');
  await check('src-tauri/src');
});

test('release asset names are normalized before checksums are generated', async () => {
  const workflow = await read('../../.github/workflows/kotoba-windows-x64.yml');
  const release = workflow.split('\n  release:\n')[1];
  assert.ok(release.includes('normalized="${file// /.}"'));
  assert.ok(release.indexOf('normalized="${file// /.}"') < release.indexOf('sha256sum *.exe > SHA256SUMS.txt'));
  // Exercise the actual release shell block on hosts with bash and sha256sum.
  // Windows runners execute the release job on Ubuntu, not PowerShell.
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(path.join(tmpdir(), 'kotoba-checksums-'));
  try {
    await writeFile(path.join(directory, 'MHFZ-Z Translator Overlay_0.2.4_x64-setup.exe'), 'synthetic installer');
    await writeFile(path.join(directory, 'kotoba-overlay.exe'), 'synthetic app');
    const block = release.split('cd release-assets\n')[1].split('          cd ..')[0]
      .split('\n').map((line) => line.replace(/^          /, '')).join('\n');
    execFileSync('bash', ['-euo', 'pipefail', '-c', block], {
      cwd: directory, env: { ...process.env, BASH_ENV: '' },
    });
    const manifest = await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8');
    assert.match(manifest, /MHFZ-Z\.Translator\.Overlay_0\.2\.4_x64-setup\.exe/);
    assert.doesNotMatch(manifest, /MHFZ-Z Translator Overlay/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
