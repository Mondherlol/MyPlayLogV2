# ======================================================================
#  Envoi de la Collection locale vers le site (VPS)
# ======================================================================
# Lancé par upload-collection.bat, à la racine du dépôt. Quatre étapes, dans
# l'ordre, et on s'arrête à la première erreur :
#
#   1. exporte le catalogue de la base LOCALE (npm run collection:export) ;
#   2. fabrique une archive des fichiers d'upload que ce catalogue référence
#      VRAIMENT — et seulement ceux qui ont changé depuis le dernier envoi ;
#   3. dépose les deux sur le VPS (scp) ;
#   4. les verse dans le conteneur, puis y rejoue l'import (upsert par slug).
#
# ------------------------------------------------ CHAQUE ÉTAPE SE REPREND ----
# LE CAS QUI A COÛTÉ ONZE MINUTES POUR RIEN : les 2 Go étaient arrivés à bon
# port, et c'est l'import (étape 4) qui a lâché — la seule qui dure trois
# secondes. Relancer le script tel quel, c'était refaire l'archive ET repousser
# les 2 Go pour rejouer ces trois secondes.
#
#   -Resume    reprend DIRECTEMENT à l'étape 4. Rien n'est réexporté, rien
#              n'est réarchivé, rien n'est renvoyé : le script suppose que ce
#              qu'il faut est déjà sur le VPS (c'est le cas dès que l'étape 3
#              est allée au bout).
#   -NoFiles   saute les fichiers et n'envoie que le catalogue. C'est le cas
#              courant quand on n'a fait que corriger des fiches.
#
# Et même sans drapeau, L'ARCHIVE N'EST PLUS REFAITE POUR RIEN : si celle du
# passage précédent est encore là et que la liste des fichiers n'a pas bougé,
# elle est réutilisée telle quelle (voir $listStamp).
#
# ------------------------------------------------ pourquoi l'incrémental -----
# Le rayon papier pèse 2 Go de planches qui ne changent jamais une fois
# extraites. Repousser le tout à chaque ajout d'une série, c'est vingt minutes
# de téléversement pour trois jaquettes. On garde donc la date du dernier envoi
# réussi (.upload-collection-state.json) et on n'emporte que les fichiers plus
# récents. `-All` refait tout, pour le premier envoi ou quand on doute de ce
# qu'il y a en face.
#
# Le script d'import est recopié dans le conteneur à chaque passage : sans ça,
# il faudrait avoir poussé et redéployé le dépôt avant de pouvoir importer
# quoi que ce soit — l'image de prod ne contient que le code de son build.

param(
  # Reprendre à l'étape 4 : l'import seul, sur ce qui est déjà là-bas.
  [switch]$Resume,
  # N'envoyer que le catalogue, sans les fichiers.
  [switch]$NoFiles,
  # Refaire un envoi complet des fichiers (ignore la date du dernier envoi).
  [switch]$All,
  # Poser sa clé SSH sur le VPS, une fois pour toutes — voir plus bas.
  [switch]$InstallKey,
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
$listStamp = Join-Path $PSScriptRoot ".upload-collection-sent.txt"
$catalog = Join-Path $root "server\collection-catalog.json"
$listFile = Join-Path $root "server\collection-catalog-files.txt"
$uploads = Join-Path $root "server\uploads"
$archive = Join-Path $env:TEMP "collection-files.tgz"
$sendList = Join-Path $env:TEMP "collection-send.txt"
$target = "$VpsUser@$VpsHost"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Skip($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor DarkGray }
function Die($msg) { Write-Host "`n❌ $msg" -ForegroundColor Red; exit 1 }

foreach ($exe in @("node", "npm", "ssh", "scp", "tar")) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    Die "« $exe » est introuvable. Installe-le (ou ouvre un nouveau terminal) et recommence."
  }
}

# ============================================================
#  -InstallKey — le mot de passe, une dernière fois
# ============================================================
# CE N'EST PAS UN CONFORT, C'EST LA CAUSE DES PANNES. Le script ouvre DEUX
# connexions (le transfert, puis l'import), donc deux mots de passe ; et un VPS
# qui voit passer plusieurs authentifications par mot de passe rapprochées les
# refuse (fail2ban, MaxStartups) — d'où le « Connection closed by … port 22 »
# qui tombe précisément sur la seconde, après onze minutes de transfert.
#
# Avec une clé, plus aucun mot de passe, et plus aucune de ces coupures.
if ($InstallKey) {
  $key = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
  if (-not (Test-Path $key)) {
    Write-Host "Fabrication d'une clé SSH ($key)…" -ForegroundColor Cyan
    & ssh-keygen -t ed25519 -N '""' -C "myplaylog-upload" -f $key
    if ($LASTEXITCODE -ne 0) { Die "La fabrication de la clé a échoué." }
  }
  $pub = (Get-Content "$key.pub" -Raw).Trim()
  Write-Host "Dépôt de la clé sur $target (mot de passe demandé une dernière fois)…"
  # `grep -qxF` : la clé n'est ajoutée que si elle n'y est pas déjà — relancer
  # cette commande ne doit pas empiler dix fois la même ligne.
  $cmd = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys"
  & ssh -p $VpsPort $target $cmd
  if ($LASTEXITCODE -ne 0) { Die "Le dépôt de la clé a échoué." }
  Write-Host "`n✅ Clé posée. Les prochains envois ne demanderont plus rien." -ForegroundColor Green
  exit 0
}

# Ce qu'on fait de ce passage-ci. `-Resume` coupe court à tout ce qui précède
# l'import : c'est le drapeau de la reprise après une panne d'étape 4.
$doExport = -not $Resume
$doFiles = -not $Resume -and -not $NoFiles
$doSend = -not $Resume

# --------------------------------------------------------- 1. l'export ------
if ($doExport) {
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
} else {
  Skip 1 "Export sauté (-Resume) : on reprend ce qui est déjà sur le VPS."
}

# --------------------------------------------------- 2. les fichiers --------
$hasFiles = $false
if ($doFiles) {
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
    # bsdtar veut ses chemins en avant-slash, relatifs au dossier -C — et la
    # liste SANS marque d'ordre d'octets : `Set-Content -Encoding utf8` en pose
    # une sous PowerShell 5, et bsdtar la lit comme faisant partie du premier
    # nom de fichier (vu à l'essai : « Couldn't visit directory »).
    $body = ($send -join "`n")
    [System.IO.File]::WriteAllText($sendList, $body, (New-Object System.Text.UTF8Encoding($false)))

    # L'ARCHIVE DU PASSAGE PRÉCÉDENT, SI ELLE VAUT ENCORE. Onze minutes de
    # compression pour 2 Go : la refaire à l'identique après un échec de
    # transfert est le genre d'attente qui décourage de réessayer. On garde
    # donc l'empreinte de la liste envoyée, et on ne recommence que si elle a
    # changé.
    $sameList = (Test-Path $archive) -and (Test-Path $listStamp) -and
      ((Get-Content $listStamp -Raw) -eq $body)
    if ($sameList) {
      Step 2 "Archive du passage précédent réutilisée ($([math]::Round((Get-Item $archive).Length / 1MB, 1)) Mo)."
    } else {
      Step 2 "Fabrication de l'archive…"
      & tar -czf $archive -C $uploads -T $sendList
      if ($LASTEXITCODE -ne 0) { Die "La fabrication de l'archive a échoué." }
      [System.IO.File]::WriteAllText($listStamp, $body, (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "    Archive : $([math]::Round((Get-Item $archive).Length / 1MB, 1)) Mo compressés."
    }
  }
} elseif ($NoFiles) {
  Skip 2 "Fichiers sautés (-NoFiles) : seul le catalogue part."
} else {
  Skip 2 "Archive sautée (-Resume) : celle du VPS sera reprise si elle y est."
}

# ------------------------------------------------------- 3. le transfert ----
if ($doSend) {
  Step 3 "Transfert vers $target…"
  $payload = @($catalog, (Join-Path $root "server\src\scripts\collectionCatalog.js"))
  if ($hasFiles) { $payload += $archive }
  & scp -P $VpsPort $payload "${target}:$VpsPath/"
  if ($LASTEXITCODE -ne 0) {
    Die @"
Le transfert a échoué (mot de passe, réseau ou chemin distant).
Si l'archive était déjà partie, relance avec -Resume pour ne pas la repousser :
    upload-collection.bat -Resume
"@
  }
} else {
  Skip 3 "Transfert sauté (-Resume)."
}

# ------------------------------------------------------- 4. l'import --------
Step 4 "Import sur le VPS…"

# L'ARCHIVE EST CHERCHÉE SUR PLACE, PAS DEVINÉE ICI. Le script n'a aucun moyen
# fiable de savoir ce qui a survécu à un transfert interrompu ; le VPS, lui, n'a
# qu'à regarder si le fichier est là. C'est ce qui rend `-Resume` sûr : reprise
# ou pas, la même commande fait ce qu'il faut.
$remote = @"
set -e
cd $VpsPath
docker compose cp collection-catalog.json server:/app/collection-catalog.json
docker compose cp collectionCatalog.js server:/app/src/scripts/collectionCatalog.js
if [ -f collection-files.tgz ]; then
  echo "--- versement des fichiers ---"
  docker compose cp collection-files.tgz server:/tmp/collection-files.tgz
  docker compose exec -T server tar xzf /tmp/collection-files.tgz -C /app/uploads
  docker compose exec -T server rm -f /tmp/collection-files.tgz
else
  echo "--- aucune archive a verser ---"
fi
docker compose exec -T server node src/scripts/collectionCatalog.js --import
rm -f collection-catalog.json collection-files.tgz collectionCatalog.js
echo "--- disque du VPS ---"
df -h /
"@

& ssh -p $VpsPort $target $remote
if ($LASTEXITCODE -ne 0) {
  Die @"
L'import distant a échoué (voir le message ci-dessus).
Tout est déjà sur le VPS : reprends à cette étape seule, sans rien repousser :
    upload-collection.bat -Resume
"@
}

# --------------------------------------------------------- 5. la trace ------
# Écrite SEULEMENT si tout est passé : un échec en cours de route doit laisser
# la date d'avant, sinon les fichiers de ce passage ne repartiraient jamais.
@{ lastRun = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
# L'archive locale a fait son office : elle ne sert plus qu'à occuper 2 Go du
# disque, et son empreinte n'a plus rien à rattraper.
Remove-Item $archive, $sendList, $listStamp -ErrorAction SilentlyContinue

Write-Host "`n✅ Collection en ligne sur https://myplaylog.cc/collection" -ForegroundColor Green
