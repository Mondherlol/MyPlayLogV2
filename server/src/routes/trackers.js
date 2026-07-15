import express from "express";
import GameTracker from "../models/GameTracker.js";
import TrackerMatch from "../models/TrackerMatch.js";
import LolMatch from "../models/LolMatch.js";
import RankChange from "../models/RankChange.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  isConfigured,
  resolvePlayer,
  fetchPlayerData,
  fetchMatchHistoryPage,
  updatePlayer,
  matchDetail,
  getGameAssets,
  extractUid,
  findPlayer,
  searchPlayersByName,
} from "../lib/marvelRivals.js";
import {
  SEASONS,
  CURRENT_SEASON_VALUE,
  rankLabel,
  rankImage,
} from "../lib/marvelRivalsData.js";
import * as lol from "../lib/leagueOfLegends.js";
import { igdbQuery } from "../lib/igdb.js";

// Habillage IGDB des jeux du sélecteur de liaison : jaquette (portrait, pour les
// cartes) + backdrop (artwork paysage 1080p, pour la bannière de la modale — même
// visuel « sexy » que le fond de la page du jeu). Best-effort, cache 24 h.
const IGDB_IMG = "https://images.igdb.com/igdb/image/upload";
const igImg = (id, size) => (id ? `${IGDB_IMG}/${size}/${id}.jpg` : null);
const TRACKER_GAME_NAMES = {
  "marvel-rivals": "Marvel Rivals",
  "league-of-legends": "League of Legends",
  valorant: "Valorant",
  tft: "Teamfight Tactics",
};
let _artCache = { at: 0, data: null };
const ART_TTL = 24 * 60 * 60 * 1000;

// Jaquette + artwork paysage d'un jeu par nom (match exact prioritaire).
async function gameArt(name) {
  const rows = await igdbQuery(
    "games",
    `search "${name}"; fields name, cover.image_id, artworks.image_id, screenshots.image_id; limit 10;`
  );
  const list = rows || [];
  const exact = list.find((g) => (g.name || "").toLowerCase() === name.toLowerCase());
  const g = exact || list.find((x) => x.cover?.image_id) || list[0] || {};
  const artId = g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id || null;
  return {
    cover: igImg(g.cover?.image_id, "t_cover_big"),
    backdrop: igImg(artId, "t_1080p"),
  };
}

async function getTrackerArt() {
  if (_artCache.data && Date.now() - _artCache.at < ART_TTL) return _artCache.data;
  const entries = await Promise.all(
    Object.entries(TRACKER_GAME_NAMES).map(async ([provider, name]) => {
      try {
        return [provider, await gameArt(name)];
      } catch {
        return [provider, { cover: null, backdrop: null }];
      }
    })
  );
  _artCache = { at: Date.now(), data: Object.fromEntries(entries) };
  return _artCache.data;
}

// Deux parties classées séparées de plus de 3 h = deux sessions distinctes
// (pour regrouper une montée/descente de rang sur une même session de jeu).
const RANK_SESSION_GAP = 3 * 60 * 60 * 1000;

// Détecte un changement de rang entre deux parties classées consécutives et
// ouvre/étend un document RankChange (card de fil). Best-effort : jamais bloquant.
async function applyRankTransition(tracker, prev, cur) {
  const dir = cur.rankLevel > prev.rankLevel ? "up" : "down";
  // Session ouverte récente et CONTINUE (son rang courant = celui d'avant la
  // partie) → on l'étend en place plutôt que d'empiler les cards.
  const open = await RankChange.findOne({
    user: tracker.user,
    provider: tracker.provider,
  }).sort({ lastAt: -1 });
  const continues =
    open &&
    cur.playedAt - open.lastAt <= RANK_SESSION_GAP &&
    open.newLevel === prev.rankLevel;

  if (continues) {
    open.newLevel = cur.rankLevel;
    open.newScore = cur.rankScore;
    open.newTier = rankLabel(cur.rankLevel);
    open.newImage = rankImage(cur.rankLevel);
    open.lastAt = cur.playedAt;
    open.direction = open.newLevel > open.oldLevel ? "up" : "down";
    if (cur.matchUid && !open.matchUids.includes(cur.matchUid))
      open.matchUids.push(cur.matchUid);
    // Retour exact au rang de départ → plus de changement net : on retire la card.
    if (open.newLevel === open.oldLevel) await open.deleteOne();
    else await open.save();
    return;
  }

  await RankChange.create({
    user: tracker.user,
    provider: tracker.provider,
    oldLevel: prev.rankLevel,
    oldScore: prev.rankScore,
    oldTier: rankLabel(prev.rankLevel),
    oldImage: rankImage(prev.rankLevel),
    newLevel: cur.rankLevel,
    newScore: cur.rankScore,
    newTier: rankLabel(cur.rankLevel),
    newImage: rankImage(cur.rankLevel),
    direction: dir,
    hero: cur.hero || null,
    firstAt: cur.playedAt,
    lastAt: cur.playedAt,
    matchUids: cur.matchUid ? [cur.matchUid] : [],
  });
}

// Tracking des performances in-game (Marvel Rivals en premier). Liaison par
// pseudo, snapshot des stats + génération de cartes de fil sur les nouvelles
// parties. Générique : `provider` paramètre tout, prêt pour LoL / Valorant.
const router = express.Router();

// Fraîcheur : au-delà, une ouverture de profil déclenche une resynchro de fond.
const SNAPSHOT_TTL = 10 * 60 * 1000; // 10 min
// Cooldown du bouton « Actualiser » (respecte le rate-limit dynamique de l'API).
const REFRESH_COOLDOWN = 60 * 1000; // 60 s

// Libellé humain d'un provider (titre des cartes, badges d'onglet).
export const PROVIDER_LABEL = {
  "marvel-rivals": "Marvel Rivals",
  "league-of-legends": "League of Legends",
};

// Vue publique d'un tracker (pas de secret : uniquement l'id public + snapshot).
function trackerPublic(t) {
  return {
    provider: t.provider,
    label: PROVIDER_LABEL[t.provider] || t.provider,
    uid: t.externalUid,
    externalName: t.externalName,
    profileUrl: t.profileUrl,
    region: t.region || null,
    connectedAt: t.connectedAt,
    snapshot: t.snapshot || null,
    snapshotAt: t.snapshotAt || null,
    lastSyncAt: t.lastSyncAt || null,
    // Historique classé (LoL) : saisons passées + pic par file. null ailleurs.
    rankHistory: t.rankHistory || null,
  };
}

// Synchronise un tracker Marvel Rivals : refetch stats (snapshot) + matchs.
// `emitFeed` = true : on enregistre les parties postérieures au curseur
// `lastMatchUid` (→ cartes de fil). `emitFeed` = false (1re synchro au link) :
// on pose juste le curseur SANS créer de TrackerMatch (pas d'inondation du fil
// avec de vieilles parties). Best-effort : si l'API tombe, on garde l'ancien
// snapshot et on ne throw pas.
async function syncMarvelRivals(tracker, { emitFeed = true } = {}) {
  let processing = false;
  let matches = [];
  // 1. Snapshot + matchs via l'orchestrateur (rivalsmeta / marvelrivalsapi).
  //    Un échec (API down) ne throw pas : on garde l'ancien snapshot.
  try {
    const data = await fetchPlayerData(tracker.externalUid);
    processing = data.processing;
    matches = data.matches || [];
    if (data.snapshot) {
      // On embarque les derniers matchs DANS le snapshot : l'onglet Tracking les
      // affiche immédiatement (même juste après la liaison), indépendamment de la
      // collection TrackerMatch qui, elle, ne sert qu'aux cartes de fil.
      data.snapshot.recentMatches = matches.slice(0, 20);
      tracker.snapshot = data.snapshot;
      tracker.snapshotAt = new Date();
      tracker.markModified("snapshot");
    }
  } catch (e) {
    if (e.status === 202 || e.status === 409) processing = true;
  }

  // 2. Matchs récents → cartes de fil pour les nouveaux (curseur lastMatchUid).
  let added = 0;
  try {
    // Du plus ancien au plus récent : on s'arrête au curseur déjà connu.
    const chrono = [...matches].sort((a, b) => a.playedAt - b.playedAt);
    const newest =
      matches.reduce((mx, m) => (!mx || m.playedAt > mx.playedAt ? m : mx), null)
        ?.matchUid || tracker.lastMatchUid;

    if (emitFeed && tracker.lastMatchUid) {
      const fresh = [];
      for (let i = chrono.length - 1; i >= 0; i--) {
        if (chrono[i].matchUid === tracker.lastMatchUid) break;
        fresh.push(chrono[i]);
      }
      fresh.reverse();
      const freshUids = new Set(fresh.map((m) => m.matchUid));
      for (const m of fresh) {
        try {
          const r = await TrackerMatch.updateOne(
            { user: tracker.user, matchUid: m.matchUid },
            {
              $setOnInsert: {
                user: tracker.user,
                provider: tracker.provider,
                matchUid: m.matchUid,
                playedAt: m.playedAt,
                hero: m.hero,
                k: m.k,
                d: m.d,
                a: m.a,
                kda: m.kda,
                win: m.win,
                mode: m.mode,
                map: m.map,
                rankLevel: m.rankLevel ?? null,
                rankScore: m.rankScore ?? null,
                scoreDelta: m.scoreDelta ?? null,
              },
            },
            { upsert: true }
          );
          if (r.upsertedCount) added++;
        } catch {
          /* doublon concurrent : ignoré */
        }
      }

      // Montées/descentes de rang : sur la suite des parties CLASSÉES (rang connu),
      // toute transition de niveau vers/depuis une NOUVELLE partie ouvre ou étend
      // une card RankChange. Best-effort, jamais bloquant pour la synchro.
      try {
        const rankedChrono = chrono.filter((m) => m.rankLevel != null);
        for (let i = 1; i < rankedChrono.length; i++) {
          const cur = rankedChrono[i];
          const prev = rankedChrono[i - 1];
          if (!freshUids.has(cur.matchUid)) continue; // uniquement les nouvelles
          if (cur.rankLevel === prev.rankLevel) continue; // pas de changement de rang
          await applyRankTransition(tracker, prev, cur);
        }
      } catch (e) {
        console.error("rank transition error:", e.message);
      }
    }
    if (newest) tracker.lastMatchUid = newest;
  } catch {
    /* historique indisponible : on garde le curseur en l'état */
  }

  tracker.lastSyncAt = new Date();
  await tracker.save();
  return { processing, added };
}

// ===========================================================================
//  League of Legends (API officielle Riot — synchro entièrement automatique)
// ===========================================================================

// Détecte un changement de PALIER (tier/division, pas le simple LP) du rang Solo
// entre deux synchros et ouvre/étend une card RankChange de fil. Best-effort.
async function applyLolRankChange(tracker, prev, cur, hero) {
  if (!prev || !cur) return;
  // Ne compare que le même type de file (Solo vs Solo) : sinon l'apparition d'un
  // rang Solo chez un joueur qui n'avait que du Flex créerait une fausse carte.
  if (prev.queue && cur.queue && prev.queue !== cur.queue) return;
  // On n'émet que sur un changement de palier ou de division (pas de spam LP).
  if (prev.rawTier === cur.rawTier && prev.division === cur.division) return;

  const dir = cur.value > prev.value ? "up" : "down";
  const open = await RankChange.findOne({
    user: tracker.user,
    provider: tracker.provider,
  }).sort({ lastAt: -1 });
  const continues =
    open &&
    Date.now() - new Date(open.lastAt).getTime() <= RANK_SESSION_GAP &&
    open.newLevel === prev.value;

  if (continues) {
    open.newLevel = cur.value;
    open.newScore = cur.lp;
    open.newTier = cur.tier;
    open.newImage = cur.image;
    open.lastAt = new Date();
    open.direction = open.newLevel > open.oldLevel ? "up" : "down";
    if (open.newLevel === open.oldLevel) await open.deleteOne();
    else await open.save();
    return;
  }

  await RankChange.create({
    user: tracker.user,
    provider: tracker.provider,
    oldLevel: prev.value,
    oldScore: prev.lp,
    oldTier: prev.tier,
    oldImage: prev.image,
    newLevel: cur.value,
    newScore: cur.lp,
    newTier: cur.tier,
    newImage: cur.image,
    direction: dir,
    hero: hero || null,
    firstAt: new Date(),
    lastAt: new Date(),
    matchUids: [],
  });
}

// Met à jour le PIC de rang par file (notre propre historique, construit au fil
// des synchros). Un rang courant qui dépasse le pic connu le remplace. Renvoie
// true si un pic a changé (pour persister). `ranks` = snapshot.ranks (normEntry).
function updateLolPeaks(tracker, ranks) {
  if (!Array.isArray(ranks) || !ranks.length) return false;
  const rh = tracker.rankHistory || {};
  const peak = { ...(rh.peak || {}) };
  let changed = false;
  for (const r of ranks) {
    if (!r?.queue || !r.tier) continue;
    const cur = peak[r.queue];
    if (!cur || (r.value || 0) > (cur.value || 0)) {
      peak[r.queue] = {
        tier: r.tier,
        division: r.division || null,
        label: r.label,
        lp: r.lp || 0,
        value: r.value || 0,
        image: r.emblem || null,
        at: new Date(),
      };
      changed = true;
    }
  }
  if (changed) {
    tracker.rankHistory = { ...rh, peak };
    tracker.markModified("rankHistory");
  }
  return changed;
}

// Backfill (best-effort) de l'historique de saisons via op.gg. On ne le fait
// qu'une fois par compte (sauf `force`) : les saisons passées ne changent plus.
// N'échoue jamais. `tracker.externalName` = « Pseudo#TAG » (résout gameName/tag).
async function backfillLolSeasons(tracker, { force = false } = {}) {
  if (!force && tracker.rankHistory?.seasons?.length) return false;
  const parsed = lol.parseRiotId(tracker.externalName);
  if (!parsed) return false;
  try {
    const seasons = await lol.fetchSeasonHistory(
      parsed.gameName,
      parsed.tagLine,
      tracker.region
    );
    if (!seasons.length) return false;
    tracker.rankHistory = {
      ...(tracker.rankHistory || {}),
      seasons,
      seasonsSource: "opgg",
      seasonsAt: new Date(),
    };
    tracker.markModified("rankHistory");
    await tracker.save();
    return true;
  } catch (e) {
    console.error("lol season backfill error:", e.message);
    return false;
  }
}

// Synchronise un tracker LoL : refetch snapshot (rang/champions/parties) +
// enregistre les nouvelles parties (cartes de fil) + détecte les changements de
// palier. `emitFeed=false` (1re synchro au link) : on pose juste les curseurs
// sans inonder le fil. Best-effort : si l'API Riot tombe, on garde l'ancien snapshot.
async function syncLeagueOfLegends(tracker, { emitFeed = true } = {}) {
  // Rang Solo AVANT synchro (pour détecter un changement de palier).
  const prevSolo =
    tracker.snapshot?.rank && tracker.snapshot.rank.rawTier
      ? {
          rawTier: tracker.snapshot.rank.rawTier,
          division: tracker.snapshot.rank.division,
          value: tracker.snapshot.rank.value,
          lp: tracker.snapshot.rank.score,
          tier: tracker.snapshot.rank.tier,
          image: tracker.snapshot.rank.image,
          queue: tracker.snapshot.rank.queue,
        }
      : null;

  let matches = [];
  try {
    const data = await lol.fetchPlayerData(tracker.externalUid, tracker.region);
    matches = data.matches || [];
    if (data.snapshot) {
      tracker.snapshot = data.snapshot;
      tracker.snapshotAt = new Date();
      tracker.markModified("snapshot");
      // Notre historique maison : on fait grandir le pic de rang par file.
      updateLolPeaks(tracker, data.snapshot.ranks);
    }
  } catch (e) {
    console.error("lol sync fetch error:", e.message);
  }

  // Nouvelles parties -> TrackerMatch (curseur lastMatchUid), comme Marvel.
  let added = 0;
  try {
    const chrono = [...matches].sort((a, b) => a.playedAt - b.playedAt);
    const newest =
      matches.reduce((mx, m) => (!mx || m.playedAt > mx.playedAt ? m : mx), null)
        ?.matchUid || tracker.lastMatchUid;

    if (emitFeed && tracker.lastMatchUid) {
      const fresh = [];
      for (let i = chrono.length - 1; i >= 0; i--) {
        if (chrono[i].matchUid === tracker.lastMatchUid) break;
        fresh.push(chrono[i]);
      }
      fresh.reverse();
      for (const m of fresh) {
        try {
          const r = await TrackerMatch.updateOne(
            { user: tracker.user, matchUid: m.matchUid },
            {
              $setOnInsert: {
                user: tracker.user,
                provider: tracker.provider,
                matchUid: m.matchUid,
                playedAt: m.playedAt,
                hero: m.hero,
                k: m.k,
                d: m.d,
                a: m.a,
                kda: m.kda,
                win: m.win,
                mode: m.mode, // libellé de file (« Classée Solo/Duo »…)
                map: null,
                rankLevel: null,
                rankScore: null,
                scoreDelta: null,
              },
            },
            { upsert: true }
          );
          if (r.upsertedCount) added++;
        } catch {
          /* doublon concurrent : ignoré */
        }
      }

      // Changement de palier Solo : héros = champion le plus joué du snapshot.
      try {
        const curSolo = tracker.snapshot?.rank?.rawTier
          ? {
              rawTier: tracker.snapshot.rank.rawTier,
              division: tracker.snapshot.rank.division,
              value: tracker.snapshot.rank.value,
              lp: tracker.snapshot.rank.score,
              tier: tracker.snapshot.rank.tier,
              image: tracker.snapshot.rank.image,
              queue: tracker.snapshot.rank.queue,
            }
          : null;
        const topChamp = tracker.snapshot?.champions?.[0];
        await applyLolRankChange(
          tracker,
          prevSolo,
          curSolo,
          topChamp ? { name: topChamp.name, thumb: topChamp.thumb } : null
        );
      } catch (e) {
        console.error("lol rank change error:", e.message);
      }
    }
    if (newest) tracker.lastMatchUid = newest;
  } catch {
    /* historique indisponible : curseur inchangé */
  }

  tracker.lastSyncAt = new Date();
  await tracker.save();
  return { added };
}

// GET /api/trackers/status — mes liaisons + état de configuration serveur +
// jaquettes IGDB des jeux (habillage des cartes de liaison).
router.get("/status", requireAuth, async (req, res) => {
  try {
    const [trackers, marvelAssets, lolCover, art] = await Promise.all([
      GameTracker.find({ user: req.userId }).lean(),
      getGameAssets().catch(() => ({ cover: null })),
      lol.getGameCover().catch(() => null),
      getTrackerArt().catch(() => ({})),
    ]);
    res.json({
      configured: isConfigured(),
      lolConfigured: lol.isConfigured(),
      lolRegions: lol.REGIONS,
      games: {
        "marvel-rivals": marvelAssets.cover || art["marvel-rivals"]?.cover || null,
        "league-of-legends": lolCover || art["league-of-legends"]?.cover || null,
        valorant: art.valorant?.cover || null,
        tft: art.tft?.cover || null,
      },
      backdrops: {
        "marvel-rivals": art["marvel-rivals"]?.backdrop || null,
        "league-of-legends": art["league-of-legends"]?.backdrop || null,
        valorant: art.valorant?.backdrop || null,
        tft: art.tft?.backdrop || null,
      },
      trackers: trackers.map(trackerPublic),
    });
  } catch (err) {
    console.error("trackers status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/trackers/league-of-legends/preview { riotId, region } — recherche un
// compte SANS le lier : renvoie icône d'invocateur + niveau + rang pour que
// l'utilisateur confirme que c'est bien le sien avant de lier.
router.post("/league-of-legends/preview", requireAuth, async (req, res) => {
  try {
    if (!lol.isConfigured())
      return res
        .status(503)
        .json({ error: "League of Legends n'est pas configuré côté serveur." });
    const riotId = String(req.body?.riotId || req.body?.input || "").trim();
    const region = lol.normalizePlatform(req.body?.region);
    if (!riotId)
      return res.status(400).json({ error: "Renseigne ton Riot ID (Pseudo#TAG)." });

    const player = await lol.resolvePlayer(riotId, region);
    if (!player)
      return res
        .status(404)
        .json({ error: "Invocateur introuvable. Vérifie ton Riot ID et ta région." });

    const lite = await lol.fetchPlayerLite(player.puuid, player.region);
    const clash = await GameTracker.findOne({
      provider: "league-of-legends",
      externalUid: player.puuid,
      user: { $ne: req.userId },
    }).select("_id");

    res.json({
      preview: {
        name: player.name,
        region: player.region,
        icon: lite.icon,
        level: lite.level,
        rank: lite.rank,
        ranks: lite.ranks,
        takenByOther: !!clash,
      },
    });
  } catch (err) {
    console.error("lol preview error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Recherche impossible pour le moment." });
  }
});

// POST /api/trackers/marvel-rivals/search { input } — recherche par PSEUDO et
// renvoie la liste des joueurs correspondants (pseudos non uniques → l'utilisateur
// choisit le sien). Un uid / une URL collée renvoie un candidat unique. La recherche
// par nom passe par rivalsmeta (sans clé) ; repli marvelrivalsapi si configuré.
router.post("/marvel-rivals/search", requireAuth, async (req, res) => {
  try {
    const input = String(req.body?.input || req.body?.query || "").trim();
    if (!input)
      return res.status(400).json({ error: "Pseudo ou identifiant manquant." });

    // uid numérique / URL de profil collée : résolution directe (1 candidat).
    const uid = extractUid(input);
    if (uid) {
      const player = await resolvePlayer(input);
      return res.json({
        players: player ? [{ uid: player.uid, name: player.name, icon: null }] : [],
      });
    }

    // Pseudo : recherche rivalsmeta (sans clé), repli marvelrivalsapi si vide.
    let players = await searchPlayersByName(input);
    if (!players.length && isConfigured()) {
      const p = await findPlayer(input).catch(() => null);
      if (p) players = [{ uid: p.uid, name: p.name, icon: null }];
    }
    res.json({ players });
  } catch (err) {
    console.error("marvel search error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Recherche impossible pour le moment." });
  }
});

// POST /api/trackers/marvel-rivals/preview { input } — même principe : recherche
// un compte (pseudo / uid / URL) et renvoie un aperçu (rang + héros) avant liaison.
router.post("/marvel-rivals/preview", requireAuth, async (req, res) => {
  try {
    const input = String(req.body?.input || req.body?.username || "").trim();
    if (!input)
      return res.status(400).json({ error: "Pseudo ou identifiant manquant." });

    const player = await resolvePlayer(input);
    if (!player)
      return res
        .status(404)
        .json({ error: "Joueur introuvable. Vérifie le pseudo / l'identifiant." });

    const data = await fetchPlayerData(player.uid).catch(() => ({ snapshot: null }));
    const snap = data.snapshot;
    const clash = await GameTracker.findOne({
      provider: "marvel-rivals",
      externalUid: player.uid,
      user: { $ne: req.userId },
    }).select("_id");

    res.json({
      preview: {
        name: player.name,
        uid: player.uid,
        icon: snap?.icon || snap?.heroes?.[0]?.thumb || null,
        level: snap?.level || null,
        rank: snap?.rank || null,
        takenByOther: !!clash,
      },
    });
  } catch (err) {
    console.error("marvel preview error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Recherche impossible pour le moment." });
  }
});

// POST /api/trackers/marvel-rivals/link { username } — lie un compte. La saisie
// accepte un pseudo (résolu via marvelrivalsapi si configuré), un identifiant
// numérique, ou une URL de profil collée (rivalsmeta.com/player/…).
router.post("/marvel-rivals/link", requireAuth, async (req, res) => {
  try {
    const input = String(req.body?.username || req.body?.input || "").trim();
    if (!input) return res.status(400).json({ error: "Pseudo ou identifiant manquant." });

    const player = await resolvePlayer(input);
    if (!player)
      return res.status(404).json({ error: "Joueur introuvable. Vérifie le pseudo / l'identifiant." });

    // Empêche de lier un compte déjà rattaché à un autre utilisateur.
    const clash = await GameTracker.findOne({
      provider: "marvel-rivals",
      externalUid: player.uid,
      user: { $ne: req.userId },
    }).select("_id");
    if (clash)
      return res.status(409).json({ error: "Ce compte Marvel Rivals est déjà lié ailleurs." });

    const tracker = await GameTracker.findOneAndUpdate(
      { user: req.userId, provider: "marvel-rivals" },
      {
        $set: {
          externalUid: player.uid,
          externalName: player.name,
          profileUrl: `https://rivalsmeta.com/player/${player.uid}`,
        },
        $setOnInsert: { connectedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // 1re synchro : baseline (pas de cartes de fil pour l'historique existant).
    await syncMarvelRivals(tracker, { emitFeed: false }).catch(() => {});

    res.json({ connected: true, tracker: trackerPublic(tracker) });
  } catch (err) {
    console.error("trackers link error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Erreur lors de la liaison." });
  }
});

// DELETE /api/trackers/marvel-rivals — délie (option ?removeMatches=true).
router.delete("/marvel-rivals", requireAuth, async (req, res) => {
  try {
    await GameTracker.deleteOne({ user: req.userId, provider: "marvel-rivals" });
    const removeMatches =
      req.query.removeMatches === "true" || req.body?.removeMatches === true;
    if (removeMatches) {
      await TrackerMatch.deleteMany({ user: req.userId, provider: "marvel-rivals" });
    }
    res.json({ connected: false });
  } catch (err) {
    console.error("trackers unlink error:", err.message);
    res.status(500).json({ error: "Erreur lors de la déliaison." });
  }
});

// POST /api/trackers/marvel-rivals/refresh — repush + resynchro (mon compte).
router.post("/marvel-rivals/refresh", requireAuth, async (req, res) => {
  try {
    const tracker = await GameTracker.findOne({
      user: req.userId,
      provider: "marvel-rivals",
    });
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    // Cooldown du BOUTON : basé sur le dernier clic manuel (lastRefreshAt), pas
    // sur lastSyncAt — sinon la resync de fond à l'ouverture du profil grillerait
    // le cooldown à chaque fois. On renvoie quand même le snapshot.
    if (tracker.lastRefreshAt && Date.now() - tracker.lastRefreshAt.getTime() < REFRESH_COOLDOWN) {
      return res.json({
        tracker: trackerPublic(tracker),
        cooldown: true,
        matches: tracker.snapshot?.recentMatches || [],
      });
    }
    tracker.lastRefreshAt = new Date();

    // Repush (met le profil en file ~2-5 min) puis on lit ce qui est dispo.
    await updatePlayer(tracker.externalUid);
    const { processing, added } = await syncMarvelRivals(tracker, { emitFeed: true });

    res.json({
      tracker: trackerPublic(tracker),
      processing,
      added,
      matches: tracker.snapshot?.recentMatches || [],
    });
  } catch (err) {
    console.error("trackers refresh error:", err.message);
    res.status(502).json({ error: err.message || "Erreur lors de l'actualisation." });
  }
});

// POST /api/trackers/league-of-legends/link { riotId, region } — lie un compte
// LoL par Riot ID (« Pseudo#TAG ») et région. Résolution via l'API Riot.
router.post("/league-of-legends/link", requireAuth, async (req, res) => {
  try {
    if (!lol.isConfigured())
      return res
        .status(503)
        .json({ error: "League of Legends n'est pas configuré côté serveur." });

    const riotId = String(req.body?.riotId || req.body?.input || "").trim();
    const region = lol.normalizePlatform(req.body?.region);
    if (!riotId)
      return res.status(400).json({ error: "Renseigne ton Riot ID (Pseudo#TAG)." });

    const player = await lol.resolvePlayer(riotId, region);
    if (!player)
      return res
        .status(404)
        .json({ error: "Invocateur introuvable. Vérifie ton Riot ID et ta région." });

    // Empêche de lier un compte déjà rattaché à un autre utilisateur.
    const clash = await GameTracker.findOne({
      provider: "league-of-legends",
      externalUid: player.puuid,
      user: { $ne: req.userId },
    }).select("_id");
    if (clash)
      return res
        .status(409)
        .json({ error: "Ce compte League of Legends est déjà lié ailleurs." });

    const tracker = await GameTracker.findOneAndUpdate(
      { user: req.userId, provider: "league-of-legends" },
      {
        $set: {
          externalUid: player.puuid,
          externalName: player.name,
          region: player.region,
          profileUrl: lol.opggUrl(player.gameName, player.tagLine, player.region),
        },
        $setOnInsert: { connectedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    // 1re synchro : baseline (pas de cartes de fil pour l'historique existant).
    await syncLeagueOfLegends(tracker, { emitFeed: false }).catch(() => {});

    // Backfill UNIQUE de l'historique de saisons passées via op.gg (l'API Riot
    // ne l'expose pas). Best-effort : n'échoue jamais, ne bloque pas la liaison.
    await backfillLolSeasons(tracker);

    res.json({ connected: true, tracker: trackerPublic(tracker) });
  } catch (err) {
    console.error("lol link error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Erreur lors de la liaison." });
  }
});

// DELETE /api/trackers/league-of-legends — délie (option ?removeMatches=true).
router.delete("/league-of-legends", requireAuth, async (req, res) => {
  try {
    await GameTracker.deleteOne({ user: req.userId, provider: "league-of-legends" });
    const removeMatches =
      req.query.removeMatches === "true" || req.body?.removeMatches === true;
    if (removeMatches) {
      await TrackerMatch.deleteMany({
        user: req.userId,
        provider: "league-of-legends",
      });
    }
    res.json({ connected: false });
  } catch (err) {
    console.error("lol unlink error:", err.message);
    res.status(500).json({ error: "Erreur lors de la déliaison." });
  }
});

// POST /api/trackers/league-of-legends/refresh — resynchro manuelle (mon compte).
// La synchro est automatique, mais on garde un bouton pour forcer un rafraîchissement.
router.post("/league-of-legends/refresh", requireAuth, async (req, res) => {
  try {
    const tracker = await GameTracker.findOne({
      user: req.userId,
      provider: "league-of-legends",
    });
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    if (
      tracker.lastRefreshAt &&
      Date.now() - tracker.lastRefreshAt.getTime() < REFRESH_COOLDOWN
    ) {
      return res.json({ tracker: trackerPublic(tracker), cooldown: true });
    }
    tracker.lastRefreshAt = new Date();

    const { added } = await syncLeagueOfLegends(tracker, { emitFeed: true });
    // Rattrape l'historique de saisons si un compte lié avant cette fonctionnalité
    // ne l'a pas encore (backfill best-effort, une seule fois).
    await backfillLolSeasons(tracker);
    res.json({ tracker: trackerPublic(tracker), added });
  } catch (err) {
    console.error("lol refresh error:", err.message);
    res.status(502).json({ error: err.message || "Erreur lors de l'actualisation." });
  }
});

// GET /api/trackers/league-of-legends/:username/matches?start=&count= — page
// suivante de l'historique (bouton « Voir plus » de l'onglet Tracking). Le
// profil sert déjà les 12 plus récents ; on pagine la suite via Match-V5.
router.get("/league-of-legends/:username/matches", optionalAuth, async (req, res) => {
  try {
    if (!lol.isConfigured())
      return res
        .status(503)
        .json({ error: "League of Legends n'est pas configuré côté serveur." });

    const { default: User } = await import("../models/User.js");
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });

    const tracker = await GameTracker.findOne({
      user: u._id,
      provider: "league-of-legends",
    }).select("externalUid region");
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    const start = Math.max(0, Number(req.query.start) || 0);
    const count = Math.min(20, Math.max(1, Number(req.query.count) || 10));

    // 1) Fenêtre d'IDs (récent -> ancien) : 1 appel Riot léger.
    const ids = await lol.fetchMatchIds(tracker.externalUid, tracker.region, {
      start,
      count,
    });
    if (!ids.length) return res.json({ matches: [] });

    // 2) Détails déjà en cache (immuables) -> zéro appel Riot pour ceux-là.
    const cached = await LolMatch.find({
      user: u._id,
      matchUid: { $in: ids },
    }).lean();
    const byId = new Map(cached.map((c) => [c.matchUid, c.data]));

    // 3) Manquants uniquement : on tape Riot puis on persiste pour la prochaine fois.
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      const fetched = await lol.fetchMatchDetails(
        tracker.externalUid,
        tracker.region,
        missing
      );
      if (fetched.length) {
        await LolMatch.bulkWrite(
          fetched.map((m) => ({
            updateOne: {
              filter: { user: u._id, matchUid: m.matchUid },
              update: { $set: { playedAt: m.playedAt, data: m } },
              upsert: true,
            },
          }))
        );
        for (const m of fetched) byId.set(m.matchUid, m);
      }
    }

    // 4) Renvoi dans l'ordre Riot (récent -> ancien).
    const matches = ids.map((id) => byId.get(id)).filter(Boolean);
    res.json({ matches });
  } catch (err) {
    console.error("lol matches page error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Chargement des parties impossible." });
  }
});

// GET /api/trackers/league-of-legends/:username — données de l'onglet Tracking
// LoL (public / partageable). Resynchro de fond automatique si périmé.
router.get("/league-of-legends/:username", optionalAuth, async (req, res) => {
  try {
    const { default: User } = await import("../models/User.js");
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });

    const tracker = await GameTracker.findOne({
      user: u._id,
      provider: "league-of-legends",
    });
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    const cover = await lol.getGameCover().catch(() => null);
    const stale =
      !tracker.snapshotAt ||
      Date.now() - tracker.snapshotAt.getTime() > SNAPSHOT_TTL;
    if (stale && lol.isConfigured()) {
      syncLeagueOfLegends(tracker, { emitFeed: true }).catch(() => {});
    }
    // Rattrapage de fond de l'historique de saisons (comptes liés avant la
    // fonctionnalité). Ne bloque pas la réponse ; visible au prochain chargement.
    if (!tracker.rankHistory?.seasons?.length) {
      backfillLolSeasons(tracker).catch(() => {});
    }

    res.json({
      tracker: trackerPublic(tracker),
      matches: tracker.snapshot?.recentMatches || [],
      stale,
      game: { cover },
    });
  } catch (err) {
    console.error("lol profile error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du tracking." });
  }
});

// GET /api/trackers/:username/providers — liste publique des providers liés par
// un joueur (onglet Tracking : sélecteur de jeu). Pas de secret exposé.
router.get("/:username/providers", optionalAuth, async (req, res) => {
  try {
    const { default: User } = await import("../models/User.js");
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });
    const trackers = await GameTracker.find({ user: u._id })
      .select("provider externalName snapshot.rank")
      .lean();
    res.json({
      providers: trackers.map((t) => ({
        provider: t.provider,
        label: PROVIDER_LABEL[t.provider] || t.provider,
        externalName: t.externalName || null,
        rank: t.snapshot?.rank?.tier || null,
      })),
    });
  } catch (err) {
    console.error("trackers providers error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/trackers/rank-changes/:id/react — féliciter (montée) / soutenir
// (descente) l'auteur d'une card de changement de rang. Single-select comme les
// réactions d'avis (un joueur = une réaction, re-cliquer la retire). body { type }.
const RANK_REACTIONS = ["heart", "clap", "funny"];
router.post("/rank-changes/:id/react", requireAuth, async (req, res) => {
  try {
    const type = String(req.body?.type || "");
    if (!RANK_REACTIONS.includes(type))
      return res.status(400).json({ error: "Réaction inconnue." });
    const doc = await RankChange.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Introuvable." });

    const me = String(req.userId);
    const mineIdx = doc.reactions.findIndex((r) => String(r.user) === me);
    if (mineIdx >= 0) {
      const was = doc.reactions[mineIdx].type;
      doc.reactions.splice(mineIdx, 1); // retire l'ancienne (single-select)
      if (was !== type) doc.reactions.push({ user: req.userId, type });
    } else {
      doc.reactions.push({ user: req.userId, type });
    }
    await doc.save();

    const reactions = { heart: 0, clap: 0, funny: 0 };
    let myReaction = null;
    for (const r of doc.reactions) {
      if (reactions[r.type] != null) reactions[r.type]++;
      if (String(r.user) === me) myReaction = r.type;
    }
    res.json({ reactions, myReaction });
  } catch (err) {
    console.error("rank react error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /api/trackers/marvel-rivals/:username/matches?skip=&season= — page suivante
// de l'historique de matchs (bouton « Charger plus » de l'onglet Tracking). Le
// profil sert déjà les 20 plus récents ; on pagine la suite via rivalsmeta.
router.get("/marvel-rivals/:username/matches", optionalAuth, async (req, res) => {
  try {
    const { default: User } = await import("../models/User.js");
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });

    const tracker = await GameTracker.findOne({
      user: u._id,
      provider: "marvel-rivals",
    }).select("externalUid");
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    const skip = Math.max(0, Number(req.query.skip) || 0);
    const season = req.query.season ? Number(req.query.season) : CURRENT_SEASON_VALUE;
    const matches = await fetchMatchHistoryPage(tracker.externalUid, { skip, season });
    res.json({ matches });
  } catch (err) {
    console.error("trackers matches page error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Chargement des parties impossible." });
  }
});

// GET /api/trackers/marvel-rivals/:username — données de l'onglet Tracking d'un
// profil (public / partageable). Resynchro de fond si le snapshot est périmé.
router.get("/marvel-rivals/:username", optionalAuth, async (req, res) => {
  try {
    // On résout le user par pseudo via le modèle User (import paresseux pour
    // éviter un cycle de dépendances entre routes).
    const { default: User } = await import("../models/User.js");
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });

    const tracker = await GameTracker.findOne({
      user: u._id,
      provider: "marvel-rivals",
    });
    if (!tracker) return res.status(404).json({ error: "Aucun compte lié." });

    // Saison demandée (défaut = courante). Une saison passée est lue à la volée
    // et N'EST PAS persistée (le snapshot stocké reste celui de la saison courante).
    const reqSeason = req.query.season ? Number(req.query.season) : null;
    const isPastSeason = reqSeason && reqSeason !== CURRENT_SEASON_VALUE;

    // Habillage IGDB (jaquette jeu + saisons). Best-effort, mis en cache.
    const game = await getGameAssets().catch(() => ({ cover: null, seasons: {} }));

    if (isPastSeason) {
      let data = null;
      try {
        data = await fetchPlayerData(tracker.externalUid, { season: reqSeason });
      } catch {
        /* API down : on renvoie un snapshot vide, l'UI l'indique */
      }
      const snap = data?.snapshot || null;
      if (snap) snap.recentMatches = (data.matches || []).slice(0, 20);
      return res.json({
        tracker: { ...trackerPublic(tracker), snapshot: snap, snapshotAt: new Date() },
        matches: snap?.recentMatches || [],
        seasons: SEASONS,
        season: reqSeason,
        stale: false,
        game,
      });
    }

    // Saison courante : snapshot stocké + resynchro de fond si périmé.
    const stale =
      !tracker.snapshotAt || Date.now() - tracker.snapshotAt.getTime() > SNAPSHOT_TTL;
    if (stale) {
      // rivalsmeta ne nécessite aucune clé : on peut toujours resynchroniser.
      syncMarvelRivals(tracker, { emitFeed: true }).catch(() => {});
    }

    res.json({
      tracker: trackerPublic(tracker),
      matches: tracker.snapshot?.recentMatches || [],
      seasons: SEASONS,
      season: CURRENT_SEASON_VALUE,
      stale,
      game,
    });
  } catch (err) {
    console.error("trackers profile error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du tracking." });
  }
});

// GET /api/trackers/marvel-rivals/match/:matchUid?map=<mapId> — scoreboard
// complet d'une partie (deux équipes, K/D/A, dégâts, soin, rang, MVP/SVP).
// Public (profils partageables). Sert toujours via rivalsmeta (gratuit).
router.get("/marvel-rivals/match/:matchUid", optionalAuth, async (req, res) => {
  try {
    const mapId = req.query.map ? Number(req.query.map) : null;
    const detail = await matchDetail(req.params.matchUid, { mapId });
    res.json(detail);
  } catch (err) {
    console.error("trackers match error:", err.message);
    res
      .status(err.status && err.status < 500 ? err.status : 502)
      .json({ error: err.message || "Détail du match indisponible." });
  }
});

// ===========================================================================
//  Synchro automatique en arrière-plan (League of Legends)
// ===========================================================================
// L'API Riot renvoie des données fraîches sans « file d'attente » : on peut donc
// resynchroniser périodiquement TOUS les comptes LoL liés, sans attendre qu'un
// visiteur ouvre le profil. C'est ce qui alimente le fil (cartes de parties /
// montées de rang) en continu. On espace les comptes pour rester bien en deçà
// du rate-limit Riot (clé dev : 100 req / 2 min ; ~18 req par compte).
const AUTO_SYNC_INTERVAL = 12 * 60 * 1000; // toutes les 12 min
const AUTO_SYNC_SPACING = 8 * 1000; // 8 s entre deux comptes
// On ne resynchronise un compte que s'il n'a pas bougé depuis ce délai (évite le
// double emploi avec la resynchro déclenchée à l'ouverture d'un profil).
const AUTO_SYNC_MIN_AGE = 10 * 60 * 1000;

async function autoSyncLolBatch() {
  try {
    const cutoff = new Date(Date.now() - AUTO_SYNC_MIN_AGE);
    const trackers = await GameTracker.find({
      provider: "league-of-legends",
      $or: [{ lastSyncAt: null }, { lastSyncAt: { $lt: cutoff } }],
    }).limit(30);
    for (const tracker of trackers) {
      try {
        await syncLeagueOfLegends(tracker, { emitFeed: true });
      } catch (e) {
        console.error("lol auto-sync error:", e.message);
      }
      await new Promise((r) => setTimeout(r, AUTO_SYNC_SPACING));
    }
  } catch (e) {
    console.error("lol auto-sync batch error:", e.message);
  }
}

// Démarré depuis index.js après la connexion Mongo. No-op si Riot non configuré.
export function startTrackerAutoSync() {
  if (!lol.isConfigured()) return;
  // Premier passage différé (laisse le serveur démarrer), puis en boucle.
  setTimeout(autoSyncLolBatch, 30 * 1000);
  setInterval(autoSyncLolBatch, AUTO_SYNC_INTERVAL);
  console.log("🔁 Auto-sync League of Legends activé");
}

export default router;
