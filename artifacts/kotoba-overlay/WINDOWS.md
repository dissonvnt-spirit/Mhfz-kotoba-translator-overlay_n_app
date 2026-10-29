# Windows x64 desktop build

## Capture/OCR recovery diagnostics — source changes, not a native gameplay pass

The reported failure is Windows 11 app 0.2.4 showing no Japanese or English
after source/crop selection in Cloud mode. The changes below are in the current
workspace; they do **not** establish that an existing released installer has
been repaired or tested on physical Windows.

### Concrete failures addressed

- Recognized Japanese previously appeared only after successful translation.
  It is now independently visible in the capture diagnostics, even if the
  selected translation engine fails.
- Failed translations were added to the duplicate-suppression list before
  success. Successful results now enter that list only afterward. Failed
  dialogue can be retried explicitly, with a 30-second automatic retry delay.
- A resolved `video.play()` was treated as sufficient startup evidence.
  Startup now waits for decoded video data and nonzero frame dimensions,
  with a bounded wait and source-specific guidance.
- Full-screen captures were reduced to 1200 pixels wide, shrinking small
  Japanese glyphs. Full-HD frames now retain their width; crop edges are
  clamped and selected dialogue can be enlarged within a bounded canvas.
- OCR startup/recognition now have separate deadlines and actionable errors.
  Horizontal and vertical language assets use their corresponding Tesseract
  page-segmentation modes. The target MHFZ gameplay acceptance remains
  horizontal-only, as requested by the developer.
- Stop/unmount invalidates pending capture sessions. A late source is stopped;
  a late OCR worker is terminated rather than restarting an obsolete session.
  Stop prevents new automatic submissions, but an already submitted
  translation can finish.

The native entry point `src-tauri/src/main.rs` was inspected. It is a standard
Tauri builder with no custom screen-capture cancellation or permission bypass.
It was left unchanged rather than adding an unverified native workaround.
WebView2/source-picker compatibility must still be measured on Windows.

### Evidence obtained in this environment

- Geometry, Japanese-spacing normalization, missing-frame timeout, OCR error
  classification, deadline cleanup and late-worker disposal have unit checks:
  `node --test scripts/capture-pipeline.test.mjs`.
- Real bundled horizontal OCR recognized the non-sensitive fixture
  `こんにちは。`. A synthetic stacked-glyph vertical fixture loaded
  `jpn_vert` and returned Japanese, but did **not** match the expected string;
  this is **not** a vertical-accuracy pass.
- On 2026-10-28 the published API health endpoint returned 200, its preflight
  allowed `http://tauri.localhost` and the consent header, and one synthetic
  consented cloud request translated `こんにちは。` to `Hello.` with HTTP 200.
  This HTTP check does not exercise the native WebView or real capture.
- No new MS Gothic/MS Mincho neural model is included. Font-specific training
  and accuracy verification remain separate from this pipeline recovery.

Controlled browser evidence (Chrome 140, Linux x86_64):

- Only source selection was replaced with a 1920 × 1080 canvas stream.
  A non-sensitive glyph image containing `こんにちは。` was painted at source
  coordinates (720, 864), size 330 × 58. Bundled Japanese worker/WASM/model
  recognition ran for real and returned `こんにちは。`.
- Cloud Cancel preserved on-device mode and made no cloud request. After
  explicit consent, the first intercepted request returned a synthetic 503:
  Japanese remained visible and the journal remained empty.
- A development-session reinitialization interrupted the explicit retry
  button check. A subsequent capture of the same Japanese received a synthetic
  200 and produced one `こんにちは。` → `Hello.` journal line. This confirms
  success on the subsequent capture, **not** the explicit button-retry path.
- Both intercepted requests contained only `{text: "こんにちは。"}` plus the
  consent header, without an operator credential. Neither reached OpenAI.
- Source dimensions and full-frame OCR diagnostics were 1920 × 1080. The
  pointer-selected ROI was not exercised; crop mathematics have unit evidence
  only, not browser/native pointer-coordinate acceptance.
- Stop ended the source track; the frame counter stayed at 4 and request
  count stayed at 2 for 3.5 seconds. A separate late source, resolved after
  Stop while selection was pending, was immediately stopped and did not
  resurrect capture.
- These are controlled browser findings, not physical Windows, actual game
  capture, WebView2, installer, native overlay or offline-inference evidence.

### Required physical Windows acceptance — not performed here

Test a **newly built, identified x64 installer containing these changes**, not
only the hosted browser preview. Record the download URL, release tag,
installer filename and SHA-256, installed app version, Windows 11 edition/build
from `winver`, exact WebView2 Runtime version, display resolution and scaling,
GPU/driver, and whether the source is a game window or entire display.

For **both windowed and borderless gameplay**, use non-sensitive synthetic
dialogue with expected Japanese `こんにちは。` and an expected English meaning
of `Hello.`. Record actual OCR and actual translation verbatim:

1. Check default on-device mode. Confirm cloud cancellation sends no dialogue;
   explicitly consent before the cloud run. Never distribute the operator key.
2. Start capture. Confirm the preview changes and diagnostics show source
   dimensions and an increasing frame count, not merely an open window.
3. Select dialogue text only. Record the crop coordinates and OCR dimensions.
   Move the game cursor outside text and compare actual Japanese with expected.
4. Verify Japanese remains visible if translation fails. Then use **Retry
   translation in selected mode** and confirm English reaches journal/overlay.
5. Minimize/restore the source; verify the waiting-for-frames explanation and
   recovery. Cancel selection and retry, and stop while OCR is loading.
6. Stop capture. Confirm no new automatic requests, preview updates or OCR
   frame increments; distinguish an already submitted request finishing.

| Mode | Exact Windows / WebView2 | Release / checksum | Frame / crop evidence | Expected / actual Japanese | Expected / actual English | Consent / Stop | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windowed | Not available | Not tested | Not available | Not available | Not available | Not performed | Physical session required |
| Borderless | Not available | Not tested | Not available | Not available | Not available | Not performed | Physical session required |

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

**Current evidence:** installed Windows preparation and local Japanese-to-English
inference passed on the hosted Windows runner described below. The user's
original 0.2.4 failure has **not been reproduced or attributed to a specific
cause**. The changes repair failed-worker retry/storage handling and provide
safe diagnostics if setup still fails on the affected player's machine.
The hosted-runner pass is not a claim that the original machine has been tested.

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

After building once, four isolated `windows-latest` jobs silently install the same NSIS package
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
Each job configures a real 1600×1200 desktop at **100%, 125%, 150%, or 200%**
scaling before launching the app. It requires measured main/overlay window DPI
of **96, 120, 144, or 192**, respectively, and rechecks overlay DPI for every drag.
Unsupported resolution/scaling or a mismatch fails the job, not a skip.
The per-source Windows DPI packets are not a public compatibility contract;
if a runner image stops supporting them, repair the runner setup rather than
substituting browser zoom or coordinate-only cases.

Real mouse drags exercise the title handle and **all eight** resize directions.
For each direction, the test grows the window, drags inward beyond the affected
360×170 logical-pixel native outer-window minimum, and grows again to prove recovery. Corners must
grow both axes; edges must leave the other axis unchanged. Opposite edges
must remain anchored within three physical pixels. Both windows must remain
responsive and the overlay WebView's close control must remain accessible after
each operation. Native positioning resets each fixture only; all asserted size
changes use the installed WebView handlers and Tauri resize permissions.

Missing controls, UI Automation failures, installation failures, and startup
timeouts fail the job; they are not treated as skipped checks. Installer and
polling waits are bounded, and each smoke step has a twenty-minute backstop.
A failed scale job blocks the dependent tagged release job. Build artifacts
are available for debugging before this gate passes; their availability alone
does not establish installed-control acceptance.

The `windows-smoke-diagnostics-100`, `-125`, `-150`, and `-200` artifacts are retained for seven days on success
or failure. Its JSON report includes the last stage, completed checks, installer
and app exit codes when available, and whitelisted native-window state. Each
resize case includes direction, requested/measured scaling, physical client/outer
bounds before and after, actual mouse target/delta, hit-window checks, and liveness.
An incomplete or failed operation cannot count as a passed direction.
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
The local preparation/self-test check passed on Windows as recorded below.
It does not cover offline cache reload after restart or upgrade preservation.

### Resize automation coordinates

Windows' `GetWindowRect` can include invisible non-client frame/shadow pixels
even for this undecorated overlay. Its bottom-right corner is not a reliable
origin for the CSS resize grip. The smoke check now uses `GetClientRect` plus
`ClientToScreen`, with per-monitor-v2 DPI awareness. It targets the center of
each unchanged 16 CSS-pixel corner or 8 CSS-pixel edge strip, converting the
8 or 4 CSS-pixel inset using `GetDpiForWindow`. There is no injected JavaScript,
test-only app mode, fallback success, or skipped interaction assertion.

The gate requires at least 30 logical pixels of width growth and/or 20 logical
pixels of height growth on each affected axis, including **both** for corners,
before proceeding to same-window reuse and close/reopen checks. Minimum-size
assertions require reaching the configured limit, not merely staying above it.
Physical bounds evidence distinguishes a misplaced click or one-axis native
edge hit from a working two-axis corner handler.
For this undecorated Windows/Tao window the configured minimum clamps the outer
rectangle, including invisible frame pixels; client dimensions are smaller.
The minimum assertion uses native outer bounds with the same three-pixel
rounding tolerance, not client bounds or a tolerance enlarged to hide the frame.

Run `pnpm --filter @workspace/kotoba-overlay run test:windows-smoke`.
The Windows workflow runs the PowerShell geometry cases at 100%, 125%, 150%,
175% and 200% scaling, including hidden frame offsets and negative monitor
origins. Those supplemental geometry cases are **not** native multi-DPI evidence.
Only the installed-app matrix's real mouse checks at measured DPI provide that
evidence. Neither test is monitor-change reachability or game acceptance.
Linux runs the source checks and skips automatic Windows PowerShell execution;
with `pwsh` installed, parser/interop and geometry checks can also run directly:

```sh
pwsh -NoProfile -File artifacts/kotoba-overlay/scripts/windows-smoke-contract.test.ps1
pwsh -NoProfile -File artifacts/kotoba-overlay/scripts/windows-smoke-geometry.test.ps1
```

### Recorded eight-direction native DPI pass

[Passing installed-control matrix](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40798323091)
used the NSIS installer from the
[successful Windows build](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40796983924).
The verification-only branch reused that immutable build while correcting the
test harness; the overlay component, resize CSS and window-creation source
matched this workspace. Normal CI builds once and gates releases on all four
installed-control jobs. No main merge, tag, release or production deploy occurred.

| Requested desktop scale | Measured app DPI | Resize directions | Passed physical mouse operations |
| --- | --- | --- | --- |
| 100% | 96 | All 8 | 24 |
| 125% | 120 | All 8 | 24 |
| 150% | 144 | All 8 | 24 |
| 200% | 192 | All 8 | 24 |

The logs contain **96 distinct passed mouse operations**: growth, inward drag
beyond the native minimum, and recovery growth for every direction at every
scale. Each records target ownership, client and outer bounds, actual DPI and
post-operation liveness. All jobs also passed installed local-model inference,
title-handle movement, window reuse, and close/reopen with the main window
surviving. Scale-specific JSON reports were uploaded for seven days. This is
real installed Windows desktop evidence, not monitor-change or MHFZ acceptance.

The [diagnostic reproduction](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40793137748)
kept the original mouse target and two-axis growth assertion. At 96 DPI:

- Outer bounds: `(202, 205)`, `496 × 239`; actual client: `(210, 206)`,
  `480 × 230`.
- Original click: `(690, 436)`, exactly on the client's exclusive right/bottom
  boundary. `WindowFromPoint` still belonged to the overlay, so native-window
  ownership alone was insufficient to establish a CSS-grip hit.
- Native bounds after dragging: `576 × 239`. Width grew by 80 pixels while
  height did not grow. The original assertion correctly failed after 45 seconds.

This reproduced an **automation targeting failure** (one native edge resized,
not the intended two-axis CSS corner). It did not demonstrate broken Tauri
resize handlers, and no UI hit-target or native resize behavior was changed.

### Corrected installed Windows verification: 2026-10-29

[Passing GitHub Actions run](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40793426399)
tested the product-only `verify/overlay-resize` branch at
`3201a4ed494d85f76b75508b1cf5863a7730ca14`, including the current product UI.
The existing Windows workflow completed successfully:

- Installed v0.2.5 from the built NSIS package and kept the main window responsive.
- Prepared the local model and passed real packaged Japanese-to-English inference.
- Opened the topmost overlay and moved it through its existing mouse drag handle.
- At 96 DPI (100% scaling), targeted `(682, 428)` inside the client area rather
  than the original `(690, 436)` boundary. Native outer bounds grew from
  `496 × 239` to **`576 × 299`**, passing both original growth thresholds.
- Passed `overlay-reuse`, preserving the same native overlay window.
- Passed `overlay-close-and-reopen`, including rendered content, closing both
  overlay instances, and main-window survival.
- Passed all three resize smoke contract/PowerShell tests, including the
  multi-DPI coordinate cases, plus existing offline and release checks.
- Uploaded `windows-smoke-diagnostics`, `kotoba-overlay-windows-x64-installer`,
  and `kotoba-overlay-windows-x64-portable` Actions artifacts. The native
  geometry and completed-check evidence above comes from job logs, not an
  authenticated download of the diagnostics ZIP.

No main merge, release tag, GitHub Release, or production deployment was made.
These are hosted Windows Server control checks, **not** acceptance on the
player's Windows 11 machine or during windowed/borderless gameplay. They do
not establish monitor-change reachability, source-positioned translations,
app-restart model reuse, upgrade compatibility, or capture/OCR correctness.

### Original installed Windows verification: 2026-10-28

[GitHub Actions verification run](https://github.com/dissonvnt-spirit/Mhfz-kotoba-translator-overlay_n_app/actions/runs/40784399832)
tested the product-only `verify/offline-model-setup` branch at
`8c616f965b158c8c1a08444ddf0587108793f200`.
No main-branch merge, release tag, published installer or production deployment
was performed.

- Environment: hosted `windows-latest`, Microsoft Windows Server 2025,
  runner image `windows-2025-vs2026`; not the player's reported Windows 11 machine.
- Built installer: `MHFZ-Z Translator Overlay_0.2.5_x64-setup.exe` (31.4 MB).
  Executable PE architecture and installer existence checks passed.
- All eight worker/controller boundary tests, all six release checks, and the
  native PowerShell safe-diagnostic parser checks passed.
- Silent installation, installed executable startup and initial online local-model
  preparation passed. The script advanced from `initial-local-model-preparation`
  at 23:06:03 UTC to `overlay-open` at 23:06:09 UTC only after the UI reported
  successful local inference of the fixed Japanese self-test sentence.
  This exercised the actual packaged worker, WASM runtime, CSP and WebView model
  storage without cloud consent or cloud translation.
- **Overall workflow failed later:** `overlay-mouse-resize` timed out after
  45 seconds. The local-model check passed; the entire Windows smoke check did
  not. Installer download artifacts and the release job were not published.
  Overlay reuse/reopen checks after resizing were not reached.
- The `windows-smoke-diagnostics` artifact was uploaded. The secure GitHub
  connection allowed job-log inspection but denied its ZIP download; the model
  pass above is independently evidenced by the recorded stage transitions and
  the script's exact ready-message gate. Do not claim the JSON was inspected.

The remaining resize failure is separate from model preparation. No gameplay
capture, OCR, original-machine reproduction, clean-machine WebView2 bootstrap,
restart persistence or upgrade preservation is established by this run.

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
