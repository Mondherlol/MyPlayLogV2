import express from "express";
import GameTracker from "../models/GameTracker.js";
import TrackerMatch from "../models/TrackerMatch.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  isConfigured,
  resolvePlayer,
  fetchPlayerData,
  updatePlayer,
  matchDetail,
  getGameAssets,
} from "../lib/marvelRivals.js";
import { SEASONS, CURRENT_SEASON_VALUE } from "../lib/marvelRivalsData.js";

// Tracking des performances in-game (Marvel Rivals en premier). Liaison par
// pseudo, snapshot des stats + génération de cartes de fil sur les nouvelles
// parties. Générique : `provider` paramètre tout, prêt pour LoL / Valorant.
const router = express.Router();

// Fraîcheur : au-delà, une ouverture de profil déclenche une resynchro de fond.
const SNAPSHOT_TTL = 10 * 60 * 1000; // 10 min
// Cooldown du bouton « Actualiser » (respecte le rate-limit dynamique de l'API).
const REFRESH_COOLDOWN = 60 * 1000; // 60 s

// Libellé humain d'un provider (titre des cartes, badges d'onglet).
export const PROVIDER_LABEL = { "marvel-rivals": "Marvel Rivals" };

// Vue publique d'un tracker (pas de secret : uniquement l'id public + snapshot).
function trackerPublic(t) {
  return {
    provider: t.provider,
    label: PROVIDER_LABEL[t.provider] || t.provider,
    uid: t.externalUid,
    externalName: t.externalName,
    profileUrl: t.profileUrl,
    connectedAt: t.connectedAt,
    snapshot: t.snapshot || null,
    snapshotAt: t.snapshotAt || null,
    lastSyncAt: t.lastSyncAt || null,
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
      for (const m of fresh.reverse()) {
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
              },
            },
            { upsert: true }
          );
          if (r.upsertedCount) added++;
        } catch {
          /* doublon concurrent : ignoré */
        }
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

// GET /api/trackers/status — mes liaisons + état de configuration serveur.
router.get("/status", requireAuth, async (req, res) => {
  try {
    const trackers = await GameTracker.find({ user: req.userId }).lean();
    res.json({
      configured: isConfigured(),
      trackers: trackers.map(trackerPublic),
    });
  } catch (err) {
    console.error("trackers status error:", err.message);
    res.status(500).json({ error: "Erreur." });
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

    // Cooldown : on ne martèle pas l'API. On renvoie quand même le snapshot.
    if (tracker.lastSyncAt && Date.now() - tracker.lastSyncAt.getTime() < REFRESH_COOLDOWN) {
      return res.json({
        tracker: trackerPublic(tracker),
        cooldown: true,
        matches: tracker.snapshot?.recentMatches || [],
      });
    }

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

export default router;
