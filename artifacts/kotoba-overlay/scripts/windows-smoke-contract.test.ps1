# Cross-platform parser/interop checks; these are NOT native interaction evidence.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot 'windows-smoke*.ps1')) {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "$($file.Name): $($errors.Message -join '; ')" }
}
foreach ($name in @('windows-smoke-display.ps1', 'windows-smoke.ps1')) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    $source = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
            $node.Value.StartsWith('using System;')
    }, $true)
    if ($null -eq $source) { throw "Native interop source missing in $name." }
    Add-Type -TypeDefinition $source.Value
}
foreach ($layout in @(
    @{ type = [KotobaSmokeDisplay+Luid]; size = 8 },
    @{ type = [KotobaSmokeDisplay+Source]; size = 20 },
    @{ type = [KotobaSmokeDisplay+Target]; size = 48 },
    @{ type = [KotobaSmokeDisplay+Path]; size = 72 },
    @{ type = [KotobaSmokeDisplay+Header]; size = 20 },
    @{ type = [KotobaSmokeDisplay+ScaleGet]; size = 32 },
    @{ type = [KotobaSmokeDisplay+ScaleSet]; size = 24 }
)) {
    $size = [Runtime.InteropServices.Marshal]::SizeOf([type]$layout.type)
    if ($size -ne $layout.size) { throw "$($layout.type) has incorrect native packet size $size." }
}
Write-Host 'PowerShell parser, C# interop compilation and native packet layout checks passed.'
