# Restarts only the mission bot (missao.mjs). The Minecraft server and Laya keep running,
# and the bot's inventory and position are saved by the server.
# Usage:  .\reiniciar-bot.ps1            (opens the bot in a new window)
#         .\reiniciar-bot.ps1 -Background (runs hidden, output in bot.log)
param([switch]$Background)
$root = $PSScriptRoot
$bots = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'missao\.mjs' }
foreach ($b in $bots) { Stop-Process -Id $b.ProcessId -Force; Write-Host "Bot antigo parado (PID $($b.ProcessId))" }
Start-Sleep -Seconds 2
$run = 'partida-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
if ($Background) {
  $env:RUN_ID = $run  # inherited by the child process (Windows PowerShell 5.1 has no -Environment)
  Start-Process node -ArgumentList 'missao.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\bot.log" -RedirectStandardError "$root\bot-erros.log"
} else {
  $new = Start-Process powershell -PassThru -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Bot AutoMine'; `$env:RUN_ID='$run'; npm run missao"
  # iniciar.ps1 lists [server, Laya, bot] windows; swap the old bot window for the new one so desligar.ps1 closes it.
  $list = "$root\.janelas.json"
  if (Test-Path $list) {
    $windows = @(Get-Content $list -Raw | ConvertFrom-Json | ForEach-Object { $_ })
    if ($windows.Count -ge 3) { Stop-Process -Id $windows[2] -Force -ErrorAction SilentlyContinue; $windows[2] = $new.Id } else { $windows += $new.Id }
    ConvertTo-Json @($windows) | Set-Content $list
  }
}
Write-Host "Bot reiniciado como $run. Recarregue o visualizador (Ctrl+F5)."
