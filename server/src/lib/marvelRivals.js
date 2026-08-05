// Intégration Marvel Rivals via l'API non officielle marvelrivalsapi.com.
//
// - On lie un compte par son PSEUDO in-game : GET /api/v1/find-player/:username
//   renvoie un `uid` stable qui sert de clé pour toutes les autres requêtes.
// - On lit ensuite les stats du joueur (rang, saison, top héros, winrate/KDA)
//   et son historique de matchs. La clé vit côté serveur (MARVEL_RIVALS_API_KEY,
//   header `x-api-key`) ; aucun secret n'est stocké côté utilisateur.
// - L'API est NON OFFICIELLE : shape mouvante + indisponibilités fréquentes
//   (502 Cloudflare, profil « en file d'attente 2-5 min »). Toutes les lectures
//   sont donc défensives (optional chaining partout, throw typé { status }) et
//   les appelants sont censés servir le dernier snapshot connu en cas d'échec.
//
// Ce module est volontairement générique dans l'esprit : la route qui l'utilise
// stocke un snapshot normalisé, réutilisable pour d'autres providers plus tard.
//
// DEUX BACKENDS derrière un même snapshot normalisé (voir orchestrateur en bas) :
//   1. rivalsmeta.com (public, SANS clé) — source par défaut, marche tout de
//      suite. Renvoie des données brutes (hero_id numériques, rangs par niveau)
//      enrichies via lib/marvelRivalsData.js.
//   2. marvelrivalsapi.com (clé x-api-key) — préféré quand il est configuré ET
//      disponible (données déjà normalisées, recherche par pseudo). Sert de
//      complément / repli à rivalsmeta.

import {
  heroInfo,
  rankLabel,
  rankImage,
  GAME_MODES,
  mapName,
  mapImage,
  matchQueue,
  CURRENT_SEASON_VALUE,
} from "./marvelRivalsData.js";
import { igdbQuery } from "./igdb.js";

const API_BASE = "https://marvelrivalsapi.com/api";
// rivalsmeta expose une API interne non documentée ; un User-Agent navigateur
// évite d'être filtré. Best-effort et tolérant aux pannes comme l'autre backend.
const RIVALSMETA_API = "https://rivalsmeta.com/api";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// Les chemins d'images renvoyés par l'API sont relatifs (ex. "/heroes/…png") :
// on les préfixe pour obtenir une URL absolue affichable.
const ASSET_BASE = "https://marvelrivalsapi.com/rivals";

// Saisons connues (l'API les clé par id numérique). On expose la plus récente
// par défaut ; la route peut demander une saison précise.
export const CURRENT_SEASON = process.env.MARVEL_RIVALS_SEASON || "";

export function isConfigured() {
  return Boolean(process.env.MARVEL_RIVALS_API_KEY);
}

function key() {
  const k = process.env.MARVEL_RIVALS_API_KEY;
  if (!k) {
    const err = new Error(
      "Marvel Rivals n'est pas configuré (MARVEL_RIVALS_API_KEY manquant dans server/.env)."
    );
    err.status = 503;
    throw err;
  }
  return k;
}

// Préfixe un chemin d'asset relatif en URL absolue (no-op si déjà absolu/vide).
export function asset(path) {
  if (!path || typeof path !== "string") return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

// Requête JSON avec header x-api-key + timeout. Lève une erreur typée { status }
// pour que l'appelant distingue « pas trouvé » (404), « en file d'attente »
// (202/409), « rate-limit » (429) et « API en panne » (5xx / réseau).
async function request(path, { method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "x-api-key": key(), accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      e.name === "AbortError"
        ? "Marvel Rivals : délai dépassé."
        : "Marvel Rivals : API injoignable."
    );
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse sans corps JSON (ex. page d'erreur Cloudflare) */
  }

  if (!res.ok) {
    const err = new Error(
      data?.message || data?.error || `Marvel Rivals : erreur ${res.status}.`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
//  Jaquettes IGDB (jeu + saisons) — habillage de l'onglet Tracking
// ---------------------------------------------------------------------------
// Marvel Rivals expose sur IGDB chaque saison comme un « jeu » distinct
// (« Marvel Rivals: Season N - … ») avec sa propre jaquette. On récupère la
// jaquette du jeu de base + une jaquette par numéro de saison, mises en cache
// 24 h (contenu quasi statique, et IGDB peut être lent / non configuré).
let _igdbCache = { at: 0, data: null };
const IGDB_ASSETS_TTL = 24 * 60 * 60 * 1000;

function igdbImage(imageId, size = "t_cover_big") {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}

export async function getGameAssets() {
  if (_igdbCache.data && Date.now() - _igdbCache.at < IGDB_ASSETS_TTL) {
    return _igdbCache.data;
  }
  try {
    const rows = await igdbQuery(
      "games",
      `search "Marvel Rivals"; fields name, cover.image_id; limit 50;`
    );
    let cover = null;
    const seasons = {}; // numéro de saison ("0", "5.5", "8") -> URL de jaquette
    for (const g of rows || []) {
      const img = igdbImage(g.cover?.image_id);
      if (!img) continue;
      const name = String(g.name || "").trim();
      if (/^marvel rivals$/i.test(name)) {
        cover = cover || img;
        continue;
      }
      const m = name.match(/season\s+(\d+(?:\.\d+)?)/i);
      // La 1re occurrence gagne (IGDB renvoie les résultats par pertinence).
      if (m && !seasons[m[1]]) seasons[m[1]] = img;
    }
    // Repli : jeu de base introuvable par nom exact → 1re jaquette disponible.
    if (!cover) {
      const first = (rows || []).find((g) => g.cover?.image_id);
      cover = igdbImage(first?.cover?.image_id);
    }
    _igdbCache = { at: Date.now(), data: { cover, seasons } };
  } catch {
    // IGDB indisponible / non configuré : on sert le dernier cache ou du vide.
    if (!_igdbCache.data) _igdbCache = { at: 0, data: { cover: null, seasons: {} } };
  }
  return _igdbCache.data;
}

// ---------------------------------------------------------------------------
//  Endpoints
// ---------------------------------------------------------------------------

// GET /v1/find-player/:username -> { name, uid } (uid = clé des autres appels).
export async function findPlayer(username) {
  const data = await request(
    `/v1/find-player/${encodeURIComponent(String(username).trim())}`
  );
  const uid = data?.uid ?? data?.player_uid ?? data?.id ?? null;
  if (!uid) return null;
  return { uid: String(uid), name: data?.name || String(username) };
}

// GET /v2/player/:uid (stats complètes). `season` optionnel.
export async function getPlayerStats(uid, season = CURRENT_SEASON) {
  const q = season ? `?season=${encodeURIComponent(season)}` : "";
  return request(`/v2/player/${encodeURIComponent(uid)}${q}`);
}

// GET /v2/player/:uid/match-history (parties récentes).
export async function getMatchHistory(uid, { limit = 20, season } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (season) params.set("season", season);
  const q = params.toString() ? `?${params}` : "";
  return request(`/v2/player/${encodeURIComponent(uid)}/match-history${q}`);
}

// Repush du profil dans la file de traitement de l'API (données fraîches ~2-5
// min plus tard). Best-effort : un échec ne doit jamais bloquer un refresh.
export async function updatePlayer(uid) {
  try {
    return await request(`/v1/player/${encodeURIComponent(uid)}/update`, {
      method: "GET",
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Normalisation -> snapshot stable, indépendant des variations de l'API
// ---------------------------------------------------------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (v) => Math.round(num(v) * 10) / 10;

// Rang : l'API renvoie tantôt un libellé « Grandmaster 3 », tantôt level+tier.
function normRank(rank) {
  if (!rank) return null;
  return {
    tier: rank.rank || rank.tier || rank.level || null,
    score: rank.score != null ? Math.round(num(rank.score)) : null,
    color: rank.color || null,
    image: asset(rank.image || rank.icon || null),
  };
}

// Stats globales : l'API imbrique parfois les valeurs (total_wins.wins…).
function normOverall(s) {
  if (!s) return null;
  const matches = num(s.total_matches ?? s.matches);
  const wins = num(s.total_wins?.wins ?? s.total_wins ?? s.wins);
  const winRate =
    s.total_wins?.win_percentage != null
      ? round1(s.total_wins.win_percentage)
      : matches
        ? round1((wins / matches) * 100)
        : 0;
  return {
    matches,
    wins,
    losses: Math.max(0, matches - wins),
    winRate,
    kda: round1(s.overall_kda?.kda ?? s.overall_kda ?? s.kda),
    kd: round1(s.overall_kd?.kd ?? s.overall_kd ?? s.kd),
    kills: num(s.total_kills?.kills ?? s.total_kills ?? s.kills),
    deaths: num(s.total_deaths?.deaths ?? s.total_deaths ?? s.deaths),
    assists: num(s.total_assists?.assists ?? s.total_assists ?? s.assists),
    mvps: num(s.total_mvps?.mvps ?? s.total_mvps ?? s.mvps),
    svps: num(s.total_svps?.svps ?? s.total_svps ?? s.svps),
  };
}

function normRoles(roles) {
  if (!roles || typeof roles !== "object") return [];
  return Object.entries(roles)
    .map(([role, r]) => ({
      role,
      matches: num(r?.matches_played ?? r?.matches),
      winRate: round1(r?.win_percentage ?? r?.winRate),
      kda: round1(r?.kda_ratio?.kda_ratio ?? r?.kda_ratio ?? r?.kda),
    }))
    .filter((r) => r.matches > 0)
    .sort((a, b) => b.matches - a.matches);
}

function normHeroes(heroes) {
  if (!Array.isArray(heroes)) return [];
  return heroes
    .map((h) => {
      const matches = num(h.matches ?? h.games ?? h.play_time?.matches);
      const wins = num(h.wins);
      const kills = num(h.kills);
      const deaths = num(h.deaths);
      const assists = num(h.assists);
      return {
        id: h.hero_id ?? h.id ?? null,
        name: h.hero_name || h.name || "Héros",
        thumb: asset(h.hero_thumbnail || h.thumbnail || h.image || null),
        matches,
        wins,
        winRate: matches ? round1((wins / matches) * 100) : 0,
        kda: deaths
          ? round1((kills + assists) / deaths)
          : round1(kills + assists),
      };
    })
    .filter((h) => h.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 12);
}

// Snapshot normalisé pour l'onglet Tracking (voir routes/trackers.js).
export function normalizeStats(raw) {
  if (!raw) return null;
  // Selon la version de l'API, les données sont à la racine ou sous `player`.
  const p = raw.player || raw;
  const info = p.info || raw.info || {};
  const icon = p.player_icon || info.player_icon || raw.icon || {};
  return {
    uid: p.uid ?? raw.uid ?? null,
    name: p.name || p.nickname || raw.name || null,
    level: num(p.level ?? info.level),
    icon: asset(icon.player_icon || icon.icon || null),
    season: raw.season ?? info.season ?? CURRENT_SEASON ?? null,
    rank: normRank(raw.rank || p.rank),
    peak: normRank(raw.rank?.peak_rank || p.rank?.peak_rank || raw.peak_rank),
    overall: normOverall(raw.overall_stats || raw.stats || p.overall_stats),
    roles: normRoles(raw.roles_played || raw.roles),
    heroes: normHeroes(raw.heroes_ranked || raw.heroes || raw.hero_stats),
    updatedAt: new Date().toISOString(),
  };
}

// Un match brut -> forme stable pour le fil et l'historique.
export function normalizeMatch(m) {
  if (!m) return null;
  const mp = m.match_player || m.player || {};
  const hero = mp.player_hero || mp.hero || {};
  const ts = num(m.match_time_stamp ?? m.timestamp ?? m.match_timestamp);
  const kills = num(hero.kills ?? mp.kills);
  const deaths = num(hero.deaths ?? mp.deaths);
  const assists = num(hero.assists ?? mp.assists);
  const matchUid = m.match_uid || m.match_id || m.uid || null;
  if (!matchUid) return null;
  return {
    matchUid: String(matchUid),
    // L'API donne un timestamp en secondes ; on tolère aussi des ms.
    playedAt: new Date(ts > 1e12 ? ts : ts * 1000),
    hero: {
      name: hero.hero_name || hero.name || "Héros",
      thumb: asset(hero.hero_thumbnail || hero.thumbnail || hero.image || null),
    },
    k: kills,
    d: deaths,
    a: assists,
    kda: deaths ? round1((kills + assists) / deaths) : round1(kills + assists),
    win: mp.is_win === true || mp.is_win === 1 || m.is_win === true,
    mode: m.game_mode || m.game_mode_name || null,
    map: m.match_map || m.map_name || null,
  };
}

export function normalizeMatches(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw?.match_history || raw?.matches || raw?.data || [];
  return list.map(normalizeMatch).filter(Boolean);
}

// ===========================================================================
//  Backend rivalsmeta.com (public, sans clé)
// ===========================================================================

// Appel rivalsmeta interne (UA navigateur + timeout). Lève une erreur typée.
// `body` fourni -> POST JSON, sinon GET.
async function rmGet(path, { method, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(`${RIVALSMETA_API}${path}`, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        "user-agent": BROWSER_UA,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error("rivalsmeta injoignable.");
    err.status = e.name === "AbortError" ? 504 : 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = new Error(`rivalsmeta : erreur ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  // Le corps peut être une page HTML (404) malgré un statut 200 : on exige JSON.
  return res.json().catch(() => null);
}

// GET rivalsmeta /api/player/:uid?season= — profil complet (stats, rangs, héros,
// matchs) pour une saison donnée (défaut = saison courante).
export async function rivalsmetaPlayer(uid, season) {
  const q = season != null ? `?season=${encodeURIComponent(season)}` : "";
  const data = await rmGet(`/player/${encodeURIComponent(uid)}${q}`);
  if (!data || !data.player) {
    const err = new Error("Joueur introuvable sur rivalsmeta.");
    err.status = 404;
    throw err;
  }
  return data;
}

// Recherche de joueurs par pseudo via rivalsmeta (public, SANS clé).
// POST /api/find-player { name } -> [{ aid, name, cur_head_icon_id }].
// Les pseudos ne sont pas uniques : on renvoie une liste de candidats à départager.
const RIVALSMETA_SITE = "https://rivalsmeta.com";
export async function searchPlayersByName(name) {
  const q = String(name || "").trim();
  if (q.length < 2) return [];
  let data;
  try {
    data = await rmGet("/find-player", { body: { name: q } });
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((p) => p?.aid)
    .slice(0, 12)
    .map((p) => ({
      uid: String(p.aid),
      name: p.name || String(p.aid),
      icon: p.cur_head_icon_id
        ? `${RIVALSMETA_SITE}/images/Playerhead/img_playerhead_${p.cur_head_icon_id}.png`
        : null,
    }));
}

// Rangs par saison depuis player.info (valeurs tantôt objet, tantôt string JSON).
function rmSeasonRanks(info) {
  const out = [];
  for (const k of Object.keys(info || {})) {
    const m = /^rank_game_(\d+)$/.exec(k);
    if (!m) continue;
    let v = info[k];
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        continue;
      }
    }
    const rg = v?.rank_game;
    if (rg) out.push({ seasonKey: Number(m[1]), ...rg });
  }
  return out.sort((a, b) => a.seasonKey - b.seasonKey);
}

// Snapshot normalisé (même shape que normalizeStats) depuis les données rivalsmeta.
export function normalizeFromRivalsmeta(raw) {
  if (!raw) return null;
  const info = raw.player?.info || {};
  const stats = raw.stats || {};

  // --- Rang : dérivé des matchs CLASSÉS de la saison demandée (le payload est
  //     scopé par saison). Rang courant = dernier match classé (ce que le joueur
  //     voit en jeu) ; pic = plus haut niveau atteint dans la saison. On évite
  //     player.info.rank_game_* qui ne couvre que les 6 dernières saisons (donc
  //     faux pour une saison passée). Repli sur rank_game si aucun match classé.
  const hist = Array.isArray(raw.match_history) ? raw.match_history : [];
  const rankedMatches = hist
    // Uniquement les parties CLASSÉES (game_mode_id 2). En rapide/arcade/perso,
    // `new_level` existe aussi mais code la progression de COMPTE, pas le rang —
    // sinon la dernière partie rapide fait afficher un faux « Bronze 3 ».
    .filter((m) => num(m.game_mode_id) === 2)
    .map((m) => m.match_player?.dynamic_fields)
    .filter((df) => df && df.new_level != null)
    .map((df) => ({ level: num(df.new_level), score: num(df.new_score) }));

  const seasons = rmSeasonRanks(info);
  const latestSeason = seasons[seasons.length - 1] || null;

  let curLevel = null;
  let curScore = null;
  let peakLevel = null;
  let peakScore = null;
  if (rankedMatches.length) {
    // hist est anté-chronologique (plus récent en tête) → [0] = rang courant.
    curLevel = rankedMatches[0].level;
    curScore = Math.round(rankedMatches[0].score);
    const pk = rankedMatches.reduce((mx, r) =>
      !mx || r.level > mx.level || (r.level === mx.level && r.score > mx.score) ? r : mx
    );
    peakLevel = pk.level;
    peakScore = Math.round(pk.score);
  } else if (latestSeason) {
    curLevel = num(latestSeason.level);
    curScore = Math.round(num(latestSeason.rank_score));
    peakLevel = num(latestSeason.max_level);
    peakScore = Math.round(num(latestSeason.max_rank_score));
  }

  // --- Stats globales : kills/deaths/assists = classé + non classé.
  const r = stats.ranked || {};
  const un = stats.unranked || {};
  const kills = num(r.total_kills) + num(un.total_kills);
  const deaths = num(r.total_deaths) + num(un.total_deaths);
  const assists = num(r.total_assists) + num(un.total_assists);
  const matches = num(stats.total_matches);
  const wins = num(stats.total_wins);

  // --- Héros : fusion classé + non classé, puis tri par nombre de parties.
  const acc = new Map();
  for (const src of [raw.heroes_ranked, raw.heroes_unranked]) {
    for (const [id, h] of Object.entries(src || {})) {
      const e =
        acc.get(id) ||
        { matches: 0, win: 0, kills: 0, deaths: 0, assists: 0, mvp: 0, svp: 0 };
      e.matches += num(h.matches);
      e.win += num(h.win);
      e.kills += num(h.kills);
      e.deaths += num(h.deaths);
      e.assists += num(h.assists);
      e.mvp += num(h.mvp);
      e.svp += num(h.svp);
      acc.set(id, e);
    }
  }
  let mvps = 0;
  let svps = 0;
  const heroes = [...acc.entries()]
    .map(([id, h]) => {
      mvps += h.mvp;
      svps += h.svp;
      const inf = heroInfo(id);
      return {
        id: inf.id,
        name: inf.name,
        thumb: inf.thumb,
        matches: h.matches,
        wins: h.win,
        winRate: h.matches ? round1((h.win / h.matches) * 100) : 0,
        kda: h.deaths ? round1((h.kills + h.assists) / h.deaths) : round1(h.kills + h.assists),
      };
    })
    .filter((h) => h.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 12);

  return {
    uid: String(info.aid || raw.player?._id || ""),
    name: info.name || null,
    level: num(info.level),
    icon: null,
    season: latestSeason?.rank_game_id ?? null,
    rank: curLevel
      ? { tier: rankLabel(curLevel), score: curScore, color: null, image: rankImage(curLevel) }
      : null,
    peak: peakLevel
      ? {
          tier: rankLabel(peakLevel),
          score: peakScore || null,
          color: null,
          image: rankImage(peakLevel),
        }
      : null,
    overall: {
      matches,
      wins,
      losses: Math.max(0, matches - wins),
      winRate: matches ? round1((wins / matches) * 100) : 0,
      kda: deaths ? round1((kills + assists) / deaths) : round1(kills + assists),
      kd: deaths ? round1(kills / deaths) : round1(kills),
      kills,
      deaths,
      assists,
      mvps,
      svps,
    },
    roles: [], // rivalsmeta ne fournit pas la ventilation par rôle
    heroes,
    updatedAt: new Date().toISOString(),
  };
}

// Matchs normalisés (même shape que normalizeMatches) depuis rivalsmeta.
export function normalizeMatchesFromRivalsmeta(raw) {
  const list = Array.isArray(raw?.match_history) ? raw.match_history : [];
  return list
    .map((m) => {
      const mp = m.match_player || {};
      const inf = heroInfo(mp.player_hero?.hero_id);
      const uid = m.match_uid;
      if (!uid) return null;
      const ts = num(m.match_time_stamp);
      const k = num(mp.k);
      const d = num(mp.d);
      const a = num(mp.a);
      const mid = m.match_map_id != null ? Number(m.match_map_id) : null;
      // Score de manches (score_info keyé par side 0/1) réordonné : le mien d'abord.
      const si = m.dynamic_fields?.score_info || {};
      const camp = num(mp.camp);
      const myR = si[camp];
      const opR = si[1 - camp];
      const score =
        myR != null && opR != null ? { me: num(myR), opp: num(opR) } : null;
      // Rang APRÈS la partie + points gagnés/perdus (uniquement en CLASSÉE) —
      // permet d'afficher « +34 » par partie et de détecter les montées de rang.
      const df = mp.dynamic_fields || {};
      const rankedGame = num(m.game_mode_id) === 2;
      const rankLevel = rankedGame && df.new_level != null ? num(df.new_level) : null;
      const rankScore =
        rankedGame && df.new_score != null ? Math.round(num(df.new_score)) : null;
      const scoreDelta =
        rankedGame && df.add_score != null ? Math.round(num(df.add_score)) : null;
      return {
        matchUid: String(uid),
        playedAt: new Date(ts > 1e12 ? ts : ts * 1000),
        hero: { name: inf.name, thumb: inf.thumb },
        k,
        d,
        a,
        kda: d ? round1((k + a) / d) : round1(k + a),
        win: mp.is_win === 1 || mp.is_win === true,
        mode: GAME_MODES[m.game_mode_id] || null,
        mapId: mid,
        map: mapName(mid),
        mapImage: mapImage(mid),
        queue: matchQueue(m.game_mode_id, m.play_mode_id, mid),
        rankLevel,
        rankScore,
        scoreDelta,
        score,
        isMvp: m.mvp_uid != null && String(mp.player_uid) === String(m.mvp_uid),
        isSvp: m.svp_uid != null && String(mp.player_uid) === String(m.svp_uid),
      };
    })
    .filter(Boolean);
}

// ===========================================================================
//  Orchestrateur hybride
// ===========================================================================

// Extrait un uid numérique d'une saisie : uid pur, ou URL de profil collée
// (rivalsmeta.com/player/249729944, tracker.gg/…/249729944…).
export function extractUid(input) {
  const s = String(input || "").trim();
  if (/^\d{5,}$/.test(s)) return s;
  const m = s.match(/(?:player|profile|ign)\/(\d{5,})/i) || s.match(/(\d{7,})/);
  return m ? m[1] : null;
}

// Résout un joueur en { uid, name } à partir d'une saisie libre.
// - uid / URL collée → vérifié directement sur rivalsmeta (sans clé).
// - pseudo → recherche via marvelrivalsapi (si configuré) ; à défaut on demande
//   à l'utilisateur de coller son id / l'URL de son profil rivalsmeta.
export async function resolvePlayer(input) {
  const uid = extractUid(input);
  if (uid) {
    // Confirme l'existence + récupère le nom (best-effort).
    try {
      const data = await rivalsmetaPlayer(uid);
      return { uid, name: data.player?.info?.name || String(uid) };
    } catch {
      // rivalsmeta peut ne pas connaître encore ce uid : on l'accepte quand même.
      return { uid, name: String(uid) };
    }
  }
  // Pseudo : nécessite la recherche marvelrivalsapi.
  if (isConfigured()) {
    const p = await findPlayer(input);
    if (p) return p;
  }
  const err = new Error(
    "Recherche par pseudo indisponible pour l'instant. Colle ton identifiant numérique ou l'URL de ton profil rivalsmeta.com."
  );
  err.status = 422;
  throw err;
}

// Récupère { snapshot, matches, source, processing } pour un uid et une saison
// (défaut = saison courante). Préférence marvelrivalsapi quand configuré ET
// répond ; sinon rivalsmeta.
export async function fetchPlayerData(uid, { season } = {}) {
  // 1. marvelrivalsapi en priorité s'il est configuré (données normalisées natives).
  if (isConfigured()) {
    try {
      const [stats, mh] = await Promise.all([
        getPlayerStats(uid, season || CURRENT_SEASON),
        getMatchHistory(uid, { season: season || undefined }).catch(() => null),
      ]);
      const snapshot = normalizeStats(stats);
      if (snapshot) {
        return {
          snapshot,
          matches: mh ? normalizeMatches(mh) : [],
          source: "marvelrivalsapi",
          processing: false,
        };
      }
    } catch (e) {
      // 202/409 = profil en file d'attente : on tente quand même rivalsmeta.
      if (e.status === 202 || e.status === 409) {
        try {
          const raw = await rivalsmetaPlayer(uid, season);
          return {
            snapshot: normalizeFromRivalsmeta(raw),
            matches: normalizeMatchesFromRivalsmeta(raw),
            source: "rivalsmeta",
            processing: true,
          };
        } catch {
          return { snapshot: null, matches: [], source: null, processing: true };
        }
      }
      // sinon on retombe sur rivalsmeta ci-dessous.
    }
  }

  // 2. rivalsmeta (défaut, sans clé).
  const raw = await rivalsmetaPlayer(uid, season);
  return {
    snapshot: normalizeFromRivalsmeta(raw),
    matches: normalizeMatchesFromRivalsmeta(raw),
    source: "rivalsmeta",
    processing: false,
  };
}

// Page suivante de l'historique de matchs (bouton « Charger plus »). rivalsmeta
// pagine via /player-match-history/:uid?skip=N — le profil renvoie les 20 plus
// récents, cet endpoint sert la suite (anté-chrono). `game_mode_id`/`hero_id` à
// 0 = pas de filtre (les laisser VIDES renvoie une 500). `season` = valeur
// rivalsmeta (18 = courante). Renvoie des matchs normalisés (même shape que
// normalizeMatchesFromRivalsmeta).
export async function fetchMatchHistoryPage(uid, { skip = 0, season } = {}) {
  const s = season != null ? season : "";
  const raw = await rmGet(
    `/player-match-history/${encodeURIComponent(uid)}` +
      `?skip=${skip}&game_mode_id=0&hero_id=0&season=${encodeURIComponent(s)}`
  );
  const list = Array.isArray(raw) ? raw : [];
  return normalizeMatchesFromRivalsmeta({ match_history: list });
}

// ===========================================================================
//  Détail d'un match (scoreboard complet) — via rivalsmeta /api/matches/:uid
// ===========================================================================
// Renvoie les deux équipes avec, par joueur : héros, rang (+delta), K/D/A,
// dégâts, dégâts subis, soin, MVP/SVP. `mapId` (facultatif, connu côté client
// depuis l'historique) permet d'afficher le nom de la carte.
export async function matchDetail(matchUid, { mapId } = {}) {
  const raw = await rmGet(`/matches/${encodeURIComponent(matchUid)}`);
  if (!raw || !Array.isArray(raw.match_players)) {
    const err = new Error("Match introuvable.");
    err.status = 404;
    throw err;
  }
  const ts = num(raw.match_time_stamp);
  // Le rang n'a de sens qu'en CLASSÉE : hors classée (rapide, perso, arcade),
  // `new_level` existe quand même (progression/compte) mais ne correspond à aucun
  // rang réel → on le masque, sinon on affiche « Bronze 3 » en partie rapide.
  const ranked = num(raw.game_mode_id) === 2;
  const player = (p) => {
    const df = p.dynamic_fields || {};
    const inf = heroInfo(p.cur_hero_id);
    const k = num(p.k);
    const d = num(p.d);
    const a = num(p.a);
    const lvl = ranked && df.new_level != null ? num(df.new_level) : null;
    return {
      uid: String(p.player_uid),
      name: p.nick_name || "Joueur",
      camp: num(p.camp),
      win: p.is_win === 1 || p.is_win === true,
      heroId: inf.id,
      heroName: inf.name,
      heroThumb: inf.thumb,
      rankTier: lvl ? rankLabel(lvl) : null,
      rankImage: lvl ? rankImage(lvl) : null,
      rankScore: ranked && df.new_score != null ? Math.round(num(df.new_score)) : null,
      rankDelta: ranked && df.add_score != null ? Math.round(num(df.add_score)) : null,
      k,
      d,
      a,
      kda: d ? round1((k + a) / d) : round1(k + a),
      damage: Math.round(num(p.total_hero_damage)),
      damageTaken: Math.round(num(p.total_damage_taken)),
      healing: Math.round(num(p.total_hero_heal)),
      isMvp: String(p.player_uid) === String(raw.mvp_uid),
      isSvp: String(p.player_uid) === String(raw.svp_uid),
    };
  };
  const players = raw.match_players.map(player);
  // Regroupement par équipe (camp). L'équipe gagnante = celle des joueurs is_win.
  const camps = [...new Set(players.map((p) => p.camp))].sort();
  const teams = camps.map((camp) => {
    const list = players.filter((p) => p.camp === camp);
    return { camp, win: list.some((p) => p.win), players: list };
  });
  return {
    matchUid: String(raw.match_uid || matchUid),
    playedAt: new Date(ts > 1e12 ? ts : ts * 1000),
    durationSec: Math.round(num(raw.match_play_duration)),
    mode: GAME_MODES[raw.game_mode_id] || null,
    ranked,
    map: mapName(mapId),
    replayId: raw.replay_id || null,
    mvpUid: raw.mvp_uid != null ? String(raw.mvp_uid) : null,
    svpUid: raw.svp_uid != null ? String(raw.svp_uid) : null,
    teams,
  };
}
