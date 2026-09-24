# MyPlayLog Compagnon

Petite application Windows (barre des tâches) qui remonte sur MyPlayLog les
**succès** et le **temps de jeu** des jeux lancés hors de Steam, à partir des
fichiers que tiennent les émulateurs de succès.

- ~120 Ko, C# 5 / .NET Framework 4.8 (fourni avec Windows 10 et 11) : rien à installer.
- Se relie au compte avec un code à 6 chiffres (app : Réglages › Compagnon PC).
  Le PC reçoit son propre jeton, limité aux routes `/api/companion/*` et
  révocable depuis l'app.

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
secondes plus tard (avec une notification Windows). Au démarrage, tout est
relu une fois ; seul ce qui n'a pas encore été envoyé repart.

**Temps de jeu** : toutes les 15 s, les processus en cours ; l'appid est lu à
côté de l'exécutable (ou jusqu'à deux dossiers au-dessus) dans
`steam_appid.txt`, `steam_settings\steam_appid.txt`, `steam_emu.ini`,
`cream_api.ini`, `OnlineFix.ini`… Envoi toutes les 5 minutes et à la fermeture
du jeu, par morceaux identifiés (un renvoi après coupure ne compte pas double).
Les jeux lancés depuis une bibliothèque Steam (`steamapps`) sont ignorés :
l'import Steam les couvre déjà.

## Côté serveur

`server/src/routes/companion.js` : `/code` (app) → `/pair` (compagnon) →
`/achievements`, `/playtime`, `/me`, `/unlink` ; `/devices` (app). Les succès
sont rangés sur la plateforme `local` de `GameAchievements`, affichés
« PC · hors boutique », et exclus des classements (ils sont déclaratifs).
Le jeu entre dans la bibliothèque au premier envoi : « en cours », PC,
boutique « hors boutique ».

## Tester contre un serveur local

```powershell
dist\MyPlayLogCompagnon.exe --api http://localhost:4000/api
```

La configuration (jeton, envois en attente) vit dans
`%AppData%\MyPlayLog\compagnon.json`.
