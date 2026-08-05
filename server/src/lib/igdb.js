// Client IGDB (via Twitch OAuth).
// Le token d'app est récupéré puis mis en cache (mémoire + fichier) jusqu'à
// expiration, pour éviter d'en redemander un à chaque redémarrage du serveur.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, "../../.igdb-token.json");

let cachedToken = null;
let tokenExpiry = 0;

// Au démarrage, on tente de recharger un token encore valide depuis le disque.
try {
  const raw = fs.readFileSync(CACHE_FILE, "utf8");
  const saved = JSON.parse(raw);
  if (saved.token && saved.expiry && Date.now() < saved.expiry - 60_000) {
    cachedToken = saved.token;
    tokenExpiry = saved.expiry;
  }
} catch {
  /* pas de cache disque : normal au premier lancement */
}

function saveToken() {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ token: cachedToken, expiry: tokenExpiry })
    );
  } catch {
    /* écriture best-effort, non bloquant */
  }
}

function isConfigured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function getToken() {
  if (!isConfigured()) {
    const err = new Error(
      "IGDB n'est pas configuré (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants dans server/.env)."
    );
    err.status = 503;
    throw err;
  }

  // Réutilise le token tant qu'il reste > 1 min de validité
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = new Error("Échec de l'authentification Twitch/IGDB (clés invalides ?).");
    err.status = 502;
    throw err;
  }

  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiry = Date.now() + json.expires_in * 1000;
  saveToken();
  return cachedToken;
}

// Invalide le token en cache (mémoire + disque) : appelé quand IGDB le rejette
// (401) alors que sa date d'expiration n'est pas encore atteinte — cas d'un
// token révoqué côté Twitch (ex: un nouveau token généré ailleurs).
function invalidateToken() {
  cachedToken = null;
  tokenExpiry = 0;
  try {
    fs.rmSync(CACHE_FILE, { force: true });
  } catch {
    /* best-effort */
  }
}

async function igdbFetch(endpoint, body, token) {
  return fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body,
  });
}

// Exécute une requête Apicalypse sur un endpoint IGDB (ex: "games").
export async function igdbQuery(endpoint, body) {
  let token = await getToken();
  let res = await igdbFetch(endpoint, body, token);

  // Token rejeté (révoqué) : on l'invalide et on réessaie une fois avec un neuf.
  if (res.status === 401) {
    invalidateToken();
    token = await getToken();
    res = await igdbFetch(endpoint, body, token);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Erreur IGDB (${res.status}). ${text}`.trim());
    err.status = 502;
    throw err;
  }
  return res.json();
}

// Jeton d'app Twitch (client_credentials) réutilisable pour l'API Helix
// (streams live) : mêmes identifiants que pour IGDB, aucune clé supplémentaire.
export async function getTwitchToken() {
  return getToken();
}

export { isConfigured };
