# Native fixture placement is setup only. Every asserted size change below must
# come from Drag-Mouse through the installed WebView's authored resize grips.
function Invoke-OverlayResizeChecks([IntPtr]$Overlay, [IntPtr]$Main, [int]$ScalingPercent) {
    $expectedDpi = 96 * $ScalingPercent / 100
    $scale = $expectedDpi / 96.0
    $tolerance = 3 # Physical pixels: rounding, not an allowance for missing axes.
    foreach ($direction in @('North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest')) {
        Set-Stage "overlay-resize-$direction"
        $sx = if ($direction -match 'West') { -1 } elseif ($direction -match 'East') { 1 } else { 0 }
        $sy = if ($direction -match 'North') { -1 } elseif ($direction -match 'South') { 1 } else { 0 }
        $outer = Get-Bounds $Overlay
        $client = Get-ClientBounds $Overlay
        # Keep all targets and drag endpoints on-screen, including at 200%.
        # Convert desired CLIENT size to outer size without assuming frame width.
        if (-not [KotobaSmokeWindows]::SetWindowPos($Overlay, [IntPtr]::Zero,
            [int](240 * $scale), [int](180 * $scale),
            [int](480 * $scale + $outer.width - $client.width),
            [int](230 * $scale + $outer.height - $client.height), 0x14)) {
            throw "Could not position fixture for $direction."
        }
        Start-Sleep -Milliseconds 500
        $case = [ordered]@{
            direction = $direction; requestedScalingPercent = $ScalingPercent
            status = 'running'; operations = @()
        }
        $report.resizeCases += $case
        Save-Report
        foreach ($action in @('grow', 'minimum', 'recover')) {
            $dpi = [KotobaSmokeWindows]::GetDpiForWindow($Overlay)
            if ($dpi -ne $expectedDpi) { throw "Unexpected DPI $dpi during $direction/$action." }
            $before = Get-ClientBounds $Overlay
            $target = Get-OverlayResizeTarget $before $dpi $direction
            $point = New-Object KotobaSmokeWindows+Point
            $point.X = $target.x
            $point.Y = $target.y
            $dx = [int]($sx * 80 * $scale)
            $dy = [int]($sy * 60 * $scale)
            if ($action -eq 'minimum') {
                # Drag 40 logical px BEYOND each affected minimum. Ending exactly
                # at the minimum would not prove Windows enforces the constraint.
                $dx = [int](-$sx * ($before.width - 360 * $scale + 40 * $scale))
                $dy = [int](-$sy * ($before.height - 170 * $scale + 40 * $scale))
            }
            $operation = [ordered]@{
                action = $action; dpi = $dpi; scalingPercent = $dpi / 96.0 * 100
                before = $before; outerBefore = Get-Bounds $Overlay
                target = $target; delta = @{ x = $dx; y = $dy }
                insideClient = Test-PointInBounds $target $before
                rootIsOverlay = [KotobaSmokeWindows]::GetAncestor([KotobaSmokeWindows]::WindowFromPoint($point), 2) -eq $Overlay
                status = 'running'
            }
            $case.operations += $operation
            Save-Report
            if (-not $operation.insideClient -or -not $operation.rootIsOverlay) {
                throw "Resize target for $direction/$action is outside the overlay client or covered."
            }
            Drag-Mouse $target.x $target.y $dx $dy
            $null = Wait-For "$direction/$action at $ScalingPercent% with anchored opposite edges" {
                $after = Get-ClientBounds $Overlay
                $operation.after = $after
                $operation.outerAfter = Get-Bounds $Overlay
                if (-not (Test-OverlayResizeAnchors $before $after $direction $tolerance)) { return $false }
                if ($action -eq 'minimum') {
                    return ($after.width -ge (360 * $scale - $tolerance) -and
                        $after.height -ge (170 * $scale - $tolerance) -and
                        ($sx -eq 0 -or [Math]::Abs($after.width - 360 * $scale) -le $tolerance) -and
                        ($sy -eq 0 -or [Math]::Abs($after.height - 170 * $scale) -le $tolerance))
                }
                return (($sx -eq 0 -or $after.width -ge $before.width + 30 * $scale) -and
                    ($sy -eq 0 -or $after.height -ge $before.height + 20 * $scale))
            } 10
            Assert-Alive $Overlay 1
            Assert-Alive $Main 1
            # Native WM_NULL alone cannot establish that the WebView survived.
            $null = Wait-For 'responsive WebView overlay controls after resizing' {
                Get-Control $Overlay 'Close overlay' $true
            } 10
            $operation.status = 'passed'
            $operation.liveness = 'overlay-and-main-native-responsive; WebView-close-control-present'
            Save-Report
            Write-Host ("Resize evidence: " + (([ordered]@{
                direction = $direction; scale = $ScalingPercent; operation = $operation
            }) | ConvertTo-Json -Compress -Depth 6))
        }
        $case.status = 'passed'
        $report.checks += "overlay-resizes-$direction-grow-minimum-recover-with-mouse"
        Save-Report
    }
    if ($report.resizeCases.Count -ne 8 -or @($report.resizeCases | Where-Object { $_.status -ne 'passed' }).Count -ne 0) {
        throw 'Not all eight real-mouse resize directions passed.'
    }
}
