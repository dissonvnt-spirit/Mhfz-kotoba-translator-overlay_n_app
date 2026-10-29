# Coordinates are physical screen pixels, not GetWindowRect's shadow/non-client
# bounds. The authored CSS corner is 16 CSS px square; target its center.
function Get-OverlayResizeTarget(
    [System.Collections.IDictionary]$ClientBounds,
    [uint32]$Dpi,
    [ValidateSet('North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest')]
    [string]$Direction = 'SouthEast'
) {
    if ($Dpi -eq 0) { throw 'Overlay DPI must be positive.' }
    $inset = [int][Math]::Max(1, [Math]::Round(8 * $Dpi / 96.0))
    if ($ClientBounds.width -le (2 * $inset) -or $ClientBounds.height -le (2 * $inset)) {
        throw 'Overlay client area is too small for its resize grip.'
    }
    # Edge strips are 8 CSS px wide; corners are 16 CSS px square.
    $edgeInset = [int][Math]::Max(1, [Math]::Round(4 * $Dpi / 96.0))
    $x = $ClientBounds.x + $ClientBounds.width / 2
    $y = $ClientBounds.y + $ClientBounds.height / 2
    $offset = if ($Direction -in @('North', 'South', 'East', 'West')) { $edgeInset } else { $inset }
    if ($Direction -match 'West') { $x = $ClientBounds.x + $offset }
    if ($Direction -match 'East') { $x = $ClientBounds.x + $ClientBounds.width - $offset }
    if ($Direction -match 'North') { $y = $ClientBounds.y + $offset }
    if ($Direction -match 'South') { $y = $ClientBounds.y + $ClientBounds.height - $offset }
    [ordered]@{ x = [int]$x; y = [int]$y }
}

function Test-PointInBounds([System.Collections.IDictionary]$Point, [System.Collections.IDictionary]$Bounds) {
    $Point.x -ge $Bounds.x -and $Point.y -ge $Bounds.y -and
        $Point.x -lt ($Bounds.x + $Bounds.width) -and $Point.y -lt ($Bounds.y + $Bounds.height)
}

# The opposite edge must stay fixed. Edges must not accidentally resize the
# other axis; corners must change BOTH axes (checked by the native caller).
function Test-OverlayResizeAnchors($Before, $After, [string]$Direction, [int]$Tolerance = 3) {
    if ($Direction -match 'West') {
        if ([Math]::Abs(($After.x + $After.width) - ($Before.x + $Before.width)) -gt $Tolerance) { return $false }
    } elseif ([Math]::Abs($After.x - $Before.x) -gt $Tolerance) { return $false }
    if ($Direction -match 'North') {
        if ([Math]::Abs(($After.y + $After.height) - ($Before.y + $Before.height)) -gt $Tolerance) { return $false }
    } elseif ([Math]::Abs($After.y - $Before.y) -gt $Tolerance) { return $false }
    if ($Direction -notmatch 'East|West' -and [Math]::Abs($After.width - $Before.width) -gt $Tolerance) { return $false }
    if ($Direction -notmatch 'North|South' -and [Math]::Abs($After.height - $Before.height) -gt $Tolerance) { return $false }
    return $true
}
