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
    foreach ($direction in @('North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest')) {
        $point = Get-OverlayResizeTarget $client $dpi $direction
        Assert-Equal (Test-PointInBounds $point $client) $true
        $offset = if ($direction -in @('North', 'South', 'East', 'West')) { 4 * $scale } else { 8 * $scale }
        $expectedX = $client.x + $client.width / 2
        $expectedY = $client.y + $client.height / 2
        if ($direction -match 'West') { $expectedX = $client.x + $offset }
        if ($direction -match 'East') { $expectedX = $client.x + $client.width - $offset }
        if ($direction -match 'North') { $expectedY = $client.y + $offset }
        if ($direction -match 'South') { $expectedY = $client.y + $client.height - $offset }
        Assert-Equal $point.x ([int]$expectedX)
        Assert-Equal $point.y ([int]$expectedY)
    }
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

$before = @{ x = 200; y = 200; width = 480; height = 230 }
foreach ($direction in @('North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest')) {
    $after = @{ x = 200; y = 200; width = 480; height = 230 }
    if ($direction -match 'East|West') { $after.width += 80 }
    if ($direction -match 'North|South') { $after.height += 60 }
    if ($direction -match 'West') { $after.x -= 80 }
    if ($direction -match 'North') { $after.y -= 60 }
    Assert-Equal (Test-OverlayResizeAnchors $before $after $direction) $true
    $after.x += 10
    Assert-Equal (Test-OverlayResizeAnchors $before $after $direction) $false
}
# A single edge may not resize the other axis.
Assert-Equal (Test-OverlayResizeAnchors $before @{ x = 200; y = 200; width = 560; height = 240 } 'East') $false
Assert-Equal (Test-OverlayResizeAnchors $before @{ x = 200; y = 200; width = 490; height = 290 } 'South') $false
Write-Host 'Windows overlay anchored-edge checks passed (supplemental, not native mouse evidence).'
