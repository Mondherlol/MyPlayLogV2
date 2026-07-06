import express from "express";
import mongoose from "mongoose";
import Recommendation from "../models/Recommendation.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";

const router = express.Router();

const count = (rec) => rec.recommenders.length + rec.boosters.length;

// --- Recommander un jeu à un utilisateur ---
// Si quelqu'un a déjà recommandé ce jeu à cette personne, on s'ajoute comme
// recommandeur supplémentaire (= +1 automatique).
router.post("/", requireAuth, async (req, res) => {
  try {
    const { toUserId, gameId, name, cover, message } = req.body || {};
    if (!mongoose.isValidObjectId(toUserId))
      return res.status(400).json({ error: "Destinataire invalide." });
    if (String(toUserId) === String(req.userId))
      return res.status(400).json({ error: "Tu ne peux pas te recommander un jeu à toi-même." });
    const gid = Number(gameId);
    if (!gid || !name) return res.status(400).json({ error: "Jeu invalide." });

    const target = await User.findById(toUserId).select("_id");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

    const msg = message ? String(message).slice(0, 280) : "";
    let rec = await Recommendation.findOne({ to: toUserId, gameId: gid });

    if (!rec) {
      rec = await Recommendation.create({
        to: toUserId,
        gameId: gid,
        name: String(name),
        cover: cover || null,
        recommenders: [{ user: req.userId, message: msg }],
      });
    } else {
      const mine = rec.recommenders.find((r) => String(r.user) === String(req.userId));
      if (mine) {
        mine.message = msg; // déjà recommandé : on met juste à jour le mot
      } else {
        rec.recommenders.push({ user: req.userId, message: msg });
        rec.boosters = rec.boosters.filter((u) => String(u) !== String(req.userId));
      }
      if (!rec.cover && cover) rec.cover = cover;
      await rec.save();
    }

    // Notifie le destinataire (auto +1 = nouvelle recommandation pour lui).
    notify({
      user: toUserId,
      type: "recommendation",
      actor: req.userId,
      game: gid,
      gameName: String(name),
      snippet: msg.slice(0, 120),
    });

    res.status(201).json({ ok: true, count: count(rec) });
  } catch (err) {
    console.error("reco create error:", err.message);
    res.status(500).json({ error: "Échec de la recommandation." });
  }
});

// --- +1 sur une recommandation (booster) ---
router.post("/:id/boost", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Recommandation introuvable." });
    const rec = await Recommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommandation introuvable." });

    const isRecommender = rec.recommenders.some((r) => String(r.user) === String(req.userId));
    if (isRecommender)
      return res.status(400).json({ error: "Tu as déjà recommandé ce jeu (déjà +1)." });

    const has = rec.boosters.some((u) => String(u) === String(req.userId));
    if (has) rec.boosters = rec.boosters.filter((u) => String(u) !== String(req.userId));
    else {
      rec.boosters.push(req.userId);
      // Notifie le(s) recommandeur(s) qu'on a soutenu leur reco.
      for (const r of rec.recommenders) {
        notify({
          user: r.user,
          type: "recommendation_boost",
          actor: req.userId,
          game: rec.gameId,
          gameName: rec.name,
        });
      }
    }
    await rec.save();
    res.json({ boosted: !has, count: count(rec) });
  } catch (err) {
    console.error("reco boost error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Commenter une recommandation ---
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Commentaire vide." });
    const rec = await Recommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommandation introuvable." });

    rec.comments.push({ user: req.userId, text: text.slice(0, 500) });
    await rec.save();
    const c = rec.comments[rec.comments.length - 1];
    const me = await User.findById(req.userId).select("username avatar");

    // Notifie le destinataire + les recommandeurs (sauf l'auteur du commentaire).
    const recipients = new Set([String(rec.to), ...rec.recommenders.map((r) => String(r.user))]);
    for (const uid of recipients) {
      notify({
        user: uid,
        type: "recommendation_comment",
        actor: req.userId,
        game: rec.gameId,
        gameName: rec.name,
        snippet: text.slice(0, 120),
      });
    }

    res.status(201).json({
      comment: {
        id: String(c._id),
        user: { id: me._id, username: me.username, avatar: me.avatar || null },
        text: c.text,
        createdAt: c.createdAt,
      },
    });
  } catch (err) {
    console.error("reco comment error:", err.message);
    res.status(500).json({ error: "Échec du commentaire." });
  }
});

// --- Retirer MA recommandation (me retire des recommandeurs) ---
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const rec = await Recommendation.findById(req.params.id);
    if (!rec) return res.json({ ok: true });
    rec.recommenders = rec.recommenders.filter((r) => String(r.user) !== String(req.userId));
    if (rec.recommenders.length === 0) await rec.deleteOne();
    else await rec.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
