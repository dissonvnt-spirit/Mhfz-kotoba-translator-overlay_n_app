# Coordinates are physical screen pixels, not GetWindowRect's shadow/non-client
# bounds. The authored CSS corner is 16 CSS px square; target its center.
function Get-OverlayResizeTarget([System.Collections.IDictionary]$ClientBounds, [uint32]$Dpi) {
    if ($Dpi -eq 0) { throw 'Overlay DPI must be positive.' }
    $inset = [int][Math]::Max(1, [Math]::Round(8 * $Dpi / 96.0))
    if ($ClientBounds.width -le (2 * $inset) -or $ClientBounds.height -le (2 * $inset)) {
        throw 'Overlay client area is too small for its resize grip.'
    }
    [ordered]@{
        x = [int]($ClientBounds.x + $ClientBounds.width - $inset)
        y = [int]($ClientBounds.y + $ClientBounds.height - $inset)
    }
}

function Test-PointInBounds([System.Collections.IDictionary]$Point, [System.Collections.IDictionary]$Bounds) {
    $Point.x -ge $Bounds.x -and $Point.y -ge $Bounds.y -and
        $Point.x -lt ($Bounds.x + $Bounds.width) -and $Point.y -lt ($Bounds.y + $Bounds.height)
}
