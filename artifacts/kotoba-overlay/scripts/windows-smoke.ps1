# Run only on a disposable Windows desktop runner. Never supply API credentials.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BundleDirectory,
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$DiagnosticsDirectory,
    [Parameter(Mandatory = $true)][ValidateSet(100, 125, 150, 200)][int]$ScalingPercent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $DiagnosticsDirectory | Out-Null
$report = [ordered]@{
    scope = 'Installed Windows app, first-time model preparation and synthetic local Japanese-to-English self-test, overlay startup and mouse move/resize controls; no MHFZ, capture, OCR, cloud, restart or upgrade verification.'
    status = 'running'
    stage = 'initialization'
    checks = @()
    requestedScalingPercent = $ScalingPercent
    resizeCases = @()
}
$app = $null
$installerProcess = $null

function Save-Report {
    $report | ConvertTo-Json -Depth 10 |
        Set-Content -Encoding UTF8 (Join-Path $DiagnosticsDirectory 'smoke-result.json')
}

function Set-Stage([string]$Name) {
    $report.stage = $Name
    Save-Report
    Write-Host "Windows smoke: $Name"
}

function Wait-For([string]$Description, [scriptblock]$Probe, [int]$Seconds = 45) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
        if ($null -ne $script:app) {
            $script:app.Refresh()
            if ($script:app.HasExited) {
                throw "Installed app exited during '$Description' (exit code $($script:app.ExitCode))."
            }
        }
        $result = & $Probe
        if ($result) { return $result }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Description after $Seconds seconds."
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'This smoke check requires Windows.' }
    . (Join-Path $PSScriptRoot 'offline-diagnostics.ps1')
    . (Join-Path $PSScriptRoot 'windows-smoke-geometry.ps1')
    . (Join-Path $PSScriptRoot 'windows-smoke-display.ps1')
    . (Join-Path $PSScriptRoot 'windows-smoke-resize.ps1')
    Set-Stage 'configure-real-display-scaling'
    $report.displayConfiguration = Set-SmokeDisplay $ScalingPercent
    Save-Report
    # PowerShell accepts mixed separators; NSIS parses /D itself and requires a
    # native Windows path. Do not pass a POSIX-style suffix to the installer.
    $InstallDirectory = [System.IO.Path]::GetFullPath($InstallDirectory).Replace('/', '\')
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class KotobaSmokeWindows {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(
        IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(
        IntPtr hwnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    public static IntPtr[] Find(int processId, string title) {
        var found = new List<IntPtr>();
        EnumWindows((hwnd, data) => {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == processId) {
                var text = new StringBuilder(512);
                GetWindowText(hwnd, text, text.Capacity);
                if (text.ToString() == title && IsWindowVisible(hwnd)) found.Add(hwnd);
            }
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }
    public static bool Responds(IntPtr hwnd) {
        UIntPtr result;
        return SendMessageTimeout(hwnd, 0, UIntPtr.Zero, IntPtr.Zero, 2, 2000, out result) != IntPtr.Zero;
    }
}
'@
    # Match UI Automation's physical screen coordinates on scaled displays.
    $null = [KotobaSmokeWindows]::SetThreadDpiAwarenessContext([IntPtr](-4))

    function Get-AppWindows([string]$Title) {
        [KotobaSmokeWindows]::Find($script:app.Id, $Title)
    }

    function Get-Control([IntPtr]$Handle, [string]$Name, [bool]$Button = $false) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
        if ($Button) {
            $type = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button)
            $condition = New-Object System.Windows.Automation.AndCondition($condition, $type)
        }
        $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    }

    function Invoke-Control([IntPtr]$Handle, [string]$Name) {
        $control = Wait-For "UI Automation button '$Name'" { Get-Control $Handle $Name $true }
        if (-not $control.Current.IsEnabled) { throw "UI Automation button '$Name' is disabled." }
        $pattern = $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
    }

    function Assert-Alive([IntPtr]$Handle, [int]$Seconds = 10) {
        for ($i = 0; $i -lt $Seconds; $i++) {
            $script:app.Refresh()
            if ($script:app.HasExited -or
                -not [KotobaSmokeWindows]::IsWindow($Handle) -or
                -not [KotobaSmokeWindows]::IsWindowVisible($Handle) -or
                -not [KotobaSmokeWindows]::Responds($Handle)) {
                throw 'Installed app window exited, disappeared, or stopped responding during the liveness check.'
            }
            Start-Sleep -Seconds 1
        }
    }

    function Get-Bounds([IntPtr]$Handle) {
        $rect = New-Object KotobaSmokeWindows+Rect
        if (-not [KotobaSmokeWindows]::GetWindowRect($Handle, [ref]$rect)) { throw 'Could not read native overlay bounds.' }
        [ordered]@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
    }

    function Get-ClientBounds([IntPtr]$Handle) {
        $rect = New-Object KotobaSmokeWindows+Rect
        $origin = New-Object KotobaSmokeWindows+Point
        if (-not [KotobaSmokeWindows]::GetClientRect($Handle, [ref]$rect) -or
            -not [KotobaSmokeWindows]::ClientToScreen($Handle, [ref]$origin)) {
            throw 'Could not read overlay client bounds in physical screen coordinates.'
        }
        [ordered]@{ x = $origin.X; y = $origin.Y; width = $rect.Right; height = $rect.Bottom }
    }

    function Drag-Mouse([int]$X, [int]$Y, [int]$Dx, [int]$Dy) {
        if (-not [KotobaSmokeWindows]::SetCursorPos($X, $Y)) { throw 'Could not position mouse for overlay control check.' }
        # Let the WebView receive mousemove/hover before pressing the button.
        Start-Sleep -Milliseconds 200
        [KotobaSmokeWindows]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        try {
            # Give the WebView time to dispatch mousedown and enter native move/resize.
            Start-Sleep -Milliseconds 400
            for ($step = 1; $step -le 12; $step++) {
                if (-not [KotobaSmokeWindows]::SetCursorPos(($X + $Dx * $step / 12), ($Y + $Dy * $step / 12))) {
                    throw 'Mouse drag failed.'
                }
                Start-Sleep -Milliseconds 35
            }
        } finally {
            [KotobaSmokeWindows]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        }
    }

    Set-Stage 'silent-install'
    $installers = @(Get-ChildItem -LiteralPath $BundleDirectory -Filter '*.exe' -File)
    if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
    # /D must be last and unquoted, including when the path contains spaces (NSIS syntax).
    if (Test-Path -LiteralPath $InstallDirectory) { throw 'Smoke install directory must not already exist.' }
    $installerProcess = Start-Process -FilePath $installers[0].FullName `
        -ArgumentList "/S /D=$InstallDirectory" -PassThru
    # Retain the native process handle so Windows PowerShell can read ExitCode
    # after a fast installer exit when using a bounded WaitForExit.
    $null = $installerProcess.Handle
    if (-not $installerProcess.WaitForExit(180000)) { throw 'Silent NSIS installation timed out after 180 seconds.' }
    $installerProcess.Refresh()
    $report.installerExitCode = $installerProcess.ExitCode
    if ($installerProcess.ExitCode -ne 0) { throw "NSIS installer failed (exit code $($installerProcess.ExitCode))." }
    $exe = Join-Path $InstallDirectory 'kotoba-overlay.exe'
    $report.installDirectoryExists = Test-Path -LiteralPath $InstallDirectory -PathType Container
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Installer succeeded but the installed executable is missing.' }
    # Measure package files before first launch adds WebView profile/model data.
    # These are actual file lengths, not a compressed-payload estimate.
    $report.packageSize = [ordered]@{
        installerBytes = [long]$installers[0].Length
        installedFileBytes = [long](Get-ChildItem -LiteralPath $InstallDirectory -Recurse -File |
            Measure-Object -Property Length -Sum).Sum
        installedExecutableBytes = [long](Get-Item -LiteralPath $exe).Length
    }
    Write-Host ("Installed package size: " + ($report.packageSize | ConvertTo-Json -Compress))
    $report.checks += 'silent-install'

    Set-Stage 'installed-app-startup'
    $app = Start-Process -FilePath $exe -WorkingDirectory $InstallDirectory -PassThru
    $null = $app.Handle
    $report.processId = $app.Id
    $main = Wait-For 'visible installed main window' { Get-AppWindows 'MHFZ-Z Translator Overlay' }
    $main = [IntPtr]$main
    $report.mainDpi = [KotobaSmokeWindows]::GetDpiForWindow($main)
    if ($report.mainDpi -ne (96 * $ScalingPercent / 100)) {
        throw "Main window DPI $($report.mainDpi) does not match requested $ScalingPercent% scaling."
    }
    Assert-Alive $main
    $report.checks += 'main-window-visible-and-responsive-10s'

    Set-Stage 'initial-local-model-preparation'
    # The hosted runner has a fresh WebView profile. Exercise the actual release
    # worker, bundled WASM, CSP and persistent cache through the installed UI.
    # Preparation runs a fixed Japanese sentence through local inference before
    # emitting this exact success message. Never select or consent to cloud.
    Invoke-Control $main 'Prepare local model'
    $readyMessage = 'Local model ready. Japanese-to-English translation self-test passed on this device.'
    $null = Wait-For 'local model download and Japanese-to-English self-test' {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($main)
        $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($node in $nodes) {
            # Only record allowlisted fields from the authored error prefix.
            $name = $node.Current.Name
            $diagnostic = ConvertFrom-LocalModelDiagnostic $name
            if ($null -ne $diagnostic) {
                $report.localModelErrorCode = $diagnostic['code']
                if ($diagnostic.Contains('stage')) { $report.localModelStage = $diagnostic['stage'] }
                if ($diagnostic.Contains('lastFile')) { $report.localModelLastFile = $diagnostic['lastFile'] }
                Save-Report
                $details = ($diagnostic.Values -join '; ')
                throw "Local preparation failed with [$details]."
            }
            if ($name -eq $readyMessage) { return $true }
        }
        return $false
    } 600
    $report.checks += 'initial-local-model-preparation-and-japanese-english-inference'
    Save-Report

    Set-Stage 'overlay-open'
    # Use a real accessible control: no injected JS, devtools, remote debugging, or test-only app mode.
    Invoke-Control $main 'Overlay window'
    $overlay = Wait-For 'visible translation overlay' { Get-AppWindows 'MHFZ-Z Translator Overlay - Dialogue' }
    $overlay = [IntPtr]$overlay
    $null = Wait-For 'rendered overlay empty state' {
        Get-Control $overlay 'Japanese dialogue will appear here once the hunt begins.'
    }
    if (([KotobaSmokeWindows]::GetWindowLong($overlay, -20) -band 0x8) -eq 0) {
        throw 'Translation overlay is not marked always-on-top (WS_EX_TOPMOST).'
    }
    Assert-Alive $overlay
    $report.checks += 'overlay-rendered-topmost-and-responsive-10s'

    Set-Stage 'overlay-mouse-move'
    $before = Get-Bounds $overlay
    $report.overlayInitialBounds = $before
    $report.overlayDpi = [KotobaSmokeWindows]::GetDpiForWindow($overlay)
    $report.overlayScalingPercent = [Math]::Round($report.overlayDpi / 96.0 * 100)
    if ($report.overlayDpi -ne (96 * $ScalingPercent / 100)) {
        throw "Overlay DPI $($report.overlayDpi) does not match requested $ScalingPercent% scaling."
    }
    $move = Wait-For 'overlay drag handle' { Get-Control $overlay 'Move overlay' $true }
    $bounds = $move.Current.BoundingRectangle
    Drag-Mouse ([int]($bounds.Left + $bounds.Width / 2)) ([int]($bounds.Top + $bounds.Height / 2)) -70 -40
    $null = Wait-For 'overlay to move using its drag handle' {
        $after = Get-Bounds $overlay
        [Math]::Abs($after.x - $before.x) -ge 30 -and [Math]::Abs($after.y - $before.y) -ge 15
    }
    $report.overlayMovedBounds = Get-Bounds $overlay
    $report.checks += 'overlay-moves-with-mouse'

    Set-Stage 'overlay-mouse-resize'
    Invoke-OverlayResizeChecks $overlay $main $ScalingPercent

    Set-Stage 'overlay-reuse'
    Invoke-Control $main 'Overlay window'
    $windows = @(Get-AppWindows 'MHFZ-Z Translator Overlay - Dialogue')
    if ($windows.Count -ne 1 -or $windows[0] -ne $overlay) { throw 'Opening an existing overlay did not reuse the same window.' }
    $report.checks += 'overlay-reuses-existing-window'

    Set-Stage 'overlay-close-and-reopen'
    Invoke-Control $overlay 'Close overlay'
    $null = Wait-For 'overlay to close via its UI' { -not [KotobaSmokeWindows]::IsWindow($overlay) }
    Assert-Alive $main 2
    Invoke-Control $main 'Overlay window'
    $reopened = Wait-For 'overlay to reopen' { Get-AppWindows 'MHFZ-Z Translator Overlay - Dialogue' }
    $reopened = [IntPtr]$reopened
    $null = Wait-For 'reopened overlay content' { Get-Control $reopened 'Japanese dialogue will appear here once the hunt begins.' }
    Assert-Alive $reopened 2
    Invoke-Control $reopened 'Close overlay'
    $null = Wait-For 'reopened overlay to close' { -not [KotobaSmokeWindows]::IsWindow($reopened) }
    Assert-Alive $main 2
    $report.checks += 'overlay-closes-and-reopens-with-main-surviving'
    $report.status = 'passed'
    Set-Stage 'complete'
    Write-Host ("Completed checks: " + ($report.checks -join ', '))
}
catch {
    $report.status = 'failed'
    # Only our error and exception type: no environment, UI tree, settings, profile, or credentials.
    $report.error = $_.Exception.Message
    $report.exceptionType = $_.Exception.GetType().FullName
    if ($report.Contains('overlayResizeAfter')) {
        Write-Host ("Resize final bounds: " + ($report.overlayResizeAfter | ConvertTo-Json -Compress))
    }
    Write-Error -ErrorAction Continue "Windows smoke failed during '$($report.stage)': $($report.error)"
}
finally {
    if ($null -ne $app) {
        $app.Refresh()
        $report.appExited = $app.HasExited
        if ($app.HasExited) {
            $report.appExitCode = $app.ExitCode
        } else {
            # Whitelist native window diagnostics instead of dumping arbitrary WebView contents.
            $report.windows = @(
                foreach ($title in @('MHFZ-Z Translator Overlay', 'MHFZ-Z Translator Overlay - Dialogue')) {
                    foreach ($handle in @(Get-AppWindows $title)) {
                        [ordered]@{
                            title = $title
                            handle = $handle.ToInt64()
                            responsive = [KotobaSmokeWindows]::Responds($handle)
                            extendedStyle = [KotobaSmokeWindows]::GetWindowLong($handle, -20)
                        }
                    }
                }
            )
            Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($null -ne $installerProcess -and -not $installerProcess.HasExited) {
        Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Save-Report
    if ($report.status -eq 'failed') {
        # Whitelisted stage/error only; make failures readable without requiring
        # credentials to download an Actions artifact or exposing the UI tree.
        $details = "Stage: $($report.stage). $($report.error)"
        $details = $details.Replace("%", "%25").Replace("`r", "%0D").Replace("`n", "%0A")
        Write-Output "::error title=Windows installed-app smoke::$details"
    }
    if ($env:GITHUB_STEP_SUMMARY) {
        @"
## Windows installed-app smoke check: $($report.status)
Stage: $($report.stage)

Requested scale: $ScalingPercent%. Measured window DPI: $($report['overlayDpi']).

Completed checks: $($report.checks -join ', ')

$($report.scope)

See the windows-smoke-diagnostics-$ScalingPercent artifact for per-direction physical mouse and bounds evidence.
"@ | Add-Content -Encoding UTF8 $env:GITHUB_STEP_SUMMARY
    }
}
if ($report.status -ne 'passed') { exit 1 }
