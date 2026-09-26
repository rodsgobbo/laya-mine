# Turns Auto-mine off completely: the bot, the Minecraft server (saving the world), Laya,
# and the windows iniciar.ps1 opened. Nothing to close by hand.
# Usage:  .\desligar.ps1
$root = $PSScriptRoot
$procs = Get-CimInstance Win32_Process

# 1. Bot first, so it stops acting before the server goes away. Its inventory and position stay on the server.
foreach ($p in $procs | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'missao\.mjs|nether-agent\.mjs' }) {
  Stop-Process -Id $p.ProcessId -Force; Write-Host "Bot desligado"
}

# 2. Minecraft server: "stop" over RCON saves the world and exits. Forced close only if that fails.
$server = $procs | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match 'server\.jar' }
if ($server) {
  Write-Host "Salvando o mundo e desligando o servidor do Minecraft..."
  & node "$root\rcon.mjs" stop 2>$null | Out-Null
  $sent = $LASTEXITCODE -eq 0
  $deadline = (Get-Date).AddSeconds(30)
  while ($sent -and (Get-Date) -lt $deadline -and (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
  if (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $server.ProcessId -Force
    Write-Host "Servidor fechado à força (o RCON não respondeu; pode ter perdido os últimos minutos de construção)"
  } else { Write-Host "Servidor do Minecraft desligado, mundo salvo" }
}

# After a speedrun, the next .\iniciar.ps1 goes back to the missions world (iniciar.ps1 -Speedrun saved its name).
$previous = "$root\server\.mundo-anterior"
$serverRunning = $server -and (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue)
if ((Test-Path $previous) -and -not $serverRunning) {
  $name = (Get-Content $previous -Raw).Trim()
  $props = "$root\server\server.properties"
  (Get-Content $props -Raw) -replace '(?m)^level-name=.*$', "level-name=$name" | Set-Content $props -NoNewline -Encoding ASCII
  Remove-Item $previous
  Write-Host "Próximo .\iniciar.ps1 volta ao mundo das missões ($name)"
}

# 3. Laya: only the laya-serve executable and the Python it starts from this project's .venv.
foreach ($p in $procs | Where-Object { $_.Name -eq 'laya-serve.exe' -or ($_.Name -eq 'python.exe' -and $_.CommandLine -match [regex]::Escape("$root\.venv") -and $_.CommandLine -match 'laya') }) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "Laya desligado"

# 4. The PowerShell windows iniciar.ps1 opened (listed in .janelas.json).
$list = "$root\.janelas.json"
if (Test-Path $list) {
  foreach ($id in @(Get-Content $list -Raw | ConvertFrom-Json)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Remove-Item $list
  Write-Host "Janelas fechadas"
}

Write-Host ""
Write-Host "Auto-mine desligado. (A aba do visualizador no navegador pode ser fechada quando quiser; o Claude Desktop pode ficar aberto.)"
