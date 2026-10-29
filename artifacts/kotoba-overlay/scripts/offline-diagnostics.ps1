# Parse only the authored bracketed prefix. Never retain arbitrary UI text,
# exception messages, dialogue, paths or signed download URLs in diagnostics.
function ConvertFrom-LocalModelDiagnostic([string]$Text) {
    if ($Text -notmatch '^\[(?<code>LOCAL-(?:STORAGE|DOWNLOAD|RUNTIME|MISSING|INFERENCE|WORKER|TIMEOUT))(?<details>(?:; [^\]\r\n]{1,128}){0,2})\]') {
        return $null
    }
    $code = $Matches['code']
    $details = $Matches['details']
    $stages = @('storage', 'download', 'runtime', 'self-test', 'translation')
    $files = @(
        'config.json', 'tokenizer_config.json', 'tokenizer.json', 'generation_config.json',
        'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'
    )
    $result = [ordered]@{ code = $code }
    foreach ($detail in ($details -split '; ')) {
        if ($stages -ccontains $detail) { $result['stage'] = $detail }
        if ($files -ccontains $detail) { $result['lastFile'] = $detail }
    }
    return $result
}
