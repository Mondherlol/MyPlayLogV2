import { Router } from "express";
import Download from "../models/Download.js";
import { requireAuth } from "../middleware/auth.js";

// Journal humoristique des « délits de téléchargement » (cf. models/Download.js) :
// alimente la card moqueuse du fil d'actualité.
const router = Router();

const REACTION_TYPES = ["boo", "tomato", "monster"];
// Nombre de textes rigolos côté client (client/src/components/FeedCards.jsx) :
// on tire une variante à la création pour que la phrase reste stable.
const VARIANTS = 8;
// On évite d'inonder le fil : cliquer 5 liens du même jeu = un seul délit.
const DEDUP_WINDOW = 30 * 60 * 1000; // 30 min

// POST /api/downloads — journalise un téléchargement (bouton/lien de l'onglet
// Patchs). body : { gameId, gameName, gameCover, source }.
router.post("/", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.body?.gameId);
    const gameName = String(req.body?.gameName || "").trim().slice(0, 300);
    const source = String(req.body?.source || "").trim().slice(0, 60);
    const gameCover = req.body?.gameCover ? String(req.body.gameCover).slice(0, 500) : null;
    if (!Number.isInteger(gameId) || !gameName || !source) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    // Un délit récent sur le même jeu + même source ? On ne le re-journalise pas
    // (mais on rafraîchit sa date pour le faire remonter dans le fil).
    const since = new Date(Date.now() - DEDUP_WINDOW);
    const recent = await Download.findOne({
      user: req.userId,
      gameId,
      source,
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 });
    if (recent) {
      recent.createdAt = new Date();
      await recent.save();
      return res.json({ ok: true, id: String(recent._id), deduped: true });
    }

    const doc = await Download.create({
      user: req.userId,
      gameId,
      gameName,
      gameCover,
      source,
      variant: Math.floor(Math.random() * VARIANTS),
    });
    res.json({ ok: true, id: String(doc._id) });
  } catch (err) {
    console.error("download log error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// POST /api/downloads/:id/react — huer / jeter une tomate / traiter de monstre.
// Chaque réaction est un toggle indépendant. body : { type }.
router.post("/:id/react", requireAuth, async (req, res) => {
  try {
    const type = String(req.body?.type || "");
    if (!REACTION_TYPES.includes(type)) {
      return res.status(400).json({ error: "Réaction inconnue." });
    }
    const doc = await Download.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Introuvable." });

    const me = String(req.userId);
    const idx = doc.reactions.findIndex(
      (r) => String(r.user) === me && r.type === type
    );
    if (idx >= 0) doc.reactions.splice(idx, 1);
    else doc.reactions.push({ user: req.userId, type });
    await doc.save();

    const counts = { boo: 0, tomato: 0, monster: 0 };
    const mine = [];
    for (const r of doc.reactions) {
      if (counts[r.type] != null) counts[r.type]++;
      if (String(r.user) === me) mine.push(r.type);
    }
    res.json({ counts, mine });
  } catch (err) {
    console.error("download react error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
