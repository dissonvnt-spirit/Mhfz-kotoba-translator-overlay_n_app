# Clean Windows WebView2 installation checklist

**Status: checklist prepared; native tests NOT RUN.** Filling out this document
is not a passing result. The Linux workspace and the existing hosted
`windows-latest` smoke test cannot establish clean-machine bootstrap behavior.

## Scope and safety

Test the **unsigned Windows x64 NSIS setup executable**, not the portable app.
Verify online runtime installation, first launch, offline failure, and recovery
with the same installer. Do not change signing, `com.kotoba.overlay`, storage
namespaces, or the installer configuration to make a test pass.

Use a disposable Windows x64 VM with a visible desktop and snapshots, or a
disposable physical Windows machine with an equivalent restorable image.
**Restoring an image discards changes made after it was saved.** Never remove
WebView2 from a player's everyday machine: other applications may depend on it.
Do not use a hosted runner that already contains WebView2 as clean-machine
evidence. Do not bypass organizational security policies or disable antivirus.
No game, model download, cloud consent, API keys, or account sign-in is required.

## 1. Prepare and prove the baseline

- [ ] Record the Windows edition, version, and build from `winver`, x64
  architecture, test date, and whether the account is standard or administrator.
- [ ] Obtain the exact release's NSIS installer and its published
  `SHA256SUMS.txt` on another machine. Transfer them to the test machine before
  disconnecting its network. Record the release source and filename.
- [ ] Run `Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Test\setup.exe'`
  using the actual installer path. Compare with the published hash; stop on a
  mismatch. Record the hash. Keep the same bytes for all scenarios.
- [ ] Confirm the app has never been installed and has no existing user profile
  or downloaded models on this baseline.
- [ ] Disconnect the VM's virtual network adapter (or all physical network
  connections). A browser's offline mode is insufficient.
- [ ] Check **Settings > Apps > Installed apps** for Microsoft Edge WebView2
  Runtime. Microsoft Edge browser presence alone is not runtime evidence.
- [ ] In **64-bit Windows PowerShell**, record the output of this read-only
  check of machine-wide and current-user runtime registrations:

  ```powershell
  $roots = @(
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\EdgeUpdate\Clients',
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients',
    'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\EdgeUpdate\Clients'
  )
  $runtime = @(
    foreach ($root in $roots) {
      if (Test-Path -LiteralPath $root) {
        Get-ChildItem -LiteralPath $root | ForEach-Object {
          Get-ItemProperty -LiteralPath $_.PSPath
        } | Where-Object { $_.name -like '*WebView2*' } |
          Select-Object name, pv, PSPath
      }
    }
  )
  if ($runtime.Count) {
    $runtime | Format-List
    Write-Output 'Runtime registration found: NOT a clean baseline.'
  } else {
    Write-Output 'No WebView2 registration found; also check files and Installed apps.'
  }
  ```

- [ ] Check for runtime executables under
  `C:\Program Files (x86)\Microsoft\EdgeWebView\Application`,
  `C:\Program Files\Microsoft\EdgeWebView\Application`, and
  `%LOCALAPPDATA%\Microsoft\EdgeWebView\Application`. An empty registry check
  alone does not prove absence. If files, registrations, or Installed apps
  disagree, mark the baseline **inconclusive** and use another clean image.
- [ ] Save a disconnected **no-runtime baseline snapshot**. Do not run other
  installers or allow background software to provision WebView2 first.

## 2. Online bootstrap and first launch

- [ ] Restore the baseline; repeat the absence checks while disconnected.
- [ ] Connect the network and confirm normal HTTPS access. Immediately repeat
  the runtime checks before starting setup. If WebView2 appeared independently,
  stop: this run cannot demonstrate installer bootstrap.
- [ ] Start the exact NSIS setup interactively. For a trusted, hash-verified
  unsigned build, record any SmartScreen warning and the action taken; if policy
  blocks execution, mark **blocked**, not an installer failure or pass.
- [ ] Record installation choices, UAC prompts, runtime download/install
  messages, start/end times, and the final outcome. Allow up to ten minutes on
  a working connection; a longer wait is a failure to investigate, not a pass.
- [ ] Confirm WebView2 now appears in runtime registration/file checks; record
  its version and installation scope. If origin is ambiguous, mark bootstrap
  **inconclusive** rather than crediting the installer.
- [ ] Launch `kotoba-overlay.exe` from the **installed directory** or installed
  shortcut, not the downloaded portable binary or build output.
- [ ] Confirm the main window renders real app controls (not a blank window)
  and stays visible and responsive for at least ten seconds.
- [ ] Select **Overlay window**. Confirm the dialogue window renders its empty
  state, remains responsive, and closes/reopens without closing the main app.
- [ ] Close the app and launch the installed copy again. Confirm the main
  window renders without another prerequisite installation.

**Pass:** confirmed runtime absence immediately before setup; setup provisions
the runtime and finishes successfully; the installed app renders on first and
second launch. Record actual outcomes even if they differ from these criteria.

## 3. Offline failure with no runtime

- [ ] Restore the **original no-runtime baseline**, not the online-test snapshot.
  Confirm absence again, including no app installation.
- [ ] Keep all network adapters disconnected throughout this scenario.
- [ ] Run the same setup interactively, making the same installation choices.
- [ ] Record the exact prerequisite/error text, available retry/cancel controls,
  elapsed time, and whether setup reports success, failure, or cancellation.
  Capture only relevant dialogs; redact usernames and personal paths.
- [ ] If there is no outcome after five minutes, record the current dialog and
  elapsed time. Try the provided cancel/close control. If still stuck at ten
  minutes, record a failure and terminate setup only inside the disposable VM.
  Do not treat a timeout or forced termination as a clean failure path.
- [ ] Confirm runtime checks still show no usable runtime. Record any partial
  app files, shortcut, or uninstall entry; do not delete them before recovery.
- [ ] If setup reports success or offers app launch, try that installed copy
  and record its result. A blank window, crash, misleading success with no
  usable app, or no actionable prerequisite explanation is a **failure**.
- [ ] Confirm a tester can understand that WebView2 needs installation and can
  exit setup without an endless loop or restarting Windows.

**Pass:** the unavailable prerequisite is clearly explained, setup ends or can
be cancelled promptly, and it does not claim to provide a working application.
If this installer unexpectedly succeeds offline with a working runtime, record
that result and investigate cached/bundled prerequisites or baseline contamination;
do not report online bootstrap as verified.

## 4. Recovery after the offline attempt

Do **not** restore the baseline before this scenario: recovery must start from
the offline attempt's actual state, including any partial installation.

- [ ] Reconnect the network and confirm HTTPS access.
- [ ] Retry using the installer's retry control if still available, or rerun
  the **same setup executable**. Record which route was used and whether
  elevation was needed. No registry edits or manual file deletion should be
  needed.
- [ ] Confirm setup completes, runtime registration/version is present, and
  the installed app renders on first launch and after closing/relaunching it.
- [ ] Repeat the overlay open/close check from the online scenario.
- [ ] If retry still fails, preserve the failure evidence. For a separate
  fallback check, obtain the **Evergreen Standalone Installer, x64** from
  [Microsoft's WebView2 download page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)
  on a connected machine, transfer it, verify its Microsoft signature, install
  the runtime, and rerun app setup. Record this separately: a successful manual
  workaround does **not** make automatic recovery pass.

**Pass:** reconnecting and retrying setup succeeds without destructive cleanup,
and the installed app launches. Any fallback-only success must be labelled as
such, along with player-facing recovery steps that actually worked.

## 5. Record results

Use **PASS / FAIL / BLOCKED / INCONCLUSIVE / NOT RUN**, with evidence for every
result. Do not mark the overall clean-machine verification passed unless all
three scenarios pass on the same identified installer.

| Field | Actual result |
| --- | --- |
| Test date; tester alias | NOT RUN |
| Windows edition/version/build; x64 | NOT RUN |
| VM/image source; account privilege | NOT RUN |
| Release source; installer filename; SHA-256 | NOT RUN |
| No-runtime baseline evidence | NOT RUN |
| Online setup duration/prompts/outcome; exit code if captured | NOT RUN |
| Runtime version/scope after online setup | NOT RUN |
| First launch, relaunch, overlay | NOT RUN |
| Offline isolation; exact error/actions; duration/outcome | NOT RUN |
| Offline partial files/shortcuts/uninstall entry | NOT RUN |
| Reconnect/retry path; duration/outcome | NOT RUN |
| Runtime version and app launch after recovery | NOT RUN |
| Manual Microsoft-runtime fallback, if needed | NOT RUN |
| Redacted evidence references; defects; overall verdict | NOT RUN |

Do not invent exit codes from a dialog. Preserve any code actually captured
and distinguish user cancellation from an installer-reported error. Do not
collect environment dumps, secrets, WebView profiles, or model/settings data.

The existing `scripts/windows-smoke.ps1` remains useful for installed-app
automation, but it installs the app itself and is not a prerequisite-absence
test. Do not run it first and then claim a clean baseline. These checks do not
establish OCR, translation, model persistence, upgrades, or live-game behavior.
