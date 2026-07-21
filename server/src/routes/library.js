import express from "express";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import { recordGameActivity, removeActivity } from "../lib/activity.js";
import { triggerMissionCheck } from "../lib/missions.js";

const router = express.Router();

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];
// Statuts possibles pour un jeu INCLUS dans un bundle (pas de wishlist/endless).
const BUNDLE_STATUSES = ["playing", "finished", "paused", "dropped"];

// Statut d'un jeu de bundle, avec rétrocompat V1 (simple case `done`).
const bundleChildStatus = (g) => g.status || (g.done ? "finished" : null);

function toPublic(e) {
  return {
    gameId: e.gameId,
    name: e.name,
    cover: e.cover,
    status: e.status,
    platform: e.platform,
    format: e.format || "digital",
    plannedMonth: e.plannedMonth || null,
    bundleGames: e.bundleGames || [],
    playtimeHours: e.playtimeHours,
    note: e.note,
    review: e.review,
    reviewMedia: e.reviewMedia || [],
    spoiler: !!e.spoiler,
    favorite: e.favorite,
    rating: e.rating,
    pros: e.pros,
    cons: e.cons,
    favoriteCharacter: e.favoriteCharacter || null,
    favoriteOst: e.favoriteOst || null,
    reviewedAt: e.reviewedAt || null,
    updatedAt: e.updatedAt,
  };
}

// Le contenu « review » (ce qui définit la date d'une review affichée) : texte,
// médias, points forts/faibles, spoiler. La note, la jaquette, le temps de jeu
// ou le statut n'en font PAS partie — les modifier ne doit pas dater à neuf la
// review. Renvoie true si l'un de ces champs change vraiment entre prev et body.
function reviewBodyChanged(prev, b) {
  const next = (key, fallback) =>
    b[key] !== undefined ? b[key] : prev ? prev[key] : fallback;
  return (
    (next("review", "") || "").trim() !== (prev?.review || "").trim() ||
    JSON.stringify(next("reviewMedia", []) || []) !==
      JSON.stringify(prev?.reviewMedia || []) ||
    JSON.stringify(next("pros", []) || []) !== JSON.stringify(prev?.pros || []) ||
    JSON.stringify(next("cons", []) || []) !== JSON.stringify(prev?.cons || []) ||
    !!next("spoiler", false) !== !!prev?.spoiler
  );
}

// Une review « existe » dès qu'il y a du contenu rédigé.
const hasReviewContent = (e) =>
  !!(
    (e.review || "").trim() ||
    (e.pros || []).length ||
    (e.cons || []).length ||
    (e.reviewMedia || []).length
  );

// Compare l'entrée avant/après et le body reçu → liste des changements réels
// à journaliser dans le fil. Un champ non fourni (undefined) n'est jamais un
// changement ; un champ fourni identique non plus.
function diffChanges(prev, entry, b) {
  const changes = [];

  if (!prev) {
    changes.push({ kind: "added", status: entry.status });
  } else if (b.status !== undefined && b.status !== prev.status) {
    changes.push({ kind: "status", from: prev.status, to: entry.status });
  }

  if (
    b.rating !== undefined &&
    entry.rating != null &&
    entry.rating !== (prev?.rating ?? null)
  ) {
    changes.push({ kind: "rating", value: entry.rating });
  }

  if (["review", "pros", "cons", "reviewMedia"].some((k) => b[k] !== undefined)) {
    const reviewChanged =
      !prev ||
      (prev.review || "") !== (entry.review || "") ||
      JSON.stringify(prev.pros || []) !== JSON.stringify(entry.pros || []) ||
      JSON.stringify(prev.cons || []) !== JSON.stringify(entry.cons || []) ||
      (prev.reviewMedia || []).length !== (entry.reviewMedia || []).length;
    if (reviewChanged && hasReviewContent(entry)) changes.push({ kind: "review" });
  }

  if (b.favorite !== undefined && entry.favorite && !prev?.favorite) {
    changes.push({ kind: "favorite" });
  }

  if (b.favoriteOst !== undefined) {
    const name = entry.favoriteOst?.name || "";
    if (name && name !== (prev?.favoriteOst?.name || "")) {
      changes.push({
        kind: "ost",
        name,
        artist: entry.favoriteOst.artist || "",
        artwork: entry.favoriteOst.artwork || null,
      });
    }
  }

  if (b.favoriteCharacter !== undefined) {
    const name = entry.favoriteCharacter?.name || "";
    if (name && name !== (prev?.favoriteCharacter?.name || "")) {
      changes.push({
        kind: "character",
        name,
        image: entry.favoriteCharacter.image || null,
      });
    }
  }

  if (
    b.playtimeHours !== undefined &&
    entry.playtimeHours != null &&
    entry.playtimeHours !== (prev?.playtimeHours ?? null)
  ) {
    changes.push({ kind: "time", hours: entry.playtimeHours });
  }

  // Progression dans un bundle : on journalise les jeux inclus NOUVELLEMENT
  // passés « terminé », avec le compteur global — le fil peut alors dire
  // « a terminé X dans <bundle> (2/5) » sans marquer tout le bundle terminé.
  if (b.bundleGames !== undefined && (entry.bundleGames || []).length) {
    const prevDone = new Set(
      (prev?.bundleGames || [])
        .filter((g) => bundleChildStatus(g) === "finished")
        .map((g) => g.id)
    );
    const newly = entry.bundleGames.filter(
      (g) => bundleChildStatus(g) === "finished" && !prevDone.has(g.id)
    );
    if (newly.length) {
      changes.push({
        kind: "bundle",
        done: entry.bundleGames.filter((g) => bundleChildStatus(g) === "finished")
          .length,
        total: entry.bundleGames.length,
        names: newly.map((g) => g.name).slice(0, 3),
      });
    }
  }

  return changes;
}

// Reporte le statut coché sur chaque jeu du bundle vers SA propre entrée de
// bibliothèque (créée au besoin) : le jeu apparaît alors « joué » sur sa fiche
// et dans les stats. Il hérite aussi de la plateforme/du format du bundle.
// AUCUNE carte de fil n'est créée pour les enfants — le fil raconte déjà
// « a terminé X dans <bundle> ».
async function syncBundleChildren(userId, bundleId, entry) {
  for (const g of entry.bundleGames || []) {
    const st = bundleChildStatus(g);
    if (st) {
      await UserGame.findOneAndUpdate(
        { user: userId, gameId: g.id },
        {
          $set: {
            status: st,
            platform: entry.platform || null,
            format: entry.format || "digital",
            bundleParentId: bundleId,
          },
          $setOnInsert: { name: g.name, cover: g.cover || null },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      warmGameMeta(g.id);
    } else {
      // Statut retiré : on ne supprime QUE l'entrée créée par CE bundle et
      // restée vierge (pas de note/avis/temps/coup de cœur ajoutés à la main).
      await UserGame.deleteOne({
        user: userId,
        gameId: g.id,
        bundleParentId: bundleId,
        rating: null,
        review: "",
        favorite: false,
        playtimeHours: null,
      });
    }
  }
}

// Toutes les entrées de l'utilisateur (option ?status=)
router.get("/", requireAuth, async (req, res) => {
  const q = { user: req.userId };
  if (req.query.status) q.status = req.query.status;
  const entries = await UserGame.find(q).sort({ updatedAt: -1 });
  res.json({ entries: entries.map(toPublic) });
});

// Carte légère gameId -> {status, favorite} pour l'affichage des cards
router.get("/map", requireAuth, async (req, res) => {
  const entries = await UserGame.find({ user: req.userId }).select(
    "gameId status favorite"
  );
  const map = {};
  for (const e of entries) {
    map[e.gameId] = { status: e.status, favorite: e.favorite };
  }
  res.json({ map });
});

// Une entrée précise
router.get("/:gameId", requireAuth, async (req, res) => {
  const e = await UserGame.findOne({
    user: req.userId,
    gameId: Number(req.params.gameId),
  });
  if (!e) return res.json({ entry: null });
  res.json({ entry: toPublic(e) });
});

// Créer / mettre à jour (upsert)
router.put("/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });

    const b = req.body || {};
    if (b.status && !STATUSES.includes(b.status)) {
      return res.status(400).json({ error: "Statut invalide." });
    }
    if (b.format && !["digital", "physical"].includes(b.format)) {
      return res.status(400).json({ error: "Format invalide." });
    }
    // Mois de planning : "YYYY-MM" ou null (retirer du planning).
    if (
      b.plannedMonth !== undefined &&
      b.plannedMonth !== null &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.plannedMonth))
    ) {
      return res.status(400).json({ error: "Mois de planning invalide." });
    }
    // Progression bundle : liste assainie des jeux inclus + statut par jeu
    // (`done` V1 accepté en entrée et gardé synchronisé pour la rétrocompat).
    if (b.bundleGames !== undefined) {
      if (!Array.isArray(b.bundleGames)) {
        return res.status(400).json({ error: "bundleGames invalide." });
      }
      b.bundleGames = b.bundleGames
        .filter((g) => g && Number(g.id) && g.name)
        .slice(0, 50)
        .map((g) => {
          const status = BUNDLE_STATUSES.includes(g.status)
            ? g.status
            : g.done
              ? "finished"
              : null;
          return {
            id: Number(g.id),
            name: String(g.name).slice(0, 160),
            cover: g.cover ? String(g.cover) : null,
            status,
            done: status === "finished",
          };
        });
    }

    const update = { user: req.userId, gameId };
    // n'écrase que les champs fournis
    for (const key of [
      "name",
      "cover",
      "status",
      "platform",
      "format",
      "playtimeHours",
      "note",
      "review",
      "reviewMedia",
      "spoiler",
      "favorite",
      "rating",
      "pros",
      "cons",
      "favoriteCharacter",
      "favoriteOst",
      "plannedMonth",
      "bundleGames",
    ]) {
      if (b[key] !== undefined) update[key] = b[key];
    }
    // L'état AVANT modification : sert à ne journaliser dans le fil que les
    // VRAIS changements (le fil ne doit plus réafficher « a terminé » quand on
    // change juste une note ou une OST — cf. routes/feed.js).
    const prev = await UserGame.findOne({ user: req.userId, gameId }).lean();
    if (b.name === undefined && !prev) {
      return res.status(400).json({ error: "Le nom du jeu est requis." });
    }

    // On (re)date la review uniquement quand son contenu change réellement :
    // ainsi éditer la note/jaquette/temps de jeu conserve la date d'origine.
    if (reviewBodyChanged(prev, b)) {
      update.reviewedAt = new Date();
    }

    const entry = await UserGame.findOneAndUpdate(
      { user: req.userId, gameId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    // Les jeux du bundle héritent du statut coché et de la plateforme : on
    // attend la synchro pour que leurs fiches soient à jour dès la fermeture
    // de la modale (quelques upserts au plus).
    if (b.bundleGames !== undefined && (entry.bundleGames || []).length) {
      await syncBundleChildren(req.userId, gameId, entry).catch((err) =>
        console.error("bundle children sync error:", err.message)
      );
    }
    // Pré-chauffe le cache de métadonnées (genres/studios…) pour l'onglet
    // Stats, sans bloquer la réponse.
    warmGameMeta(gameId);
    // Journal du fil (best-effort, ne bloque pas la réponse).
    recordGameActivity({
      actor: req.userId,
      gameId,
      gameName: entry.name,
      gameCover: entry.cover || null,
      changes: diffChanges(prev, entry, b),
    });
    // Missions « Générique de fin », « À mon humble avis », « Collectionneur ».
    triggerMissionCheck(req.userId);
    res.json({ entry: toPublic(entry) });
  } catch (err) {
    console.error("library put error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// Tout retirer pour ce jeu
router.delete("/:gameId", requireAuth, async (req, res) => {
  const gameId = Number(req.params.gameId);
  await UserGame.deleteOne({ user: req.userId, gameId });
  // Si c'était un bundle : retire aussi les entrées héritées restées vierges
  // (les enfants enrichis à la main — note, avis… — sont conservés).
  await UserGame.deleteMany({
    user: req.userId,
    bundleParentId: gameId,
    rating: null,
    review: "",
    favorite: false,
    playtimeHours: null,
  });
  // Le jeu n'est plus dans la bibliothèque : ses cartes du fil n'ont plus de sens.
  removeActivity({ actor: req.userId, type: "game_update", game: gameId });
  res.json({ ok: true });
});

export default router;
