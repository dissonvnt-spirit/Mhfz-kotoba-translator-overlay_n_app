# Windows x64 desktop build

MHFZ-Z Translator Overlay includes a Tauri 2 desktop shell and an NSIS installer target for
64-bit Windows. Build it from a Windows machine with Node.js, pnpm, Rust, the
Microsoft C++ Build Tools, and WebView2 installed:

```powershell
pnpm install
pnpm --filter @workspace/kotoba-overlay desktop:build:windows
```

The installer is written under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

For local development, run:

```powershell
pnpm --filter @workspace/kotoba-overlay desktop:dev
```

The packaged desktop app defaults to on-device translation. While online,
choose **Prepare local model** once before translating offline. Model storage
must be retained; installed/native offline inference after restarting is a
separate verification from the startup smoke check below.

### Initial model setup diagnostics

Preparation now checks committed WebView storage before downloading, starts
the bundled single-threaded WASM engine, and translates the fixed synthetic
sentence `こんにちは。` locally before reporting success. A download finishing
alone is not considered a pass. Errors show a safe code, a stage, and (when
available) the last known allowlisted model filename. Parallel downloads mean
this filename is not necessarily the file that failed.

| Code | Action |
| --- | --- |
| `LOCAL-STORAGE` | Check free disk space and app storage permissions. Close other instances and retry. |
| `LOCAL-DOWNLOAD` | Check internet/firewall access to Hugging Face and its redirected download hosts, then retry. |
| `LOCAL-RUNTIME` / `LOCAL-WORKER` | Close memory-heavy applications, retry, then check WebView2 and reinstall the latest build if it repeats. |
| `LOCAL-MISSING` | Prepare the model while online before requesting offline translation. |
| `LOCAL-INFERENCE` | Local inference or its synthetic self-test failed; free memory and retry preparation. |
| `LOCAL-TIMEOUT` | No progress for five minutes; check connectivity, storage and memory, then retry. |

Retry starts a new worker to discard ONNX's sticky failed initialization while
retaining previously committed downloads. Neither preparation nor an offline
failure selects cloud translation. Only authored diagnostics leave the worker;
raw exceptions, signed download URLs, device paths and dialogue are not logged
or displayed as setup errors.

**Current evidence:** the pinned configuration, tokenizer and quantized encoder
URLs were reachable from this Linux workspace using the Windows WebView origin.
The user's original 0.2.4 failure has **not been reproduced or identified**.
The changes add diagnostics and repair failed-worker retry/storage handling;
they are **not proof that the reported first-download failure is fixed**.
Installed Windows preparation and Japanese-to-English inference remain
unverified until the Windows check below has actually run successfully.

Optional cloud translation uses the preconfigured published Kotoba service
after player consent. No player API key or service token is required. The
OpenAI key belongs only in the API server's project Secrets; it is never
bundled into the Windows installer. The shared developer-funded quota can
be exhausted, and offline mode remains available without a cloud fallback.

`KOTOBA_API_TOKEN` protects the separate legacy `/api/translate` endpoint for
trusted integrations; do not distribute that token or the OpenAI key to players.

The GitHub Actions workflow at `.github/workflows/kotoba-windows-x64.yml` builds
on a Windows x64 runner, verifies the app executable's PE architecture, and
publishes both the NSIS installer and portable executable as build artifacts.
Use the installer for normal setup; the portable executable may require WebView2
to be installed on the Windows machine.

## Release notes and updates

See the repository's [update compatibility and recovery notice](../../UPDATE-RECOVERY.md)
for pre-update backups, incompatibility reporting, and last-resort clean installs.
Version 0.2.5 adds dialogue JSON/CSV/TXT exports and consented server archives;
it does not prove native upgrade compatibility. Earlier installers lack those
backup controls. Keep original data intact if an older version cannot export.

Updates are announced only on GitHub Releases. The app has no update checker,
update notice, or automatic updater. Before tagging a version, add
`releases/vX.Y.Z.md` matching the Tauri/Cargo/Cargo.lock version, using the current release
notes as a structural example. Describe the actual version's changes, Windows
downloads, manual updating steps, and requirements/known limitations.
Run `pnpm --filter @workspace/kotoba-overlay run test:release-notes`.
CI requires completed notes before building. Tagged releases publish those notes
alongside generated GitHub change history and the Windows executables.

## Automated Windows smoke checks

After building, the same `windows-latest` job silently installs the NSIS package
in a fresh temporary directory (including a space in the path), requires exit
code zero, and launches the **installed** executable. The smoke script at
`scripts/windows-smoke.ps1` requires a visible, responsive main window for ten
seconds. Windows UI Automation invokes **Prepare local model**, waits up to ten
minutes for real model preparation and the local Japanese-to-English self-test
to succeed, and fails immediately on an authored setup error code. The runner
uses its fresh WebView profile; no cloud credentials or cloud consent are used.
The check exercises the installed release worker, bundled WASM, CSP and model
storage, not a development-server substitute.

Windows UI Automation then invokes the app's overlay control, checks
that the empty-state content renders in a visible, responsive, always-on-top
native window, verifies reuse of an existing overlay, and closes and reopens it
through its own controls while confirming the main window survives.
It also sends real mouse drags to the title handle and bottom-right resize
grip, and requires changes in native window position and dimensions. The JSON
report records initial/moved/resized bounds and the overlay window's DPI and
scaling percentage. These checks exercise the WebView handlers and native
permissions, rather than moving the window directly through a testing API.

Missing controls, UI Automation failures, installation failures, and startup
timeouts fail the job; they are not treated as skipped checks. Installer and
polling waits are bounded, and the workflow step has a fifteen-minute backstop.
A failed smoke check prevents download artifact publication and the dependent
tagged release job from running.

The `windows-smoke-diagnostics` artifact is retained for seven days on success
or failure. Its JSON report includes the last stage, completed checks, installer
and app exit codes when available, and whitelisted native-window state.
On local-model failure, `localModelErrorCode`, `localModelStage`, and
`localModelLastFile` retain only allowlisted values from the authored diagnostic
prefix. The filename is the last observed model file, not necessarily the
failing parallel download. Unknown fields and the rest of the UI text are
discarded. The same safe fields appear in the failed job's error annotation.
The diagnostic parser has native PowerShell checks before the installer build.
Each stage is saved before executing it, so even a hung automation call leaves
a diagnostic record. No API credentials are passed, and the script does not
collect environment variables, desktop screenshots, WebView profiles, settings,
or arbitrary UI text. The job summary explicitly states the verification scope.

These are installer/startup checks, **not real MHFZ gameplay verification**.
They do not verify screen sharing, local OCR, cloud translation API calls, translated
line synchronization, transparency over a game, or fullscreen compatibility.
The hosted runner already has desktop prerequisites; a pass does not prove
WebView2 bootstrap behavior on a clean/offline player machine. Physical Windows
and live-game verification remain separate work. This Linux workspace cannot
execute these native checks; their results are available in GitHub Actions.
The newly added local preparation/self-test check has not yet run on Windows.
It does not cover offline cache reload after restart or upgrade preservation.

## Clean-machine WebView2 test checklist

Use [the clean Windows WebView2 checklist](WEBVIEW2-CHECKLIST.md) to verify
online bootstrap, first launch, offline failure, and recovery using a disposable
Windows x64 machine without the runtime. It includes baseline checks, pass/fail
criteria, and a results template. **The checklist is prepared; these native
scenarios have not been run.** A hosted-runner smoke pass is not a substitute.

## Reported Windows gameplay test: 0.2.4

**Status: failed initial user test; full gameplay verification is incomplete.**
These are user-reported observations, not independently reproduced results.
Do not treat a passing installer/startup smoke check as resolving these failures.

### Environment and evidence limits

- App version reported: **0.2.4**. Exact installer filename, release source,
  and checksum were not supplied; x64 installer provenance is unconfirmed.
- OS reported: **Windows 11 Version 26H2** (user-supplied version label, not
  independently checked). Exact edition and build number were not supplied.
- WebView2: **untested; version not supplied**.
- Windowed versus borderless mode, display scaling, monitor configuration,
  and the Japanese dialogue samples were not supplied.
- No error messages, diagnostic logs, or screenshots were supplied.

### Reported failures and reproduction outline

The outlines below describe the reported attempts. They still need reproduction
on an identified physical Windows machine with the exact release installer.

| Area | Reported attempt | Observed result |
| --- | --- | --- |
| Capture, Japanese OCR, and cloud translation | Select Cloud mode, choose a screen/window for the game, and specify the dialogue capture area. | The selected area was not interpreted as expected; no Japanese dialogue capture or English translation appeared. |
| Initial offline-model preparation | Attempt to download the local Japanese translation model. | Every reported attempt failed; offline translation could not be used. The download stage and error are unknown. |
| Transparent overlay placement | Open the transparent overlay over the game and try to move or resize it. | It appeared fixed at the screen center and could not be moved or resized, obstructing gameplay until closed. |

### Supplemental user-reported results

The user subsequently confirmed the following for the initial test. These are
functional observations, not instrumented verification of internal processing
or network behavior:

| Area | Reported result | Evidence limit |
| --- | --- | --- |
| Overlay close/reopen | Working correctly. | Not reported separately for windowed and borderless modes. This does not resolve movement or resizing. |
| Capture start/stop controls | Working correctly. | Does not demonstrate valid captured frames, correct crop coordinates, or cessation of background frame processing. |
| Optional cloud consent | Working as intended. | Synthetic-text use, request traces, and behavior before consent or after withdrawal were not supplied; no successful translation was reported. |
| Japanese dialogue detection and translation | Still not working. | No recognized Japanese text or English translation was supplied. |

The first failure does **not** establish whether source capture, crop coordinates,
OCR initialization/recognition, or cloud requests failed. Diagnose those stages
separately rather than attributing the symptom to the cloud service without
evidence. The model-download failure concerns initial preparation, not model
persistence or offline translation after restarting Windows.

### Horizontal dialogue scope and font investigation

The user recommends dropping vertical Japanese recognition and focusing fully
on horizontal dialogue because the target game, Monster Hunter Frontier Z -
Zenith, does not feature vertical Japanese text. Vertical OCR is therefore
removed from the requested gameplay verification scope; it is **not** recorded
as passing. This documentation update does not change runtime OCR behavior.

The user also recommends familiarizing OCR with the game's font. Investigate
representative horizontal dialogue crops, font appearance, contrast, scaling,
and preprocessing before selecting recognition changes. The font's identity
and its contribution to the failure are unconfirmed; no font-specific model
training or improvement has been implemented or verified.

### Verification still required

Record pass/fail and reproduction details separately for **windowed** and
**borderless** gameplay:

- Screen selection and window selection, including a visible captured preview.
- Dialogue crop matching the intended game region.
- Horizontal Japanese OCR using representative in-game dialogue/font, with
  expected versus recognized text and resulting English translation.
- Overlay movement, resizing, and game visibility. Close/reopen is reported
  working, but still needs display-mode-specific results.
- Capture start/stop is reported working; confirm that frame processing stops
  and record display-mode-specific results.
- Optional cloud consent is reported working; verify request behavior using
  synthetic, non-sensitive Japanese text:
  no dialogue sent before consent, translation after consent, and no further
  cloud dialogue requests after consent is withdrawn.

Before retesting, record the app release/installer identity, Windows version
and build from `winver`, and the installed Microsoft Edge WebView2 Runtime
version. For each failure, record the source type, game display mode, display
scaling, steps, expected/actual behavior, and any visible error. Use only
non-sensitive test text and redact credentials and personal information from
any evidence.

### Requested usability direction

The user recommends a Google Lens-like presentation that places translated
text over the corresponding Japanese text instead of a central panel that
obstructs the game. This is a proposed enhancement, not an implemented or
verified capability. Restoring reliable capture/OCR and movable, resizable
overlay controls remains necessary regardless of that presentation choice.

#### Assessment: source-positioned translations

This is feasible as a separate enhancement, but is **not implemented** by the
control fix. The current overlay receives dialogue strings, not source text
bounding boxes or the desktop location of the captured game content. Placing
English accurately over Japanese requires:

- Reliable horizontal recognition with text boxes mapped back through the OCR
  crop and preprocessing scale into the original captured frame.
- Mapping frame coordinates to the game content's desktop coordinates, including
  window borders, letterboxing, monitor offsets, and Windows DPI scaling.
- Updating that mapping when the game moves, changes resolution, or switches
  windowed/borderless modes; hiding stale translations when dialogue disappears.
- A readable background mask and wrapping policy for longer English text, with
  optional click-through display that still has a reliable way to unlock/move
  or close it from the main window.

First restore reliable capture/OCR and validate the window controls below.
A source-positioned design should not be presented as a fix for those failures.

## Overlay control fix: implementation and verification

The overlay now has a dedicated **Move overlay** title handle and eight
edge/corner resize targets, including a visible bottom-right grip. These call
Tauri's native move/resize operations on primary mouse down. The close button is
outside the drag handle. The panel fills the native window, with scrolling
dialogue content so its title and close control remain visible at minimum size.
Native move, resize, show, focus, and close commands have explicit permissions.
Failures are shown in the overlay rather than silently ignored.

`src-tauri/src/main.rs` was inspected: it has no close/resize interceptors or
capture commands. No Rust lifecycle change is needed. Closing the secondary
window destroys only that window; the main WebView owns the capture stream,
OCR worker, and polling timer. Keep the main app open during gameplay.
Reopening creates a new secondary window, reloading the journal and subscribing
to subsequent dialogue updates. Opening an existing overlay shows/focuses it.
The secondary window no longer writes its journal snapshot to shared storage.

**Verification status:** the user subsequently verified that overlay
manipulation is working as intended. This closes the reported manipulation
failure on the basis of user verification, not an independently observed
Windows session. The user did not supply separate windowed/borderless results,
display scaling, or new capture-continuity measurements; those details remain
unrecorded below. Native Windows smoke and physical MHFZ gameplay checks have
not been executed in this Linux workspace.

The user still recommends Google Lens-style translation placement as an
**optional overlay style players can select**, alongside the existing panel.
That enhancement remains separate from the verified control fix and is not
implemented.

### Physical Windows acceptance checklist

Use the exact built installer/executable containing this change. Record:

| Field | Result |
| --- | --- |
| App version, installer filename, SHA-256, build source/commit | Not recorded |
| Windows edition/version/build (`winver`) | Not recorded |
| WebView2 Runtime version | Not recorded |
| Monitor resolution(s), primary monitor, arrangement | Not recorded |
| Windows display scaling per monitor | Not recorded |
| Game resolution and windowed/borderless mode | Not recorded |

Run every step separately in **windowed** and **borderless** gameplay, at the
player's actual display scaling. Include 100% and a scaled display (for example
150%) where available. Re-run after moving between differently scaled monitors
if the player uses multiple displays. Exclusive fullscreen is not claimed.

1. Start capture from the main app. Confirm a live preview of changing game
   content; record the source type (screen or window). Leave the main app open.
2. Open the overlay, including with an empty journal. Drag **the title handle**
   away from the game dialogue. Confirm it follows the pointer and remains
   visible after refocusing the game.
3. Resize with each edge and corner. Shrink to minimum size and enlarge again.
   Confirm the visible panel follows native bounds, no invisible central region
   blocks the game, and title/close controls remain reachable. With a long
   translated line, confirm content scrolls without hiding those controls.
4. Open the overlay again from the main app: there must be only one overlay.
   Confirm it can still be dragged/resized after this reuse.
5. While capture is running, close the overlay with its own **X**, then reopen.
   Repeat three times. Confirm the main app stays alive, the preview continues
   changing, and capture does not return to idle or require selection again.
6. Where OCR/translation is working, confirm the latest line appears immediately
   on reopening, and a later line updates the overlay. If OCR is still failing,
   record synchronization as blocked, not passed; a manual journal line can
   check display synchronization but cannot prove OCR or capture continuity.
7. Stop capture explicitly in the main app. Confirm it stops independently of
   whether the overlay is visible.

| Game mode | Scaling / monitor | Move | Edges / corners | Game visible | Close / reopen | Capture continues | Line sync | Evidence / errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Windowed | Not recorded | Not run | Not run | Not run | Not run | Not run | Not run | Pending physical Windows session |
| Borderless | Not recorded | Not run | Not run | Not run | Not run | Not run | Not run | Pending physical Windows session |

Record actual versus expected behavior for each failure. Do not collect
credentials or personal dialogue in evidence. A hosted-runner smoke pass alone
does not complete this physical acceptance checklist.
