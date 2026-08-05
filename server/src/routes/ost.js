import express from "express";
import mongoose from "mongoose";
import OstThread from "../models/OstThread.js";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";

// Commentaires sur les OST favorites d'un profil. Une OST est identifiée par
// (owner = propriétaire du profil, gameId). Le fil réutilise le même système
// que les commentaires de listes (Composer / médias via /lists, mentions…).
const router = express.Router();

function ownerId(req) {
  return mongoose.isValidObjectId(req.params.owner) ? req.params.owner : null;
}

// Récupère l'OST favorite (name + cover du jeu) du profil `owner` pour ce jeu.
async function getOst(owner, gameId) {
  const e = await UserGame.findOne({ user: owner, gameId })
    .select("name favoriteOst")
    .lean();
  return e?.favoriteOst?.name ? e : null;
}

// GET /api/ost/recent — les dernières OST mises en favori, TOUS joueurs
// confondus (section « Coups de cœur OST » de l'accueil). Une seule entrée par
// jeu : sans ça, une bande-son populaire monopoliserait la section. Déclarée
// avant les routes en /:owner/… — un chemin d'un seul segment ne peut pas les
// percuter, mais l'ordre garde l'intention lisible.
router.get("/recent", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 4, 1), 12);
    const rows = await UserGame.find({ "favoriteOst.name": { $nin: [null, ""] } })
      .select("gameId name cover favoriteOst user updatedAt")
      .populate("user", "username avatar")
      .sort({ updatedAt: -1 })
      // De la marge pour dédoublonner par jeu sans repasser en base.
      .limit(limit * 8)
      .lean();

    const seen = new Set();
    const items = [];
    for (const r of rows) {
      if (!r.user || seen.has(r.gameId)) continue;
      seen.add(r.gameId);
      items.push({
        gameId: r.gameId,
        gameName: r.name,
        cover: r.cover || null,
        ost: r.favoriteOst,
        user: { username: r.user.username, avatar: r.user.avatar || null },
        at: r.updatedAt,
      });
      if (items.length >= limit) break;
    }
    res.json({ items });
  } catch (err) {
    console.error("ost recent error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des OST." });
  }
});

// GET /api/ost/:owner/:gameId/comments — fil de commentaires d'une OST.
router.get("/:owner/:gameId/comments", requireAuth, async (req, res) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: "OST introuvable." });
    const gameId = Number(req.params.gameId);
    const thread = await OstThread.findOne({ owner, gameId }).populate(
      "comments.user",
      "username avatar"
    );
    const comments = (thread?.comments || []).map((c) =>
      toComment(c, thread.comments, req.userId)
    );
    res.json({ comments, mine: String(owner) === String(req.userId) });
  } catch (err) {
    console.error("ost comments fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des commentaires." });
  }
});

// POST /api/ost/:owner/:gameId/comments — ajouter un commentaire (ou une réponse).
router.post("/:owner/:gameId/comments", requireAuth, async (req, res) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: "OST introuvable." });
    const gameId = Number(req.params.gameId);
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });
    const entry = await getOst(owner, gameId);
    if (!entry) return res.status(404).json({ error: "OST introuvable." });

    let thread = await OstThread.findOne({ owner, gameId });
    if (!thread) thread = new OstThread({ owner, gameId, comments: [] });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau).
    let parent = null;
    let replyTargetUser = null; // auteur du message auquel on répond (pour la notif)
    if (req.body?.parent) {
      const p = thread.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    thread.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
    });
    await thread.save({ validateModifiedOnly: true });
    await thread.populate("comments.user", "username avatar");
    const c = thread.comments[thread.comments.length - 1];

    // Notifications (un seul message par destinataire, par priorité).
    const recipients = new Map();
    const actorStr = String(req.userId);
    const add = (uid, type) => {
      if (!uid) return;
      const s = String(uid);
      if (s === actorStr || recipients.has(s)) return;
      recipients.set(s, type);
    };
    if (replyTargetUser) add(replyTargetUser, "comment_reply");
    mentions.forEach((m) => add(m.user, "mention"));
    add(owner, "ost_comment"); // le propriétaire de l'OST
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        game: gameId,
        gameName: entry.name,
        ostOwner: owner,
        comment: c._id,
        snippet,
      });
    }

    res.status(201).json({ comment: toComment(c, thread.comments, req.userId) });
  } catch (err) {
    console.error("ost comment add error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/ost/:owner/:gameId/comments/:commentId — modifier son commentaire (max 2 fois).
router.put("/:owner/:gameId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: "OST introuvable." });
    const gameId = Number(req.params.gameId);
    const thread = await OstThread.findOne({ owner, gameId });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    if (String(c.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if ((c.editCount || 0) >= 2)
      return res.status(403).json({ error: "Limite de modifications atteinte (2)." });

    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });

    c.history.push({ text: c.text, media: c.media, at: new Date() });
    c.text = text.slice(0, 300);
    c.media = media;
    c.mentions = await resolveMentions(text);
    c.editCount = (c.editCount || 0) + 1;
    c.editedAt = new Date();

    await thread.save({ validateModifiedOnly: true });
    await thread.populate("comments.user", "username avatar");
    const updated = thread.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, thread.comments, req.userId) });
  } catch (err) {
    console.error("ost comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/ost/:owner/:gameId/comments/:commentId/like — basculer le like.
router.post("/:owner/:gameId/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.status(404).json({ error: "OST introuvable." });
    const gameId = Number(req.params.gameId);
    const thread = await OstThread.findOne({ owner, gameId });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await thread.save({ validateModifiedOnly: true });
    if (!has) {
      const entry = await getOst(owner, gameId);
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        game: gameId,
        gameName: entry?.name || "",
        ostOwner: owner,
        comment: c._id,
        snippet: c.text,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("ost comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/ost/:owner/:gameId/comments/:commentId — retirer son commentaire
// (ou n'importe lequel si on est le propriétaire de l'OST).
router.delete("/:owner/:gameId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const owner = ownerId(req);
    if (!owner) return res.json({ ok: true });
    const gameId = Number(req.params.gameId);
    const thread = await OstThread.findOne({ owner, gameId });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isAuthor = String(c.user) === String(req.userId);
    const isOwner = String(owner) === String(req.userId);
    if (!isAuthor && !isOwner)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await thread.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
