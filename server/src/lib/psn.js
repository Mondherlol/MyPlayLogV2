// Intégration PSN (API non officielle, via la lib psn-api).
//
// Modèle « compte de service » (comme PSNProfiles / Infinite Backlog) : le
// serveur possède UN SEUL compte PSN authentifié une fois par l'admin (via un
// NPSSO placé dans server/.env → PSN_NPSSO). Ce compte sert ensuite à lire les
// jeux et trophées PUBLICS de n'importe quel joueur à partir de son PSN ID.
// L'utilisateur n'a donc qu'à fournir son identifiant en ligne (et rendre son
// profil + ses trophées publics).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getUserTitles,
  getUserPlayedGames,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
  makeUniversalSearch,
} from "psn-api";
import { igdbQuery } from "./igdb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, "../../.psn-token.json");

const auth = (accessToken) => ({ accessToken });

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
// Modes de jeu IGDB considérés « sans fin » (multi/MMO/battle royale) : mêmes
// ids que la modale d'ajout / l'import Steam → statut « Sans fin » suggéré.
const ENDLESS_MODES = [2, 5, 6];

// Consoles PlayStation (id plateforme IGDB -> libellés). Ordonnées de la plus
// récente à la plus ancienne. Sert à proposer la console d'un jeu à l'import et
// à repérer un mauvais mapping (jeu absent des 3 consoles → « à reconnaître »).
const PS_CONSOLES = [
  { id: 167, label: "PS5", name: "PlayStation 5" },
  { id: 48, label: "PS4", name: "PlayStation 4" },
  { id: 9, label: "PS3", name: "PlayStation 3" },
];

// Devine la console jouée à partir des métadonnées PSN : catégorie de l'historique
// de jeu (« ps5_native_game », « ps4_game »…) en priorité, sinon plateforme du set
// de trophées (« PS5 », « PS4,PSVITA »…). Renvoie un nom IGDB ou null.
export function detectPsnConsole(playedCategory, trophyPlatform) {
  const cat = String(playedCategory || "").toLowerCase();
  if (cat.includes("ps5")) return "PlayStation 5";
  if (cat.includes("ps4")) return "PlayStation 4";
  if (cat.includes("ps3")) return "PlayStation 3";
  const tp = String(trophyPlatform || "").toUpperCase();
  if (tp.includes("PS5")) return "PlayStation 5";
  if (tp.includes("PS4")) return "PlayStation 4";
  if (tp.includes("PS3")) return "PlayStation 3";
  return null;
}

// « Configuré » = le serveur peut obtenir un token de service, soit via un NPSSO
// en variable d'environnement (PSN_NPSSO), soit via des tokens de service déjà
// établis par l'admin au runtime (refresh token encore valide, persisté disque).
export function isConfigured() {
  if (process.env.PSN_NPSSO) return true;
  return Boolean(
    serviceTokens?.refreshToken && Date.now() < serviceTokens.refreshExpiresAt
  );
}

// ---------------------------------------------------------------------------
// Tokens du compte de service (globaux, jamais liés à un utilisateur)
// ---------------------------------------------------------------------------

// { accessToken, refreshToken, expiresAt, refreshExpiresAt }
let serviceTokens = null;

// Au démarrage, on tente de recharger des tokens de service encore valides.
try {
  const saved = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  if (saved?.refreshToken && saved.refreshExpiresAt > Date.now()) serviceTokens = saved;
} catch {
  /* pas de cache disque : normal au premier lancement */
}

// Transforme la réponse d'auth psn-api en objet stockable (dates absolues, avec
// 60 s de marge pour rafraîchir avant expiration réelle).
function toStored(a, connectedAt = null) {
  const now = Date.now();
  return {
    accessToken: a.accessToken,
    refreshToken: a.refreshToken,
    expiresAt: now + (a.expiresIn - 60) * 1000,
    refreshExpiresAt: now + (a.refreshTokenExpiresIn - 60) * 1000,
    // Date de connexion via l'UI admin (préservée à travers les refresh) ; null
    // quand la source est la variable d'env PSN_NPSSO.
    connectedAt,
  };
}

function saveTokens() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(serviceTokens));
  } catch {
    /* écriture best-effort, non bloquant */
  }
}

async function obtainTokens() {
  const now = Date.now();
  // 1) Refresh token encore valide : on rafraîchit sans re-demander de NPSSO.
  //    On conserve la date de connexion établie par l'admin.
  if (serviceTokens?.refreshToken && now < serviceTokens.refreshExpiresAt) {
    try {
      return toStored(
        await exchangeRefreshTokenForAuthTokens(serviceTokens.refreshToken),
        serviceTokens.connectedAt || null
      );
    } catch {
      /* refresh périmé côté Sony malgré tout : on retombe sur le NPSSO d'env */
    }
  }
  // 2) Sinon : échange du NPSSO d'environnement (valable ~2 mois). Absent quand le
  //    compte a été connecté au runtime via l'UI admin → il faut re-coller un NPSSO.
  const npsso = String(process.env.PSN_NPSSO || "").trim();
  if (!npsso) {
    const err = new Error(
      "PSN non connecté : aucun NPSSO valide (ni au runtime, ni dans PSN_NPSSO)."
    );
    err.status = 503;
    throw err;
  }
  const code = await exchangeNpssoForAccessCode(npsso);
  return toStored(await exchangeAccessCodeForAuthTokens(code));
}

// Verrou simple : évite les échanges de tokens concurrents.
let refreshing = null;

// Renvoie un access token de service valide (rafraîchi / réobtenu si besoin).
// Lève une erreur 503 si le compte de service n'est pas configuré (ni NPSSO
// d'environnement, ni connexion runtime valide).
export async function getServiceAccessToken() {
  if (!isConfigured()) {
    const err = new Error(
      "PSN n'est pas configuré (NPSSO manquant : PSN_NPSSO ou connexion admin)."
    );
    err.status = 503;
    throw err;
  }
  if (serviceTokens?.accessToken && Date.now() < serviceTokens.expiresAt) {
    return serviceTokens.accessToken;
  }
  if (!refreshing) {
    refreshing = obtainTokens()
      .then((t) => {
        serviceTokens = t;
        saveTokens();
        return t.accessToken;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

// ---------------------------------------------------------------------------
// Configuration du compte de service au runtime (UI admin)
// ---------------------------------------------------------------------------

// Connecte le compte de service à partir d'un NPSSO collé par l'admin : échange
// le NPSSO contre des tokens, les stocke en mémoire + sur disque. Permet de faire
// tourner le NPSSO (valable ~2 mois) sans redéploiement. Lève si le NPSSO est
// invalide. Renvoie le nouveau statut.
export async function setServiceNpsso(npsso) {
  const val = String(npsso || "").trim();
  if (!val) throw new Error("NPSSO manquant.");
  const code = await exchangeNpssoForAccessCode(val);
  serviceTokens = toStored(await exchangeAccessCodeForAuthTokens(code), Date.now());
  saveTokens();
  return getServiceStatus();
}

// Statut du compte de service pour l'UI admin. « connected » vrai si on peut
// obtenir un token (tokens runtime valides ou NPSSO d'env présent).
export function getServiceStatus() {
  const now = Date.now();
  const refreshValid = Boolean(
    serviceTokens?.refreshToken && now < serviceTokens.refreshExpiresAt
  );
  const envConfigured = Boolean(process.env.PSN_NPSSO);
  return {
    connected: refreshValid || envConfigured,
    // « expiré » : on avait une connexion runtime mais son refresh token a expiré,
    // et aucun NPSSO d'env ne prend le relais → l'admin doit re-coller un NPSSO.
    expired: Boolean(serviceTokens?.refreshToken) && !refreshValid && !envConfigured,
    connectedAt: serviceTokens?.connectedAt || null,
    source: refreshValid ? "runtime" : envConfigured ? "env" : null,
  };
}

// Déconnecte le compte de service connecté au runtime (efface tokens + cache).
// Note : si PSN_NPSSO est défini dans l'environnement, il reste la source active.
export function clearServiceTokens() {
  serviceTokens = null;
  refreshing = null;
  try {
    fs.unlinkSync(CACHE_FILE);
  } catch {
    /* pas de cache disque : rien à supprimer */
  }
}

// ---------------------------------------------------------------------------
// Résolution d'un PSN ID + lecture des jeux / trophées d'un compte
// ---------------------------------------------------------------------------

// Résout un identifiant en ligne (PSN ID) en { accountId, onlineId, avatar }.
// Renvoie null si aucun compte ne correspond.
export async function resolveOnlineId(accessToken, onlineId) {
  const term = String(onlineId || "").trim();
  if (!term) return null;
  const res = await makeUniversalSearch(auth(accessToken), term, "SocialAllAccounts");
  const results = res?.domainResponses?.[0]?.results || [];
  if (!results.length) {
    // Sony a répondu mais sans résultat : soit l'ID n'existe pas, soit la
    // recherche est filtrée depuis cette IP/région (fréquent sur un VPS).
    console.warn("psn resolveOnlineId: 0 résultat pour", term);
    return null;
  }
  const norm = (s) => String(s || "").toLowerCase();
  const exact = results.find((r) => norm(r.socialMetadata?.onlineId) === norm(term));
  const m = (exact || results[0]).socialMetadata;
  if (!m?.accountId) return null;
  return {
    accountId: m.accountId,
    onlineId: m.onlineId || term,
    avatar: m.avatarUrl || null,
  };
}

// Vérifie que la liste de trophées d'un compte est lisible (profil public).
export async function checkTrophiesPublic(accessToken, accountId) {
  try {
    await getUserTitles(auth(accessToken), accountId, { limit: 1 });
    return true;
  } catch {
    return false;
  }
}

// Liste des titres (jeux) pour lesquels le compte a des trophées.
export async function fetchUserTitles(accessToken, accountId) {
  const all = [];
  let offset = 0;
  for (let i = 0; i < 8; i++) {
    const res = await getUserTitles(auth(accessToken), accountId, { limit: 100, offset });
    const titles = res.trophyTitles || [];
    all.push(...titles);
    if (titles.length < 100 || all.length >= 800) break;
    offset += 100;
  }
  return all;
}

// Convertit une durée ISO 8601 ("PT138H26M52S") en minutes.
function iso8601ToMinutes(str) {
  if (!str) return 0;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i.exec(str);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  return Math.round(h * 60 + min + s / 60);
}

// Historique des jeux joués (avec temps de jeu réel). Nécessite que l'historique
// de jeu du compte soit public ; renvoie [] sinon (on se rabat sur les trophées).
export async function fetchPlayedGames(accessToken, accountId) {
  const all = [];
  let offset = 0;
  for (let i = 0; i < 5; i++) {
    const res = await getUserPlayedGames(auth(accessToken), accountId, { limit: 200, offset });
    const titles = res.titles || [];
    all.push(...titles);
    if (titles.length < 200 || all.length >= 800) break;
    offset += 200;
  }
  return all.map((t) => ({
    titleId: t.titleId,
    name: t.localizedName || t.name || "",
    icon: t.localizedImageUrl || t.imageUrl || null,
    category: t.category || null,
    playMinutes: iso8601ToMinutes(t.playDuration),
    lastPlayed: t.lastPlayedDateTime || null,
    conceptId: t.concept?.id || null,
  }));
}

// Trophées d'un titre (définitions + statut gagné/pas gagné fusionnés).
export async function fetchTitleTrophies(accessToken, npCommunicationId, npServiceName, accountId) {
  const opts = npServiceName ? { npServiceName } : {};
  const [defs, earned] = await Promise.all([
    getTitleTrophies(auth(accessToken), npCommunicationId, "all", opts),
    getUserTrophiesEarnedForTitle(
      auth(accessToken),
      accountId,
      npCommunicationId,
      "all",
      opts
    ).catch(() => null),
  ]);
  const earnedMap = new Map((earned?.trophies || []).map((t) => [t.trophyId, t]));
  return (defs.trophies || []).map((t) => {
    const e = earnedMap.get(t.trophyId) || {};
    return {
      id: t.trophyId,
      name: t.trophyName || "",
      detail: t.trophyDetail || "",
      icon: t.trophyIconUrl || null,
      type: t.trophyType || "bronze", // bronze|silver|gold|platinum
      hidden: !!t.trophyHidden,
      earned: !!e.earned,
      earnedAt: e.earnedDateTime || null,
      percent:
        e.trophyEarnedRate != null
          ? Math.round(Number(e.trophyEarnedRate) * 10) / 10
          : null,
    };
  });
}

// Nombre total de trophées définis pour un titre (tous grades confondus).
export function sumTrophies(counts) {
  if (!counts) return 0;
  return (
    (counts.bronze || 0) +
    (counts.silver || 0) +
    (counts.gold || 0) +
    (counts.platinum || 0)
  );
}

// ---------------------------------------------------------------------------
// Matching titres PSN -> jeu IGDB (par NOM : PSN ne fournit pas d'identifiant
// mappable comme l'appid Steam).
// ---------------------------------------------------------------------------

// Clé de comparaison : minuscule, sans symboles ni ponctuation (robuste aux
// ™/®, tirets, éditions écrites différemment…).
export function simplifyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[™®©℠]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function pool(items, size, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

function toIgdbRow(g) {
  const platIds = new Set(g.platforms || []);
  return {
    gameId: g.id,
    name: g.name,
    cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
    endless: (g.game_modes || []).some((m) => ENDLESS_MODES.includes(m)),
    // Consoles PlayStation sur lesquelles ce jeu est sorti (vide = pas une sortie
    // PS3/PS4/PS5 → mapping suspect côté PSN).
    consoles: PS_CONSOLES.filter((c) => platIds.has(c.id)).map((c) => ({
      label: c.label,
      name: c.name,
    })),
  };
}

// Pour une liste de noms de jeux, renvoie une Map simplifyName(nom) ->
// { gameId, name, cover, endless }. Deux passes : correspondance de nom exacte
// par paquets (rapide), puis recherche IGDB pour les noms restants.
export async function matchNamesToIgdb(names) {
  const out = new Map();
  const uniq = [...new Set(names.map((n) => (n || "").trim()).filter(Boolean))];
  if (!uniq.length) return out;

  // 1) Passe rapide : where name = (...), par paquets (correspondance exacte).
  for (let i = 0; i < uniq.length; i += 150) {
    const chunk = uniq.slice(i, i + 150);
    const list = chunk.map((n) => `"${n.replace(/["\\]/g, "")}"`).join(",");
    const rows = await igdbQuery(
      "games",
      `fields name,cover.image_id,game_modes,platforms,version_parent; where name = (${list}); limit 500;`
    ).catch(() => []);
    for (const r of rows) {
      const k = simplifyName(r.name);
      if (!k) continue;
      // On préfère un jeu de base avec jaquette (évite une édition sans cover).
      const prev = out.get(k);
      if (!prev || (!prev.cover && r.cover)) out.set(k, toIgdbRow(r));
    }
  }

  // 2) Repli : recherche IGDB pour les noms non résolus (concurrence limitée).
  const pending = uniq.filter((n) => !out.has(simplifyName(n)));
  await pool(pending, 4, async (name) => {
    const q = name.replace(/["\\]/g, "").replace(/[™®©℠]/g, "").trim();
    if (!q) return;
    const rows = await igdbQuery(
      "games",
      `search "${q}"; fields name,cover.image_id,game_modes,platforms,version_parent; limit 8;`
    ).catch(() => []);
    if (!rows.length) return;
    const target = simplifyName(name);
    const bases = rows.filter((r) => !r.version_parent);
    const pick =
      bases.find((r) => simplifyName(r.name) === target) ||
      rows.find((r) => simplifyName(r.name) === target) ||
      bases.find((r) => r.cover) ||
      bases[0] ||
      rows[0];
    if (pick) out.set(target, toIgdbRow(pick));
  });

  return out;
}

// ---------------------------------------------------------------------------
// Import COMPLET pour le worker maison (contourne le blocage Akamai du VPS).
// Le worker appelle buildPsnImportData depuis une IP résidentielle et renvoie
// le résultat au VPS, qui n'a plus qu'à l'écrire en base. Fonctions PURES : pas
// d'accès à la base MyPlayLog.
// ---------------------------------------------------------------------------

// Au-delà de ce temps de jeu, un jeu non catalogué est suggéré « Terminé ».
const FINISHED_HOURS = 30;

// Mappe les trophées psn-api vers la forme stockée dans GameAchievements.
export function mapTrophies(trophies) {
  return (trophies || []).map((t) => ({
    apiName: String(t.id),
    name: t.name,
    description: t.detail,
    icon: t.icon,
    hidden: t.hidden,
    unlocked: t.earned,
    unlockedAt: t.earnedAt ? new Date(t.earnedAt) : null,
    rarity: t.percent,
    tier: t.type,
  }));
}

// Fusionne l'historique joué (temps) et la liste de trophées (progression) par
// nom simplifié. Pure (sans DB) : cumule le temps entre versions PS4/PS5.
function mergePlayedAndTitles(played, titles) {
  const merged = new Map();
  for (const p of played) {
    const key = simplifyName(p.name);
    if (!key) continue;
    const cur = merged.get(key);
    if (cur) {
      cur.playMinutes += p.playMinutes;
      if (new Date(p.lastPlayed || 0) > new Date(cur.lastPlayed || 0)) cur.lastPlayed = p.lastPlayed;
      if (!cur.icon) cur.icon = p.icon;
    } else {
      merged.set(key, {
        name: p.name, icon: p.icon, playMinutes: p.playMinutes, lastPlayed: p.lastPlayed,
        npCommunicationId: null, npServiceName: null, trophyProgress: null,
        definedTrophies: 0, hasPlatinum: false, playedCategory: p.category || null, trophyPlatform: null,
      });
    }
  }
  for (const t of titles) {
    const key = simplifyName(t.trophyTitleName);
    if (!key) continue;
    const defined = sumTrophies(t.definedTrophies);
    const cur = merged.get(key);
    if (cur) {
      cur.npCommunicationId = t.npCommunicationId;
      cur.npServiceName = t.npServiceName;
      cur.trophyProgress = t.progress;
      cur.definedTrophies = defined;
      cur.hasPlatinum = (t.definedTrophies?.platinum || 0) > 0;
      if (!cur.icon) cur.icon = t.trophyTitleIconUrl || null;
      if (!cur.lastPlayed) cur.lastPlayed = t.lastUpdatedDateTime || null;
      if (!cur.trophyPlatform) cur.trophyPlatform = t.trophyTitlePlatform || null;
    } else {
      merged.set(key, {
        name: t.trophyTitleName, icon: t.trophyTitleIconUrl || null, playMinutes: 0,
        lastPlayed: t.lastUpdatedDateTime || null, npCommunicationId: t.npCommunicationId,
        npServiceName: t.npServiceName, trophyProgress: t.progress, definedTrophies: defined,
        hasPlatinum: (t.definedTrophies?.platinum || 0) > 0, playedCategory: null,
        trophyPlatform: t.trophyTitlePlatform || null,
      });
    }
  }
  return [...merged.values()];
}

// Construit le résultat d'import complet d'un compte (jeux matchés IGDB +
// trophées complets, et jeux « à reconnaître »), prêt à être renvoyé au VPS.
// onProgress(done, total) : callback facultatif pour l'avancement des trophées.
export async function buildPsnImportData(accessToken, accountId, onProgress) {
  const [played, titles] = await Promise.all([
    fetchPlayedGames(accessToken, accountId).catch(() => []),
    fetchUserTitles(accessToken, accountId).catch(() => []),
  ]);
  const list = mergePlayedAndTitles(played, titles);
  if (!list.length) return { games: [], unmatched: [] };

  const matchMap = await matchNamesToIgdb(list.map((g) => g.name));

  const games = [];
  const unmatched = [];
  for (const g of list) {
    const hours = Math.round((g.playMinutes / 60) * 10) / 10;
    const m = matchMap.get(simplifyName(g.name));
    const base = {
      titleKey: simplifyName(g.name),
      psnName: g.name,
      icon: g.icon,
      playtimeHours: hours,
      lastPlayed: g.lastPlayed,
      npCommunicationId: g.npCommunicationId,
      npServiceName: g.npServiceName,
      trophyProgress: g.trophyProgress,
      definedTrophies: g.definedTrophies,
      hasPlatinum: g.hasPlatinum,
      canImportTrophies: !!g.npCommunicationId && g.definedTrophies > 0,
      trophies: null,
      trophyTotal: 0,
      trophyUnlocked: 0,
    };
    const consoles = m?.consoles || [];
    if (!m || consoles.length === 0) {
      unmatched.push({ ...base, name: g.name });
      continue;
    }
    const detected = detectPsnConsole(g.playedCategory, g.trophyPlatform);
    const suggestedConsole =
      detected && consoles.some((c) => c.name === detected) ? detected : consoles[0].name;
    const progress = g.trophyProgress ?? 0;
    const suggestedStatus = m.endless
      ? "endless"
      : progress >= 100 || hours >= FINISHED_HOURS
      ? "finished"
      : "paused";
    games.push({
      ...base,
      gameId: m.gameId,
      name: m.name,
      cover: m.cover,
      endless: m.endless,
      consoles,
      suggestedConsole,
      suggestedStatus,
    });
  }

  // Trophées complets pour tous les titres qui en ont (matchés + à reconnaître).
  const withTrophies = [...games, ...unmatched].filter((g) => g.canImportTrophies);
  let done = 0;
  await pool(withTrophies, 3, async (g) => {
    try {
      const trophies = await fetchTitleTrophies(
        accessToken, g.npCommunicationId, g.npServiceName, accountId
      );
      g.trophies = mapTrophies(trophies);
      g.trophyTotal = g.trophies.length;
      g.trophyUnlocked = g.trophies.filter((t) => t.unlocked).length;
    } catch {
      g.trophies = null;
    }
    done++;
    onProgress?.(done, withTrophies.length);
  });

  games.sort((a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0));
  return { games, unmatched };
}
