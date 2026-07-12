// Intégration Steam (API Web officielle + « Sign in through Steam » OpenID 2.0).
//
// - L'utilisateur lie son compte via le vrai bouton Steam (OpenID) : on récupère
//   son SteamID64 sans mot de passe.
// - On lit ensuite sa bibliothèque (jeux + temps de jeu) et ses succès via la
//   Steam Web API (clé serveur STEAM_API_KEY). Le PROFIL Steam doit être public
//   (détails des jeux) pour que ces lectures fonctionnent.
// - Le matching Steam appid -> jeu IGDB passe par l'endpoint `external_games`
//   d'IGDB (category = 1 = Steam), pour rattacher chaque jeu à notre base.

import { igdbQuery } from "./igdb.js";

const API = "https://api.steampowered.com";
const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

function key() {
  const k = process.env.STEAM_API_KEY;
  if (!k) {
    const err = new Error(
      "Steam n'est pas configuré (STEAM_API_KEY manquant dans server/.env)."
    );
    err.status = 503;
    throw err;
  }
  return k;
}

export function isConfigured() {
  return Boolean(process.env.STEAM_API_KEY);
}

// Petit fetch JSON tolérant (renvoie null en cas d'échec réseau / non-JSON).
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OpenID 2.0 « Sign in through Steam »
// ---------------------------------------------------------------------------

const OPENID_NS = "http://specs.openid.net/auth/2.0";
const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

// URL vers laquelle rediriger le navigateur pour lancer la connexion Steam.
// `returnTo` = URL de notre API qui recevra la réponse ; `realm` = origine.
export function buildLoginUrl(returnTo, realm) {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": `${OPENID_NS}/identifier_select`,
    "openid.claimed_id": `${OPENID_NS}/identifier_select`,
  });
  return `${OPENID_ENDPOINT}?${params.toString()}`;
}

// Vérifie la réponse OpenID renvoyée par Steam (mode check_authentication) et
// renvoie le SteamID64 si tout est valide, sinon null. On rejoue TOUS les
// paramètres openid.* reçus en changeant seulement openid.mode.
export async function verifyOpenId(query) {
  try {
    const claimed = String(query["openid.claimed_id"] || "");
    const m = claimed.match(/\/openid\/id\/(\d{17})$/);
    if (!m) return null;

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (k.startsWith("openid.")) body.set(k, v);
    }
    body.set("openid.mode", "check_authentication");

    const res = await fetch(OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    if (!/is_valid\s*:\s*true/i.test(text)) return null;
    return m[1]; // SteamID64
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Steam Web API
// ---------------------------------------------------------------------------

// Résout une URL de profil / vanity / SteamID64 brut en SteamID64 (repli manuel).
export async function resolveSteamId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  // SteamID64 déjà fourni.
  if (/^\d{17}$/.test(raw)) return raw;
  // URL /profiles/<id64>
  const idm = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (idm) return idm[1];
  // URL /id/<vanity> ou simple vanity
  const vm = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  const vanity = vm ? vm[1] : raw.replace(/^@/, "");
  const j = await getJson(
    `${API}/ISteamUser/ResolveVanityURL/v1/?key=${key()}&vanityurl=${encodeURIComponent(
      vanity
    )}`
  );
  return j?.response?.success === 1 ? j.response.steamid : null;
}

// Profil public d'un joueur (pseudo, avatar, URL publique, visibilité).
export async function getPlayerSummary(steamId) {
  const j = await getJson(
    `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${key()}&steamids=${steamId}`
  );
  const p = j?.response?.players?.[0];
  if (!p) return null;
  return {
    steamId: p.steamid,
    personaName: p.personaname || "",
    avatar: p.avatarfull || p.avatarmedium || p.avatar || null,
    profileUrl: p.profileurl || null,
    // communityvisibilitystate 3 = public.
    public: p.communityvisibilitystate === 3,
  };
}

// Bibliothèque : jeux possédés + temps de jeu (minutes). Nécessite un profil
// dont les détails des jeux sont publics. Renvoie [] si privé / erreur.
export async function getOwnedGames(steamId) {
  const j = await getJson(
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${key()}&steamid=${steamId}` +
      `&include_appinfo=1&include_played_free_games=1&format=json`
  );
  const games = j?.response?.games;
  if (!Array.isArray(games)) return null; // null = illisible (profil privé)
  return games.map((g) => ({
    appid: g.appid,
    name: g.name || "",
    playtimeMinutes: g.playtime_forever || 0,
    icon: g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : null,
  }));
}

// Succès d'un joueur pour un jeu : on fusionne le schéma (définitions : nom
// lisible, description, icônes) avec la progression du joueur (débloqué + date)
// et la rareté mondiale (% de joueurs l'ayant obtenu). Renvoie null si le jeu
// n'a pas de succès ou si la progression est illisible (profil privé).
export async function getGameAchievements(steamId, appid, lang = "french") {
  const [playerJ, schemaJ, globalJ] = await Promise.all([
    getJson(
      `${API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${key()}&steamid=${steamId}&appid=${appid}&l=${lang}`
    ),
    getJson(
      `${API}/ISteamUserStats/GetSchemaForGame/v2/?key=${key()}&appid=${appid}&l=${lang}`
    ),
    getJson(
      `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`
    ),
  ]);

  const player = playerJ?.playerstats;
  if (!player || player.success === false) return null;
  const playerList = player.achievements || [];
  if (!playerList.length) return null; // jeu sans succès

  const schemaList =
    schemaJ?.game?.availableGameStats?.achievements || [];
  const schemaMap = new Map(schemaList.map((a) => [a.name, a]));
  const globalMap = new Map(
    (globalJ?.achievementpercentages?.achievements || []).map((a) => [
      a.name,
      a.percent,
    ])
  );

  const achievements = playerList.map((a) => {
    const s = schemaMap.get(a.apiname) || {};
    const pct = globalMap.get(a.apiname);
    return {
      apiName: a.apiname,
      name: s.displayName || a.name || a.apiname,
      description: s.description || "",
      icon: (a.achieved ? s.icon : s.icongray) || s.icon || null,
      hidden: s.hidden === 1,
      unlocked: !!a.achieved,
      unlockedAt: a.achieved && a.unlocktime ? new Date(a.unlocktime * 1000) : null,
      rarity: pct != null ? Math.round(Number(pct) * 10) / 10 : null,
    };
  });

  return {
    total: achievements.length,
    unlocked: achievements.filter((a) => a.unlocked).length,
    achievements,
  };
}

// ---------------------------------------------------------------------------
// Matching Steam appid -> jeu IGDB
// ---------------------------------------------------------------------------

// Modes de jeu IGDB considérés « sans fin » (multi/MMO/battle royale) : mêmes
// ids que la modale d'ajout (routes/games.js) → statut « Sans fin » suggéré.
const ENDLESS_MODES = [2, 5, 6];

// Pour une liste d'appids Steam, renvoie une Map appid -> { gameId, name,
// cover, endless }. Passe par IGDB external_games (category 1 = Steam), puis
// récupère nom/jaquette/modes des jeux résolus.
export async function matchAppsToIgdb(appids) {
  const out = new Map();
  const uniq = [...new Set(appids.map(Number).filter(Boolean))];

  // 1) appid Steam -> id IGDB via external_games, par paquets.
  // NB : IGDB a déprécié le champ `category` (souvent null sur les fiches
  // récentes) au profit de `external_game_source`. Steam = source 1. Filtrer
  // sur `category = 1` rate donc beaucoup de jeux → on utilise la source.
  const uidToGame = new Map();
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const list = chunk.map((a) => `"${a}"`).join(",");
    const rows = await igdbQuery(
      "external_games",
      `fields game,uid; where external_game_source = 1 & uid = (${list}); limit 500;`
    ).catch(() => []);
    for (const r of rows) {
      if (r.uid && r.game && !uidToGame.has(r.uid)) uidToGame.set(String(r.uid), r.game);
    }
  }
  if (!uidToGame.size) return out;

  // 2) Détails des jeux IGDB résolus (nom, jaquette, modes).
  const gameIds = [...new Set(uidToGame.values())];
  const gameById = new Map();
  for (let i = 0; i < gameIds.length; i += 400) {
    const chunk = gameIds.slice(i, i + 400);
    const rows = await igdbQuery(
      "games",
      `fields name,cover.image_id,game_modes; where id = (${chunk.join(",")}); limit 500;`
    ).catch(() => []);
    for (const g of rows) gameById.set(g.id, g);
  }

  for (const appid of uniq) {
    const gameId = uidToGame.get(String(appid));
    if (!gameId) continue;
    const g = gameById.get(gameId);
    if (!g) continue;
    out.set(appid, {
      gameId,
      name: g.name,
      cover: g.cover?.image_id
        ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg`
        : null,
      endless: (g.game_modes || []).some((m) => ENDLESS_MODES.includes(m)),
    });
  }
  return out;
}
