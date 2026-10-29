Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'offline-diagnostics.ps1')

function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw 'Safe local model diagnostic assertion failed.' }
}

$result = ConvertFrom-LocalModelDiagnostic '[LOCAL-DOWNLOAD; download; onnx/encoder_model_quantized.onnx] Safe authored message.'
Assert-Equal $result.code 'LOCAL-DOWNLOAD'
Assert-Equal $result.stage 'download'
Assert-Equal $result.lastFile 'onnx/encoder_model_quantized.onnx'

$result = ConvertFrom-LocalModelDiagnostic '[LOCAL-WORKER] Safe authored message.'
Assert-Equal $result.code 'LOCAL-WORKER'
Assert-Equal $result.Count 1

# Unknown details are not copied even if the error code is valid.
$result = ConvertFrom-LocalModelDiagnostic '[LOCAL-DOWNLOAD; https://host.test/model?signature=private; C:\private\model] Private dialogue.'
Assert-Equal $result.Count 1
Assert-Equal $result.code 'LOCAL-DOWNLOAD'

foreach ($text in @(
    'Private dialogue.',
    '[LOCAL-UNKNOWN; download; tokenizer.json] Unknown code.',
    "prefix [LOCAL-DOWNLOAD; download] Private dialogue.",
    "[LOCAL-DOWNLOAD; download`nprivate] Bad prefix."
)) {
    Assert-Equal (ConvertFrom-LocalModelDiagnostic $text) $null
}

foreach ($stage in @('storage', 'download', 'runtime', 'self-test', 'translation')) {
    $result = ConvertFrom-LocalModelDiagnostic "[LOCAL-RUNTIME; $stage] Safe message."
    Assert-Equal $result.stage $stage
}

Write-Host 'Safe local model diagnostic parser checks passed.'
