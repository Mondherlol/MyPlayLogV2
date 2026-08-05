// Intégration League of Legends via l'API OFFICIELLE Riot Games (developer.riotgames.com).
//
// - On lie un compte par son RIOT ID (« Pseudo#TAG », ex. « Faker#KR1 ») + sa
//   région. L'API Account-V1 renvoie un `puuid` stable qui sert de clé à tous les
//   autres appels. La clé vit côté serveur (RIOT_API_KEY, header X-Riot-Token) ;
//   aucun secret n'est stocké côté utilisateur.
// - On lit ensuite le niveau/icône (Summoner-V4), le rang Solo/Flex (League-V4),
//   l'historique de parties (Match-V5) et la maîtrise des champions
//   (Champion-Mastery-V4), puis on normalise le tout en un snapshot stable.
// - Riot route ses endpoints sur DEUX espaces : la PLATEFORME (euw1, na1, kr…)
//   pour summoner/league/mastery, et le CLUSTER RÉGIONAL (europe, americas, asia)
//   pour account/match. On mappe l'un vers l'autre (PLATFORMS ci-dessous).
// - Les assets (icônes de champions, d'invocateur) viennent de Data Dragon
//   (statique, sans clé) ; les emblèmes de rang de Community Dragon.
//
// Contrairement à Marvel Rivals (API non officielle, profil « en file d'attente »),
// l'API Riot renvoie des données fraîches immédiatement : la synchro est donc
// entièrement automatique (fond + ouverture de profil), sans bouton à presser.

import * as cheerio from "cheerio";
import { igdbQuery } from "./igdb.js";

const RIOT_KEY_HEADER = "X-Riot-Token";

export function isConfigured() {
  return Boolean(process.env.RIOT_API_KEY);
}

function key() {
  const k = process.env.RIOT_API_KEY;
  if (!k) {
    const err = new Error(
      "League of Legends n'est pas configuré (RIOT_API_KEY manquant dans server/.env)."
    );
    err.status = 503;
    throw err;
  }
  return k;
}

// ---------------------------------------------------------------------------
//  Régions : plateforme (host des endpoints summoner/league) -> cluster régional
//  (host des endpoints account/match). Libellés FR pour le sélecteur du client.
// ---------------------------------------------------------------------------
export const PLATFORMS = {
  euw1: { label: "Europe de l'Ouest (EUW)", cluster: "europe" },
  eun1: { label: "Europe Nordique & Est (EUNE)", cluster: "europe" },
  tr1: { label: "Turquie (TR)", cluster: "europe" },
  ru: { label: "Russie (RU)", cluster: "europe" },
  na1: { label: "Amérique du Nord (NA)", cluster: "americas" },
  br1: { label: "Brésil (BR)", cluster: "americas" },
  la1: { label: "Amérique latine Nord (LAN)", cluster: "americas" },
  la2: { label: "Amérique latine Sud (LAS)", cluster: "americas" },
  kr: { label: "Corée (KR)", cluster: "asia" },
  jp1: { label: "Japon (JP)", cluster: "asia" },
  oc1: { label: "Océanie (OCE)", cluster: "sea" },
  vn2: { label: "Vietnam (VN)", cluster: "sea" },
  sg2: { label: "Singapour (SG)", cluster: "sea" },
};

// Liste ordonnée exposée au client (sélecteur de région).
export const REGIONS = Object.entries(PLATFORMS).map(([value, v]) => ({
  value,
  label: v.label,
}));

const DEFAULT_PLATFORM = "euw1";

export function normalizePlatform(p) {
  const k = String(p || "").toLowerCase().trim();
  return PLATFORMS[k] ? k : DEFAULT_PLATFORM;
}

function clusterFor(platform) {
  return PLATFORMS[normalizePlatform(platform)].cluster;
}

// Slug de région op.gg (pour le lien « voir le profil complet »).
const OPGG_REGION = {
  euw1: "euw", eun1: "eune", tr1: "tr", ru: "ru", na1: "na", br1: "br",
  la1: "lan", la2: "las", kr: "kr", jp1: "jp", oc1: "oce", vn2: "vn", sg2: "sg",
};

export function opggUrl(gameName, tagLine, platform) {
  const region = OPGG_REGION[normalizePlatform(platform)] || "euw";
  return `https://www.op.gg/summoners/${region}/${encodeURIComponent(
    `${gameName}-${tagLine}`
  )}`;
}

// ---------------------------------------------------------------------------
//  Backfill de l'HISTORIQUE DE SAISONS (op.gg). L'API Riot n'expose aucun rang
//  des saisons passées : op.gg les affiche depuis sa propre base historique. On
//  la lit UNE fois (à la liaison) en parsant le tableau « Past seasons » de la
//  page publique du joueur (HTML rendu côté serveur). Purement best-effort :
//  toute erreur renvoie [] et ne bloque jamais la liaison. Ensuite, notre propre
//  historique prend le relais (pic de rang suivi au fil des synchros).
// ---------------------------------------------------------------------------

// medals_mini/<tier>.png -> palier Riot (rawTier). Table op.gg -> nos constantes.
const OPGG_MEDAL_TIER = {
  iron: "IRON", bronze: "BRONZE", silver: "SILVER", gold: "GOLD",
  platinum: "PLATINUM", emerald: "EMERALD", diamond: "DIAMOND",
  master: "MASTER", grandmaster: "GRANDMASTER", challenger: "CHALLENGER",
};
const DIV_ARABIC_TO_ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV" };

// Récupère l'historique de saisons d'un joueur via sa page op.gg publique.
// Renvoie [{ season, tier, division, label, lp, image }] (plus récent d'abord),
// ou [] si indisponible. Jamais throw.
export async function fetchSeasonHistory(gameName, tagLine, platform) {
  const url = opggUrl(gameName, tagLine, platform);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let html = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // op.gg sert une page vide aux clients sans user-agent « navigateur ».
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "text/html",
      },
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }

  try {
    const $ = cheerio.load(html);
    const seasons = [];
    const seen = new Set();
    $("tr").each((_, tr) => {
      const $tr = $(tr);
      const label = $tr.find("strong").first().text().trim();
      // Libellé de saison : « S2025 », « S2024 S2 »…
      if (!/^S20\d{2}/.test(label)) return;
      const season = label.replace(/\s+/g, " ").trim();
      if (seen.has(season)) return;

      const src = $tr.find('img[src*="medals_mini"]').attr("src") || "";
      const medal = (src.match(/medals_mini\/([a-z]+)\.png/) || [])[1];
      const tier = OPGG_MEDAL_TIER[medal];
      if (!tier) return; // saison non classée : ignorée

      // Texte du palier (« silver 4 » / « master ») → division éventuelle.
      const tierTxt = $tr.find("span").first().text().trim().toLowerCase();
      const divNum = APEX.has(tier) ? null : (tierTxt.match(/\b([1-4])\b/) || [])[1];
      const division = divNum ? DIV_ARABIC_TO_ROMAN[divNum] : null;

      // LP : dernière cellule alignée à droite (nombre).
      const lpTxt = $tr.find('td[align="right"]').last().text().trim();
      const lp = num(lpTxt.replace(/[^\d]/g, ""));

      seen.add(season);
      seasons.push({
        season,
        tier,
        division,
        label: rankLabel(tier, division),
        lp,
        image: rankEmblem(tier),
      });
    });
    return seasons.slice(0, 10);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
//  Files de jeu (queueId -> libellé FR + drapeau « classée »). Sous-ensemble
//  courant ; toute file inconnue retombe sur « Partie ».
// ---------------------------------------------------------------------------
const QUEUES = {
  420: { label: "Classée Solo/Duo", ranked: true },
  440: { label: "Classée Flex", ranked: true },
  400: { label: "Normale (Draft)", ranked: false },
  430: { label: "Normale (Aveugle)", ranked: false },
  490: { label: "Normale (Rapide)", ranked: false },
  450: { label: "ARAM", ranked: false },
  700: { label: "Clash", ranked: true },
  720: { label: "ARAM Clash", ranked: false },
  830: { label: "Coop vs IA", ranked: false },
  840: { label: "Coop vs IA", ranked: false },
  850: { label: "Coop vs IA", ranked: false },
  900: { label: "URF", ranked: false },
  1020: { label: "One for All", ranked: false },
  1300: { label: "Nexus Blitz", ranked: false },
  1700: { label: "Arena", ranked: false },
  1710: { label: "Arena", ranked: false },
  1900: { label: "URF", ranked: false },
};

export function queueMeta(queueId) {
  return QUEUES[queueId] || { label: "Partie", ranked: false };
}

// ---------------------------------------------------------------------------
//  Requête Riot (X-Riot-Token + timeout). Erreur typée { status } : 404 (pas
//  trouvé), 429 (rate-limit), 5xx / réseau (API en panne) — les appelants
//  servent le dernier snapshot connu en cas d'échec.
// ---------------------------------------------------------------------------
async function riot(host, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(`https://${host}.api.riotgames.com${path}`, {
      headers: { [RIOT_KEY_HEADER]: key(), accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      e.name === "AbortError"
        ? "Riot : délai dépassé."
        : "Riot : API injoignable."
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
    /* réponse sans corps JSON */
  }
  if (!res.ok) {
    const err = new Error(
      data?.status?.message || `Riot : erreur ${res.status}.`
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
//  Data Dragon : version courante + table des champions (id numérique -> nom /
//  clé d'asset). Statique, mis en cache 12 h.
// ---------------------------------------------------------------------------
const DDRAGON = "https://ddragon.leagueoflegends.com";
let _dd = { at: 0, version: null, champById: null };
const DD_TTL = 12 * 60 * 60 * 1000;

async function ddGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`ddragon ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function dataDragon() {
  if (_dd.champById && Date.now() - _dd.at < DD_TTL) return _dd;
  try {
    const versions = await ddGet(`${DDRAGON}/api/versions.json`);
    const version = Array.isArray(versions) ? versions[0] : "14.1.1";
    const champs = await ddGet(
      `${DDRAGON}/cdn/${version}/data/fr_FR/champion.json`
    );
    const champById = {};
    for (const c of Object.values(champs?.data || {})) {
      // c.key = id numérique (string), c.id = clé d'asset (« Aatrox »), c.name = FR.
      champById[c.key] = { assetId: c.id, name: c.name };
    }
    _dd = { at: Date.now(), version, champById };
  } catch {
    if (!_dd.version) _dd = { at: 0, version: "14.1.1", champById: {} };
  }
  return _dd;
}

export function championSquare(assetId, version) {
  if (!assetId) return null;
  return `${DDRAGON}/cdn/${version || _dd.version || "14.1.1"}/img/champion/${assetId}.png`;
}

function profileIcon(iconId, version) {
  if (iconId == null) return null;
  return `${DDRAGON}/cdn/${version || _dd.version || "14.1.1"}/img/profileicon/${iconId}.png`;
}

// Emblème de rang (Community Dragon). tier en minuscules (iron…challenger).
export function rankEmblem(tier) {
  if (!tier) return null;
  const t = String(tier).toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${t}.png`;
}

// ---------------------------------------------------------------------------
//  Rang : ordre absolu pour comparer deux rangs (montée / descente).
// ---------------------------------------------------------------------------
const TIER_ORDER = [
  "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD",
  "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];
const DIVISION_ORDER = { IV: 0, III: 1, II: 2, I: 3 };
const TIER_LABEL = {
  IRON: "Fer", BRONZE: "Bronze", SILVER: "Argent", GOLD: "Or",
  PLATINUM: "Platine", EMERALD: "Émeraude", DIAMOND: "Diamant",
  MASTER: "Maître", GRANDMASTER: "Grand Maître", CHALLENGER: "Challenger",
};
// Les paliers Maître+ n'ont pas de division.
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

export function rankLabel(tier, division) {
  if (!tier) return "Non classé";
  const base = TIER_LABEL[tier] || tier;
  return APEX.has(tier) ? base : `${base} ${division || ""}`.trim();
}

// Valeur numérique croissante d'un rang (pour direction up/down des RankChange).
export function rankValue(tier, division, lp) {
  if (!tier) return 0;
  const ti = TIER_ORDER.indexOf(tier);
  if (ti < 0) return 0;
  const di = APEX.has(tier) ? 0 : DIVISION_ORDER[division] ?? 0;
  return (ti * 4 + di) * 1000 + Number(lp || 0);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (v) => Math.round(num(v) * 10) / 10;

// Normalise une entrée League-V4 (une file classée).
function normEntry(e) {
  if (!e) return null;
  const wins = num(e.wins);
  const losses = num(e.losses);
  const games = wins + losses;
  const solo = e.queueType === "RANKED_SOLO_5x5";
  return {
    queue: solo ? "solo" : "flex",
    queueLabel: solo ? "Solo/Duo" : "Flexible",
    tier: e.tier || null,
    division: e.rank || null,
    lp: num(e.leaguePoints),
    wins,
    losses,
    games,
    winRate: games ? round1((wins / games) * 100) : 0,
    label: rankLabel(e.tier, e.rank),
    emblem: rankEmblem(e.tier),
    value: rankValue(e.tier, e.rank, e.leaguePoints),
    hotStreak: !!e.hotStreak,
  };
}

// ---------------------------------------------------------------------------
//  Résolution d'un joueur à partir d'un Riot ID (« Pseudo#TAG »).
// ---------------------------------------------------------------------------
export function parseRiotId(input) {
  const s = String(input || "").trim();
  const m = s.match(/^(.+)#([A-Za-z0-9]{2,5})$/);
  if (!m) return null;
  return { gameName: m[1].trim(), tagLine: m[2].trim() };
}

// { gameName, tagLine, region } -> { puuid, name, region, tagLine }
export async function resolvePlayer(input, region) {
  const platform = normalizePlatform(region);
  const parsed = parseRiotId(input);
  if (!parsed) {
    const err = new Error(
      "Renseigne ton Riot ID au format Pseudo#TAG (ex. Faker#KR1)."
    );
    err.status = 422;
    throw err;
  }
  const cluster = clusterFor(platform);
  const acc = await riot(
    cluster,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
      parsed.gameName
    )}/${encodeURIComponent(parsed.tagLine)}`
  );
  if (!acc?.puuid) return null;
  return {
    puuid: acc.puuid,
    name: `${acc.gameName || parsed.gameName}#${acc.tagLine || parsed.tagLine}`,
    gameName: acc.gameName || parsed.gameName,
    tagLine: acc.tagLine || parsed.tagLine,
    region: platform,
  };
}

// Entrées classées (League-V4). Riot a déprécié le champ `id` (encrypted
// summonerId) du retour Summoner-V4 : dans de nombreuses régions il revient
// désormais vide, ce qui cassait la récupération du rang via
// `by-summoner/{summonerId}` (→ joueur affiché « Non classé » à tort). On
// passe donc par `by-puuid/{puuid}`, indépendant du summonerId, avec repli sur
// l'ancien endpoint si jamais il n'est pas disponible.
async function fetchLeagueEntries(platform, puuid, summonerId) {
  try {
    const byPuuid = await riot(
      platform,
      `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
    );
    if (Array.isArray(byPuuid) && byPuuid.length) return byPuuid;
    // Tableau vide légitime (vraiment non classé) → on le renvoie tel quel,
    // sauf si on peut encore tenter l'ancien endpoint par summonerId.
    if (!summonerId) return byPuuid || [];
  } catch {
    /* endpoint indisponible : on tente le repli par summonerId */
  }
  if (summonerId) {
    try {
      return await riot(
        platform,
        `/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`
      );
    } catch {
      /* pas de rang / indisponible */
    }
  }
  return [];
}

// Construit { ranks, rank } normalisés à partir des entrées League-V4.
// `rank` = file principale (Solo si dispo, sinon Flex) sous la forme générique
// { tier, score, image } attendue par le badge d'onglet / la vue profil.
function ranksFromEntries(entries) {
  const ranks = (entries || [])
    .map(normEntry)
    .filter((e) => e && (e.queue === "solo" || e.queue === "flex"))
    .sort((a, b) => (a.queue === "solo" ? -1 : 1));
  const rank = ranks[0]
    ? {
        tier: ranks[0].label,
        score: ranks[0].lp,
        image: ranks[0].emblem,
        queue: ranks[0].queueLabel,
        value: ranks[0].value,
        rawTier: ranks[0].tier,
        division: ranks[0].division,
      }
    : null;
  return { ranks, rank };
}

// Aperçu LÉGER (identité + rang, sans historique ni maîtrise) : utilisé par la
// prévisualisation au moment de lier un compte (rapide, 2-3 requêtes).
export async function fetchPlayerLite(puuid, region) {
  const platform = normalizePlatform(region);
  const dd = await dataDragon();
  let summoner = null;
  try {
    summoner = await riot(
      platform,
      `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
    );
  } catch {
    /* best-effort */
  }
  const entries = await fetchLeagueEntries(platform, puuid, summoner?.id);
  const { ranks, rank } = ranksFromEntries(entries);
  return {
    level: num(summoner?.summonerLevel),
    icon: profileIcon(summoner?.profileIconId, dd.version),
    ranks,
    rank,
  };
}

// ---------------------------------------------------------------------------
//  Récupération complète + normalisation en snapshot stable.
// ---------------------------------------------------------------------------
const MATCH_DETAIL_COUNT = 12; // parties dont on lit le détail (K/D/A, durée…)

// Score de performance ~ « OP Score » (heuristique maison, Riot n'en fournit
// pas) : récompense éliminations/assists/farm/dégâts, pénalise les morts et
// pondère par la participation aux kills de l'équipe. Sert au classement 1er-10e
// et aux badges MVP (meilleur de l'équipe gagnante) / ACE (meilleur des perdants).
function perfScore(p, teamKills) {
  const k = num(p.kills);
  const d = num(p.deaths);
  const a = num(p.assists);
  const cs = num(p.totalMinionsKilled) + num(p.neutralMinionsKilled);
  const dmg = num(p.totalDamageDealtToChampions);
  const kp = teamKills ? (k + a) / teamKills : 0;
  return (
    (k * 2.2 + a * 1.3 + cs * 0.02 + dmg * 0.00012 + kp * 4) / (1 + d * 0.9)
  );
}

// Détail d'une partie Match-V5 -> forme stable, du point de vue de `puuid`.
function normMatch(raw, puuid, dd) {
  const info = raw?.info;
  if (!info || !Array.isArray(info.participants)) return null;
  const me = info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;
  const q = queueMeta(info.queueId);
  const durationSec = num(info.gameDuration);
  const champ = dd.champById?.[String(me.championId)];
  const k = num(me.kills);
  const d = num(me.deaths);
  const a = num(me.assists);
  const cs = num(me.totalMinionsKilled) + num(me.neutralMinionsKilled);
  const mins = durationSec / 60;
  // Remake : partie annulée (reddition anticipée avant ~3 min) → ni victoire ni
  // défaite. Le flag Riot est fiable ; repli sur durée très courte.
  const remake =
    me.gameEndedInEarlySurrender === true ||
    (durationSec > 0 && durationSec < 240 && info.participants.every((p) => num(p.kills) + num(p.deaths) <= 1));

  // Kills par équipe (pour la participation) + score de perf par joueur.
  const teamKills = { 100: 0, 200: 0 };
  for (const p of info.participants) teamKills[p.teamId] += num(p.kills);
  const scored = info.participants.map((p) => ({
    p,
    score: perfScore(p, teamKills[p.teamId]),
  }));
  // Classement global 1..10 (meilleur score = 1er).
  const ranking = [...scored].sort((x, y) => y.score - x.score);
  const placeOf = new Map();
  ranking.forEach((s, i) => placeOf.set(s.p.puuid, i + 1));
  // Meilleur de chaque équipe → MVP (gagnants) / ACE (perdants).
  const bestOfTeam = {};
  for (const teamId of [100, 200]) {
    const best = scored
      .filter((s) => s.p.teamId === teamId)
      .sort((x, y) => y.score - x.score)[0];
    if (best) bestOfTeam[teamId] = best.p.puuid;
  }

  // Scoreboard (deux équipes de 5) pour l'affichage déplié côté profil.
  const teams = [100, 200].map((teamId) => {
    const teamWin = info.participants.find((p) => p.teamId === teamId)?.win === true;
    return {
      teamId,
      win: teamWin,
      players: info.participants
        .filter((p) => p.teamId === teamId)
        .map((p) => {
          const c = dd.champById?.[String(p.championId)];
          const pk = num(p.kills);
          const pd = num(p.deaths);
          const pa = num(p.assists);
          const isBest = bestOfTeam[teamId] === p.puuid;
          return {
            name:
              p.riotIdGameName ||
              p.summonerName ||
              p.riotIdTagline ||
              "Invocateur",
            champ: c?.name || p.championName || "?",
            thumb: championSquare(c?.assetId || p.championName, dd.version),
            k: pk,
            d: pd,
            a: pa,
            kda: pd ? round1((pk + pa) / pd) : round1(pk + pa),
            cs: num(p.totalMinionsKilled) + num(p.neutralMinionsKilled),
            win: p.win === true,
            me: p.puuid === puuid,
            place: placeOf.get(p.puuid) || null,
            // Badge « OP » : MVP (meilleur gagnant) / ACE (meilleur perdant).
            badge: isBest ? (teamWin ? "mvp" : "ace") : null,
          };
        }),
    };
  });

  return {
    matchUid: String(raw.metadata?.matchId || info.gameId || ""),
    playedAt: new Date(num(info.gameEndTimestamp || info.gameCreation)),
    hero: {
      name: champ?.name || me.championName || "Champion",
      thumb: championSquare(champ?.assetId || me.championName, dd.version),
    },
    champion: champ?.name || me.championName || "Champion",
    championId: me.championId,
    k,
    d,
    a,
    kda: d ? round1((k + a) / d) : round1(k + a),
    win: me.win === true,
    remake,
    queueId: info.queueId,
    mode: q.label,
    ranked: q.ranked,
    durationSec,
    cs,
    csPerMin: mins ? round1(cs / mins) : 0,
    championLevel: num(me.champLevel),
    position: me.teamPosition || me.individualPosition || null,
    myBadge: bestOfTeam[me.teamId] === puuid ? (me.win ? "mvp" : "ace") : null,
    myPlace: placeOf.get(puuid) || null,
    teams,
  };
}

// Renvoie { snapshot, matches } pour un puuid + sa région.
export async function fetchPlayerData(puuid, region) {
  const platform = normalizePlatform(region);
  const cluster = clusterFor(platform);
  const dd = await dataDragon();

  // 1. Identité (niveau, icône) — Summoner-V4.
  let summoner = null;
  try {
    summoner = await riot(
      platform,
      `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
    );
  } catch {
    /* best-effort : le rang et les matchs restent lisibles sans ça */
  }

  // 2. Rang Solo/Flex — League-V4 (par puuid, repli par summonerId).
  const entries = await fetchLeagueEntries(platform, puuid, summoner?.id);
  const { ranks, rank } = ranksFromEntries(entries);

  // 3. Historique de parties — Match-V5 (ids puis détails).
  let matches = [];
  try {
    const ids = await riot(
      cluster,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(
        puuid
      )}/ids?start=0&count=${MATCH_DETAIL_COUNT}`
    );
    const details = await Promise.all(
      (ids || []).map((id) =>
        riot(cluster, `/lol/match/v5/matches/${encodeURIComponent(id)}`).catch(
          () => null
        )
      )
    );
    matches = details
      .map((m) => (m ? normMatch(m, puuid, dd) : null))
      .filter(Boolean)
      .sort((a, b) => b.playedAt - a.playedAt);
  } catch {
    /* historique indisponible */
  }

  // 4. Maîtrise des champions — Champion-Mastery-V4 (top 6).
  let mastery = [];
  try {
    const raw = await riot(
      platform,
      `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(
        puuid
      )}/top?count=6`
    );
    mastery = (raw || []).map((m) => {
      const c = dd.champById?.[String(m.championId)];
      return {
        id: m.championId,
        name: c?.name || `#${m.championId}`,
        thumb: championSquare(c?.assetId, dd.version),
        points: num(m.championPoints),
        level: num(m.championLevel),
      };
    });
  } catch {
    /* maîtrise indisponible */
  }

  // --- Agrégats sur les parties lues (le détail par partie n'existe que là).
  //     Les remakes sont exclus du bilan V/D (comme op.gg). ---
  let k = 0, d = 0, a = 0, cs = 0, dur = 0, wins = 0, counted = 0;
  const byChamp = new Map();
  const byMate = new Map(); // coéquipiers récurrents (« joué avec »)
  for (const m of matches) {
    if (m.remake) continue; // remake : ne compte pas
    counted++;
    k += m.k; d += m.d; a += m.a; cs += m.cs; dur += m.durationSec;
    if (m.win) wins++;
    const key = m.championId;
    const e =
      byChamp.get(key) ||
      { id: m.championId, name: m.champion, thumb: m.hero.thumb, games: 0, wins: 0, k: 0, d: 0, a: 0, cs: 0, dur: 0 };
    e.games++;
    if (m.win) e.wins++;
    e.k += m.k; e.d += m.d; e.a += m.a; e.cs += m.cs; e.dur += m.durationSec;
    byChamp.set(key, e);

    // Coéquipiers (même équipe que moi, hors moi) : nombre de parties + victoires.
    const myTeam = (m.teams || []).find((t) => t.players.some((p) => p.me));
    for (const p of myTeam?.players || []) {
      if (p.me) continue;
      const me2 = byMate.get(p.name) || { name: p.name, thumb: p.thumb, games: 0, wins: 0 };
      me2.games++;
      if (m.win) me2.wins++;
      byMate.set(p.name, me2);
    }
  }
  const champions = [...byChamp.values()]
    .map((e) => {
      const mins = e.dur / 60;
      return {
        id: e.id,
        name: e.name,
        thumb: e.thumb,
        games: e.games,
        wins: e.wins,
        winRate: e.games ? round1((e.wins / e.games) * 100) : 0,
        kda: e.d ? round1((e.k + e.a) / e.d) : round1(e.k + e.a),
        // Moyennes par partie (comme op.gg : K / D / A + CS + CS/min).
        avgK: round1(e.k / e.games),
        avgD: round1(e.d / e.games),
        avgA: round1(e.a / e.games),
        cs: e.games ? Math.round(e.cs / e.games) : 0,
        csPerMin: mins ? round1(e.cs / mins) : 0,
        // Maîtrise (si dispo) pour enrichir la vignette.
        mastery: mastery.find((mm) => mm.id === e.id) || null,
      };
    })
    .sort((x, y) => y.games - x.games)
    .slice(0, 6);

  // Coéquipiers récurrents (au moins 2 parties ensemble), triés par fréquence.
  const playedWith = [...byMate.values()]
    .filter((mm) => mm.games >= 2)
    .map((mm) => ({
      name: mm.name,
      thumb: mm.thumb,
      games: mm.games,
      wins: mm.wins,
      winRate: mm.games ? round1((mm.wins / mm.games) * 100) : 0,
    }))
    .sort((x, y) => y.games - x.games)
    .slice(0, 6);

  const snapshot = {
    provider: "league-of-legends",
    puuid,
    region: platform,
    name: summoner ? null : null, // le pseudo « affiché » est porté par le tracker
    level: num(summoner?.summonerLevel),
    icon: profileIcon(summoner?.profileIconId, dd.version),
    ranks,
    // Rang « principal » (Solo si dispo, sinon Flex), forme générique commune.
    rank,
    overall: {
      matches: counted,
      wins,
      losses: Math.max(0, counted - wins),
      winRate: counted ? round1((wins / counted) * 100) : 0,
      kills: k,
      deaths: d,
      assists: a,
      kda: d ? round1((k + a) / d) : round1(k + a),
      csPerMin: dur ? round1(cs / (dur / 60)) : 0,
      hoursRecent: round1(dur / 3600),
    },
    champions,
    playedWith,
    mastery,
    masteryTotal: mastery.reduce((s, m) => s + m.points, 0),
    recentMatches: matches.slice(0, MATCH_DETAIL_COUNT),
    updatedAt: new Date().toISOString(),
  };

  return { snapshot, matches };
}

// Fenêtre d'IDs de parties (récent -> ancien), Match-V5 pagine via start/count.
// Appel léger (1 requête) : sert de « sommaire » pour la pagination « Voir plus ».
export async function fetchMatchIds(puuid, region, { start = 0, count = 10 } = {}) {
  const cluster = clusterFor(normalizePlatform(region));
  const ids = await riot(
    cluster,
    `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${Math.max(
      0,
      start | 0
    )}&count=${Math.min(50, Math.max(1, count | 0))}`
  );
  return ids || [];
}

// Détail normalisé d'une liste d'IDs (mêmes champs que recentMatches). Un appel
// Riot par partie : à n'appeler que pour les parties absentes du cache serveur.
export async function fetchMatchDetails(puuid, region, ids) {
  if (!ids?.length) return [];
  const cluster = clusterFor(normalizePlatform(region));
  const dd = await dataDragon();
  const details = await Promise.all(
    ids.map((id) =>
      riot(cluster, `/lol/match/v5/matches/${encodeURIComponent(id)}`).catch(() => null)
    )
  );
  return details.map((m) => (m ? normMatch(m, puuid, dd) : null)).filter(Boolean);
}

// Page suivante de l'historique (bouton « Voir plus ») : IDs puis détails.
export async function fetchMatchPage(puuid, region, opts = {}) {
  const ids = await fetchMatchIds(puuid, region, opts);
  const matches = await fetchMatchDetails(puuid, region, ids);
  return matches.sort((a, b) => b.playedAt - a.playedAt);
}

// ---------------------------------------------------------------------------
//  Jaquette IGDB « League of Legends » (habillage de l'onglet). Cache 24 h.
// ---------------------------------------------------------------------------
let _cover = { at: 0, url: null };
const COVER_TTL = 24 * 60 * 60 * 1000;

export async function getGameCover() {
  if (_cover.url && Date.now() - _cover.at < COVER_TTL) return _cover.url;
  try {
    const rows = await igdbQuery(
      "games",
      `search "League of Legends"; fields name, cover.image_id; limit 10;`
    );
    const exact =
      (rows || []).find((g) => /^league of legends$/i.test(g.name || "")) ||
      (rows || []).find((g) => g.cover?.image_id);
    const id = exact?.cover?.image_id;
    _cover = {
      at: Date.now(),
      url: id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`
        : null,
    };
  } catch {
    if (!_cover.at) _cover = { at: 0, url: null };
  }
  return _cover.url;
}
