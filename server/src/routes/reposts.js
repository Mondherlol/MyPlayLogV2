import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Repost from "../models/Repost.js";
import User from "../models/User.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";

const router = express.Router();

// Dossier des images de reposts (servi par /uploads comme les avatars).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/reposts");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 15 * 1024 * 1024; // 15 Mo max par image
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Garde-fou SSRF : on ne télécharge que du http(s) public, jamais une adresse
// locale/privée (l'URL vient du client, même si elle provient de notre feed).
function isSafeImageUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host.includes(":")) return false; // IPv6 littérale : on écarte
  return true;
}

// Télécharge l'image sur le disque et renvoie le nom du fichier local.
async function downloadImage(url, userId) {
  if (!isSafeImageUrl(url)) throw new Error("URL d'image refusée");
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error("le contenu n'est pas une image");
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("image vide");
  if (buf.length > MAX_BYTES) throw new Error("image trop lourde");
  const filename = `${userId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buf);
  return filename;
}

function deleteImageFile(filename) {
  if (!filename) return;
  // Best-effort : le doc prime, un fichier orphelin n'est pas grave.
  fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(filename))).catch(() => {});
}

// Jaquette du jeu (best-effort, pour habiller la carte du feed).
async function fetchGameCover(gameId) {
  try {
    const rows = await igdbQuery("games", `fields cover.image_id; where id = ${gameId};`);
    const img = rows?.[0]?.cover?.image_id;
    return img
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${img}.jpg`
      : null;
  } catch {
    return null;
  }
}

function repostCard(r, req, opts = {}) {
  const base = `${req.protocol}://${req.get("host")}`;
  return {
    id: String(r._id),
    itemId: r.itemId,
    source: r.source,
    author: r.author || "",
    url: r.url || "",
    image: `${base}/uploads/reposts/${r.image}`,
    w: r.w || null,
    h: r.h || null,
    game: { id: r.gameId, name: r.gameName, cover: r.gameCover || null },
    likeCount: (r.likes || []).length,
    liked: (r.likes || []).some((u) => String(u) === String(req.userId)),
    commentCount: (r.comments || []).length,
    // Le lecteur a-t-il déjà ce fan art sur SON feed ? (état du bouton
    // « republier » quand on consulte le feed d'un autre joueur)
    repostedByMe: opts.myItemIds
      ? String(r.user) === String(req.userId) || opts.myItemIds.has(r.itemId)
      : String(r.user) === String(req.userId),
    createdAt: r.createdAt,
  };
}

// Stats du feed d'un utilisateur (pour le rail latéral de l'onglet).
async function buildStats(userId) {
  const [bySource, topGames, total] = await Promise.all([
    Repost.aggregate([
      { $match: { user: userId } },
      { $group: { _id: "$source", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    Repost.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: "$gameId",
          n: { $sum: 1 },
          name: { $first: "$gameName" },
          cover: { $first: "$gameCover" },
        },
      },
      { $sort: { n: -1 } },
      { $limit: 3 },
    ]),
    Repost.countDocuments({ user: userId }),
  ]);
  return {
    total,
    sources: bySource.map((s) => ({ source: s._id, n: s.n })),
    topGames: topGames.map((g) => ({
      id: g._id,
      name: g.name,
      cover: g.cover || null,
      n: g.n,
    })),
  };
}

// --- Fan arts déjà republiés par moi pour un jeu (état des boutons du feed) ---
router.get("/ids", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.query.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });
    const rows = await Repost.find({ user: req.userId, gameId }).select("itemId").lean();
    res.json({ ids: rows.map((r) => r.itemId) });
  } catch (err) {
    console.error("repost ids error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Feed des reposts d'un utilisateur (pagination par curseur createdAt) ---
router.get("/user/:username", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select("_id");
    if (!user) return res.status(404).json({ error: "Profil introuvable." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 30);
    const before = req.query.before ? new Date(req.query.before) : null;
    const query = { user: user._id };
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    // Stats agrégées uniquement sur la première page (le rail du feed) :
    // total, répartition par source, jeux les plus republiés.
    const [items, stats] = await Promise.all([
      Repost.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
      before ? Promise.resolve(null) : buildStats(user._id),
    ]);

    // Fan arts de cette page que le LECTEUR a déjà sur son propre feed
    // (pour l'état des boutons « republier » sur le feed d'un autre joueur).
    let myItemIds = new Set();
    if (String(user._id) !== String(req.userId) && items.length) {
      const mine = await Repost.find({
        user: req.userId,
        itemId: { $in: items.map((r) => r.itemId) },
      })
        .select("itemId")
        .lean();
      myItemIds = new Set(mine.map((r) => r.itemId));
    }

    res.json({
      items: items.map((r) => repostCard(r, req, { myItemIds })),
      nextCursor:
        items.length === limit ? items[items.length - 1].createdAt.toISOString() : null,
      ...(stats ? { total: stats.total, stats } : {}),
    });
  } catch (err) {
    console.error("repost feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du feed." });
  }
});

// --- Republier / retirer un fan art (toggle) ---
// Body : { item: { id, source, image, author, url, w, h }, game: { id, name } }
// OU    : { fromRepostId } — republier depuis le feed d'un autre joueur : on
// copie l'image locale du repost source (pas de re-téléchargement externe).
router.post("/", requireAuth, async (req, res) => {
  try {
    if (req.body?.fromRepostId) {
      const src = await Repost.findById(req.body.fromRepostId).lean();
      if (!src) return res.status(404).json({ error: "Repost introuvable." });

      // Déjà sur mon feed → toggle : on retire.
      const existing = await Repost.findOne({ user: req.userId, itemId: src.itemId });
      if (existing) {
        deleteImageFile(existing.image);
        await existing.deleteOne();
        return res.json({ reposted: false });
      }

      // Chaque repost possède SA copie du fichier (suppressions indépendantes).
      const ext = path.extname(src.image) || ".jpg";
      const filename = `${req.userId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      await fs.promises.copyFile(
        path.join(UPLOAD_DIR, path.basename(src.image)),
        path.join(UPLOAD_DIR, filename)
      );

      try {
        const repost = await Repost.create({
          user: req.userId,
          itemId: src.itemId,
          source: src.source,
          author: src.author,
          url: src.url,
          originalImage: src.originalImage,
          image: filename,
          w: src.w,
          h: src.h,
          gameId: src.gameId,
          gameName: src.gameName,
          gameCover: src.gameCover,
        });
        return res.status(201).json({ reposted: true, repost: repostCard(repost, req) });
      } catch (err) {
        deleteImageFile(filename);
        if (err.code === 11000) return res.json({ reposted: true });
        throw err;
      }
    }

    const item = req.body?.item || {};
    const game = req.body?.game || {};
    const itemId = String(item.id || "").slice(0, 200);
    const gameId = Number(game.id);
    if (!itemId || !gameId || !item.image || !game.name)
      return res.status(400).json({ error: "Fan art invalide." });

    // Déjà republié → on retire (toggle, comme un un-retweet).
    const existing = await Repost.findOne({ user: req.userId, itemId });
    if (existing) {
      deleteImageFile(existing.image);
      await existing.deleteOne();
      return res.json({ reposted: false });
    }

    // Téléchargement local d'abord : si l'image est morte, on ne crée rien.
    const filename = await downloadImage(String(item.image), req.userId);
    const gameCover = await fetchGameCover(gameId);

    try {
      const repost = await Repost.create({
        user: req.userId,
        itemId,
        source: String(item.source || "Web").slice(0, 40),
        author: String(item.author || "").slice(0, 120),
        url: String(item.url || "").slice(0, 600),
        originalImage: String(item.image).slice(0, 600),
        image: filename,
        w: Number(item.w) || null,
        h: Number(item.h) || null,
        gameId,
        gameName: String(game.name).slice(0, 200),
        gameCover,
      });
      res.status(201).json({ reposted: true, repost: repostCard(repost, req) });
    } catch (err) {
      deleteImageFile(filename);
      // Double clic / requêtes concurrentes : l'index unique a tranché.
      if (err.code === 11000) return res.json({ reposted: true });
      throw err;
    }
  } catch (err) {
    console.error("repost error:", err.message);
    res.status(500).json({ error: "Impossible de republier ce fan art." });
  }
});

// --- Liker / retirer son like d'une republication ---
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id);
    if (!repost) return res.status(404).json({ error: "Repost introuvable." });
    const uid = String(req.userId);
    const has = repost.likes.some((u) => String(u) === uid);
    if (has) repost.likes = repost.likes.filter((u) => String(u) !== uid);
    else repost.likes.push(req.userId);
    await repost.save({ validateModifiedOnly: true });
    if (!has) {
      notify({
        user: repost.user,
        type: "repost_like",
        actor: req.userId,
        game: repost.gameId,
        gameName: repost.gameName,
        repostOwner: repost.user,
        snippet: `fan art ${repost.gameName}`,
      });
    }
    res.json({ liked: !has, likeCount: repost.likes.length });
  } catch (err) {
    console.error("repost like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Commentaires d'une republication — même système que listes/OST
//  (Composer, fils à un niveau, médias, likes, édition, historique).
// ============================================================

// GET /api/reposts/:id/comments — fil de commentaires du repost.
router.get("/:id/comments", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id).populate(
      "comments.user",
      "username avatar"
    );
    if (!repost) return res.status(404).json({ error: "Repost introuvable." });
    const comments = (repost.comments || []).map((c) =>
      toComment(c, repost.comments, req.userId)
    );
    res.json({ comments, mine: String(repost.user) === String(req.userId) });
  } catch (err) {
    console.error("repost comments fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des commentaires." });
  }
});

// POST /api/reposts/:id/comments — ajouter un commentaire (ou une réponse).
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id);
    if (!repost) return res.status(404).json({ error: "Repost introuvable." });
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau).
    let parent = null;
    let replyTargetUser = null;
    if (req.body?.parent) {
      const p = repost.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    repost.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
    });
    await repost.save({ validateModifiedOnly: true });
    await repost.populate("comments.user", "username avatar");
    const c = repost.comments[repost.comments.length - 1];

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
    add(repost.user, "repost_comment"); // l'auteur de la republication
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        game: repost.gameId,
        gameName: repost.gameName,
        repostOwner: repost.user,
        comment: c._id,
        snippet,
      });
    }

    res.status(201).json({ comment: toComment(c, repost.comments, req.userId) });
  } catch (err) {
    console.error("repost comment add error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/reposts/:id/comments/:commentId — modifier son commentaire (max 2 fois).
router.put("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id);
    const c = repost?.comments.id(req.params.commentId);
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

    await repost.save({ validateModifiedOnly: true });
    await repost.populate("comments.user", "username avatar");
    const updated = repost.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, repost.comments, req.userId) });
  } catch (err) {
    console.error("repost comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/reposts/:id/comments/:commentId/like — basculer le like.
router.post("/:id/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id);
    const c = repost?.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await repost.save({ validateModifiedOnly: true });
    if (!has) {
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        game: repost.gameId,
        gameName: repost.gameName,
        repostOwner: repost.user,
        comment: c._id,
        snippet: c.text,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("repost comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/reposts/:id/comments/:commentId — retirer son commentaire
// (ou n'importe lequel si on est l'auteur de la republication).
router.delete("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findById(req.params.id);
    const c = repost?.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isAuthor = String(c.user) === String(req.userId);
    const isOwner = String(repost.user) === String(req.userId);
    if (!isAuthor && !isOwner)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await repost.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Supprimer un repost depuis son feed ---
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const repost = await Repost.findOne({ _id: req.params.id, user: req.userId });
    if (!repost) return res.status(404).json({ error: "Repost introuvable." });
    deleteImageFile(repost.image);
    await repost.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("repost delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
