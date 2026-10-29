# Narrow compatibility security patches

These are local, source-compatible patches to the latest stable Tauri 2
dependency tree, not a framework replacement. Upstream version numbers are
preserved: changing a version label would not fix a vulnerability.

The original crate archives were verified against the SHA-256 checksums in
the v0.2.5 Cargo.lock before extraction:

| Crate | Original archive SHA-256 |
| --- | --- |
| tauri-codegen 2.7.4 | fb37631cf71dab5e8ab55e1bdd701e18a52653d90b78e71d0e5598b1e0a61316 |
| glib 0.18.5 | 233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5 |
| glib-macros 0.18.5 | 0bb0228f477c0900c880fd78c8759b95c7636dbd7842707f49e132378aa2acdc |
| gtk3-macros 0.18.2 | 52ff3c5b21f14f0736fed6dcfc0bfb4225ebf5725f3c0209edeec181e4d73e9d |
| wry 0.57.1 | 759c50ddad0ef9913bb5496cb9d509a50433a3b78cb0238d61105526589cf0e9 |

## Changes

- **tauri-codegen:** upgrade its SHA-256 dependency from sha2 0.10 to 0.11.1.
  The existing Digest/Sha256 APIs remain in use. Cargo must resolve
  block-buffer at least 0.12.1, the published fix for GHSA-qwgh-2vcv-g2f7.
- **wry:** make the same SHA-256 dependency upgrade for its Android backend
  and development examples, so unused target dependencies do not retain the
  older block-buffer in the shared lockfile. No WebView implementation changed.
- **glib:** backport upstream commit
  `05dff0ee696f9bcd8617cd48c4b812d046d440cb`
  (gtk-rs/gtk-rs-core PR #1343): make the VariantStrIter out-pointer mutable
  and pass a mutable reference to the FFI function. This fixes the actual
  unsound write described by RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g.
- **glib-macros and gtk3-macros:** replace the unmaintained
  proc-macro-error 1.x dependency with proc-macro-error3 3.1.1.
  A crate-local alias preserves existing use sites; generated macro
  references can resolve the real proc_macro_error3 dependency. The initial
  candidate proc-macro-error2 was rejected after a fresh audit found its own
  unmaintained advisory (RUSTSEC-2026-0173).
- **GLib/macro test tooling:** replace the trybuild2 fork with upstream
  trybuild 1.0.122 under the existing test-only import name. This avoids
  introducing unmaintained basic-toml through the old test harness.

Cargo.toml.orig files are preserved as upstream provenance, not active
manifests. Original licenses and copyright notices remain in each directory.
Unused upstream lockfiles are omitted; only the application workspace lockfile
controls resolution.

## Verification and scanner limits

Test the patched GLib iterator in an optimized Linux build and compile both
macro crates. Build, install and smoke-test the Windows x64 application with
the same committed lockfile. Windows continues to use WebView2, not GTK.
The workspace defaults to the application package, not Linux-only vendor
members, so ordinary Windows builds do not attempt to build GLib.

A version-based scanner can still report the two GLib aliases because the
backport intentionally retains version 0.18.5. Do not suppress those records
or claim that the registry release itself was fixed. Report the pinned local
source patch, its regression evidence, and any remaining scanner findings.

Remove each patch when a compatible upstream release includes the equivalent
fix. Do not replace these patches with an unreviewed floating Git dependency
or an incompatible GLib major-version override.
