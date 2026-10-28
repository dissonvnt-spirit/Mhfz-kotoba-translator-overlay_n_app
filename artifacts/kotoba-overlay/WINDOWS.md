# Windows x64 desktop build

Kotoba Overlay includes a Tauri 2 desktop shell and an NSIS installer target for
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

Updates are announced only on GitHub Releases. The app has no update checker,
update notice, or automatic updater. Before tagging a version, add
`releases/vX.Y.Z.md` matching the Tauri/Cargo version, using the current release
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
seconds. Windows UI Automation then invokes the app's overlay control, checks
that the empty-state content renders in a visible, responsive, always-on-top
native window, verifies reuse of an existing overlay, and closes and reopens it
through its own controls while confirming the main window survives.

Missing controls, UI Automation failures, installation failures, and startup
timeouts fail the job; they are not treated as skipped checks. Installer and
polling waits are bounded, and the workflow step has a ten-minute backstop.
A failed smoke check prevents download artifact publication and the dependent
tagged release job from running.

The `windows-smoke-diagnostics` artifact is retained for seven days on success
or failure. Its JSON report includes the last stage, completed checks, installer
and app exit codes when available, and whitelisted native-window state.
Each stage is saved before executing it, so even a hung automation call leaves
a diagnostic record. No API credentials are passed, and the script does not
collect environment variables, desktop screenshots, WebView profiles, settings,
or arbitrary UI text. The job summary explicitly states the verification scope.

These are installer/startup checks, **not real MHFZ gameplay verification**.
They do not verify screen sharing, local OCR, translation API calls, translated
line synchronization, transparency over a game, or fullscreen compatibility.
The hosted runner already has desktop prerequisites; a pass does not prove
WebView2 bootstrap behavior on a clean/offline player machine. Physical Windows
and live-game verification remain separate work. This Linux workspace cannot
execute these native checks; their first actual result will come from Actions.
