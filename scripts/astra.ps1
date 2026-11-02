# Starts a GPT-6 Astra pass in the Codex CLI at the repo root (docs/ASTRA.md).
# -Effort: high for a pass (the default), max for a big design pass.
# -Brief <path>: run that brief headless (codex exec) and write the final message next to it.
param(
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = 'high',
    [string]$Brief = ''
)

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $codex) {
    $codex = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $codex) { Write-Error 'Codex CLI not found. Install it or open the Codex app once.'; exit 1 }
$exe = if ($codex.Source) { $codex.Source } else { $codex.FullName }

Set-Location $repo
$common = @('-m', 'gpt-6-astra', '--sandbox', 'workspace-write',
    '-c', "model_reasoning_effort=`"$Effort`"",
    '-c', 'sandbox_workspace_write.network_access=false',
    '-c', 'web_search="live"')
if ($Brief) {
    $out = [System.IO.Path]::ChangeExtension($Brief, '.last-message.txt')
    Get-Content -Raw -Encoding utf8 $Brief | & $exe exec @common -o $out -
} else {
    & $exe @common
}
