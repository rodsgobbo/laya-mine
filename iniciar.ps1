# Opens the three Auto-mine windows: Minecraft server, Laya, and the mission agent.
# Run from PowerShell in this folder:  .\iniciar.ps1
$root = $PSScriptRoot
$java = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe" | Select-Object -First 1).FullName

# RCON lets desligar.ps1 send "stop" (which saves the world) without anyone typing in the server window.
# It listens on server-ip (127.0.0.1) only; the random password lives in server/, which git ignores.
$props = "$root\server\server.properties"
$text = Get-Content $props -Raw
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

$windows += (Start-Process powershell -PassThru -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Bot AutoMine'; npm run missao").Id
ConvertTo-Json @($windows) | Set-Content "$root\.janelas.json"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3007"

# Addresses to watch and to join. The LAN IP is the one on the interface with a default gateway (Wi-Fi or cable).
$lan = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress
$mcPort = (Select-String -Path "$root\server\server.properties" -Pattern '^server-port=(\d+)').Matches.Groups[1].Value
$mcIp = (Select-String -Path "$root\server\server.properties" -Pattern '^server-ip=(.*)$').Matches.Groups[1].Value

Write-Host ""
Write-Host "Pronto! Agora abra o Claude Desktop e peça uma missão."
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
