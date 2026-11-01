# Signs the Claude Code CLI in for Mili's jobs. Claude Code stores the login itself (in your user profile), and Mili's jobs reuse it.
$c = Get-Command claude -ErrorAction SilentlyContinue
$exe = if ($c) { $c.Source } else {
    # the store version of the desktop app keeps its copy under Packages\Claude_*\LocalCache
    $roots = @("$env:APPDATA\Claude\claude-code") + (Get-ChildItem "$env:LOCALAPPDATA\Packages" -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName)\LocalCache\Roaming\Claude\claude-code" })
    $roots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse -Filter claude.exe } |
        Sort-Object { [version]($_.FullName -replace '.*claude-code\\([\d.]+)\\.*', '$1') } -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $exe) { Write-Host 'claude.exe not found. Install Claude Code or the Claude desktop app.'; exit 1 }
Write-Host "Using $exe"
& $exe auth login
& $exe auth status
