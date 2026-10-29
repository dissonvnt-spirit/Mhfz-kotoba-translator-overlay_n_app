import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../src-tauri/', import.meta.url);
const read = async name => (await readFile(new URL(name, root), 'utf8')).replace(/\r\n/g, '\n');
const packages = (await read('Cargo.lock')).split('[[package]]').slice(1);

test('the lockfile no longer contains old block-buffer or unmaintained macro-error', () => {
  const buffers = packages.filter(p => /^name = "block-buffer"$/m.test(p));
  assert.equal(buffers.length, 1);
  assert.match(buffers[0], /^version = "0\.12\.1"$/m);
  assert.ok(!packages.some(p => /^name = "(?:proc-macro-error|proc-macro-error-attr|proc-macro-error2|proc-macro-error-attr2|basic-toml)"$/m.test(p)));
  assert.ok(packages.some(p => /^name = "proc-macro-error3"$/m.test(p)));
});
test('the GLib backport is selected as local source, not an unfixed registry crate', async () => {
  const glib = packages.filter(p => /^name = "glib"$/m.test(p));
  assert.equal(glib.length, 1);
  assert.doesNotMatch(glib[0], /^source = /m);
  const source = await read('vendor/glib-0.18.5/src/variant_iter.rs');
  const method = source.split('fn impl_get(&self, i: usize)')[1]?.split("impl<'a> Iterator")[0];
  assert.match(method, /let mut p: \*mut libc::c_char/);
  assert.match(method, /g_variant_get_child\([\s\S]*?&mut p,/);
  assert.doesNotMatch(method, /^\s*&p,/m);
  assert.match(source, /fn security_mutable_out_pointer_optimized_iteration/);
});
test('both GTK macro consumers use the maintained replacement', async () => {
  for (const crate of ['glib-macros-0.18.5', 'gtk3-macros-0.18.2']) {
    assert.match(await read(`vendor/${crate}/Cargo.toml`), /\[dependencies\.proc-macro-error3\]/);
    assert.doesNotMatch(await read(`vendor/${crate}/Cargo.toml`), /\[dependencies\.proc-macro-error\]/);
    assert.match(await read(`vendor/${crate}/src/lib.rs`), /extern crate proc_macro_error3 as proc_macro_error;/);
  }
});
test('vendored upstream lockfiles cannot reintroduce the original advisories', async () => {
  for (const crate of ['tauri-codegen-2.7.4', 'wry-0.57.1']) {
    await assert.rejects(access(new URL(`vendor/${crate}/Cargo.lock`, root)), { code: 'ENOENT' });
  }
});
