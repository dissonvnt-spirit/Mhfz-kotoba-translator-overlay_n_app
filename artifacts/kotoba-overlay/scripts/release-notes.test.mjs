import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
// Git on Windows may check text out with CRLF. Content checks must not depend
// on the host's checkout newline convention.
const read = async (path) => (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');

test('the installed version has substantive release-specific notes', async () => {
  const { version } = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const notes = await read(`releases/v${version}.md`);
  assert.ok(notes.startsWith(`# Kotoba Overlay v${version}\n`));
  for (const title of ['Changes', 'Windows downloads', 'Updating', 'Requirements and known limitations']) {
    const section = notes.split(`## ${title}\n`)[1]?.split('\n## ')[0].trim();
    assert.ok(section && section.length >= 30, `Missing or empty ${title} section`);
  }
  assert.doesNotMatch(notes, /\b(?:TODO|TBD|PLACEHOLDER)\b/i, 'Release notes must be finished before release');
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
