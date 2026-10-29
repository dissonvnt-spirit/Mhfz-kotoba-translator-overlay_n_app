# Offline runtime packaging audit

## Audited dependencies and load path

- Transformers.js **3.8.1**, pinned exactly in the app manifest and lockfile.
- Its ONNX Runtime Web dependency: **1.22.0-dev.20250409-89f8206ba4**.
- `dist/transformers.web.js` imports `onnxruntime-web`.
- ORT's default ESM export is `dist/ort.bundle.min.mjs`. It embeds the
  JSEP glue, whose static WASM URL causes Vite to emit a hashed WASM asset.
- ORT's `lib/wasm/wasm-utils-import.ts` chooses
  `ort-wasm-simd-threaded.jsep.mjs` when JSEP is enabled. That choice does
  **not** depend on the pipeline's `device: 'wasm'` or `numThreads: 1`.
- Our worker always supplies the bundled `/offline-runtime/` URL prefix as
  `wasmPaths`. ORT therefore dynamically imports the local JSEP glue instead
  of using its embedded copy. The glue loads the adjacent JSEP WASM file.

The supported `onnxruntime-web-use-extern-wasm` export condition selects
`dist/ort.min.mjs`, avoiding the embedded glue and hashed WASM emission while
preserving the runtime variant and inference backend. Vite applies this
condition to the translation worker as well as the client.

## Payload decisions

Keep exactly these executable assets, from the installed pinned dependency:

| Asset | Bytes |
| --- | ---: |
| `offline-runtime/ort-wasm-simd-threaded.jsep.mjs` | 44,484 |
| `offline-runtime/ort-wasm-simd-threaded.jsep.wasm` | 21,596,019 |

Remove the unselected non-JSEP glue (20,856 bytes), its WASM (11,133,407
bytes), and the redundant hashed JSEP WASM (21,596,019 bytes). The smaller
worker also no longer embeds a second copy of the JSEP glue.

Do not switch to the plain WASM-only ORT export just because the pipeline
uses CPU inference. This change deliberately retains the already-working
JSEP variant rather than introducing another runtime/backend change.

`prepare-offline.cjs` cleans stale generated variants on incremental builds.
`offline-runtime.cjs` rejects unaudited dependency versions. The build's
`verify-offline-runtime.cjs` rejects extra/missing runtime files, altered
runtime bytes, and duplicate emitted ONNX WASM/glue assets. Tests cover
repeatable cleanup, missing source assets and deliberately broken packages.

## Policy and verification boundaries

No translation model, OCR engine or Japanese language data was removed.
Model revision, quantization, IndexedDB namespace, Tauri identity, CSP,
single-thread CPU inference and local preparation self-test are unchanged.
All executable runtime code remains bundled; this change adds no CDN or
cloud dependency. Only explicit preparation may download model data.
Ordinary translation remains cache-only, without a cloud fallback.

Run:

```sh
pnpm --filter @workspace/kotoba-overlay run test:offline
pnpm --filter @workspace/kotoba-overlay run build
pnpm --filter @workspace/kotoba-overlay run typecheck
```

The Windows workflow builds and silently installs the actual NSIS package,
starts the installed app and requires successful first-time model
preparation **including Japanese-to-English inference**, not just download
completion. It never selects cloud mode. Its report records installer,
installed executable and installed-directory file bytes before first
launch, excluding later WebView profile/model cache data. File-byte totals
are not filesystem allocation-cluster usage.

This check is not evidence for real gameplay, OCR accuracy, network-isolated
inference, restart/upgrade persistence, or a machine without WebView2.

## Measured Windows results — 2026-10-29

Two manual, non-release workflow runs used the same product source and size
instrumentation; the optimized run changed only the runtime packaging,
dependency pin and packaging checks:

- [Baseline Windows run](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40794644831)
- [Optimized Windows run](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40794736191)

Both completed successfully on `windows-latest`, including silent installation,
installed-app startup, first-time local model preparation and the worker's
Japanese-to-English self-test, plus overlay move/resize/reuse/reopen checks.
The model self-test ran through the installed app using the real bundled WASM
and WebView2, without translation credentials or cloud consent.

| Measurement | Baseline bytes | Optimized bytes | Saved bytes | Reduction |
| --- | ---: | ---: | ---: | ---: |
| NSIS installer | 32,897,709 | 30,694,296 | 2,203,413 | 6.70% |
| Installed directory, before first launch | 39,804,952 | 37,691,928 | 2,113,024 | 5.31% |
| Installed app executable | 39,725,568 | 37,612,544 | 2,113,024 | 5.32% |

The installed directory includes the app and uninstaller, not the separately
downloaded model or WebView user data. Shared/system WebView2 installation is
also excluded. Measurements are file lengths, not allocated filesystem blocks.
The native app embeds compressed frontend assets, and NSIS compresses its
payload: eliminating roughly 31 MiB of redundant raw runtime files does **not**
mean a 31 MiB smaller installer. Actual measured savings are about **2.10 MiB**
for the installer and **2.02 MiB** for the installed package.

No tag, GitHub Release, main-branch merge or production deployment was made
for these verification runs.
