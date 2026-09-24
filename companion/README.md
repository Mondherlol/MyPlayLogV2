# MyPlayLog Compagnon

Petite application Windows (barre des tâches) qui remonte sur MyPlayLog les
**succès** et le **temps de jeu** des jeux lancés hors de Steam, à partir des
fichiers que tiennent les émulateurs de succès.

- ~1 Mo, C# 5 / .NET Framework 4.8 (fourni avec Windows 10 et 11) : rien à installer.
  L'essentiel du poids, ce sont les polices du site embarquées (Space Grotesk, Inter).
- Se relie au compte avec un code à 6 chiffres (app : Réglages › Compagnon PC).
  Le PC reçoit son propre jeton, limité aux routes `/api/companion/*` et
  révocable depuis l'app.
- **Rien n'arrive sur le profil sans validation.** Tout ce qu'il trouve (jeux,
  succès, heures) attend sur le site, page `/companion` (Réglages › Imports ›
  Compagnon PC) : on confirme ou corrige le jeu reconnu, on écarte ce qui n'est
  pas un jeu, et l'historique permet d'annuler ou de rétablir chaque envoi.
  Mode automatique possible : les jeux DÉJÀ validés reçoivent alors la suite
  directement (toujours annulable) ; un jeu nouveau attend toujours.

## Ce qu'il repère

- **Les dossiers de jeux** (`D:\Games`, `C:\Jeux`… trouvés tout seuls au
  premier lancement, puis réglables dans la fenêtre › Jeux détectés) : chaque
  sous-dossier qui contient un exécutable de jeu est un jeu. Son appid Steam
  vient des fichiers de l'émulateur (`steam_appid.txt`, `steam_emu.ini`…) ; s'il
  n'y en a pas (émulateur Ubisoft `upc_r2`, jeu sans DRM…), c'est le NOM du
  dossier qui le fait reconnaître côté serveur (« Assassins Creed Black Flag
  Resynced » → la bonne fiche IGDB).
- **Les sauvegardes des émulateurs** (tableau plus bas) : un jeu lancé au moins
  une fois, même sans succès débloqué.
- **Le temps de jeu** de tout ce qui tourne depuis ces dossiers, appid ou pas.

## L'interface

Tout est peint à la main (`src/Ui`), aux couleurs du site : fond presque noir,
doré #f2b70b, Space Grotesk / Inter, icônes Lucide.

- **Fenêtre** (clic sur l'icône, ou relancer l'exe) : non relié, les six cases
  du code ; relié, le compte, le jeu en cours avec son chrono, les derniers
  succès, les émulateurs trouvés, Synchroniser, et les réglages. La croix range
  la fenêtre : le compagnon continue dans la barre des tâches.
- **Notifications** en bas à droite, façon Steam (« Succès débloqué » avec
  l'icône du succès, « En jeu », « Relié ») : elles ne prennent jamais le
  focus, un jeu en plein écran n'est pas dérangé.
- **Menu** (clic droit) sombre, coins arrondis sous Windows 11.

Les icônes sont des PNG blancs recolorés à la volée : `tools/make-glyphs.mjs`
(SVG depuis lucide-react-native) puis `make-glyphs.ps1` (rendu par Edge).
Polices et icônes sont embarquées dans l'exe par `build.ps1`.

## Compiler

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Produit `dist\MyPlayLogCompagnon.exe` et en copie un exemplaire dans
`client\public\downloads\`. C'est **le site** qui le distribue, sur
`https://myplaylog.cc/downloads/MyPlayLogCompagnon.exe` (boutons
« Télécharger » du site et de l'app) : le conteneur de l'API est construit à
partir de `./server` seul et ne voit pas ce dossier.
`make-icon.ps1` régénère `assets\icon.ico` depuis `assets\icon.png`
(l'icône du site, `client/public/pwa-icon.svg` rendue en 512 px).

## Ce qu'il lit

| Émulateur | Dossier | Fichier |
|---|---|---|
| Goldberg | `%AppData%\Goldberg SteamEmu Saves\<appid>` | `achievements.json` |
| GSE (gbe_fork) | `%AppData%\GSE Saves\<appid>` | `achievements.json` |
| EMPRESS | `%AppData%\EMPRESS`, `%Public%\Documents\EMPRESS` | `achievements.json` |
| CODEX | `%Public%\Documents\Steam\CODEX\<appid>`, `%AppData%\Steam\CODEX\<appid>` | `achievements.ini` |
| RUNE | `%Public%\Documents\Steam\RUNE\<appid>` | `achievements.ini` |
| OnlineFix | `%Public%\Documents\OnlineFix\<appid>` | `achievements.ini` |
| SKIDROW | `%LocalAppData%\SKIDROW\<appid>` | `achiev.ini` |

Les dossiers sont surveillés en continu : un succès débloqué part quelques
secondes plus tard (avec sa notification). Au démarrage, tout est
relu une fois ; seul ce qui n'a pas encore été envoyé repart.

**Temps de jeu** : toutes les 15 s, les processus en cours ; l'appid est lu à
côté de l'exécutable (ou jusqu'à deux dossiers au-dessus) dans
`steam_appid.txt`, `steam_settings\steam_appid.txt`, `steam_emu.ini`,
`cream_api.ini`, `OnlineFix.ini`… Envoi toutes les 5 minutes et à la fermeture
du jeu, par morceaux identifiés (un renvoi après coupure ne compte pas double).
Les jeux lancés depuis une bibliothèque Steam (`steamapps`) sont ignorés :
l'import Steam les couvre déjà.

## Côté serveur

`server/src/routes/companion.js`, logique dans `server/src/lib/companion.js` :

- compagnon : `/pair`, `/games` (jeux trouvés → « à valider », rend l'état de
  chacun), `/achievements`, `/playtime`, `/recent`, `/me`, `/unlink` ;
- site : `/code`, `/devices` (+ nombre à valider), `/review` (tout d'un coup),
  `/games/:id/validate|ignore|reject|restore|remove`,
  `/events/:id/undo|apply|reject`, `PUT /settings` (mode automatique).

Chaque envoi devient un `CompanionEvent` (en attente, appliqué, annulé,
refusé ; les envois rapprochés d'un même jeu se regroupent), rattaché à un
`CompanionGame` (en attente, validé, écarté). Appliquer : succès dans
`GameAchievements` (plateforme `local`, « PC · hors boutique », hors
classements), heures dans `UserGame`, jeu dans la bibliothèque (« hors
boutique »). Annuler défait exactement ça.

## Tester contre un serveur local

```powershell
dist\MyPlayLogCompagnon.exe --api http://localhost:4000/api --data C:\temp\mpl-test
```

`--data` prend une config à part : la vraie n'est pas touchée, ni le démarrage
avec Windows, et il peut tourner à côté du vrai compagnon. `--tray` (ajouté
par la clé « lancer avec Windows ») : démarre sans ouvrir la fenêtre.

La configuration (jeton, envois en attente) vit dans
`%AppData%\MyPlayLog\compagnon.json`.
