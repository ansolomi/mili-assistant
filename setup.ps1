# One-time setup for Mili on Windows 10/11. Run from this folder in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Safe to run again: finished steps are skipped. Add -SkipModels to skip the 6 GB Ollama download,
# -SkipVoice to skip the 2 GB VOICEVOX download (she then falls back to Edge TTS), -NoExe to skip building Mili.exe.
param([switch]$SkipModels, [switch]$SkipVoice, [switch]$NoExe)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$brain = Join-Path $root 'Open-LLM-VTuber'
$doc = Join-Path $root 'Documentation'
$UPSTREAM = 'https://github.com/Open-LLM-VTuber/Open-LLM-VTuber.git'
$UPSTREAM_COMMIT = '992309c0aa19845960228f880013d4685fde93b5'
$LLM = 'qwen3-vl:8b-instruct'
$VV_VERSION = '0.26.0'

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Run($exe, $argList, $dir) { Push-Location $dir; try { & $exe @argList; if ($LASTEXITCODE) { throw "$exe $($argList -join ' ') failed ($LASTEXITCODE)" } } finally { Pop-Location } }

Step '1/7 Tools (git, Node.js, uv, Ollama, 7-Zip)'
Refresh-Path
$tools = @(
    @{ cmd = 'git'; id = 'Git.Git' }, @{ cmd = 'node'; id = 'OpenJS.NodeJS.LTS' }, @{ cmd = 'uv'; id = 'astral-sh.uv' },
    @{ cmd = 'ollama'; id = 'Ollama.Ollama' }
)
foreach ($t in $tools) {
    if (Has $t.cmd) { Write-Host "$($t.cmd): ok"; continue }
    if (-not (Has 'winget')) { throw "$($t.cmd) is missing and winget is not available. Install $($t.id) by hand, then run this again." }
    winget install -e --id $t.id --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Has $t.cmd)) { throw "$($t.cmd) was installed but is not on PATH yet. Open a new PowerShell window and run setup.ps1 again." }
}
$sevenZip = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $sevenZip -and -not $SkipVoice) {
    winget install -e --id 7zip.7zip --accept-package-agreements --accept-source-agreements
    $sevenZip = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}

Step '2/7 Brain (Open-LLM-VTuber at the commit this project was built on, plus our patch)'
if (-not (Test-Path (Join-Path $brain '.git'))) {
    Run git @('clone', $UPSTREAM, $brain) $root
    Run git @('checkout', '-q', $UPSTREAM_COMMIT) $brain
}
Run git @('submodule', 'update', '--init', '--recursive') $brain
Push-Location $brain
& git apply --check --whitespace=nowarn (Join-Path $root 'Open-LLM-VTuber.patch') 2>$null
if ($LASTEXITCODE -eq 0) { & git apply --whitespace=nowarn (Join-Path $root 'Open-LLM-VTuber.patch'); Write-Host 'patch applied' } else { Write-Host 'patch already applied (or the folder was changed by hand): left as is' }
Pop-Location
Copy-Item (Join-Path $root 'Open-LLM-VTuber-overrides\*') $brain -Recurse -Force
Write-Host 'conf.yaml and prompts copied'

Step '3/7 Python environment for the brain (uv sync; downloads packages, a few GB)'
Run uv @('sync') $brain

Step '4/7 Language model (Ollama)'
[Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH', '16384', 'User') # she needs room for the persona, digest and chat
$env:OLLAMA_CONTEXT_LENGTH = '16384'
if (-not $SkipModels) {
    $up = try { Invoke-WebRequest http://localhost:11434/api/tags -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false }
    if (-not $up) { Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep 6 }
    if (-not (& ollama list | Select-String ([regex]::Escape($LLM)))) { & ollama pull $LLM; if ($LASTEXITCODE) { throw 'ollama pull failed' } } else { Write-Host "$LLM already pulled" }
} else { Write-Host "skipped: run 'ollama pull $LLM' yourself" }

Step '5/7 Japanese voice (VOICEVOX engine)'
$vv = Join-Path $doc 'data\voicevox'
if (Test-Path (Join-Path $vv 'windows-cpu\run.exe')) { Write-Host 'already installed' }
elseif ($SkipVoice) { Write-Host "skipped: set tts_model: 'edge_tts' in Open-LLM-VTuber\conf.yaml to use Edge TTS instead" }
else {
    New-Item -ItemType Directory -Force $vv | Out-Null
    $f = Join-Path $vv "voicevox_engine-windows-cpu-$VV_VERSION.7z.001"
    $url = "https://github.com/VOICEVOX/voicevox_engine/releases/download/$VV_VERSION/voicevox_engine-windows-cpu-$VV_VERSION.7z.001"
    if (-not (Test-Path $f)) { Start-BitsTransfer -Source $url -Destination $f }
    & $sevenZip x -y "-o$vv" $f | Out-Null
    if ($LASTEXITCODE) { throw '7-Zip could not extract the VOICEVOX archive' }
    Remove-Item $f
}

Step '6/7 Stage and overlay (npm)'
$stage = Join-Path $doc 'app\vrm-stage'
Run npm @('install', '--no-audit', '--no-fund') $stage
Run npm @('run', 'build') $stage
Run npm @('install', '--no-audit', '--no-fund') (Join-Path $doc 'app\overlay')

Step '7/7 Mili.exe'
if ($NoExe) { Write-Host "skipped: start-vtuber.ps1 runs the overlay through Electron instead" }
else {
    Run npm @('run', 'pack') (Join-Path $doc 'app\overlay')
    $exe = Join-Path $root 'Mili\Mili-win32-x64\Mili.exe'
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mili.lnk'))
    $sc.TargetPath = $exe; $sc.WorkingDirectory = Split-Path $exe; $sc.Save()
    Write-Host 'Desktop shortcut "Mili" created'
}

Write-Host "`nDone. Start her with the Mili shortcut or: powershell -ExecutionPolicy Bypass -File .\start-vtuber.ps1" -ForegroundColor Green
Write-Host 'First start downloads the speech-recognition model (about 230 MB) and takes a few minutes.'
