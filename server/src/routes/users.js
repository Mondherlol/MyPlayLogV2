import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import mongoose from "mongoose";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import Recommendation from "../models/Recommendation.js";
import OstThread from "../models/OstThread.js";
import Repost from "../models/Repost.js";
import Documentary from "../models/Documentary.js";
import GameAchievements from "../models/GameAchievements.js";
import GameTracker from "../models/GameTracker.js";
import { igdbQuery } from "../lib/igdb.js";
import { ensureGameMeta } from "../lib/gameMeta.js";
import { ensureEntityLogos } from "../lib/entityLogos.js";
import { setServiceNpsso, getServiceStatus, clearServiceTokens } from "../lib/psn.js";
import { isAdminEmail } from "../lib/admin.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { summarizeReactions, reviewComment } from "../lib/reviewSerialize.js";
import { recordActivity, removeActivity } from "../lib/activity.js";

const router = express.Router();

// --- Upload d'avatars (réutilise le dossier uploads) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/avatars");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${req.userId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// --- Upload de couvertures (bannière du profil) : dossier + limite dédiés ---
const COVER_DIR = path.join(__dirname, "../../uploads/covers");
fs.mkdirSync(COVER_DIR, { recursive: true });
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, COVER_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${req.userId}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const coverUpload = multer({
  storage: coverStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// Clés autorisées pour la personnalisation de l'onglet « Aperçu » (voir PUT /me).
const OVERVIEW_SECTIONS = new Set([
  "favorites",
  "playing",
  "endless",
  "finished",
  "wishlist",
  "upcoming",
  "paused",
  "dropped",
]);
const OVERVIEW_CARD_FIELDS = new Set(["rating", "hours", "platform", "title"]);
// Widgets de la colonne latérale « Aperçu » que le propriétaire peut réordonner
// et masquer (drag & drop + toggle). Doit rester aligné avec le registre client
// (ProfileOverviewAside). Toute clé inconnue est ignorée à l'enregistrement.
const ASIDE_WIDGETS = new Set([
  "stats",
  "playtime",
  "tracking-lol",
  "tracking-rivals",
  "console",
  "characters",
  "studios",
  "playlist",
  "ost",
  "video",
  "lists",
  "review",
  "wanted",
]);

function entryCard(e) {
  return {
    gameId: e.gameId,
    name: e.name,
    cover: e.cover,
    status: e.status,
    platform: e.platform,
    format: e.format || "digital",
    playtimeHours: e.playtimeHours,
    favorite: e.favorite,
    rating: e.rating,
    favoriteCharacter: e.favoriteCharacter?.name
      ? { name: e.favoriteCharacter.name, image: e.favoriteCharacter.image || null }
      : null,
    favoriteOst: e.favoriteOst?.name
      ? {
          name: e.favoriteOst.name,
          artist: e.favoriteOst.artist || null,
          artwork: e.favoriteOst.artwork || null,
          preview: e.favoriteOst.preview || null,
          youtube: !!e.favoriteOst.youtube,
          url: e.favoriteOst.url || null,
        }
      : null,
    updatedAt: e.updatedAt,
  };
}

// Durée d'écoute d'une playlist : durées connues + 4 min par piste sans info
// (aligné avec le serveur des listes et le client).
function listDuration(items) {
  if (!items.length) return { durationSec: 0, durationEstimated: false };
  const known = items.filter((i) => i.durationSec > 0);
  return {
    durationSec:
      known.reduce((s, i) => s + i.durationSec, 0) +
      (items.length - known.length) * 240,
    durationEstimated: known.length < items.length,
  };
}

function listCard(l, viewerId) {
  const items = l.items || [];
  return {
    ...(l.type === "playlist" ? listDuration(items) : {}),
    id: l._id,
    title: l.title,
    description: l.description,
    cover: l.cover || null,
    coverDesign: l.coverDesign || null,
    type: l.type,
    itemKind: l.itemKind || "game",
    visibility: l.visibility,
    author: l.user
      ? { id: l.user._id || l.user, username: l.user.username, avatar: l.user.avatar || null }
      : null,
    itemCount: items.length,
    preview: items.filter((i) => i.image).slice(0, 8).map((i) => i.image),
    // Aperçu de tier list : images regroupées par palier (ordre des paliers).
    ...(l.type === "tier"
      ? {
          tierPreview: (l.tiers || [])
            .map((t) => ({
              label: t.label,
              color: t.color,
              images: items
                .filter((i) => i.tier === t.id && i.image)
                .map((i) => i.image)
                .slice(0, 6),
            }))
            .filter((t) => t.images.length > 0)
            .slice(0, 4),
        }
      : {}),
    likeCount: (l.likes || []).length,
    liked: viewerId ? (l.likes || []).some((u) => String(u) === String(viewerId)) : false,
    commentCount: (l.comments || []).length,
    updatedAt: l.updatedAt,
  };
}

// --- Mettre à jour son profil ---
router.put("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
    const b = req.body || {};

    if (b.username !== undefined) {
      const username = String(b.username).trim();
      if (username.length < 2)
        return res.status(400).json({ error: "Identifiant trop court." });
      if (username !== user.username) {
        const taken = await User.findOne({ username });
        if (taken) return res.status(409).json({ error: "Cet identifiant est déjà pris." });
        user.username = username;
      }
    }
    if (b.bio !== undefined) user.bio = String(b.bio).slice(0, 300);
    if (b.tagline !== undefined) user.tagline = String(b.tagline).slice(0, 120);
    if (b.taglineImage !== undefined)
      user.taglineImage = b.taglineImage ? String(b.taglineImage) : null;
    if (b.cover !== undefined) user.cover = b.cover ? String(b.cover) : null;
    if (b.coverPos !== undefined)
      user.coverPos = b.coverPos ? String(b.coverPos).slice(0, 32) : null;
    // Photos de couverture multiples (carrousel) : max 6, dédoublonnées par URL.
    // cover/coverPos restent alignés sur la 1re image (partage, rétrocompat).
    if (b.covers !== undefined) {
      const seen = new Set();
      user.covers = (Array.isArray(b.covers) ? b.covers : [])
        .map((c) => ({
          url: c && c.url ? String(c.url).slice(0, 600) : null,
          pos: c && c.pos ? String(c.pos).slice(0, 32) : null,
        }))
        .filter((c) => c.url && !seen.has(c.url) && seen.add(c.url))
        .slice(0, 6);
      user.cover = user.covers[0]?.url || null;
      user.coverPos = user.covers[0]?.pos || null;
    }
    if (b.avatar !== undefined) user.avatar = b.avatar ? String(b.avatar) : null;
    // Ordre de préférence des OST favorites (ids de jeux, dédoublonnés).
    if (b.ostOrder !== undefined) {
      const seen = new Set();
      user.ostOrder = (Array.isArray(b.ostOrder) ? b.ostOrder : [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && !seen.has(n) && seen.add(n))
        .slice(0, 500);
    }
    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    console.error("profile update error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// --- Personnalisation de l'onglet « Aperçu » (ordre des sections + détails des
//     jaquettes). Écriture ATOMIQUE via $set : ces réglages sont enregistrés à
//     chaque toggle / glisser-déposer, donc en rafale — un load-modify-save
//     classique provoquerait des VersionError sur les requêtes concurrentes. ---
function cleanKeys(arr, allowed) {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : [])
    .map((s) => String(s))
    .filter((s) => allowed.has(s) && !seen.has(s) && seen.add(s));
}

router.put("/me/overview", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const set = {};
    if (b.overviewOrder !== undefined)
      set.overviewOrder = cleanKeys(b.overviewOrder, OVERVIEW_SECTIONS);
    if (b.overviewCards !== undefined)
      set.overviewCards = cleanKeys(b.overviewCards, OVERVIEW_CARD_FIELDS);
    // Colonne latérale : ordre des widgets + widgets masqués.
    if (b.asideOrder !== undefined)
      set.asideOrder = cleanKeys(b.asideOrder, ASIDE_WIDGETS);
    if (b.asideHidden !== undefined)
      set.asideHidden = cleanKeys(b.asideHidden, ASIDE_WIDGETS);
    // Réglage par widget (mode auto vs sélection épinglée). Assaini par champ.
    if (b.asideConfig !== undefined) {
      const src = b.asideConfig && typeof b.asideConfig === "object" ? b.asideConfig : {};
      const clean = {};
      for (const key of Object.keys(src)) {
        if (!ASIDE_WIDGETS.has(key)) continue;
        const v = src[key];
        if (!v || typeof v !== "object") continue;
        const c = { mode: String(v.mode || "").slice(0, 16) };
        if (v.id != null) c.id = String(v.id).slice(0, 64);
        if (v.gameId != null && Number.isFinite(Number(v.gameId))) c.gameId = Number(v.gameId);
        if (v.videoId != null) c.videoId = String(v.videoId).slice(0, 20);
        if (Array.isArray(v.ids)) c.ids = v.ids.map((x) => String(x).slice(0, 64)).slice(0, 3);
        if (v.platform != null) c.platform = String(v.platform).slice(0, 80);
        if (Array.isArray(v.keys)) c.keys = v.keys.map((x) => String(x).slice(0, 160)).slice(0, 24);
        // Studios épinglés : objets { name, logo } (rendu direct de la carte).
        if (Array.isArray(v.companies))
          c.companies = v.companies
            .filter((x) => x && x.name)
            .map((x) => ({
              name: String(x.name).slice(0, 120),
              logo: x.logo ? String(x.logo).slice(0, 400) : null,
              country: x.country ? String(x.country).slice(0, 80) : null,
            }))
            .slice(0, 3);
        clean[key] = c;
      }
      set.asideConfig = clean;
    }
    // Ordre manuel des jeux par section : { sectionKey: [gameId,…] }. On ne
    // garde que les sections connues et des ids numériques dédoublonnés.
    if (b.overviewGameOrder !== undefined) {
      const src =
        b.overviewGameOrder && typeof b.overviewGameOrder === "object"
          ? b.overviewGameOrder
          : {};
      const clean = {};
      for (const key of Object.keys(src)) {
        if (!OVERVIEW_SECTIONS.has(key)) continue;
        const seen = new Set();
        clean[key] = (Array.isArray(src[key]) ? src[key] : [])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && !seen.has(n) && seen.add(n))
          .slice(0, 500);
      }
      set.overviewGameOrder = clean;
    }
    if (Object.keys(set).length) await User.updateOne({ _id: req.userId }, { $set: set });
    res.json({ ok: true, ...set });
  } catch (err) {
    console.error("overview prefs error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// --- Statut du compte de service PSN (source des trophées) pour la page Admin ---
router.get("/me/psn", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("email");
    const s = getServiceStatus();
    res.json({
      isAdmin: isAdminEmail(me?.email),
      connected: s.connected,
      expired: s.expired,
      connectedAt: s.connectedAt,
    });
  } catch (err) {
    console.error("psn status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Connexion du compte de service PSN (admin uniquement) : on échange le NPSSO
//     collé contre des tokens de service. Ce compte sert de source des trophées
//     pour TOUS les utilisateurs. Permet de faire tourner le NPSSO sans redéploi. ---
router.post("/me/psn", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("email");
    if (!isAdminEmail(me?.email))
      return res.status(403).json({ error: "Réservé à l'administrateur." });

    const npsso = String(req.body?.npsso || "").trim();
    if (!npsso) return res.status(400).json({ error: "Token NPSSO manquant." });

    try {
      await setServiceNpsso(npsso);
    } catch {
      return res
        .status(400)
        .json({ error: "NPSSO invalide ou expiré. Récupère-en un nouveau et réessaie." });
    }
    res.json({ connected: true });
  } catch (err) {
    console.error("psn connect error:", err.message);
    res.status(500).json({ error: "Erreur lors de la connexion PSN." });
  }
});

// --- Déconnexion du compte de service PSN (admin uniquement) ---
router.delete("/me/psn", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("email");
    if (!isAdminEmail(me?.email))
      return res.status(403).json({ error: "Réservé à l'administrateur." });
    clearServiceTokens();
    res.json({ connected: false });
  } catch (err) {
    console.error("psn disconnect error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Passkey C411 personnel (onglet Pack HD) ---
// Renvoyé uniquement à son propriétaire (jamais dans un profil public), sert au
// serveur à réécrire l'URL d'annonce du .torrent → ratio de l'utilisateur.
router.get("/me/c411", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("+c411Passkey");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({ passkey: user.c411Passkey || "" });
  } catch (err) {
    console.error("c411 passkey get error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Enregistre / remplace / efface (chaîne vide) le passkey C411.
router.put("/me/c411", requireAuth, async (req, res) => {
  try {
    const raw = String(req.body?.passkey ?? "").trim().slice(0, 64);
    // Un passkey C411 est un jeton hexadécimal (souvent 32 car.) ; on refuse
    // tout ce qui n'y ressemble pas (mais on autorise "" = suppression).
    if (raw && !/^[a-f0-9]{16,64}$/i.test(raw))
      return res.status(400).json({ error: "Passkey C411 invalide." });
    await User.updateOne({ _id: req.userId }, { $set: { c411Passkey: raw || null } });
    res.json({ passkey: raw, hasKey: !!raw });
  } catch (err) {
    console.error("c411 passkey set error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// --- Upload de la photo de profil ---
router.post("/me/avatar", requireAuth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image manquante ou invalide." });
    const url = `${req.protocol}://${req.get("host")}/uploads/avatars/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { avatar: url } },
      { new: true }
    );
    res.json({ avatar: url, user: user.toPublic() });
  } catch (err) {
    console.error("avatar upload error:", err.message);
    res.status(500).json({ error: "Échec de l'upload." });
  }
});

// --- Upload d'une image de couverture personnalisée ---
// Renvoie juste l'URL : le cadrage et l'enregistrement se font ensuite via
// PUT /me (cover + coverPos) comme pour une couverture piochée dans un jeu.
router.post("/me/cover", requireAuth, coverUpload.single("cover"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image manquante ou invalide." });
    const url = `${req.protocol}://${req.get("host")}/uploads/covers/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    console.error("cover upload error:", err.message);
    res.status(500).json({ error: "Échec de l'upload." });
  }
});

// --- Basculer l'abonnement à un utilisateur ---
router.post("/:id/follow", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    if (String(req.params.id) === String(req.userId))
      return res.status(400).json({ error: "Tu ne peux pas t'abonner à toi-même." });
    const target = await User.findById(req.params.id).select("_id");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

    const me = await User.findById(req.userId);
    const has = me.following.some((u) => String(u) === String(target._id));
    if (has) me.following = me.following.filter((u) => String(u) !== String(target._id));
    else me.following.push(target._id);
    await me.save();

    // Fil : « X s'est abonné à Y » (retiré si on se désabonne).
    if (has) removeActivity({ actor: req.userId, type: "follow", target: target._id });
    else recordActivity({ actor: req.userId, type: "follow", target: target._id });

    const followers = await User.countDocuments({ following: target._id });
    res.json({ following: !has, followersCount: followers });
  } catch (err) {
    console.error("follow error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liste des abonnements d'un utilisateur ---
router.get("/:id/following", optionalAuth, async (req, res) => {
  try {
    const u = await User.findById(req.params.id).populate("following", "username avatar bio");
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable." });
    const me = await User.findById(req.userId).select("following");
    const mine = new Set((me?.following || []).map(String));
    const users = (u.following || []).map((f) => ({
      ...f.toCard(),
      isFollowing: mine.has(String(f._id)),
      isMe: String(f._id) === String(req.userId),
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liste des abonnés d'un utilisateur ---
router.get("/:id/followers", optionalAuth, async (req, res) => {
  try {
    const followers = await User.find({ following: req.params.id }).select(
      "username avatar bio"
    );
    const me = await User.findById(req.userId).select("following");
    const mine = new Set((me?.following || []).map(String));
    const users = followers.map((f) => ({
      ...f.toCard(),
      isFollowing: mine.has(String(f._id)),
      isMe: String(f._id) === String(req.userId),
    }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Recherche d'utilisateurs (autocomplétion des mentions @) ---
// Déclarée AVANT /:username pour ne pas être capturée par la route paramétrée.
router.get("/search/mentions", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ users: [] });
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({ username: { $regex: `^${safe}`, $options: "i" } })
      .select("username avatar")
      .limit(8)
      .lean();
    res.json({
      users: users.map((u) => ({
        id: u._id,
        username: u.username,
        avatar: u.avatar || null,
      })),
    });
  } catch (err) {
    console.error("mention search error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Reviews & commentaires d'un utilisateur (onglet dédié, chargé à la demande) ---
// Déclarée AVANT /:username : le sous-chemin /activity ne doit pas être capturé.
// `author` = l'utilisateur du profil (auteur de la review) ; `meId` = le lecteur.
function reviewCard(e, meId, author) {
  const { counts, mine } = summarizeReactions(e.reactions, meId);
  return {
    gameId: e.gameId,
    name: e.name,
    cover: e.cover,
    // Auteur de la review (le profil consulté) — pour réactions & réponses.
    user: author
      ? { id: author._id, username: author.username, avatar: author.avatar || null }
      : null,
    reactions: counts,
    myReaction: mine,
    comments: (e.comments || []).map((c) => reviewComment(c, e.comments, meId)),
    status: e.status,
    platform: e.platform,
    playtimeHours: e.playtimeHours,
    rating: e.rating,
    review: e.review || "",
    spoiler: !!e.spoiler,
    pros: e.pros || [],
    cons: e.cons || [],
    media: (e.reviewMedia || []).map((m) => ({
      type: m.type,
      url: m.url,
      width: m.width,
      height: m.height,
    })),
    favoriteCharacter: e.favoriteCharacter?.name
      ? { name: e.favoriteCharacter.name, image: e.favoriteCharacter.image || null }
      : null,
    favoriteOst: e.favoriteOst?.name
      ? {
          name: e.favoriteOst.name,
          artist: e.favoriteOst.artist || null,
          artwork: e.favoriteOst.artwork || null,
          preview: e.favoriteOst.preview || null,
          youtube: !!e.favoriteOst.youtube,
          url: e.favoriteOst.url || null,
        }
      : null,
    createdAt: e.createdAt,
    reviewedAt: e.reviewedAt || e.updatedAt,
    updatedAt: e.updatedAt,
  };
}

router.get("/:username/activity", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select(
      "_id username avatar"
    );
    if (!user) return res.status(404).json({ error: "Profil introuvable." });
    const isMe = String(user._id) === String(req.userId);

    const [entries, lists, reviewCommented, ostThreads, repostCommented] = await Promise.all([
      UserGame.find({ user: user._id })
        .populate("comments.user", "username avatar")
        .sort({ updatedAt: -1 }),
      List.find(
        isMe
          ? { "comments.user": user._id }
          : { "comments.user": user._id, visibility: "public" }
      )
        .populate("comments.user", "username avatar")
        .populate("user", "username avatar")
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean(),
      // Reviews (d'autres joueurs) sous lesquelles cet utilisateur a répondu.
      UserGame.find({ "comments.user": user._id })
        .populate("comments.user", "username avatar")
        .populate("user", "username avatar")
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean(),
      // OST (de n'importe quel profil) commentées par cet utilisateur.
      OstThread.find({ "comments.user": user._id })
        .populate("comments.user", "username avatar")
        .populate("owner", "username avatar")
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean(),
      // Republications (de n'importe quel feed) commentées par cet utilisateur.
      Repost.find({ "comments.user": user._id })
        .populate("comments.user", "username avatar")
        .populate("user", "username avatar")
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean(),
    ]);

    // Une entrée compte comme « review » dès qu'elle a du contenu rédigé.
    const reviews = entries
      .filter(
        (e) =>
          (e.review && e.review.trim()) ||
          (e.pros && e.pros.length) ||
          (e.cons && e.cons.length) ||
          (e.reviewMedia && e.reviewMedia.length)
      )
      .map((e) => reviewCard(e, req.userId, user));

    // Tous les commentaires ET réponses écrits par l'utilisateur, à plat.
    const comments = [];
    for (const l of lists) {
      const all = l.comments || [];
      for (const c of all) {
        if (String(c.user?._id || c.user) !== String(user._id)) continue;
        const parent = c.parent
          ? all.find((x) => String(x._id) === String(c.parent))
          : null;
        comments.push({
          kind: "list",
          id: c._id,
          text: c.text || "",
          media: (c.media || []).map((m) => ({
            type: m.type,
            url: m.url,
            width: m.width,
            height: m.height,
          })),
          mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
          likeCount: (c.likes || []).length,
          liked: (c.likes || []).some((u) => String(u) === String(req.userId)),
          parent: c.parent ? String(c.parent) : null,
          replyTo: parent
            ? {
                username: parent.user?.username || null,
                text: (parent.text || "").slice(0, 80),
              }
            : null,
          list: (() => {
            const its = l.items || [];
            const chars = its.filter((i) => i.kind === "character").length;
            return {
              id: l._id,
              title: l.title,
              type: l.type,
              itemCount: its.length,
              // Nature des éléments (pour afficher « X jeux » ou « X personnages »).
              itemKind: its.length > 0 && chars === its.length ? "character" : "game",
              preview: its
                .filter((i) => i.image)
                .slice(0, 4)
                .map((i) => i.image),
              author: l.user?.username
                ? { username: l.user.username, avatar: l.user.avatar || null }
                : null,
              likeCount: (l.likes || []).length,
              commentCount: (l.comments || []).length,
            };
          })(),
          createdAt: c.createdAt,
        });
      }
    }

    // Réponses écrites par l'utilisateur sous les reviews d'autres joueurs.
    for (const e of reviewCommented) {
      const all = e.comments || [];
      for (const c of all) {
        if (String(c.user?._id || c.user) !== String(user._id)) continue;
        const parent = c.parent
          ? all.find((x) => String(x._id) === String(c.parent))
          : null;
        comments.push({
          kind: "review",
          id: c._id,
          text: c.text || "",
          media: (c.media || []).map((m) => ({
            type: m.type,
            url: m.url,
            width: m.width,
            height: m.height,
          })),
          mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
          likeCount: (c.likes || []).length,
          liked: (c.likes || []).some((u) => String(u) === String(req.userId)),
          parent: c.parent ? String(c.parent) : null,
          replyTo: parent
            ? {
                username: parent.user?.username || null,
                text: (parent.text || "").slice(0, 80),
              }
            : null,
          game: {
            id: e.gameId,
            name: e.name,
            cover: e.cover || null,
            author: e.user?.username
              ? { username: e.user.username, avatar: e.user.avatar || null }
              : null,
          },
          createdAt: c.createdAt,
        });
      }
    }

    // Commentaires écrits par l'utilisateur sous des OST favorites (de tout profil).
    if (ostThreads.length) {
      // Jaquette/nom du jeu + OST : dans l'entrée de bibliothèque du propriétaire.
      const keys = ostThreads.map((t) => ({
        user: t.owner?._id || t.owner,
        gameId: t.gameId,
      }));
      const ostEntries = await UserGame.find({ $or: keys })
        .select("user gameId name cover favoriteOst")
        .lean();
      const ostMap = new Map(
        ostEntries.map((e) => [`${e.user}_${e.gameId}`, e])
      );
      for (const t of ostThreads) {
        const all = t.comments || [];
        const ownerId = t.owner?._id || t.owner;
        const entry = ostMap.get(`${ownerId}_${t.gameId}`);
        const fo = entry?.favoriteOst;
        for (const c of all) {
          if (String(c.user?._id || c.user) !== String(user._id)) continue;
          const parent = c.parent
            ? all.find((x) => String(x._id) === String(c.parent))
            : null;
          comments.push({
            kind: "ost",
            id: c._id,
            text: c.text || "",
            media: (c.media || []).map((m) => ({
              type: m.type,
              url: m.url,
              width: m.width,
              height: m.height,
            })),
            mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
            likeCount: (c.likes || []).length,
            liked: (c.likes || []).some((u) => String(u) === String(req.userId)),
            parent: c.parent ? String(c.parent) : null,
            replyTo: parent
              ? {
                  username: parent.user?.username || null,
                  text: (parent.text || "").slice(0, 80),
                }
              : null,
            owner: t.owner?.username
              ? { id: ownerId, username: t.owner.username, avatar: t.owner.avatar || null }
              : { id: ownerId, username: null, avatar: null },
            game: { id: t.gameId, name: entry?.name || "Jeu", cover: entry?.cover || null },
            ost: fo?.name
              ? {
                  name: fo.name,
                  artist: fo.artist || null,
                  artwork: fo.artwork || null,
                  preview: fo.preview || null,
                  youtube: !!fo.youtube,
                  url: fo.url || null,
                }
              : null,
            createdAt: c.createdAt,
          });
        }
      }
    }

    // Commentaires écrits par l'utilisateur sous des republications de fan arts.
    const uploadsBase = `${req.protocol}://${req.get("host")}`;
    for (const r of repostCommented) {
      const all = r.comments || [];
      const ownerId = r.user?._id || r.user;
      for (const c of all) {
        if (String(c.user?._id || c.user) !== String(user._id)) continue;
        const parent = c.parent
          ? all.find((x) => String(x._id) === String(c.parent))
          : null;
        comments.push({
          kind: "repost",
          id: c._id,
          text: c.text || "",
          media: (c.media || []).map((m) => ({
            type: m.type,
            url: m.url,
            width: m.width,
            height: m.height,
          })),
          mentions: (c.mentions || []).map((m) => m.username).filter(Boolean),
          likeCount: (c.likes || []).length,
          liked: (c.likes || []).some((u) => String(u) === String(req.userId)),
          parent: c.parent ? String(c.parent) : null,
          replyTo: parent
            ? {
                username: parent.user?.username || null,
                text: (parent.text || "").slice(0, 80),
              }
            : null,
          owner: r.user?.username
            ? { id: ownerId, username: r.user.username, avatar: r.user.avatar || null }
            : { id: ownerId, username: null, avatar: null },
          game: { id: r.gameId, name: r.gameName, cover: r.gameCover || null },
          repost: {
            id: String(r._id),
            image: `${uploadsBase}/uploads/reposts/${r.image}`,
            source: r.source,
            author: r.author || "",
          },
          createdAt: c.createdAt,
        });
      }
    }

    comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ reviews, comments });
  } catch (err) {
    console.error("profile activity error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de l'activité." });
  }
});

// --- Recommandations d'un utilisateur : reçues (groupées par jeu) + envoyées ---
// Déclarée AVANT /:username pour ne pas être capturée.
// Enrichit une liste d'ids de jeux avec genres/plateformes/année (IGDB, best-effort).
async function gameMetaMap(gameIds) {
  const ids = [...new Set(gameIds)].filter(Boolean).slice(0, 300);
  const map = new Map();
  if (!ids.length) return map;
  try {
    const raw = await igdbQuery(
      "games",
      `fields name,genres.name,platforms.abbreviation,platforms.name,first_release_date; where id = (${ids.join(",")}); limit ${ids.length};`
    );
    for (const g of raw) {
      map.set(g.id, {
        genres: (g.genres || []).map((x) => x.name).filter(Boolean),
        platforms: (g.platforms || []).map((p) => p.abbreviation || p.name).filter(Boolean),
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
      });
    }
  } catch (err) {
    console.error("reco igdb enrich error:", err.message);
  }
  return map;
}

router.get("/:username/recommendations", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select("_id");
    if (!user) return res.status(404).json({ error: "Profil introuvable." });

    const meId = String(req.userId);
    const person = (u) =>
      u ? { id: u._id, username: u.username, avatar: u.avatar || null } : null;

    const [received, sent] = await Promise.all([
      Recommendation.find({ to: user._id })
        .populate("recommenders.user", "username avatar")
        .populate("comments.user", "username avatar")
        .sort({ updatedAt: -1 })
        .lean(),
      Recommendation.find({ "recommenders.user": user._id })
        .populate("to", "username avatar")
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const meta = await gameMetaMap([
      ...received.map((r) => r.gameId),
      ...sent.map((r) => r.gameId),
    ]);
    const withMeta = (r) => {
      const m = meta.get(r.gameId) || {};
      return { genres: m.genres || [], platforms: m.platforms || [], year: m.year ?? null };
    };

    const receivedList = received
      .map((r) => {
        const recommenders = (r.recommenders || []).map((rc) => ({
          user: person(rc.user),
          message: rc.message || "",
          at: rc.at,
        }));
        const boosters = (r.boosters || []).map(String);
        return {
          id: String(r._id),
          gameId: r.gameId,
          name: r.name,
          cover: r.cover,
          ...withMeta(r),
          count: recommenders.length + boosters.length,
          recommenders,
          iRecommended: (r.recommenders || []).some((rc) => String(rc.user?._id || rc.user) === meId),
          iBoosted: boosters.includes(meId),
          comments: (r.comments || []).map((c) => ({
            id: String(c._id),
            user: person(c.user),
            text: c.text,
            createdAt: c.createdAt,
          })),
          lastAt: recommenders.reduce(
            (mx, rc) => (new Date(rc.at) > new Date(mx) ? rc.at : mx),
            r.createdAt
          ),
        };
      })
      .sort((a, b) => b.count - a.count);

    const sentList = sent.map((r) => {
      const mine = (r.recommenders || []).find((rc) => String(rc.user?._id || rc.user) === String(user._id));
      return {
        id: String(r._id),
        gameId: r.gameId,
        name: r.name,
        cover: r.cover,
        ...withMeta(r),
        to: person(r.to),
        message: mine?.message || "",
        count: (r.recommenders || []).length + (r.boosters || []).length,
        createdAt: r.createdAt,
      };
    });

    res.json({ received: receivedList, sent: sentList });
  } catch (err) {
    console.error("reco fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des recommandations." });
  }
});

// --- Statistiques du profil (onglet Stats) ---
// Tout est calculé à la volée depuis Mongo. IGDB n'est sollicité que pour les
// jeux absents du cache GameMeta (1 requête batchée max, puis plus jamais).
router.get("/:username/stats", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select(
      "_id following"
    );
    if (!user) return res.status(404).json({ error: "Profil introuvable." });

    const entries = await UserGame.find({ user: user._id })
      .select("gameId name cover status platform format playtimeHours favorite rating review")
      .lean();

    const meta = await ensureGameMeta(entries.map((e) => e.gameId));
    const played = entries.filter((e) => e.status !== "wishlist");
    const finishable = played.filter((e) => e.status !== "endless");
    // Base des stats de goûts (genres, studios…) : les jeux joués ; si le
    // profil n'a que de la wishlist, on se rabat sur toute la bibliothèque.
    const base = played.length ? played : entries;

    // -- Compteur générique : liste de labels -> top trié avec proportions --
    const tally = (items) => {
      const m = new Map();
      for (const it of items) if (it) m.set(it, (m.get(it) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const withPct = ([name, count]) => ({
      name,
      count,
      pct: Math.round((count / base.length) * 100),
    });

    // -- Listes de jeux par facette (pour les pop-ups « voir les jeux ») --
    // Version allégée d'une entrée : juste de quoi afficher une jaquette.
    const FACET_CAP = 60; // on plafonne chaque liste (payload + lisibilité)
    const slim = (e) => ({ gameId: e.gameId, name: e.name, cover: e.cover });
    // Regroupe des entrées par clé(s) -> liste de jeux allégée (plafonnée).
    const groupGames = (list, keyFn) => {
      const m = new Map();
      for (const e of list) {
        for (const k of keyFn(e)) {
          if (k == null || k === "") continue;
          if (!m.has(k)) m.set(k, []);
          const arr = m.get(k);
          if (arr.length < FACET_CAP) arr.push(slim(e));
        }
      }
      return m;
    };

    // -- Totaux / KPI --
    const hours = played.reduce((s, e) => s + (e.playtimeHours || 0), 0);
    const rated = entries.filter((e) => e.rating != null);
    const finished = entries.filter((e) => e.status === "finished").length;
    const droppedCount = entries.filter((e) => e.status === "dropped").length;
    const avgRating = rated.length
      ? Math.round(rated.reduce((s, e) => s + e.rating, 0) / rated.length)
      : null;

    const statusGames = groupGames(entries, (e) => [e.status]);
    const statuses = ["playing", "endless", "finished", "paused", "dropped", "wishlist"].map(
      (key) => ({
        key,
        count: entries.filter((e) => e.status === key).length,
        games: statusGames.get(key) || [],
      })
    );

    // -- Consoles (plateforme déclarée sur l'entrée) --
    const platMap = new Map();
    for (const e of played) {
      if (!e.platform) continue;
      const p = platMap.get(e.platform) || { name: e.platform, count: 0, hours: 0 };
      p.count += 1;
      p.hours += e.playtimeHours || 0;
      platMap.set(e.platform, p);
    }
    const platGames = groupGames(played, (e) => (e.platform ? [e.platform] : []));
    const platforms = [...platMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((p) => ({
        ...p,
        pct: Math.round((p.count / played.length) * 100),
        games: platGames.get(p.name) || [],
      }));

    // -- Démat vs physique vs let's play (jeux joués ; défaut : digital) --
    // Les jeux « vus en let's play » n'ont pas de format d'achat : on les sort
    // du décompte démat/physique pour en faire une catégorie à part.
    const LETSPLAY_PLATFORM = "Vu en let's play";
    const letsplayEntries = played.filter((e) => e.platform === LETSPLAY_PLATFORM);
    const ownedEntries = played.filter((e) => e.platform !== LETSPLAY_PLATFORM);
    const physicalEntries = ownedEntries.filter((e) => e.format === "physical");
    const digitalEntries = ownedEntries.filter((e) => e.format !== "physical");
    const formats = {
      digital: digitalEntries.length,
      physical: physicalEntries.length,
      letsplay: letsplayEntries.length,
      digitalGames: digitalEntries.slice(0, FACET_CAP).map(slim),
      physicalGames: physicalEntries.slice(0, FACET_CAP).map(slim),
      letsplayGames: letsplayEntries.slice(0, FACET_CAP).map(slim),
    };

    // -- Marathon : jeux avec le plus d'heures --
    const topByHours = played
      .filter((e) => (e.playtimeHours || 0) > 0)
      .sort((a, b) => b.playtimeHours - a.playtimeHours)
      .slice(0, 8)
      .map((e) => ({ gameId: e.gameId, name: e.name, cover: e.cover, hours: e.playtimeHours }));

    // -- Goûts : genres / studios / franchises (via le cache GameMeta) --
    const metaOf = (e) => meta.get(e.gameId) || {};
    const genreGames = groupGames(base, (e) => metaOf(e).genres || []);
    const genres = tally(base.flatMap((e) => metaOf(e).genres || []))
      .slice(0, 8)
      .map(withPct)
      .map((g) => ({ ...g, games: genreGames.get(g.name) || [] }));
    const developers = tally(base.flatMap((e) => metaOf(e).developers || []))
      .slice(0, 8)
      .map(withPct);
    const publishers = tally(base.flatMap((e) => metaOf(e).publishers || []))
      .slice(0, 8)
      .map(withPct);

    // -- Logos studios/éditeurs/consoles (cache Mongo, IGDB au premier appel) --
    const [companyLogos, platformLogos] = await Promise.all([
      ensureEntityLogos("company", [
        ...developers.map((d) => d.name),
        ...publishers.map((p) => p.name),
      ]),
      ensureEntityLogos("platform", platforms.map((p) => p.name)),
    ]);
    for (const d of developers) d.logo = companyLogos.get(d.name) || null;
    for (const p of publishers) p.logo = companyLogos.get(p.name) || null;
    for (const p of platforms) p.logo = platformLogos.get(p.name) || null;
    const franchiseGames = groupGames(base, (e) =>
      metaOf(e).franchise ? [metaOf(e).franchise] : []
    );
    const franchises = tally(base.map((e) => metaOf(e).franchise))
      .filter(([, count]) => count >= 2)
      .slice(0, 6)
      .map(([name, count]) => ({
        name,
        count,
        covers: base
          .filter((e) => metaOf(e).franchise === name && e.cover)
          .slice(0, 3)
          .map((e) => e.cover),
        games: franchiseGames.get(name) || [],
      }));

    // -- Machine à remonter le temps : décennies de sortie --
    const decadeGames = groupGames(base, (e) => {
      const y = metaOf(e).year;
      return y ? [Math.floor(y / 10) * 10] : [];
    });
    const decades = tally(
      base.map((e) => {
        const y = metaOf(e).year;
        return y ? Math.floor(y / 10) * 10 : null;
      })
    )
      .map(([decade, count]) => ({
        decade,
        count,
        games: decadeGames.get(decade) || [],
      }))
      .sort((a, b) => a.decade - b.decade);

    // -- Notes : distribution (10 paliers) + podium --
    const dist = Array.from({ length: 10 }, () => 0);
    for (const e of rated) dist[Math.min(9, Math.floor(e.rating / 10))] += 1;
    const ratingGames = groupGames(rated, (e) => [Math.min(9, Math.floor(e.rating / 10))]);
    const distGames = Array.from({ length: 10 }, (_, i) => ratingGames.get(i) || []);
    const topRated = rated
      .slice()
      .sort((a, b) => b.rating - a.rating || (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      .slice(0, 5)
      .map((e) => ({ gameId: e.gameId, name: e.name, cover: e.cover, rating: e.rating }));

    // -- Les mal-aimés : pires notes (sans recouper le panthéon) --
    const topIds = new Set(topRated.map((g) => g.gameId));
    const flopRated = rated
      .filter((e) => !topIds.has(e.gameId) && e.rating < 60)
      .sort(
        (a, b) =>
          a.rating - b.rating ||
          (b.status === "dropped" ? 1 : 0) - (a.status === "dropped" ? 1 : 0)
      )
      .slice(0, 5)
      .map((e) => ({
        gameId: e.gameId,
        name: e.name,
        cover: e.cover,
        rating: e.rating,
        dropped: e.status === "dropped",
      }));

    // -- Âme sœur gaming : l'abonnement avec le plus de goûts en commun --
    // Zéro IGDB : simple croisement des bibliothèques des gens que ce profil
    // suit (jeux en commun pondérés + proximité des notes sur ces jeux).
    const following = (user.following || []).slice(0, 150);
    const mine = new Map(entries.map((e) => [e.gameId, e]));
    let soulmates = [];
    if (following.length && entries.length) {
      const friendGames = await UserGame.find({ user: { $in: following } })
        .select("user gameId rating favorite")
        .lean();
      const byFriend = new Map();
      for (const g of friendGames) {
        const k = String(g.user);
        if (!byFriend.has(k)) byFriend.set(k, []);
        byFriend.get(k).push(g);
      }
      const scored = [];
      for (const [fid, list] of byFriend) {
        const common = list.filter((g) => mine.has(g.gameId));
        if (common.length < 3) continue;
        const overlap = common.length / Math.min(entries.length, list.length);
        const ratedPairs = common
          .map((g) => [g.rating, mine.get(g.gameId).rating])
          .filter(([a, b]) => a != null && b != null);
        const agreement = ratedPairs.length
          ? ratedPairs.reduce((s, [a, b]) => s + (1 - Math.abs(a - b) / 100), 0) /
            ratedPairs.length
          : null;
        // Coups de cœur partagés : le signal de goût le plus fort — un jeu que
        // les DEUX ont mis en favori pèse bien plus qu'un simple jeu en commun.
        const sharedFavs = common.filter(
          (g) => g.favorite && mine.get(g.gameId).favorite
        ).length;
        const favScore = sharedFavs ? Math.min(1, sharedFavs / 4) : null;
        // Moyenne pondérée des composantes disponibles (les poids des
        // composantes absentes sont redistribués).
        const parts = [
          [0.45, overlap],
          [0.3, agreement],
          [0.25, favScore],
        ].filter(([, v]) => v != null);
        const wTotal = parts.reduce((s, [w]) => s + w, 0);
        const match = Math.round(
          (100 * parts.reduce((s, [w, v]) => s + w * v, 0)) / wTotal
        );
        const topCommon = common
          .map((g) => mine.get(g.gameId))
          .sort(
            (a, b) =>
              (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) ||
              (b.rating || 0) - (a.rating || 0)
          )
          .slice(0, 4)
          .map((e) => ({ gameId: e.gameId, name: e.name, cover: e.cover }));
        scored.push({
          fid,
          match: Math.min(match, 99),
          common: common.length,
          sharedFavs,
          topCommon,
        });
      }
      scored.sort((a, b) => b.match - a.match || b.common - a.common);
      const top = scored.slice(0, 3);
      if (top.length) {
        const friends = await User.find({ _id: { $in: top.map((s) => s.fid) } })
          .select("username avatar")
          .lean();
        const fMap = new Map(friends.map((f) => [String(f._id), f]));
        soulmates = top
          .filter((s) => fMap.has(s.fid))
          .map((s) => ({
            id: s.fid,
            username: fMap.get(s.fid).username,
            avatar: fMap.get(s.fid).avatar || null,
            match: s.match,
            common: s.common,
            sharedFavs: s.sharedFavs,
            topCommon: s.topCommon,
          }));
      }
    }

    res.json({
      totals: {
        games: entries.length,
        played: played.length,
        finished,
        hours,
        favorites: entries.filter((e) => e.favorite).length,
        reviews: entries.filter((e) => (e.review || "").trim()).length,
        rated: rated.length,
        avgRating,
        // Base « finissable » : les jeux sans fin (multi/service) sont exclus
        // du taux de complétion — on ne peut ni les terminer ni les abandonner.
        completionRate: finishable.length ? Math.round((finished / finishable.length) * 100) : null,
        droppedRate: finishable.length ? Math.round((droppedCount / finishable.length) * 100) : null,
      },
      statuses,
      platforms,
      formats,
      topByHours,
      genres,
      developers,
      publishers,
      franchises,
      decades,
      ratings: { avg: avgRating, dist, distGames, top: topRated, flop: flopRated },
      soulmates,
      // Part des jeux dont on a les métadonnées (honnêteté des % affichés)
      metaCoverage: entries.length
        ? Math.round(
            (entries.filter((e) => meta.has(e.gameId)).length / entries.length) * 100
          )
        : 0,
    });
  } catch (err) {
    console.error("profile stats error:", err.message);
    res.status(500).json({ error: "Erreur lors du calcul des statistiques." });
  }
});

// --- Jeux en commun entre deux profils (détail de l'âme sœur gaming) ---
// Renvoie l'intersection complète des deux bibliothèques, coups de cœur
// partagés en tête puis meilleures notes, avec la note de chacun.
router.get("/:username/common/:other", optionalAuth, async (req, res) => {
  try {
    const [user, other] = await Promise.all([
      User.findOne({ username: req.params.username }).select("_id"),
      User.findOne({ username: req.params.other }).select("_id"),
    ]);
    if (!user || !other)
      return res.status(404).json({ error: "Profil introuvable." });

    const [mine, theirs] = await Promise.all([
      UserGame.find({ user: user._id })
        .select("gameId name cover rating favorite status")
        .lean(),
      UserGame.find({ user: other._id })
        .select("gameId rating favorite")
        .lean(),
    ]);
    const theirMap = new Map(theirs.map((g) => [g.gameId, g]));
    const games = mine
      .filter((g) => theirMap.has(g.gameId))
      .map((g) => {
        const t = theirMap.get(g.gameId);
        return {
          gameId: g.gameId,
          name: g.name,
          cover: g.cover,
          myRating: g.rating ?? null,
          theirRating: t.rating ?? null,
          myFav: Boolean(g.favorite),
          theirFav: Boolean(t.favorite),
        };
      })
      .sort(
        (a, b) =>
          (b.myFav && b.theirFav ? 1 : 0) - (a.myFav && a.theirFav ? 1 : 0) ||
          (b.myFav || b.theirFav ? 1 : 0) - (a.myFav || a.theirFav ? 1 : 0) ||
          ((b.myRating || 0) + (b.theirRating || 0)) -
            ((a.myRating || 0) + (a.theirRating || 0))
      );

    res.json({ games });
  } catch (err) {
    console.error("common games error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des jeux en commun." });
  }
});

// --- Onglet « Succès » du profil : synthèse des succès (Steam pour l'instant,
//     PSN prévu) agrégés par jeu + statistiques globales. ---
router.get("/:username/achievements", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select(
      "_id steam psn"
    );
    if (!user) return res.status(404).json({ error: "Profil introuvable." });
    const isMe = String(user._id) === String(req.userId);

    const docs = await GameAchievements.find({ user: user._id }).lean();

    // Temps de jeu / note depuis la bibliothèque (jointure par gameId) pour
    // permettre les tris « temps de jeu » et « note » côté client.
    const ugs = await UserGame.find({ user: user._id })
      .select("gameId playtimeHours rating")
      .lean();
    const ugMap = new Map(ugs.map((u) => [u.gameId, u]));

    const games = docs
      .map((d) => {
        const percent = d.total ? Math.round((d.unlocked / d.total) * 100) : 0;
        const list = d.achievements || [];
        // Succès débloqué le plus rare de ce jeu (rareté = % de joueurs).
        const rarest = list
          .filter((a) => a.unlocked && a.rarity != null)
          .sort((a, b) => a.rarity - b.rarity)[0];
        // Date du dernier succès débloqué (pour le tri « activité récente »).
        let lastUnlock = null;
        for (const a of list) {
          if (a.unlocked && a.unlockedAt) {
            const t = new Date(a.unlockedAt).getTime();
            if (!lastUnlock || t > lastUnlock) lastUnlock = t;
          }
        }
        const ug = ugMap.get(d.gameId);
        return {
          gameId: d.gameId,
          name: d.gameName,
          cover: d.gameCover,
          platform: d.platform,
          total: d.total,
          unlocked: d.unlocked,
          percent,
          perfect: d.total > 0 && d.unlocked === d.total,
          playtime: ug?.playtimeHours ?? null,
          rating: ug?.rating ?? null,
          lastUnlock: lastUnlock ? new Date(lastUnlock) : null,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          rarest: rarest
            ? { name: rarest.name, rarity: rarest.rarity, icon: rarest.icon }
            : null,
        };
      })
      .sort((a, b) => b.unlocked - a.unlocked || b.percent - a.percent);

    // Flux transverses : succès récemment débloqués + plus rares, tous jeux.
    const flat = [];
    for (const d of docs) {
      for (const a of d.achievements || []) {
        if (!a.unlocked) continue;
        flat.push({
          name: a.name,
          icon: a.icon,
          rarity: a.rarity,
          unlockedAt: a.unlockedAt,
          gameId: d.gameId,
          gameName: d.gameName,
          cover: d.gameCover,
          platform: d.platform,
        });
      }
    }
    const recent = flat
      .filter((a) => a.unlockedAt)
      .sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt))
      .slice(0, 12);
    const rarest = flat
      .filter((a) => a.rarity != null)
      .sort((a, b) => a.rarity - b.rarity)
      .slice(0, 12);

    const withAch = games.filter((g) => g.total > 0);
    const totalUnlocked = games.reduce((s, g) => s + g.unlocked, 0);
    const totalAchievements = games.reduce((s, g) => s + g.total, 0);
    const avgCompletion = withAch.length
      ? Math.round(withAch.reduce((s, g) => s + g.percent, 0) / withAch.length)
      : 0;
    // Succès « légendaires » débloqués : rareté mondiale < 5 %.
    const legendaryUnlocked = flat.filter(
      (a) => a.rarity != null && a.rarity < 5
    ).length;
    // Répartition des jeux suivis par plateforme (pour les filtres client).
    const byPlatform = games.reduce((acc, g) => {
      acc[g.platform] = (acc[g.platform] || 0) + 1;
      return acc;
    }, {});

    res.json({
      isMe,
      connected: !!user.steam?.steamId || !!user.psn?.accountId,
      stats: {
        games: games.length,
        totalUnlocked,
        totalAchievements,
        globalCompletion: totalAchievements
          ? Math.round((totalUnlocked / totalAchievements) * 100)
          : 0,
        avgCompletion,
        perfectGames: games.filter((g) => g.perfect).length,
        legendaryUnlocked,
        byPlatform,
      },
      games,
      recent,
      rarest,
    });
  } catch (err) {
    console.error("achievements summary error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des succès." });
  }
});

// --- Liste complète des succès d'UN jeu (chargée à l'ouverture d'une carte). ---
router.get("/:username/achievements/:gameId", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select("_id");
    if (!user) return res.status(404).json({ error: "Profil introuvable." });
    const doc = await GameAchievements.findOne({
      user: user._id,
      gameId: Number(req.params.gameId),
    }).lean();
    if (!doc) return res.json({ achievements: [] });
    // Débloqués d'abord (par date récente), puis verrouillés (par rareté).
    const achievements = (doc.achievements || []).slice().sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      if (a.unlocked) return new Date(b.unlockedAt || 0) - new Date(a.unlockedAt || 0);
      return (b.rarity ?? -1) - (a.rarity ?? -1);
    });
    res.json({
      gameId: doc.gameId,
      name: doc.gameName,
      cover: doc.gameCover,
      platform: doc.platform,
      total: doc.total,
      unlocked: doc.unlocked,
      achievements,
    });
  } catch (err) {
    console.error("achievements detail error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Profil public complet par identifiant (username) ---
// optionalAuth : consultable sans être connecté (profil partageable). Un
// visiteur connecté est reconnu (isMe / abonnements) ; un invité voit la
// version publique (isMe=false, lists publiques uniquement).
router.get("/:username", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "Profil introuvable." });

    const isMe = String(user._id) === String(req.userId);
    const me = isMe
      ? user
      : req.userId
        ? await User.findById(req.userId).select("following")
        : null;
    const isFollowing = (me?.following || []).some(
      (u) => String(u) === String(user._id)
    );

    const [entries, followers, listQuery, recoCount, videoCount, achievementsCount, trackerDocs] =
      await Promise.all([
        UserGame.find({ user: user._id }).sort({ updatedAt: -1 }),
        User.countDocuments({ following: user._id }),
        List.find(
          isMe
            ? { user: user._id }
            : { user: user._id, visibility: "public" }
        )
          .populate("user", "username avatar")
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean(),
        Recommendation.countDocuments({ to: user._id }),
        Documentary.countDocuments({ user: user._id, recommended: true }),
        GameAchievements.countDocuments({ user: user._id }),
        GameTracker.find({ user: user._id }).lean(),
      ]);

    // Résumé léger des comptes de tracking liés (badge + visibilité de l'onglet
    // Tracking). On expose juste provider + pseudo + rang courant.
    const trackers = (trackerDocs || []).map((t) => ({
      provider: t.provider,
      externalName: t.externalName || null,
      rank: t.snapshot?.rank?.tier || null,
    }));

    const library = entries.map(entryCard);

    // Nombre de commentaires par OST favorite (pour la pastille de l'onglet OST).
    const ostGameIds = library.filter((e) => e.favoriteOst).map((e) => e.gameId);
    if (ostGameIds.length) {
      const threads = await OstThread.find({
        owner: user._id,
        gameId: { $in: ostGameIds },
      })
        .select("gameId comments")
        .lean();
      const counts = new Map(
        threads.map((t) => [t.gameId, (t.comments || []).length])
      );
      for (const e of library) {
        if (e.favoriteOst) e.ostCommentCount = counts.get(e.gameId) || 0;
      }
    }

    // Enrichit chaque jeu avec ses genres/plateformes/modes/thèmes (ids IGDB)
    // pour permettre les filtres façon Explorer. Best-effort : si IGDB est
    // indisponible, on renvoie simplement des tableaux vides.
    if (library.length) {
      try {
        const ids = [...new Set(library.map((e) => e.gameId))].slice(0, 500);
        const raw = await igdbQuery(
          "games",
          `fields genres,platforms,game_modes,themes; where id = (${ids.join(",")}); limit 500;`
        );
        const meta = new Map(raw.map((g) => [g.id, g]));
        for (const e of library) {
          const g = meta.get(e.gameId) || {};
          e.genres = g.genres || [];
          e.platforms = g.platforms || [];
          e.modes = g.game_modes || [];
          e.themes = g.themes || [];
        }
      } catch (err) {
        console.error("profile igdb enrich error:", err.message);
      }
    }

    const favorites = library.filter((e) => e.favorite);
    const finished = library.filter((e) => e.status === "finished").length;

    res.json({
      profile: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        cover: user.cover,
        coverPos: user.coverPos,
        covers: user.effectiveCovers(),
        bio: user.bio,
        tagline: user.tagline,
        taglineImage: user.taglineImage,
        ostOrder: user.ostOrder || [],
        overviewOrder: user.overviewOrder || [],
        overviewCards: user.overviewCards || [],
        overviewGameOrder: user.overviewGameOrder || {},
        asideOrder: user.asideOrder || [],
        asideHidden: user.asideHidden || [],
        asideConfig: user.asideConfig || {},
        favoriteCompanies: user.favoriteCompanies || [],
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt || null,
        isMe,
        isFollowing,
        trackers,
        counts: {
          followers,
          following: (user.following || []).length,
          games: library.length,
          favorites: favorites.length,
          finished,
          recommendations: recoCount,
          videos: videoCount,
          achievements: achievementsCount,
          trackers: trackers.length,
        },
      },
      favorites,
      library,
      lists: listQuery.map((l) => listCard(l, req.userId)),
    });
  } catch (err) {
    console.error("profile fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du profil." });
  }
});

export default router;
