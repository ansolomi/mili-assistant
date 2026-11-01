# Stops the stage window, the stage server, the VTuber server and the old Electron client.
# Leaves Ollama running (add -Ollama to stop it too).
param([switch]$Ollama)
$profile = Join-Path $PSScriptRoot 'Documentation\data\edge-profile'
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$profile*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process Mili, electron -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process open-llm-vtuber-electron -ErrorAction SilentlyContinue | Stop-Process -Force
foreach ($port in 8765, 12393, 50021) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($c) { Stop-Process -Id $c.OwningProcess -Force }
}
if ($Ollama) { Get-Process 'ollama*' -ErrorAction SilentlyContinue | Stop-Process -Force }
