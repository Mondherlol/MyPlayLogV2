# Compile MyPlayLog Compagnon avec le compilateur C# fourni par Windows
# (.NET Framework 4.8) : rien à installer. Résultat : dist\MyPlayLogCompagnon.exe
#
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Out C:\temp\test.exe -NoPublish
param([string]$Out, [switch]$NoPublish)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "Compilateur C# introuvable (.NET Framework 4.x requis)." }

$icon = Join-Path $here "assets\icon.ico"
if (-not (Test-Path $icon)) { & (Join-Path $here "make-icon.ps1") }

if (-not $Out) { $Out = Join-Path $here "dist\MyPlayLogCompagnon.exe" }
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$sources = Get-ChildItem (Join-Path $here "src") -Filter *.cs -Recurse | ForEach-Object { $_.FullName }

# Embarqués dans l'exe : les polices du site (Space Grotesk, Inter — licence
# OFL), les icônes Lucide rendues en PNG (make-glyphs.ps1) et le logo.
$resources = @()
Get-ChildItem (Join-Path $here "assets\fonts") -Filter *.ttf | ForEach-Object { $resources += "/resource:$($_.FullName),font.$($_.Name)" }
Get-ChildItem (Join-Path $here "assets\glyphs") -Filter *.png | ForEach-Object { $resources += "/resource:$($_.FullName),glyph.$($_.Name)" }
$resources += "/resource:$(Join-Path $here 'assets\icon.png'),icon.png"

& $csc /nologo /target:winexe /optimize+ /platform:anycpu /utf8output /codepage:65001 `
  "/out:$Out" "/win32icon:$icon" "/win32manifest:$(Join-Path $here 'app.manifest')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Net.Http.dll /r:System.Web.Extensions.dll `
  $resources $sources
if ($LASTEXITCODE -ne 0) { throw "La compilation a échoué." }

$size = [Math]::Round((Get-Item $Out).Length / 1KB)
Write-Host "OK : $Out ($size Ko)"
if ($NoPublish) { return }

# ⚠️ C'EST LE SITE QUI LE DISTRIBUE, PAS L'API. Le conteneur du serveur est
# construit à partir de ./server seul (docker-compose) : il ne voit jamais ce
# dossier. Le site, lui, sert tout client/public tel quel (Caddy) — l'exe y est
# donc copié, et se télécharge sur https://myplaylog.cc/downloads/MyPlayLogCompagnon.exe
$pub = Join-Path $here "..\client\public\downloads"
New-Item -ItemType Directory -Force $pub | Out-Null
Copy-Item $Out (Join-Path $pub "MyPlayLogCompagnon.exe") -Force
Write-Host "Copie pour le site : client\public\downloads\MyPlayLogCompagnon.exe"
