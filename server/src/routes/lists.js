import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import List from "../models/List.js";
import { requireAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";

const router = express.Router();

const TYPES = ["classic", "ranked", "tier"];
const VISIBILITIES = ["public", "private"];
const ITEM_KINDS = ["game", "character"];

// --- Upload d'images de réaction (commentaires) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMENTS_DIR = path.join(__dirname, "../../uploads/comments");
fs.mkdirSync(COMMENTS_DIR, { recursive: true });

const commentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, COMMENTS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `c-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// Paliers par défaut d'une nouvelle tier list (esprit S/A/B/C/D).
const DEFAULT_TIERS = [
  { id: "s", label: "S", color: "#ff5470" },
  { id: "a", label: "A", color: "#ff8b3d" },
  { id: "b", label: "B", color: "#f2b70b" },
  { id: "c", label: "C", color: "#3dd68c" },
  { id: "d", label: "D", color: "#4aa8ff" },
];

// Normalise un élément reçu du client (on ne fait pas confiance au brut).
function sanitizeItem(raw) {
  if (!raw || raw.refId == null || !raw.name) return null;
  const kind = raw.kind === "character" ? "character" : "game";
  const rating =
    raw.rating == null || raw.rating === ""
      ? null
      : Math.max(0, Math.min(100, Number(raw.rating) || 0));
  return {
    kind,
    refId: String(raw.refId),
    gameId: raw.gameId != null ? Number(raw.gameId) || null : null,
    gameName: raw.gameName ? String(raw.gameName).slice(0, 200) : null,
    name: String(raw.name).slice(0, 200),
    image: raw.image ? String(raw.image) : null,
    note: raw.note ? String(raw.note).slice(0, 500) : "",
    rating,
    tier: raw.tier ? String(raw.tier) : null,
  };
}

function sanitizeTiers(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((t) => t && t.id)
    .slice(0, 12)
    .map((t) => ({
      id: String(t.id).slice(0, 40),
      label: String(t.label ?? "").slice(0, 24),
      color: /^#[0-9a-fA-F]{3,8}$/.test(t.color || "") ? t.color : "#f2b70b",
    }));
}

// Vue "carte" (feed) : légère, sans les items complets.
function toCard(l, userId) {
  const items = l.items || [];
  return {
    id: l._id,
    title: l.title,
    description: l.description,
    type: l.type,
    itemKind: l.itemKind || "game",
    visibility: l.visibility,
    author: l.user
      ? { id: l.user._id, username: l.user.username }
      : null,
    mine: userId ? String(l.user?._id || l.user) === String(userId) : false,
    itemCount: items.length,
    // Aperçu : les 5 premières images pour un montage visuel.
    preview: items
      .filter((i) => i.image)
      .slice(0, 5)
      .map((i) => i.image),
    likeCount: (l.likes || []).length,
    liked: userId
      ? (l.likes || []).some((u) => String(u) === String(userId))
      : false,
    commentCount: (l.comments || []).length,
    updatedAt: l.updatedAt,
    createdAt: l.createdAt,
  };
}

// Vue complète (page détail).
function toFull(l, userId) {
  return {
    id: l._id,
    title: l.title,
    description: l.description,
    type: l.type,
    itemKind: l.itemKind || "game",
    visibility: l.visibility,
    author: l.user ? { id: l.user._id, username: l.user.username } : null,
    mine: userId ? String(l.user?._id || l.user) === String(userId) : false,
    items: (l.items || []).map((i) => ({
      _id: i._id,
      kind: i.kind,
      refId: i.refId,
      gameId: i.gameId,
      gameName: i.gameName,
      name: i.name,
      image: i.image,
      note: i.note,
      rating: i.rating,
      tier: i.tier,
    })),
    tiers: l.tiers || [],
    likeCount: (l.likes || []).length,
    liked: userId
      ? (l.likes || []).some((u) => String(u) === String(userId))
      : false,
    comments: (l.comments || []).map((c) => toComment(c, l.comments || [], userId)),
    updatedAt: l.updatedAt,
    createdAt: l.createdAt,
  };
}

// GET /api/lists — feed : toutes les listes publiques + mes listes.
// ?scope=mine pour n'avoir que les miennes, ?sort=likes|recent
router.get("/", requireAuth, async (req, res) => {
  try {
    const scope = req.query.scope;
    const q =
      scope === "mine"
        ? { user: req.userId }
        : { $or: [{ visibility: "public" }, { user: req.userId }] };
    const lists = await List.find(q)
      .populate("user", "username")
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    let cards = lists.map((l) => toCard(l, req.userId));
    if (req.query.sort === "likes") {
      cards = cards.sort((a, b) => b.likeCount - a.likeCount);
    }
    res.json({ lists: cards });
  } catch (err) {
    console.error("lists feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des listes." });
  }
});

// GET /api/lists/gifs — proxy de recherche GIF (GIPHY). Déclaré AVANT /:id
// pour ne pas être capturé par la route paramétrée.
router.get("/gifs", requireAuth, async (req, res) => {
  const key = process.env.GIPHY_KEY;
  if (!key)
    return res.status(503).json({ error: "Recherche GIF non configurée (GIPHY_KEY)." });
  try {
    const q = String(req.query.q || "").trim();
    const params = new URLSearchParams({
      api_key: key,
      limit: "24",
      rating: "pg-13",
      bundle: "messaging_non_clips",
    });
    if (q) params.set("q", q);
    const endpoint = q
      ? "https://api.giphy.com/v1/gifs/search"
      : "https://api.giphy.com/v1/gifs/trending";
    const r = await fetch(`${endpoint}?${params}`);
    if (!r.ok) throw new Error(`GIPHY ${r.status}`);
    const d = await r.json();
    const gifs = (d.data || [])
      .map((g) => {
        const img = g.images || {};
        const full = img.downsized_medium || img.original || {};
        return {
          id: g.id,
          preview: img.fixed_width?.url || img.fixed_width_small?.url || null,
          url: full.url || null,
          width: Number(full.width) || null,
          height: Number(full.height) || null,
          desc: g.title || "GIF",
        };
      })
      .filter((g) => g.preview && g.url);
    res.json({ gifs });
  } catch (err) {
    console.error("giphy error:", err.message);
    res.status(502).json({ error: "Recherche GIF indisponible." });
  }
});

// POST /api/lists/comments/media — upload d'une image de réaction. Renvoie l'URL.
router.post(
  "/comments/media",
  requireAuth,
  commentUpload.single("media"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
    const url = `${req.protocol}://${req.get("host")}/uploads/comments/${req.file.filename}`;
    res.status(201).json({ media: { type: "image", url } });
  }
);

// GET /api/lists/:id — détail d'une liste (respecte la confidentialité).
router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Liste introuvable." });
    const l = await List.findById(req.params.id)
      .populate("user", "username")
      .populate("comments.user", "username avatar")
      .lean();
    if (!l) return res.status(404).json({ error: "Liste introuvable." });
    const isOwner = String(l.user?._id || l.user) === String(req.userId);
    if (l.visibility === "private" && !isOwner)
      return res.status(403).json({ error: "Cette liste est privée." });
    res.json({ list: toFull(l, req.userId) });
  } catch (err) {
    console.error("list detail error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de la liste." });
  }
});

// POST /api/lists — créer une liste.
router.post("/", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "Un titre est requis." });
    const type = TYPES.includes(b.type) ? b.type : "classic";
    // Le "kind" ne concerne que les tier lists (jeux OU personnages).
    const itemKind =
      type === "tier" && ITEM_KINDS.includes(b.itemKind) ? b.itemKind : "game";
    const visibility = VISIBILITIES.includes(b.visibility)
      ? b.visibility
      : "public";
    const items = Array.isArray(b.items)
      ? b.items.map(sanitizeItem).filter(Boolean)
      : [];
    const tiers =
      type === "tier"
        ? sanitizeTiers(b.tiers) || DEFAULT_TIERS
        : [];

    const list = await List.create({
      user: req.userId,
      title,
      description: String(b.description || "").slice(0, 2000),
      type,
      itemKind,
      visibility,
      items,
      tiers,
    });
    const full = await List.findById(list._id)
      .populate("user", "username")
      .lean();
    res.status(201).json({ list: toFull(full, req.userId) });
  } catch (err) {
    console.error("list create error:", err.message);
    res.status(500).json({ error: "Erreur lors de la création." });
  }
});

// PUT /api/lists/:id — mettre à jour (propriétaire uniquement).
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });

    const b = req.body || {};
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) return res.status(400).json({ error: "Un titre est requis." });
      list.title = title.slice(0, 120);
    }
    if (b.description !== undefined)
      list.description = String(b.description).slice(0, 2000);
    if (b.visibility !== undefined && VISIBILITIES.includes(b.visibility))
      list.visibility = b.visibility;
    if (b.items !== undefined && Array.isArray(b.items))
      list.items = b.items.map(sanitizeItem).filter(Boolean);
    if (b.tiers !== undefined && list.type === "tier") {
      const t = sanitizeTiers(b.tiers);
      if (t) list.tiers = t;
    }

    await list.save({ validateModifiedOnly: true });
    const full = await List.findById(list._id)
      .populate("user", "username")
      .populate("comments.user", "username avatar")
      .lean();
    res.json({ list: toFull(full, req.userId) });
  } catch (err) {
    console.error("list update error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// DELETE /api/lists/:id
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.json({ ok: true });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    await list.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// POST /api/lists/:id/like — basculer le like.
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const uid = String(req.userId);
    const has = list.likes.some((u) => String(u) === uid);
    if (has) list.likes = list.likes.filter((u) => String(u) !== uid);
    else list.likes.push(req.userId);
    await list.save({ validateModifiedOnly: true });
    if (!has) {
      notify({
        user: list.user,
        type: "list_like",
        actor: req.userId,
        list: list._id,
        snippet: list.title,
      });
    }
    res.json({ liked: !has, likeCount: list.likes.length });
  } catch (err) {
    console.error("list like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/lists/:id/comments — ajouter un commentaire (texte et/ou média,
// éventuellement en réponse à un autre commentaire).
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (list.visibility === "private" && String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Liste privée." });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau
    // d'imbrication). Répondre à une réponse cible donc le même parent.
    let parent = null;
    let replyTargetUser = null; // auteur du message auquel on répond (pour la notif)
    if (req.body?.parent) {
      const p = list.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    list.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
    });
    await list.save({ validateModifiedOnly: true });
    await list.populate("comments.user", "username avatar");
    const c = list.comments[list.comments.length - 1];

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
    add(list.user, "list_comment");
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        list: list._id,
        comment: c._id,
        snippet,
      });
    }

    res.status(201).json({ comment: toComment(c, list.comments, req.userId) });
  } catch (err) {
    console.error("list comment error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/lists/:id/comments/:commentId — modifier son commentaire (max 2 fois).
router.put("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    if (String(c.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if ((c.editCount || 0) >= 2)
      return res.status(403).json({ error: "Limite de modifications atteinte (2)." });

    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });

    // Sauvegarde la version actuelle avant de la remplacer.
    c.history.push({ text: c.text, media: c.media, at: new Date() });
    c.text = text.slice(0, 300);
    c.media = media;
    c.mentions = await resolveMentions(text);
    c.editCount = (c.editCount || 0) + 1;
    c.editedAt = new Date();

    await list.save({ validateModifiedOnly: true });
    await list.populate("comments.user", "username avatar");
    const updated = list.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, list.comments, req.userId) });
  } catch (err) {
    console.error("comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/lists/:id/comments/:commentId/like — basculer le like d'un commentaire.
router.post("/:id/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await list.save({ validateModifiedOnly: true });
    if (!has) {
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        list: list._id,
        comment: c._id,
        snippet: c.text,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/lists/:id/comments/:commentId — retirer son commentaire
// (ou n'importe lequel si on possède la liste).
router.delete("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.json({ ok: true });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isCommentAuthor = String(c.user) === String(req.userId);
    const isListOwner = String(list.user) === String(req.userId);
    if (!isCommentAuthor && !isListOwner)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await list.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
