import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import GameMedia from "../models/GameMedia.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";
import { sanitizeEdit, renderEditedVideo } from "../lib/videoEdit.js";

const router = express.Router();

// --- Upload des fichiers du mur média (images ET vidéos courtes) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "../../uploads/gamemedia");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEDIA_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || "";
      cb(null, `gm-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 Mo (clips vidéo)
  fileFilter: (req, file, cb) =>
    cb(
      null,
      /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype) ||
        /^video\/(mp4|webm|quicktime|ogg)$/.test(file.mimetype)
    ),
});

// Normalise les médias joints d'un post (uniquement des fichiers hébergés chez
// nous ou des GIF GIPHY ; jamais confiance au client). Spoiler par média.
function sanitizePostMedia(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((m) => {
      if (!m || !m.url) return null;
      const url = String(m.url);
      const kind = m.kind === "video" ? "video" : m.kind === "gif" ? "gif" : "image";
      const hosted = /\/uploads\/gamemedia\//.test(url);
      const giphy = kind === "gif" && /giphy\.com|\.gif(\?.*)?$/i.test(url);
      if (!hosted && !giphy) return null;
      return {
        kind,
        url: url.slice(0, 1000),
        thumbnail: m.thumbnail ? String(m.thumbnail).slice(0, 1000) : null,
        width: m.width != null ? Number(m.width) || null : null,
        height: m.height != null ? Number(m.height) || null : null,
        spoiler: !!m.spoiler,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

// Compatibilité anciens posts (média unique + `caption` + `spoiler`).
function normalizePost(p) {
  let text = p.text ?? p.caption ?? "";
  let media = [];
  if (Array.isArray(p.media)) {
    media = p.media.map((m) => ({
      kind: m.kind,
      url: m.url,
      thumbnail: m.thumbnail || null,
      width: m.width || null,
      height: m.height || null,
      spoiler: !!m.spoiler,
    }));
  } else if (p.media && p.media.url) {
    if (["image", "video", "gif"].includes(p.media.kind)) {
      media = [
        {
          kind: p.media.kind,
          url: p.media.url,
          thumbnail: p.media.thumbnail || null,
          width: p.media.width || null,
          height: p.media.height || null,
          spoiler: !!p.spoiler,
        },
      ];
    } else {
      // Ancien embed (youtube/twitter/tiktok/link) : on remet l'URL dans le
      // texte pour qu'elle soit ré-embarquée côté client.
      text = `${text} ${p.media.url}`.trim();
    }
  }
  return { text, media };
}

// Exporté : le fil d'accueil (routes/feed.js) sérialise les posts pareil.
export function toPost(p, userId) {
  const { text, media } = normalizePost(p);
  return {
    id: p._id,
    text,
    media,
    author: p.user
      ? { id: p.user._id, username: p.user.username, avatar: p.user.avatar || null }
      : null,
    mine: userId ? String(p.user?._id || p.user) === String(userId) : false,
    likeCount: (p.likes || []).length,
    liked: userId ? (p.likes || []).some((u) => String(u) === String(userId)) : false,
    comments: (p.comments || []).map((c) => toComment(c, p.comments || [], userId)),
    commentCount: (p.comments || []).length,
    createdAt: p.createdAt,
  };
}

// --- Rendu vidéo côté serveur (éditeur du composer) ---
// Fichiers temporaires (vidéo brute + musique) : supprimés après le rendu.
const TMP_DIR = path.join(__dirname, "../../uploads/gamemedia/tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

const renderUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || "";
      cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  // 500 Mo : c'est le fichier BRUT (capture de jeu non compressée) — ffmpeg le
  // compresse puis le temporaire est supprimé, donc on peut être généreux.
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(
      null,
      file.fieldname === "video"
        ? /^video\//.test(file.mimetype)
        : /^(audio|video)\//.test(file.mimetype)
    ),
});

// Enveloppe le middleware multer pour transformer ses erreurs (limite de
// taille…) en JSON clair au lieu d'un 500 brut.
const renderFiles = renderUpload.fields([
  { name: "video", maxCount: 1 },
  { name: "music", maxCount: 1 },
]);
function renderFilesSafe(req, res, next) {
  renderFiles(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({
      error: tooBig
        ? "Vidéo trop lourde (500 Mo max). Raccourcis ou compresse ton clip avant."
        : "Envoi invalide.",
    });
  });
}

// POST /api/game-media/render — reçoit la vidéo BRUTE + musique éventuelle +
// paramètres d'édition (JSON dans le champ `edit`), fait le montage avec
// ffmpeg (rognage, volumes, musique positionnée, compression) et renvoie l'URL
// du mp4 final. Beaucoup plus rapide que le rendu temps réel du navigateur.
router.post(
  "/render",
  requireAuth,
  renderFilesSafe,
  async (req, res) => {
    const videoFile = req.files?.video?.[0];
    const musicFile = req.files?.music?.[0];
    const cleanup = () => {
      for (const f of [videoFile, musicFile]) {
        if (f) fs.promises.unlink(f.path).catch(() => {});
      }
    };
    try {
      if (!videoFile) return res.status(400).json({ error: "Aucune vidéo." });
      let edit;
      try {
        edit = sanitizeEdit(JSON.parse(req.body?.edit || "{}"));
      } catch {
        return res.status(400).json({ error: "Paramètres d'édition invalides." });
      }
      if (!musicFile) edit.music = null;

      const outName = `gm-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp4`;
      const outPath = path.join(MEDIA_DIR, outName);
      await renderEditedVideo({
        videoPath: videoFile.path,
        musicPath: musicFile?.path || null,
        edit,
        outPath,
      });
      const url = `${req.protocol}://${req.get("host")}/uploads/gamemedia/${outName}`;
      res.status(201).json({ media: { kind: "video", url } });
    } catch (err) {
      console.error("game media render error:", err.message);
      res.status(500).json({ error: "Le montage vidéo a échoué." });
    } finally {
      cleanup();
    }
  }
);

// POST /api/game-media/upload — upload d'une image ou d'un clip vidéo.
// Même principe : erreur multer → JSON clair (et pas un 500 brut).
const uploadSingle = mediaUpload.single("media");
function uploadSingleSafe(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({
      error: tooBig
        ? "Fichier trop lourd (60 Mo max) — passe par « Éditer la vidéo » pour le compresser."
        : "Envoi invalide.",
    });
  });
}
router.post("/upload", requireAuth, uploadSingleSafe, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
  const url = `${req.protocol}://${req.get("host")}/uploads/gamemedia/${req.file.filename}`;
  const kind = /^video\//.test(req.file.mimetype)
    ? "video"
    : /gif$/.test(req.file.mimetype)
      ? "gif"
      : "image";
  res.status(201).json({ media: { kind, url } });
});

// GET /api/game-media/game/:gameId?sort=recent|top — le mur d'un jeu.
router.get("/game/:gameId", optionalAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "Jeu invalide." });
    const posts = await GameMedia.find({ gameId })
      .populate("user", "username avatar")
      .populate("comments.user", "username avatar")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    let out = posts.map((p) => toPost(p, req.userId));
    if (req.query.sort === "top") {
      out = out.sort(
        (a, b) =>
          b.likeCount - a.likeCount || new Date(b.createdAt) - new Date(a.createdAt)
      );
    }
    res.json({ posts: out });
  } catch (err) {
    console.error("game media list error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des médias." });
  }
});

// POST /api/game-media/game/:gameId — publier un post (texte et/ou médias).
router.post("/game/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "Jeu invalide." });
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    const media = sanitizePostMedia(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Écris quelque chose ou ajoute un média." });

    const post = await GameMedia.create({
      gameId,
      gameName: req.body?.gameName ? String(req.body.gameName).slice(0, 200) : null,
      gameCover: req.body?.gameCover ? String(req.body.gameCover).slice(0, 500) : null,
      user: req.userId,
      text,
      media,
    });
    const full = await GameMedia.findById(post._id)
      .populate("user", "username avatar")
      .lean();
    res.status(201).json({ post: toPost(full, req.userId) });
  } catch (err) {
    console.error("game media create error:", err.message);
    res.status(500).json({ error: "Erreur lors de la publication." });
  }
});

// GET /api/game-media/post/:postId — un post seul, avec les infos du jeu.
// Sert la page publique de partage /clip/:id (accessible sans compte).
router.get("/post/:postId", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId))
      return res.status(404).json({ error: "Post introuvable." });
    const p = await GameMedia.findById(req.params.postId)
      .populate("user", "username avatar")
      .populate("comments.user", "username avatar")
      .lean();
    if (!p) return res.status(404).json({ error: "Post introuvable." });
    res.json({
      post: toPost(p, req.userId),
      game: { id: p.gameId, name: p.gameName, cover: p.gameCover },
    });
  } catch (err) {
    console.error("game media get error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du post." });
  }
});

// DELETE /api/game-media/:postId — retirer son post.
router.delete("/:postId", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.json({ ok: true });
    if (String(post.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    await post.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("game media delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// POST /api/game-media/:postId/like — basculer le like d'un post.
router.post("/:postId/like", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post introuvable." });
    const uid = String(req.userId);
    const has = post.likes.some((u) => String(u) === uid);
    if (has) post.likes = post.likes.filter((u) => String(u) !== uid);
    else post.likes.push(req.userId);
    await post.save({ validateModifiedOnly: true, timestamps: false });
    res.json({ liked: !has, likeCount: post.likes.length });
  } catch (err) {
    console.error("game media like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  Commentaires d'un post (même système que les listes).
// ======================================================================

// POST /api/game-media/:postId/comments — commenter (texte et/ou média, réponse).
router.post("/:postId/comments", requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post introuvable." });

    let parent = null;
    if (req.body?.parent) {
      const p = post.comments.id(req.body.parent);
      if (p) parent = p.parent || p._id;
    }
    const mentions = await resolveMentions(text);
    post.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
      createdAt: new Date(),
    });
    await post.save({ validateModifiedOnly: true, timestamps: false });
    await post.populate("comments.user", "username avatar");
    const c = post.comments[post.comments.length - 1];
    res.status(201).json({ comment: toComment(c, post.comments, req.userId) });
  } catch (err) {
    console.error("game media comment error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/game-media/:postId/comments/:commentId — modifier (max 2 fois).
router.put("/:postId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post introuvable." });
    const c = post.comments.id(req.params.commentId);
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

    await post.save({ validateModifiedOnly: true, timestamps: false });
    await post.populate("comments.user", "username avatar");
    const updated = post.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, post.comments, req.userId) });
  } catch (err) {
    console.error("game media comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/game-media/:postId/comments/:commentId/like — like d'un commentaire.
router.post("/:postId/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post introuvable." });
    const c = post.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await post.save({ validateModifiedOnly: true, timestamps: false });
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("game media comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/game-media/:postId/comments/:commentId — retirer un commentaire
// (l'auteur du commentaire OU l'auteur du post).
router.delete("/:postId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.json({ ok: true });
    const c = post.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isCommentAuthor = String(c.user) === String(req.userId);
    const isPostAuthor = String(post.user) === String(req.userId);
    if (!isCommentAuthor && !isPostAuthor)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await post.save({ validateModifiedOnly: true, timestamps: false });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
