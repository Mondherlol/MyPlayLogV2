# 🎮 MyPlayLog

Ton journal de jeux vidéo — track, note et partage tes parties.
Stack : **React (Vite)** + **Node/Express** + **MongoDB**.

## Prérequis

- Node.js 18+ (testé sur v22)
- MongoDB installé et lancé en local (`mongodb://127.0.0.1:27017`)

## Lancer le projet

### Commande unique (recommandé)

Depuis la **racine** du projet :

```bash
npm run install:all   # première fois seulement (installe racine + server + client)
npm run dev           # démarre le back (nodemon) ET le front en même temps
```

- API : http://localhost:4000
- Site : **http://localhost:5173** ← à ouvrir dans le navigateur

Le back tourne sous **nodemon** : il redémarre tout seul à chaque modif du code serveur.
Pour tout arrêter : `Ctrl + C` dans le terminal.

### Ou séparément (2 terminaux)

```bash
cd server && npm run dev   # API sur :4000 (nodemon)
cd client && npm run dev   # site sur :5173
```

## Ce qui est en place

- 🎨 Landing page avec présentation des fonctionnalités
- 🌗 Thème clair / sombre (mémorisé), accents orange & jaune
- ✨ Ambiance rétro : curseur custom + éléments flottants
- 🔐 Inscription (email + identifiant + mot de passe min. 3 caractères)
- 🔐 Connexion par identifiant **ou** email + « se souvenir de moi »
- 🎉 Écran de bienvenue après connexion

## Structure

```
server/   API Express + MongoDB (auth JWT)
  src/models/User.js
  src/routes/auth.js
  src/middleware/auth.js
client/   App React (Vite)
  src/pages/       Landing, Login, Register, Welcome
  src/components/  Navbar, CustomCursor, Floaties, ThemeToggle
  src/context/     AuthContext, ThemeContext
```

## Config

- `server/.env` : port, URI Mongo, secret JWT
- Liaison Discord : `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` (application créée
  sur <https://discord.com/developers>, avec `<domaine>/api/discord/return` déclarée
  comme URL de redirection OAuth2)
- Bot du site : `GROQ_API_KEY` (gratuit, Llama 70B — c'est lui qui lui donne son caractère ; à défaut `GEMINI_API_KEY`, en moins mordant), `BOT_USERNAME` pour le rebaptiser.
  Le droit de lui parler se donne compte par compte depuis le panel d'admin.
- `client/.env` : `VITE_API_URL` (URL de l'API)
- `APP_RELEASE_TOKEN` (dans `server/.env`) : le secret qui autorise la
  publication de l'APK Android. **Sans lui, `POST /api/app/release` répond 503
  et aucune version ne peut être mise en ligne.** Il doit valoir exactement le
  `MPL_RELEASE_TOKEN` du dépôt mobile, d'où part `npm run update`.

## L'app Android

MyPlayLog n'est pas sur le Play Store : c'est ce serveur qui fait office de
magasin d'applications.

- `POST /api/app/release` reçoit un build (dépôt mobile, `npm run update`) et le
  range dans `uploads/app/` — donc dans le volume `uploads_data`, qui survit aux
  redéploiements — avec un manifeste `latest.json` à côté.
- `GET /api/app/latest` dit ce qui est publié. C'est ce que l'app interroge pour
  savoir si elle est à jour, et ce que lit la page `/download` du site.
- `GET /api/app/download` sert l'APK. **URL stable** : c'est elle qu'on partage,
  elle rend toujours le dernier build.

Côté site, la page publique `/download` (`client/src/pages/DownloadApp.jsx`)
explique l'installation hors magasin — sans quoi la moitié des gens abandonnent
devant l'avertissement d'Android.
