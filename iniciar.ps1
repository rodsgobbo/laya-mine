# Opens the three Auto-mine windows: Minecraft server, Laya, and the mission agent.
# Run from PowerShell in this folder:  .\iniciar.ps1
# Dragon speedrun instead of missions:  .\iniciar.ps1 -Speedrun   (fresh world with the route seed; Claude Desktop plans)
param([switch]$Speedrun)
$root = $PSScriptRoot
$java = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe" | Select-Object -First 1).FullName

# RCON lets desligar.ps1 send "stop" (which saves the world) without anyone typing in the server window.
# It listens on server-ip (127.0.0.1) only; the random password lives in server/, which git ignores.
$props = "$root\server\server.properties"
$text = Get-Content $props -Raw

# The speedrun route counts on untouched village chests, so every run gets a new world with the same seed.
# The missions world name is kept in server\.mundo-anterior; desligar.ps1 puts it back.
if ($Speedrun) {
  if (Test-NetConnection 127.0.0.1 -Port 25576 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    Write-Host "O servidor do Minecraft já está ligado. Rode .\desligar.ps1 antes de começar um speedrun."; exit 1
  }
  $world = 'speedrun-' + (Get-Date -Format 'yyyyMMdd-HHmm')
  if (-not (Test-Path "$root\server\.mundo-anterior")) {
    ([regex]::Match($text, '(?m)^level-name=(.*)$').Groups[1].Value.Trim()) | Set-Content "$root\server\.mundo-anterior" -Encoding ASCII
  }
  $text = $text -replace '(?m)^level-name=.*$', "level-name=$world"
  Write-Host "Speedrun no mundo novo '$world' (semente $([regex]::Match($text, '(?m)^level-seed=(.*)$').Groups[1].Value.Trim()))"
}
if ($text -notmatch '(?m)^enable-rcon=true') { $text = $text -replace '(?m)^enable-rcon=.*$', 'enable-rcon=true' }
if ($text -match '(?m)^rcon\.password=\s*$') {
  $password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  $text = $text -replace '(?m)^rcon\.password=.*$', "rcon.password=$password"
}
Set-Content $props $text -NoNewline -Encoding ASCII

# Windows this script opens; desligar.ps1 closes exactly these.
$windows = @()
$windows += (Start-Process powershell -PassThru -WorkingDirectory "$root\server" -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Servidor Minecraft'; & '$java' -Xms512M -Xmx2G -jar server.jar nogui").Id
$windows += (Start-Process powershell -PassThru -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Laya'; `$env:LAYA_HOST='127.0.0.1'; `$env:LAYA_DEVICE='cpu'; `$env:LAYA_PRELOAD='1'; .\.venv\Scripts\laya-serve.exe").Id
$windows | ConvertTo-Json | Set-Content "$root\.janelas.json"

Write-Host "Esperando o servidor do Minecraft e o Laya ficarem prontos..."
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  $mc = Test-NetConnection 127.0.0.1 -Port 25576 -InformationLevel Quiet -WarningAction SilentlyContinue
  $laya = try { (Invoke-RestMethod http://127.0.0.1:8000/health -TimeoutSec 2).status -eq 'ok' } catch { $false }
  if ($mc -and $laya) { break }
  Start-Sleep -Seconds 2
}

$botCommand = if ($Speedrun) { "`$host.UI.RawUI.WindowTitle='Bot Speedrun'; `$env:PLANNER='desktop'; `$env:RUN_ID='$world'; node speedrun\nether-agent.mjs" }
  else { "`$host.UI.RawUI.WindowTitle='Bot AutoMine'; npm run missao" }
$windows += (Start-Process powershell -PassThru -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", $botCommand).Id
ConvertTo-Json @($windows) | Set-Content "$root\.janelas.json"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3007"

# Addresses to watch and to join. The LAN IP is the one on the interface with a default gateway (Wi-Fi or cable).
$lan = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress
$mcPort = (Select-String -Path "$root\server\server.properties" -Pattern '^server-port=(\d+)').Matches.Groups[1].Value
$mcIp = (Select-String -Path "$root\server\server.properties" -Pattern '^server-ip=(.*)$').Matches.Groups[1].Value

Write-Host ""
if ($Speedrun) {
  Write-Host "Pronto! O bot espera o primeiro plano. No Claude Desktop, peça:"
  Write-Host "  `"Vamos fazer o speedrun do dragão. Veja o jogo, siga as instruções do pedido e fique"
  Write-Host "   respondendo cada pedido de plano até o bot sair pelo portal do End.`""
  Write-Host "Para parar no meio: crie o arquivo runs\$world\stop"
} else { Write-Host "Pronto! Agora abra o Claude Desktop e peça uma missão." }
Write-Host ""
Write-Host "Visualizador"
Write-Host "  neste computador:        http://localhost:3007"
if ($lan) { Write-Host "  tablet/celular no Wi-Fi: http://${lan}:3007" }
Write-Host ""
Write-Host "Minecraft Java 1.16.5 (Multijogador > Conexão direta)"
Write-Host "  neste computador:        127.0.0.1:$mcPort"
if ($mcIp -eq '127.0.0.1') {
  Write-Host "  outros computadores:     desligado (server-ip=127.0.0.1 no server.properties)"
} elseif ($lan) {
  Write-Host "  outros computadores:     ${lan}:$mcPort"
}
