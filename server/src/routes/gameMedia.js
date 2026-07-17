import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import GameMedia from "../models/GameMedia.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

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

// --- Détection du type de média depuis une URL collée ---
// On ne fait jamais confiance au `kind` envoyé par le client : on le recalcule.
function youtubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}
function tweetId(url) {
  const m = String(url).match(
    /(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/
  );
  return m ? m[1] : null;
}
function tiktokId(url) {
  const m = String(url).match(/tiktok\.com\/(?:@[^/]+\/video|v|embed)\/(\d+)/);
  return m ? m[1] : null;
}

function detectEmbed(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const yt = youtubeId(url);
  if (yt)
    return {
      kind: "youtube",
      url,
      embedId: yt,
      thumbnail: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    };
  const tw = tweetId(url);
  if (tw) return { kind: "twitter", url, embedId: tw };
  const tk = tiktokId(url);
  if (tk) return { kind: "tiktok", url, embedId: tk };
  // Image directe collée (lien se terminant par une extension image).
  if (/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(url))
    return { kind: /\.gif(\?.*)?$/i.test(url) ? "gif" : "image", url };
  return { kind: "link", url };
}

// Normalise le média reçu du client. Pour les fichiers hébergés (image/video/
// gif uploadés chez nous) on garde l'url telle quelle ; pour tout le reste on
// re-détecte le type serveur-side depuis l'URL.
function sanitizeMedia(raw) {
  if (!raw || !raw.url) return null;
  const url = String(raw.url);
  const hostedFile =
    (raw.kind === "image" || raw.kind === "video" || raw.kind === "gif") &&
    /\/uploads\/gamemedia\//.test(url);
  // GIF GIPHY : hébergé chez GIPHY, mais légitime (déjà utilisé par les commentaires).
  const giphy = raw.kind === "gif" && /giphy\.com|\.gif(\?.*)?$/i.test(url);
  if (hostedFile || giphy) {
    return {
      kind: raw.kind === "video" ? "video" : raw.kind === "gif" ? "gif" : "image",
      url: url.slice(0, 1000),
      embedId: null,
      thumbnail: raw.thumbnail ? String(raw.thumbnail).slice(0, 1000) : null,
      width: raw.width != null ? Number(raw.width) || null : null,
      height: raw.height != null ? Number(raw.height) || null : null,
    };
  }
  const detected = detectEmbed(url);
  if (!detected) return null;
  return {
    kind: detected.kind,
    url: detected.url.slice(0, 1000),
    embedId: detected.embedId || null,
    thumbnail: detected.thumbnail || null,
    width: null,
    height: null,
  };
}

// Sérialise un post pour le client.
function toPost(p, userId) {
  return {
    id: p._id,
    caption: p.caption || "",
    spoiler: !!p.spoiler,
    media: {
      kind: p.media.kind,
      url: p.media.url,
      embedId: p.media.embedId || null,
      thumbnail: p.media.thumbnail || null,
      width: p.media.width || null,
      height: p.media.height || null,
    },
    author: p.user
      ? { id: p.user._id, username: p.user.username, avatar: p.user.avatar || null }
      : null,
    mine: userId ? String(p.user?._id || p.user) === String(userId) : false,
    likeCount: (p.likes || []).length,
    liked: userId ? (p.likes || []).some((u) => String(u) === String(userId)) : false,
    createdAt: p.createdAt,
  };
}

// GET /api/game-media/detect?url= — aperçu d'une URL collée (type + embedId).
// Sert au composer pour prévisualiser en direct avant de poster.
router.get("/detect", requireAuth, (req, res) => {
  const detected = detectEmbed(req.query.url);
  if (!detected) return res.status(400).json({ error: "URL non reconnue." });
  res.json({ media: detected });
});

// POST /api/game-media/upload — upload d'une image ou d'un clip vidéo.
router.post("/upload", requireAuth, mediaUpload.single("media"), (req, res) => {
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
      .sort({ createdAt: -1 })
      .limit(300)
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

// POST /api/game-media/game/:gameId — publier un média.
router.post("/game/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "Jeu invalide." });
    const media = sanitizeMedia(req.body?.media);
    if (!media)
      return res
        .status(400)
        .json({ error: "Média manquant ou lien non reconnu." });
    const caption = String(req.body?.caption || "").trim().slice(0, 600);

    const post = await GameMedia.create({
      gameId,
      gameName: req.body?.gameName ? String(req.body.gameName).slice(0, 200) : null,
      user: req.userId,
      caption,
      spoiler: !!req.body?.spoiler,
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

// PATCH /api/game-media/:postId — modifier son post (légende / spoiler).
router.patch("/:postId", requireAuth, async (req, res) => {
  try {
    const post = await GameMedia.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Média introuvable." });
    if (String(post.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if (req.body?.caption !== undefined)
      post.caption = String(req.body.caption).trim().slice(0, 600);
    if (req.body?.spoiler !== undefined) post.spoiler = !!req.body.spoiler;
    await post.save({ validateModifiedOnly: true });
    const full = await GameMedia.findById(post._id)
      .populate("user", "username avatar")
      .lean();
    res.json({ post: toPost(full, req.userId) });
  } catch (err) {
    console.error("game media edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
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
    if (!post) return res.status(404).json({ error: "Média introuvable." });
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

export default router;
