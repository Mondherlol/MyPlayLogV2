import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import User from "../models/User.js";
import GameMedia from "../models/GameMedia.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import Recommendation from "../models/Recommendation.js";
import OstThread from "../models/OstThread.js";
import Repost from "../models/Repost.js";
import Documentary from "../models/Documentary.js";
import Notification from "../models/Notification.js";
import Activity from "../models/Activity.js";
import HiddenOst from "../models/HiddenOst.js";
import OstRename from "../models/OstRename.js";
import GemSkip from "../models/GemSkip.js";
import GemDiscovery from "../models/GemDiscovery.js";
import { isUserAdmin } from "../lib/admin.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { listEnv, setEnvVar, deleteEnvVar } from "../lib/envFile.js";
import {
  listMissionsForAdmin,
  updateMissionConfig,
  resetMissionConfig,
} from "../lib/missions.js";

const router = express.Router();

// Toutes les routes de ce fichier sont réservées aux administrateurs.
router.use(requireAuth, requireAdmin);

// --- Liste des utilisateurs du site (avec recherche + nb de jeux) ---
router.get("/users", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const filter = {};
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: safe, $options: "i" };
      filter.$or = [{ username: rx }, { email: rx }];
    }

    const users = await User.find(filter)
      .select("username email avatar createdAt lastSeenAt following isAdmin isSuperAdmin points")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // Nombre de jeux par utilisateur (une seule agrégation).
    const counts = await UserGame.aggregate([
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]);
    const gameCount = new Map(counts.map((c) => [String(c._id), c.count]));
    // Abonnés : combien de personnes suivent chaque user.
    const followerCounts = await User.aggregate([
      { $unwind: "$following" },
      { $group: { _id: "$following", count: { $sum: 1 } } },
    ]);
    const followers = new Map(followerCounts.map((c) => [String(c._id), c.count]));

    res.json({
      users: users.map((u) => ({
        id: u._id,
        username: u.username,
        email: u.email,
        avatar: u.avatar || null,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt || null,
        isAdmin: isUserAdmin(u),
        isSuper: !!u.isSuperAdmin,
        gameCount: gameCount.get(String(u._id)) || 0,
        points: u.points || 0, // solde d'arcade, ajustable depuis la fiche
        followingCount: (u.following || []).length,
        followersCount: followers.get(String(u._id)) || 0,
      })),
      total: users.length,
    });
  } catch (err) {
    console.error("admin users list error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des utilisateurs." });
  }
});

// --- Suppression d'un utilisateur + TOUTES ses données (irréversible) ---
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    if (String(id) === String(req.userId))
      return res.status(400).json({ error: "Tu ne peux pas supprimer ton propre compte." });

    const target = await User.findById(id).select("isSuperAdmin");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (target.isSuperAdmin)
      return res.status(403).json({ error: "Impossible de supprimer le super-administrateur." });

    // Contenu possédé par l'utilisateur.
    await Promise.all([
      UserGame.deleteMany({ user: id }),
      List.deleteMany({ user: id }),
      OstThread.deleteMany({ owner: id }),
      Repost.deleteMany({ user: id }),
      Documentary.deleteMany({ user: id }),
      HiddenOst.deleteMany({ user: id }),
      OstRename.deleteMany({ user: id }),
      GemSkip.deleteMany({ user: id }),
      GemDiscovery.deleteMany({ user: id }),
      Notification.deleteMany({ $or: [{ user: id }, { actor: id }] }),
      Activity.deleteMany({ $or: [{ actor: id }, { target: id }] }),
      Recommendation.deleteMany({ to: id }),
    ]);

    // Références de l'utilisateur laissées dans le contenu d'autrui.
    await Promise.all([
      // Abonnements : on retire ce user des « following » de tout le monde.
      User.updateMany({ following: id }, { $pull: { following: id } }),
      // Commentaires / likes / réactions écrits par ce user ailleurs.
      UserGame.updateMany({}, { $pull: { comments: { user: id }, reactions: { user: id } } }),
      List.updateMany({}, { $pull: { comments: { user: id }, likes: id } }),
      OstThread.updateMany({}, { $pull: { comments: { user: id } } }),
      Repost.updateMany({}, { $pull: { comments: { user: id }, likes: id } }),
      Recommendation.updateMany(
        {},
        { $pull: { recommenders: { user: id }, boosters: id, comments: { user: id } } }
      ),
    ]);

    // Recommandations devenues vides (plus aucun recommandeur) : on les supprime.
    await Recommendation.deleteMany({ recommenders: { $size: 0 } });

    await User.findByIdAndDelete(id);

    res.json({ ok: true });
  } catch (err) {
    console.error("admin user delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur." });
  }
});

// Carte légère d'un utilisateur pour les listes d'abonnés / abonnements.
function userCard(u) {
  return {
    id: String(u._id),
    username: u.username,
    avatar: u.avatar || null,
    isAdmin: isUserAdmin(u),
  };
}

// --- Détail d'un utilisateur : profil + abonnements + abonnés (pour gérer les
//     liens depuis le panel). ---
router.get("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });

    const user = await User.findById(id)
      .select("username email avatar bio createdAt lastSeenAt following isAdmin isSuperAdmin points")
      .populate("following", "username avatar isAdmin isSuperAdmin")
      .lean();
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    // Abonnés : les comptes qui suivent cet utilisateur.
    const followers = await User.find({ following: id })
      .select("username avatar isAdmin isSuperAdmin")
      .sort({ username: 1 })
      .limit(500)
      .lean();

    const gameCount = await UserGame.countDocuments({ user: id });

    res.json({
      user: {
        id: String(user._id),
        username: user.username,
        email: user.email,
        avatar: user.avatar || null,
        bio: user.bio || "",
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt || null,
        isAdmin: isUserAdmin(user),
        isSuper: !!user.isSuperAdmin,
        gameCount,
        points: user.points || 0,
      },
      following: (user.following || []).map(userCard),
      followers: followers.map(userCard),
    });
  } catch (err) {
    console.error("admin user detail error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de l'utilisateur." });
  }
});

// --- Changer l'email d'un utilisateur ---
router.patch("/users/:id/email", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });

    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Adresse email invalide." });

    const target = await User.findById(id).select("isSuperAdmin");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    // Le compte super-admin n'est modifiable que par le super-admin lui-même.
    if (target.isSuperAdmin && !req.isSuperAdmin)
      return res.status(403).json({
        error: "Seul le super-administrateur peut modifier son propre compte.",
      });

    const clash = await User.findOne({ email, _id: { $ne: id } }).select("_id");
    if (clash) return res.status(409).json({ error: "Cet email est déjà utilisé." });

    await User.updateOne({ _id: id }, { $set: { email } });
    res.json({ ok: true, email });
  } catch (err) {
    console.error("admin user email error:", err.message);
    res.status(500).json({ error: "Erreur lors du changement d'email." });
  }
});

// --- Changer le mot de passe d'un utilisateur ---
router.patch("/users/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });

    const password = String(req.body?.password || "");
    if (password.length < 3)
      return res.status(400).json({ error: "Le mot de passe doit faire au moins 3 caractères." });

    const target = await User.findById(id).select("isSuperAdmin");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (target.isSuperAdmin && !req.isSuperAdmin)
      return res.status(403).json({
        error: "Seul le super-administrateur peut modifier son propre compte.",
      });

    const passwordHash = await bcrypt.hash(password, 10);
    // On invalide les liens de reset en cours pour ce compte.
    await User.updateOne(
      { _id: id },
      { $set: { passwordHash }, $unset: { resetTokenHash: "", resetTokenExpires: "" } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("admin user password error:", err.message);
    res.status(500).json({ error: "Erreur lors du changement de mot de passe." });
  }
});

// --- Promouvoir / rétrograder un administrateur (super-admin uniquement) ---
router.patch("/users/:id/admin", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res
        .status(403)
        .json({ error: "Seul le super-administrateur peut gérer les administrateurs." });

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });

    const makeAdmin = !!req.body?.isAdmin;
    const target = await User.findById(id).select("isSuperAdmin isAdmin");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (target.isSuperAdmin)
      return res.status(400).json({
        error: "Le super-administrateur est toujours admin — utilise le transfert de rôle.",
      });

    await User.updateOne({ _id: id }, { $set: { isAdmin: makeAdmin } });
    res.json({ ok: true, isAdmin: makeAdmin });
  } catch (err) {
    console.error("admin user role error:", err.message);
    res.status(500).json({ error: "Erreur lors du changement de rôle." });
  }
});

// --- Transférer le rôle de super-admin à un autre utilisateur (super-admin
//     uniquement). L'ancien super-admin est rétrogradé en administrateur simple.
//     Garantit qu'il n'existe qu'UN seul super-admin. ---
router.post("/users/:id/transfer-super", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res
        .status(403)
        .json({ error: "Seul le super-administrateur peut transférer son rôle." });

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    if (String(id) === String(req.userId))
      return res.status(400).json({ error: "Tu es déjà le super-administrateur." });

    const target = await User.findById(id).select("_id isSuperAdmin");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

    // Rétrograde tous les super-admins actuels en admin simple, puis promeut la
    // cible → il n'y a jamais qu'un seul super-admin en base.
    await User.updateMany(
      { isSuperAdmin: true },
      { $set: { isSuperAdmin: false, isAdmin: true } }
    );
    await User.updateOne({ _id: id }, { $set: { isSuperAdmin: true, isAdmin: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin transfer super error:", err.message);
    res.status(500).json({ error: "Erreur lors du transfert." });
  }
});

// --- Retirer un abonnement : l'utilisateur :id cesse de suivre :targetId ---
router.post("/users/:id/unfollow", async (req, res) => {
  try {
    const { id } = req.params;
    const targetId = String(req.body?.targetId || "");
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(targetId))
      return res.status(400).json({ error: "Identifiant invalide." });
    await User.updateOne({ _id: id }, { $pull: { following: targetId } });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin unfollow error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Retirer un abonné : :followerId cesse de suivre l'utilisateur :id ---
router.post("/users/:id/remove-follower", async (req, res) => {
  try {
    const { id } = req.params;
    const followerId = String(req.body?.followerId || "");
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(followerId))
      return res.status(400).json({ error: "Identifiant invalide." });
    await User.updateOne({ _id: followerId }, { $pull: { following: id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin remove follower error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  Système — disque, RAM, CPU, base Mongo et poids des uploads (par
//  dossier et par utilisateur) pour l'onglet « Système » du panel.
// ======================================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
const AUDIO_CACHE_DIR = path.join(__dirname, "../../cache/audio");

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

// RAM de la machine. Sur Linux on lit MemAvailable (os.freemem() sous-estime
// beaucoup : le cache disque du noyau est récupérable) ; ailleurs, repli sur os.
function readMemory() {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const info = fs.readFileSync("/proc/meminfo", "utf8");
    const m = info.match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) available = Number(m[1]) * 1024;
  } catch {
    /* pas de /proc (Windows, macOS) */
  }
  return { total, available, used: total - available };
}

// Espace disque du système de fichiers qui porte les uploads (= le volume
// Docker monté depuis l'hôte en prod, donc bien le disque du VPS).
async function readDisk() {
  try {
    const s = await fsp.statfs(UPLOADS_DIR);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize; // dispo pour les non-root, comme `df`
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

// Parcourt uploads/ : totaux par sous-dossier + attribution par utilisateur.
// Attribution : préfixe ObjectId dans le nom (avatars, covers, reposts) ; pour
// le mur média (gm-…) le nom ne dit rien, on passe par la collection GameMedia.
async function scanUploads() {
  const mediaOwners = new Map();
  try {
    const posts = await GameMedia.find({}, "user media.url").lean();
    for (const p of posts)
      for (const m of p.media || []) {
        const file = String(m.url || "").split("/uploads/gamemedia/")[1];
        if (file && !file.includes("/")) mediaOwners.set(file, String(p.user));
      }
  } catch {
    /* best-effort */
  }

  const folders = [];
  const perUser = new Map();
  let entries = [];
  try {
    entries = await fsp.readdir(UPLOADS_DIR, { withFileTypes: true });
  } catch {
    /* dossier absent (première installation) */
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(UPLOADS_DIR, ent.name);
    const folder = { name: ent.name, files: 0, bytes: 0, images: 0, videos: 0 };
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      /* ignore */
    }
    for (const name of names) {
      let st;
      try {
        st = await fsp.stat(path.join(dir, name));
      } catch {
        continue;
      }
      if (!st.isFile()) continue; // ignore les sous-dossiers (gamemedia/tmp…)
      const kind = VIDEO_EXT.has(path.extname(name).toLowerCase())
        ? "videos"
        : "images";
      folder.files += 1;
      folder.bytes += st.size;
      folder[kind] += st.size;

      let owner = null;
      const prefix = name.split("-")[0];
      if (/^[0-9a-f]{24}$/i.test(prefix)) owner = prefix.toLowerCase();
      else if (ent.name === "gamemedia") owner = mediaOwners.get(name) || null;
      if (owner) {
        const u =
          perUser.get(owner) || { files: 0, bytes: 0, images: 0, videos: 0 };
        u.files += 1;
        u.bytes += st.size;
        u[kind] += st.size;
        perUser.set(owner, u);
      }
    }
    folders.push(folder);
  }
  folders.sort((a, b) => b.bytes - a.bytes);
  return { folders, perUser };
}

// Cache audio des OST (m4a extraits par yt-dlp) + son quota.
async function scanAudioCache() {
  const out = {
    files: 0,
    bytes: 0,
    maxBytes: Number(process.env.AUDIO_CACHE_MAX_MB || 500) * 1024 * 1024,
  };
  try {
    for (const name of await fsp.readdir(AUDIO_CACHE_DIR)) {
      try {
        const st = await fsp.stat(path.join(AUDIO_CACHE_DIR, name));
        if (!st.isFile()) continue;
        out.files += 1;
        out.bytes += st.size;
      } catch {
        continue;
      }
    }
  } catch {
    /* dossier absent */
  }
  return out;
}

// Stats MongoDB : totaux + les collections les plus lourdes.
async function readDbStats() {
  const db = mongoose.connection.db;
  const stats = await db.stats();
  let collections = [];
  try {
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    collections = (
      await Promise.all(
        cols.map(async (c) => {
          try {
            const [s] = await db
              .collection(c.name)
              .aggregate([{ $collStats: { storageStats: {} } }])
              .toArray();
            const ss = s?.storageStats || {};
            return {
              name: c.name,
              count: ss.count ?? 0,
              dataBytes: ss.size ?? 0,
              storageBytes: ss.storageSize ?? 0,
              indexBytes: ss.totalIndexSize ?? 0,
            };
          } catch {
            return null; // vues, collections système…
          }
        })
      )
    )
      .filter(Boolean)
      .sort((a, b) => b.dataBytes - a.dataBytes);
  } catch {
    /* best-effort */
  }
  return {
    dataBytes: stats.dataSize ?? 0,
    storageBytes: stats.storageSize ?? 0,
    indexBytes: stats.indexSize ?? 0,
    objects: stats.objects ?? 0,
    collections,
  };
}

router.get("/system", async (req, res) => {
  try {
    const [disk, uploads, audioCache, db] = await Promise.all([
      readDisk(),
      scanUploads(),
      scanAudioCache(),
      readDbStats().catch(() => null),
    ]);

    // Résolution des propriétaires (pseudo + avatar) des fichiers attribués.
    const ids = [...uploads.perUser.keys()].filter((id) =>
      mongoose.isValidObjectId(id)
    );
    const docs = ids.length
      ? await User.find({ _id: { $in: ids } }, "username avatar").lean()
      : [];
    const known = new Map(docs.map((u) => [String(u._id), u]));
    const users = [...uploads.perUser.entries()]
      .map(([id, s]) => ({
        id,
        username: known.get(id)?.username || null,
        avatar: known.get(id)?.avatar || null,
        ...s,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    const mem = process.memoryUsage();
    res.json({
      generatedAt: new Date().toISOString(),
      disk,
      memory: readMemory(),
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || null,
        load: os.loadavg(), // [1, 5, 15 min] — 0 sous Windows
      },
      host: {
        uptime: os.uptime(),
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
      },
      process: {
        uptime: process.uptime(),
        node: process.version,
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      db,
      uploads: {
        files: uploads.folders.reduce((n, f) => n + f.files, 0),
        bytes: uploads.folders.reduce((n, f) => n + f.bytes, 0),
        folders: uploads.folders,
      },
      audioCache,
      users,
    });
  } catch (err) {
    console.error("admin system error:", err.message);
    res.status(500).json({ error: "Erreur lors du relevé des stats système." });
  }
});

// ======================================================================
//  Secrets (.env) — RÉSERVÉ AU SUPER-ADMIN (JWT_SECRET, clés API…).
// ======================================================================
function requireSuper(req, res, next) {
  if (!req.isSuperAdmin)
    return res
      .status(403)
      .json({ error: "Section réservée au super-administrateur." });
  next();
}

// Liste des variables du .env (clé + valeur + drapeau « sensible »).
router.get("/secrets", requireSuper, (req, res) => {
  try {
    res.json(listEnv());
  } catch (err) {
    console.error("admin secrets list error:", err.message);
    res.status(500).json({ error: "Impossible de lire le fichier .env." });
  }
});

// Ajoute une nouvelle variable (refuse si la clé existe déjà).
router.post("/secrets", requireSuper, (req, res) => {
  try {
    const key = String(req.body?.key || "").trim();
    const value = String(req.body?.value ?? "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      return res.status(400).json({
        error: "Nom invalide : lettres, chiffres et _ uniquement (ne commence pas par un chiffre).",
      });
    if (listEnv().entries.some((e) => e.key === key))
      return res.status(409).json({ error: "Cette variable existe déjà." });
    const entry = setEnvVar(key, value);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error("admin secrets add error:", err.message);
    res.status(500).json({ error: err.message || "Impossible d'écrire dans le .env." });
  }
});

// Met à jour la valeur d'une variable existante (ou la crée si absente).
router.put("/secrets/:key", requireSuper, (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    const value = String(req.body?.value ?? "");
    const entry = setEnvVar(key, value);
    res.json({ ok: true, entry });
  } catch (err) {
    console.error("admin secrets update error:", err.message);
    res.status(500).json({ error: err.message || "Impossible d'écrire dans le .env." });
  }
});

// Supprime une variable.
router.delete("/secrets/:key", requireSuper, (req, res) => {
  try {
    deleteEnvVar(String(req.params.key || "").trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("admin secrets delete error:", err.message);
    res.status(500).json({ error: err.message || "Impossible d'écrire dans le .env." });
  }
});

// ======================================================================
//  Missions & badges — retoucher l'habillage et le barème.
// ======================================================================
// On peut changer titre / description / icône / points. On ne peut NI créer NI
// supprimer une mission, NI toucher à sa condition : tout ça vit dans le code
// (lib/missions.js), et c'est volontaire — une condition est du comportement,
// pas de la configuration.

// GET /api/admin/missions — catalogue avec valeurs effectives + valeurs d'origine.
router.get("/missions", async (_req, res) => {
  try {
    res.json({ missions: await listMissionsForAdmin() });
  } catch (err) {
    console.error("admin missions list error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des missions." });
  }
});

// PUT /api/admin/missions/:key — retoucher une mission (champ vide = défaut).
router.put("/missions/:key", async (req, res) => {
  try {
    const mission = await updateMissionConfig(req.params.key, req.body || {});
    res.json({ mission });
  } catch (err) {
    if (!err.status) console.error("admin mission update error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// DELETE /api/admin/missions/:key — revenir aux valeurs du code.
router.delete("/missions/:key", async (req, res) => {
  try {
    const mission = await resetMissionConfig(req.params.key);
    res.json({ mission });
  } catch (err) {
    console.error("admin mission reset error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
