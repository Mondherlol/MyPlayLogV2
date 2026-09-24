# Fabrique assets\icon.ico à partir de assets\icon.png (l'icône du site,
# client/public/pwa-icon.svg rendue en 512 px).
#
# Plusieurs tailles dans un seul .ico : 16 px pour la barre des tâches, 32/48
# pour l'explorateur, 256 pour les grandes icônes. Les petites sont écrites en
# bitmap 32 bits (ce que Windows lit partout, zone de notification comprise),
# la 256 en PNG.
param(
  [string]$Source = (Join-Path $PSScriptRoot "assets\icon.png"),
  [string]$Out = (Join-Path $PSScriptRoot "assets\icon.ico")
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($Source)
$frames = New-Object System.Collections.ArrayList

foreach ($s in 16, 20, 24, 32, 40, 48, 64, 256) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  if ($s -ge 256) {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $w = New-Object System.IO.BinaryWriter $ms
    # BITMAPINFOHEADER : hauteur doublée (image + masque), 32 bits par pixel.
    $w.Write([int]40); $w.Write([int]$s); $w.Write([int]($s * 2))
    $w.Write([int16]1); $w.Write([int16]32)
    $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0); $w.Write([int]0)
    for ($y = $s - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $s; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A)
      }
    }
    # Masque AND (vide : l'alpha fait foi), lignes alignées sur 32 bits.
    $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
    for ($y = 0; $y -lt $s; $y++) { $w.Write((New-Object byte[] $maskRow)) }
    $w.Flush()
  }
  [void]$frames.Add(@($s, $ms.ToArray()))
  $bmp.Dispose()
}
$src.Dispose()

$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([int16]0); $w.Write([int16]1); $w.Write([int16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
  $s = $f[0]; $bytes = $f[1]
  $dim = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([int16]1); $w.Write([int16]32)
  $w.Write([int]$bytes.Length); $w.Write([int]$offset)
  $offset += $bytes.Length
}
foreach ($f in $frames) { $w.Write([byte[]]$f[1]) }
$w.Flush()
[System.IO.File]::WriteAllBytes($Out, $ico.ToArray())
Write-Host "Icone ecrite : $Out ($($frames.Count) tailles)"
