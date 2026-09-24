# Rend les icônes du compagnon (assets/glyphs/*.svg) en PNG 64 px transparents,
# avec Edge en mode sans tête — présent sur tout Windows 10/11.
# À relancer seulement quand on ajoute une icône (tools/make-glyphs.mjs d'abord).
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "assets\glyphs"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$profile = Join-Path $env:TEMP "mpl-glyphs-edge"

foreach ($svg in Get-ChildItem $dir -Filter *.svg) {
  $png = [IO.Path]::ChangeExtension($svg.FullName, ".png")
  Remove-Item $png -ErrorAction SilentlyContinue
  $url = "file:///" + ($svg.FullName -replace "\\", "/")
  & $edge --headless=new --disable-gpu --hide-scrollbars --window-size=64,64 `
    --default-background-color=00000000 --user-data-dir="$profile" `
    "--screenshot=$png" $url | Out-Null
  # Edge écrit la capture après avoir rendu la main : on l'attend.
  for ($i = 0; $i -lt 40 -and -not (Test-Path $png); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Path $png)) { throw "Rendu raté : $($svg.Name)" }
}
Write-Host "Icones PNG pretes dans $dir"
