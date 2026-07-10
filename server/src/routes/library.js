import express from "express";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import { recordGameActivity, removeActivity } from "../lib/activity.js";

const router = express.Router();

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

function toPublic(e) {
  return {
    gameId: e.gameId,
    name: e.name,
    cover: e.cover,
    status: e.status,
    platform: e.platform,
    format: e.format || "digital",
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
    updatedAt: e.updatedAt,
  };
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

  return changes;
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

    const entry = await UserGame.findOneAndUpdate(
      { user: req.userId, gameId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
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
  // Le jeu n'est plus dans la bibliothèque : ses cartes du fil n'ont plus de sens.
  removeActivity({ actor: req.userId, type: "game_update", game: gameId });
  res.json({ ok: true });
});

export default router;
