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

// ---------------------------------------------------------------------------
//  La file d'attente vers IGDB
// ---------------------------------------------------------------------------
// IGDB accepte QUATRE requêtes par seconde et huit simultanées par identifiant.
// Au-delà, il répond 429 — et comme un 429 remontait ici en erreur 502, une
// fiche ne s'affichait pas. Le cache (lib/gameIgdb.js) évite l'essentiel des
// appels ; cette file s'occupe de ceux qui restent : remplissage initial du
// cache, recherches, calendrier des sorties, scripts d'import.
//
// Deux garde-fous : un espacement minimum entre deux départs (donc ≤ 4/s), et
// un plafond de requêtes en vol. Une file trop longue échoue vite plutôt que de
// faire attendre tout le monde plusieurs minutes.
const MIN_GAP_MS = 260; // un peu plus que 250 ms : marge sur la mesure d'IGDB
const MAX_CONCURRENT = 6; // sous les 8 autorisées
const MAX_QUEUE = 300;

let active = 0;
let lastStart = 0;
let timer = null;
const waiting = [];

function pump() {
  if (timer || !waiting.length || active >= MAX_CONCURRENT) return;
  const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => {
    timer = null;
    const next = waiting.shift();
    if (next) {
      active++;
      lastStart = Date.now();
      next();
    }
    pump();
  }, wait);
}

// Prend un jeton de passage. Rendu par `release()`, quoi qu'il arrive.
function acquire() {
  if (waiting.length >= MAX_QUEUE) {
    const err = new Error("IGDB est saturé (file d'attente pleine). Réessaie dans un instant.");
    err.status = 503;
    return Promise.reject(err);
  }
  return new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });
}

function release() {
  active = Math.max(0, active - 1);
  pump();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Combien attendre après un 429 : ce qu'IGDB demande s'il le dit, sinon un
// recul qui double à chaque tentative.
function backoffMs(res, attempt) {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 4_000);
}

/** L'état de la file, pour le panel admin / le diagnostic. */
export function igdbQueueStats() {
  return { active, waiting: waiting.length, maxConcurrent: MAX_CONCURRENT, maxQueue: MAX_QUEUE };
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
// Passe par la file : jamais plus de 4 départs par seconde, jamais plus de 6
// requêtes en vol, et un 429 est attendu puis retenté au lieu d'échouer.
export async function igdbQuery(endpoint, body) {
  await acquire();
  try {
    let token = await getToken();
    let res = await igdbFetch(endpoint, body, token);

    // Token rejeté (révoqué) : on l'invalide et on réessaie une fois avec un neuf.
    if (res.status === 401) {
      invalidateToken();
      token = await getToken();
      res = await igdbFetch(endpoint, body, token);
    }

    // Trop de requêtes : on garde notre place dans la file (donc on freine tout
    // le monde, c'est voulu) le temps qu'IGDB se calme.
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
      await sleep(backoffMs(res, attempt));
      res = await igdbFetch(endpoint, body, token);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Erreur IGDB (${res.status}). ${text}`.trim());
      // 429 après trois tentatives : ce n'est pas « IGDB est cassé », c'est
      // « on tape trop fort » — le 503 le dit, et invite à réessayer.
      err.status = res.status === 429 ? 503 : 502;
      throw err;
    }
    return res.json();
  } finally {
    release();
  }
}

// Jeton d'app Twitch (client_credentials) réutilisable pour l'API Helix
// (streams live) : mêmes identifiants que pour IGDB, aucune clé supplémentaire.
export async function getTwitchToken() {
  return getToken();
}

export { isConfigured };
