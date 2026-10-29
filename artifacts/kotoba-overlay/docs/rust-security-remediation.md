# Rust security remediation for v0.2.6

The v0.2.5 release still had the four scanner reports recorded in
security-review-2026-10-28.md. This release changes actual dependency resolution
and source code; it does not hide advisories or relabel old upstream releases.

## Original reports

| Original report | Remediation |
| --- | --- |
| GHSA-qwgh-2vcv-g2f7, block-buffer 0.10.4 | Use sha2 0.11.1 / block-buffer 0.12.1 through a narrow tauri-codegen manifest patch. Update Wry's Android-only/example SHA-256 dependency too, removing the old version from the complete lockfile. |
| RUSTSEC-2024-0429, GLib iterator unsoundness | Backport upstream commit 05dff0ee696f9bcd8617cd48c4b812d046d440cb: declare a mutable out-pointer and pass `&mut p` to `g_variant_get_child`. |
| GHSA-wrw7-89jp-8q8g | Alias of the same GLib issue, addressed by the same source fix. |
| RUSTSEC-2024-0370, unmaintained proc-macro-error | Migrate both GTK macro consumers to proc-macro-error3 3.1.1. |

The first replacement candidate, proc-macro-error2, was rejected because its
own unmaintained advisory is now published. Upstream trybuild replaces the
test-only trybuild2 fork so that the new regression harness does not add
unmaintained basic-toml.

## Fresh scan result after the source/dependency changes

- Dependency audit: **0 critical, 0 high, 2 moderate**.
- The two remaining records are **both aliases of the original GLib issue**.
  The scanner matches version 0.18.5 without recognizing the local source
  backport. They have not been suppressed.
- Static application analysis: complete, **0 findings**.
- Privacy/security data-flow analysis: **0 findings**.

This is not a claim that the registry's GLib 0.18.5 package was repaired or
that every future scanner will recognize a backport. The project selects the
local patched source, and the original package identity is preserved honestly.
GTK/GLib remain absent from the Windows target's executable dependency tree.

## Verification gates

- `node --test scripts/rust-security.test.mjs` rejects old hashing and
  macro-error packages, registry GLib resolution, missing source fixes and
  stale vendored lockfiles.
- The Linux CI job runs the GLib iterator unit suite with `--release`,
  including repeated forward/backward iteration over empty, Japanese and
  ASCII strings, using the repaired FFI out-pointer.
- Both migrated macro crates are compiled, while the patched SHA-256
  integration is compiled into the Windows build's code-generation path.
- Windows CI builds the x64 app/installer and runs installed-control checks
  at 100%, 125%, 150% and 200% DPI. Release publication depends on all gates.
- Download checksums must be verified after publication.

The local Replit compiler is below the existing Tauri dependency tree's Rust
minimum requirement; native compilation uses GitHub's stable toolchain rather
than bypassing Rust-version checks.

See ../src-tauri/vendor/SECURITY-PATCHES.md for the verified upstream archive
hashes, exact patch scope, retained licenses and eventual patch-removal policy.
This security update does not change the GUI, game OCR model, cloud consent,
application identity, signing status or production API deployment.
