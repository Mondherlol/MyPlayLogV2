# ======================================================================
#  Envoi de la Collection locale vers le site (VPS)
# ======================================================================
# Lancé par upload-collection.bat, à la racine du dépôt. Tout ce qu'il fait,
# dans l'ordre, et en s'arrêtant à la première erreur :
#
#   1. exporte le catalogue de la base LOCALE (npm run collection:export) ;
#   2. fabrique une archive des fichiers d'upload que ce catalogue référence
#      VRAIMENT — et seulement ceux qui ont changé depuis le dernier envoi ;
#   3. dépose les deux sur le VPS (scp) ;
#   4. les verse dans le conteneur, puis y rejoue l'import (upsert par slug).
#
# ------------------------------------------------ pourquoi l'incrémental -----
# Le rayon papier pèse à lui seul deux gigaoctets de planches, et une planche
# ne change JAMAIS une fois extraite. Repousser le tout à chaque ajout d'une
# série, c'est vingt minutes de téléversement pour trois jaquettes. On garde
# donc la date du dernier envoi réussi (.upload-collection-state.json) et on
# n'emporte que les fichiers plus récents. `-All` refait tout, pour le premier
# envoi ou quand on doute de ce qu'il y a en face.
#
# Le script d'import est recopié dans le conteneur à chaque passage : sans ça,
# il faudrait avoir poussé et redéployé le dépôt avant de pouvoir importer
# quoi que ce soit — l'image de prod ne contient que le code de son build.

param(
  # Refaire un envoi complet des fichiers (ignore la date du dernier envoi).
  [switch]$All,
  # N'emporter qu'un rayon : series, film, comic ou game.
  [string]$Kind = "",
  # Le VPS. Modifiables ici une fois pour toutes, ou passés en argument.
  [string]$VpsHost = "149.202.227.174",
  [string]$VpsUser = "ubuntu",
  [string]$VpsPort = "22",
  [string]$VpsPath = "~/myplaylog"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $PSScriptRoot ".upload-collection-state.json"
$catalog = Join-Path $root "server\collection-catalog.json"
$listFile = Join-Path $root "server\collection-catalog-files.txt"
$uploads = Join-Path $root "server\uploads"
$archive = Join-Path $env:TEMP "collection-files.tgz"
$sendList = Join-Path $env:TEMP "collection-send.txt"
$target = "$VpsUser@$VpsHost"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "`n❌ $msg" -ForegroundColor Red; exit 1 }

foreach ($exe in @("node", "npm", "ssh", "scp", "tar")) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    Die "« $exe » est introuvable. Installe-le (ou ouvre un nouveau terminal) et recommence."
  }
}

# --------------------------------------------------------- 1. l'export ------
Step 1 "Export du catalogue depuis la base locale…"
Push-Location (Join-Path $root "server")
try {
  # (pas $args : c'est une variable automatique de PowerShell.)
  $npmArgs = @("run", "collection:export")
  if ($Kind) { $npmArgs += @("--", "--kind=$Kind") }
  & npm @npmArgs
  if ($LASTEXITCODE -ne 0) { Die "L'export a échoué. MongoDB tourne-t-il en local ?" }
} finally { Pop-Location }
if (-not (Test-Path $catalog)) { Die "Le dump n'a pas été écrit : $catalog" }

# --------------------------------------------------- 2. les fichiers --------
Step 2 "Sélection des fichiers à emporter…"
$since = $null
if (-not $All -and (Test-Path $stateFile)) {
  $since = [datetime](Get-Content $stateFile -Raw | ConvertFrom-Json).lastRun
  Write-Host "    (incrémental : depuis le $($since.ToString('dd/MM/yyyy HH:mm')) — utilise -All pour tout renvoyer)"
} else {
  Write-Host "    (envoi complet)"
}

$wanted = @(Get-Content $listFile -ErrorAction SilentlyContinue | Where-Object { $_ })
$send = New-Object System.Collections.Generic.List[string]
$missing = 0
$bytes = 0
foreach ($rel in $wanted) {
  $full = Join-Path $uploads ($rel -replace "/", "\")
  $info = Get-Item -LiteralPath $full -ErrorAction SilentlyContinue
  if (-not $info) { $missing++; continue }
  if ($since -and $info.LastWriteTime -le $since) { continue }
  $send.Add($rel); $bytes += $info.Length
}
if ($missing) { Write-Host "    ⚠️  $missing fichiers référencés manquent en local (fiches incomplètes)." -ForegroundColor Yellow }
Write-Host "    $($send.Count) fichiers à envoyer sur $($wanted.Count) référencés ($([math]::Round($bytes / 1MB, 1)) Mo)."

$hasFiles = $send.Count -gt 0
if ($hasFiles) {
  Step 2 "Fabrication de l'archive…"
  # bsdtar veut ses chemins en avant-slash, relatifs au dossier -C — et la
  # liste SANS marque d'ordre d'octets : `Set-Content -Encoding utf8` en pose
  # une sous PowerShell 5, et bsdtar la lit comme faisant partie du premier
  # nom de fichier (vu à l'essai : « Couldn't visit directory »).
  [System.IO.File]::WriteAllText($sendList, ($send -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
  & tar -czf $archive -C $uploads -T $sendList
  if ($LASTEXITCODE -ne 0) { Die "La fabrication de l'archive a échoué." }
  Write-Host "    Archive : $([math]::Round((Get-Item $archive).Length / 1MB, 1)) Mo compressés."
}

# ------------------------------------------------------- 3. le transfert ----
Step 3 "Transfert vers $target (le mot de passe peut être demandé)…"
$payload = @($catalog, (Join-Path $root "server\src\scripts\collectionCatalog.js"))
if ($hasFiles) { $payload += $archive }
& scp -P $VpsPort $payload "${target}:$VpsPath/"
if ($LASTEXITCODE -ne 0) { Die "Le transfert a échoué (mot de passe, réseau ou chemin distant)." }

# ------------------------------------------------------- 4. l'import --------
Step 4 "Import sur le VPS (mot de passe une seconde fois)…"
$extract = if ($hasFiles) {
@"
  docker compose cp collection-files.tgz server:/tmp/collection-files.tgz
  docker compose exec -T server tar xzf /tmp/collection-files.tgz -C /app/uploads
  docker compose exec -T server rm -f /tmp/collection-files.tgz
"@
} else { "  echo 'aucun fichier a verser'" }

$remote = @"
set -e
cd $VpsPath
docker compose cp collection-catalog.json server:/app/collection-catalog.json
docker compose cp collectionCatalog.js server:/app/src/scripts/collectionCatalog.js
$extract
docker compose exec -T server node src/scripts/collectionCatalog.js --import
rm -f collection-catalog.json collection-files.tgz collectionCatalog.js
echo "--- disque du VPS ---"
df -h /
"@

& ssh -p $VpsPort $target $remote
if ($LASTEXITCODE -ne 0) { Die "L'import distant a échoué (voir le message ci-dessus)." }

# --------------------------------------------------------- 5. la trace ------
# Écrite SEULEMENT si tout est passé : un échec en cours de route doit laisser
# la date d'avant, sinon les fichiers de ce passage ne repartiraient jamais.
@{ lastRun = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
Remove-Item $archive, $sendList -ErrorAction SilentlyContinue

Write-Host "`n✅ Collection en ligne sur https://myplaylog.cc/collection" -ForegroundColor Green
