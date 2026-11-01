# Starts Ollama, the Open-LLM-VTuber server, the VRM stage server, and opens the stage in an app window.
# Safe to run when parts are already up. Opens the walking desktop overlay; -StageWindow opens the 9:16 stage in an Edge window instead; -NoWindow opens nothing.
param([switch]$NoWindow, [switch]$StageWindow)
$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$app   = Join-Path $root 'Open-LLM-VTuber'
$doc   = Join-Path $root 'Documentation'
$stage = Join-Path $doc 'app\vrm-stage'
$logs  = Join-Path $doc 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

function Test-Url($url) { try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false } }
function Wait-Url($url, $seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) { if (Test-Url $url) { return $true }; Start-Sleep 2 }
    $false
}

# 1. Ollama (reads OLLAMA_CONTEXT_LENGTH from the user environment)
if (-not (Test-Url 'http://localhost:11434/api/tags')) {
    Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe') -ArgumentList 'serve' -WindowStyle Hidden
    if (-not (Wait-Url 'http://localhost:11434/api/tags' 60)) { throw 'Ollama did not start' }
}

# 1b. VOICEVOX engine (her Japanese voice)
$vv = Join-Path $doc 'data\voicevox\windows-cpu\run.exe'
if ((Test-Path $vv) -and -not (Test-Url 'http://127.0.0.1:50021/version')) {
    Start-Process $vv -WorkingDirectory (Split-Path $vv) -WindowStyle Hidden
    if (-not (Wait-Url 'http://127.0.0.1:50021/version' 90)) { throw 'VOICEVOX engine did not start' }
}

# 2. VTuber brain (LLM, ASR, TTS)
if (-not (Test-Url 'http://localhost:12393/')) {
    Start-Process uv -ArgumentList 'run','run_server.py' -WorkingDirectory $app -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'server.out.log') -RedirectStandardError (Join-Path $logs 'server.err.log')
    if (-not (Wait-Url 'http://localhost:12393/' 180)) { throw 'VTuber server did not start' }
}

# 3. VRM stage server (build once if dist is missing)
if (-not (Test-Url 'http://localhost:8765/api/models')) {
    if (-not (Test-Path (Join-Path $stage 'dist\index.html'))) { Push-Location $stage; npm run build | Out-Null; Pop-Location }
    Start-Process node -ArgumentList 'server.js' -WorkingDirectory $stage -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'stage.out.log') -RedirectStandardError (Join-Path $logs 'stage.err.log')
    if (-not (Wait-Url 'http://localhost:8765/api/models' 30)) { throw 'Stage server did not start' }
}

# 4. Desktop overlay (Electron), or the stage in an Edge app window with its own profile (keeps the mic permission, allows autoplay)
if (-not $NoWindow -and -not $StageWindow) {
    $exe = Join-Path $PSScriptRoot 'Mili\Mili-win32-x64\Mili.exe'
    if (-not (Get-Process Mili, electron -ErrorAction SilentlyContinue)) {
        if (Test-Path $exe) { Start-Process $exe }
        else { Start-Process (Join-Path $doc 'app\overlay\node_modules\electron\dist\electron.exe') -ArgumentList (Join-Path $doc 'app\overlay') }
    }
}
if ($StageWindow) {
    $profile = Join-Path $doc 'data\edge-profile'
    $running = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$profile*" }
    if (-not $running) {
        $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
        Start-Process $edge -ArgumentList "--app=http://localhost:8765/", "--user-data-dir=`"$profile`"", '--autoplay-policy=no-user-gesture-required', '--window-size=1100,980'
    }
}
