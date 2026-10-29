Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-smoke-geometry.ps1')

function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Resize geometry: expected $Expected, got $Actual." }
}

# Same CSS grip at 100%, 125%, 150%, 175% and 200% Windows scaling.
foreach ($dpi in @(96, 120, 144, 168, 192)) {
    $scale = $dpi / 96.0
    $client = @{ x = 108; y = 70; width = [int](480 * $scale); height = [int](230 * $scale) }
    $point = Get-OverlayResizeTarget $client $dpi
    Assert-Equal $point.x ([int]($client.x + $client.width - 8 * $scale))
    Assert-Equal $point.y ([int]($client.y + $client.height - 8 * $scale))
    Assert-Equal (Test-PointInBounds $point $client) $true
    # The target must be inside the 16 CSS px southeast corner, not just the client.
    Assert-Equal ($point.x -gt ($client.x + $client.width - 16 * $scale)) $true
    Assert-Equal ($point.y -gt ($client.y + $client.height - 16 * $scale)) $true
}

# An undecorated Windows window may still have 8px hidden frame/shadow bounds.
# The old outer-right-minus-8 target can lie on the exclusive client boundary.
$client = @{ x = 108; y = 70; width = 480; height = 230 }
$outer = @{ x = 100; y = 70; width = 496; height = 238 }
$legacy = @{ x = $outer.x + $outer.width - 8; y = $outer.y + $outer.height - 8 }
Assert-Equal (Test-PointInBounds $legacy $client) $false
$point = Get-OverlayResizeTarget $client 96
Assert-Equal $point.x 580
Assert-Equal $point.y 292

# Negative screen origins are valid on monitors left/above the primary display.
$point = Get-OverlayResizeTarget @{ x = -1200; y = -400; width = 720; height = 345 } 144
Assert-Equal $point.x -492
Assert-Equal $point.y -67

foreach ($case in @(
    @{ bounds = $client; dpi = 0 },
    @{ bounds = @{ x = 0; y = 0; width = 16; height = 230 }; dpi = 96 }
)) {
    $threw = $false
    try { $null = Get-OverlayResizeTarget $case.bounds $case.dpi } catch { $threw = $true }
    Assert-Equal $threw $true
}

Write-Host 'Windows overlay resize geometry checks passed.'
