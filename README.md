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
- `client/.env` : `VITE_API_URL` (URL de l'API)
