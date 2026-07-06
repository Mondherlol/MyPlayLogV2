import express from "express";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped"];

function toPublic(e) {
  return {
    gameId: e.gameId,
    name: e.name,
    cover: e.cover,
    status: e.status,
    platform: e.platform,
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

    const update = { user: req.userId, gameId };
    // n'écrase que les champs fournis
    for (const key of [
      "name",
      "cover",
      "status",
      "platform",
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
    if (b.name === undefined && !(await UserGame.exists({ user: req.userId, gameId }))) {
      return res.status(400).json({ error: "Le nom du jeu est requis." });
    }

    const entry = await UserGame.findOneAndUpdate(
      { user: req.userId, gameId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ entry: toPublic(entry) });
  } catch (err) {
    console.error("library put error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// Tout retirer pour ce jeu
router.delete("/:gameId", requireAuth, async (req, res) => {
  await UserGame.deleteOne({
    user: req.userId,
    gameId: Number(req.params.gameId),
  });
  res.json({ ok: true });
});

export default router;
