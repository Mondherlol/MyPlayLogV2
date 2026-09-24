# Compile MyPlayLog Compagnon avec le compilateur C# fourni par Windows
# (.NET Framework 4.8) : rien à installer. Résultat : dist\MyPlayLogCompagnon.exe
#
#   powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { throw "Compilateur C# introuvable (.NET Framework 4.x requis)." }

$icon = Join-Path $here "assets\icon.ico"
if (-not (Test-Path $icon)) { & (Join-Path $here "make-icon.ps1") }

New-Item -ItemType Directory -Force (Join-Path $here "dist") | Out-Null
$out = Join-Path $here "dist\MyPlayLogCompagnon.exe"
$sources = Get-ChildItem (Join-Path $here "src") -Filter *.cs | ForEach-Object { $_.FullName }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu /utf8output /codepage:65001 `
  "/out:$out" "/win32icon:$icon" "/win32manifest:$(Join-Path $here 'app.manifest')" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
  /r:System.Net.Http.dll /r:System.Web.Extensions.dll `
  $sources
if ($LASTEXITCODE -ne 0) { throw "La compilation a échoué." }

$size = [Math]::Round((Get-Item $out).Length / 1KB)
Write-Host "OK : $out ($size Ko)"
