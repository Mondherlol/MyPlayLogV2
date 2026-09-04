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
import CollectionThread from "../models/CollectionThread.js";
import Repost from "../models/Repost.js";
import Documentary from "../models/Documentary.js";
import Notification from "../models/Notification.js";
import Activity from "../models/Activity.js";
import HiddenOst from "../models/HiddenOst.js";
import OstRename from "../models/OstRename.js";
import GemSkip from "../models/GemSkip.js";
import GemDiscovery from "../models/GemDiscovery.js";
import Reward, { REWARD_TYPE_KEYS } from "../models/Reward.js";
import ServerLog, { LOG_KINDS } from "../models/ServerLog.js";
import Broadcast from "../models/Broadcast.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import { logEvent, forgetAdmins } from "../lib/audit.js";
import { sendPush } from "../lib/push.js";
import { canUserDownload, isUserAdmin, isUserStaff } from "../lib/admin.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { listEnv, setEnvVar, deleteEnvVar } from "../lib/envFile.js";
import {
  listMissionsForAdmin,
  updateMissionConfig,
  resetMissionConfig,
} from "../lib/missions.js";
import { defaultSince, syncEventLists } from "../lib/eventSync.js";
import { SCRIPTS, findScript } from "../lib/adminScripts.js";
import { ensureBotUser, canUseBot, WELCOME, BOT_USERNAME } from "../lib/bot.js";
import { botSay } from "./chat.js";

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

    // Tri par défaut : le plus récemment vu en tête — c'est sur les comptes
    // actifs qu'on agit. Les comptes qui ne se sont jamais connectés (pas de
    // lastSeenAt) retombent en fin de liste, départagés par date d'inscription.
    const users = await User.find(filter)
      .select(
        "username email avatar createdAt lastSeenAt following isAdmin isSuperAdmin isStaff points canDownload botAccess discord"
      )
      .sort({ lastSeenAt: -1, createdAt: -1 })
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
        isStaff: isUserStaff(u),
        // Comme pour le téléchargement : le drapeau BRUT, sans le rôle admin,
        // pour que l'interrupteur reflète ce qui est vraiment stocké.
        staffFlag: !!u.isStaff,
        canDownload: canUserDownload(u),
        // Le drapeau BRUT, sans le coup de pouce accordé aux admins : la case à
        // cocher doit refléter ce qui est réellement stocké, sinon décocher un
        // admin donnerait l'illusion de n'avoir aucun effet.
        downloadFlag: !!u.canDownload,
        // Droit de parler au bot. Même distinction que ci-dessus entre le
        // drapeau brut et l'accès effectif (les admins l'ont par leur rôle).
        botAccess: canUseBot(u),
        botFlag: !!u.botAccess,
        discord: u.discord?.discordId
          ? { username: u.discord.username || null, id: u.discord.discordId }
          : null,
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

// Efface un compte et TOUT ce qui s'y rattache. Extrait de la route DELETE pour
// que l'action de masse passe exactement par le même chemin — deux logiques de
// suppression divergentes finiraient par laisser des orphelins d'un côté.
// Renvoie { status, error } si le compte est intouchable, null si c'est fait.
async function deleteUserCompletely(id, actorId) {
  const nope = (status, error) => ({ status, error });
  if (!mongoose.isValidObjectId(id)) return nope(404, "Utilisateur introuvable.");
  if (String(id) === String(actorId))
    return nope(400, "Tu ne peux pas supprimer ton propre compte.");

  const target = await User.findById(id).select("isSuperAdmin");
  if (!target) return nope(404, "Utilisateur introuvable.");
  if (target.isSuperAdmin)
    return nope(403, "Impossible de supprimer le super-administrateur.");

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
    CollectionThread.updateMany({}, { $pull: { comments: { user: id } } }),
    Repost.updateMany({}, { $pull: { comments: { user: id }, likes: id } }),
    Recommendation.updateMany(
      {},
      { $pull: { recommenders: { user: id }, boosters: id, comments: { user: id } } }
    ),
  ]);

  // Recommandations devenues vides (plus aucun recommandeur) : on les supprime.
  await Recommendation.deleteMany({ recommenders: { $size: 0 } });

  await User.findByIdAndDelete(id);
  return null;
}

// --- Suppression d'un utilisateur + TOUTES ses données (irréversible) ---
router.delete("/users/:id", async (req, res) => {
  try {
    const failure = await deleteUserCompletely(req.params.id, req.userId);
    if (failure) return res.status(failure.status).json({ error: failure.error });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin user delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur." });
  }
});

// --- Actions de masse sur une sélection de comptes ---
// Un seul point d'entrée pour les trois gestes du panel (ouvrir / révoquer
// l'accès au téléchargement, supprimer). Chaque compte est traité
// indépendamment : un refus (super-admin, soi-même) n'annule pas le reste, il
// est simplement remonté dans `skipped` pour que l'admin sache ce qui a résisté.
const BULK_ACTIONS = ["grant-download", "revoke-download", "delete"];

router.post("/users/bulk", async (req, res) => {
  try {
    const action = String(req.body?.action || "");
    if (!BULK_ACTIONS.includes(action))
      return res.status(400).json({ error: "Action inconnue." });

    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map(String)
      .filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return res.status(400).json({ error: "Aucun compte sélectionné." });

    if (action === "delete") {
      let done = 0;
      const skipped = [];
      // En série, pas en parallèle : chaque suppression balaie plusieurs
      // collections entières ($pull sur tout le contenu d'autrui), les lancer
      // toutes d'un coup mettrait la base à genoux sur une grosse sélection.
      for (const id of ids) {
        const failure = await deleteUserCompletely(id, req.userId);
        if (failure) skipped.push({ id, reason: failure.error });
        else done++;
      }
      return res.json({ done, skipped });
    }

    const value = action === "grant-download";
    const r = await User.updateMany(
      { _id: { $in: ids } },
      { $set: { canDownload: value } },
      { timestamps: false }
    );
    res.json({ done: r.modifiedCount ?? 0, matched: r.matchedCount ?? 0, skipped: [] });
  } catch (err) {
    console.error("admin users bulk error:", err.message);
    res.status(500).json({ error: "L'action de masse a échoué." });
  }
});

// --- Accès au téléchargement d'UN compte (interrupteur de la fiche) ---
router.patch("/users/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    const canDownload = req.body?.canDownload === true;
    const u = await User.findByIdAndUpdate(
      id,
      { $set: { canDownload } },
      { new: true, timestamps: false }
    ).select("isAdmin isSuperAdmin canDownload");
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({ downloadFlag: !!u.canDownload, canDownload: canUserDownload(u) });
  } catch (err) {
    console.error("admin user download error:", err.message);
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
  }
});

// --- Rôle staff d'UN compte (interrupteur de la fiche) ---
// Ouvert à tous les administrateurs (pas seulement au super-admin) : nommer un
// modérateur de catalogue n'engage pas les mêmes pouvoirs que nommer un admin.
router.patch("/users/:id/staff", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    const isStaff = req.body?.isStaff === true;
    const u = await User.findByIdAndUpdate(
      id,
      { $set: { isStaff } },
      { new: true, timestamps: false }
    ).select("isAdmin isSuperAdmin isStaff");
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({ staffFlag: !!u.isStaff, isStaff: isUserStaff(u) });
  } catch (err) {
    console.error("admin user staff error:", err.message);
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
  }
});

// --- Droit de parler au bot (interrupteur de la fiche) ---
// C'est ICI que se joue le contrôle d'accès au personnage : le bot est
// volontairement grossier, il ne parle qu'aux comptes qu'un administrateur a
// autorisés — d'où un droit fermé par défaut, accordé un par un et
// révocable à tout moment (le fil déjà ouvert reste, le bot s'y tait).
//
// L'ouverture déclenche deux choses : la création du compte du bot s'il
// n'existe pas encore (personne ne devrait avoir à lancer un script pour ça),
// et son mot d'accueil en message privé — sans quoi il faudrait deviner qu'on
// a le droit de lui écrire et le chercher dans les contacts.
router.patch("/users/:id/bot", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Utilisateur introuvable." });
    const botAccess = req.body?.botAccess === true;

    const before = await User.findById(id).select("botAccess isAdmin isSuperAdmin isBot");
    if (!before) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (before.isBot)
      return res.status(400).json({ error: `${BOT_USERNAME} n'a pas à se parler à lui-même.` });

    const u = await User.findByIdAndUpdate(
      id,
      { $set: { botAccess } },
      { new: true, timestamps: false }
    ).select("isAdmin isSuperAdmin botAccess");

    if (botAccess && !before.botAccess) {
      // Sans await : la fiche doit se rafraîchir tout de suite, le bonjour du
      // bot n'a aucune raison de la retarder (ni de la faire échouer).
      ensureBotUser()
        .then(() => botSay(id, WELCOME))
        .catch((err) => console.error("bot welcome error:", err.message));
    }

    res.json({ botFlag: !!u.botAccess, botAccess: canUseBot(u) });
  } catch (err) {
    console.error("admin user bot error:", err.message);
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
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
      .select(
        "username email avatar bio createdAt lastSeenAt following isAdmin isSuperAdmin isStaff canDownload botAccess discord points equipped inventory"
      )
      .populate("following", "username avatar isAdmin isSuperAdmin")
      .lean();
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    // Cosmétiques de l'arcade : ce qu'il a équipé (curseur en tête) et combien
    // de lots il possède par famille. L'inventaire ne garde que des slugs, on
    // résout donc les lots pour renvoyer nom / rareté / visuel.
    const equipped = {
      cursor: user.equipped?.cursor || null,
      ornament: user.equipped?.ornament || null,
      badge: user.equipped?.badge || null,
      theme: user.equipped?.theme || null,
    };
    const inventory = user.inventory || [];
    const keys = [
      ...new Set([...Object.values(equipped).filter(Boolean), ...inventory.map((i) => i.rewardKey)]),
    ];
    const rewards = keys.length ? await Reward.find({ key: { $in: keys } }) : [];
    const byKey = new Map(rewards.map((r) => [r.key, r]));
    const cosmetics = {};
    const ownedCount = {};
    for (const type of REWARD_TYPE_KEYS) {
      const k = equipped[type];
      // Lot supprimé depuis (slug orphelin) : on renvoie quand même le slug,
      // l'admin doit pouvoir voir ce qui cloche.
      cosmetics[type] = k
        ? byKey.has(k)
          ? { ...byKey.get(k).toPublic(), obtainedAt: inventory.find((i) => i.rewardKey === k)?.obtainedAt || null }
          : { key: k, missing: true }
        : null;
      ownedCount[type] = inventory.filter((i) => byKey.get(i.rewardKey)?.type === type).length;
    }

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
        isStaff: isUserStaff(user),
        staffFlag: !!user.isStaff,
        canDownload: canUserDownload(user),
        downloadFlag: !!user.canDownload,
        botAccess: canUseBot(user),
        botFlag: !!user.botAccess,
        discord: user.discord?.discordId
          ? {
              id: user.discord.discordId,
              username: user.discord.username || null,
              globalName: user.discord.globalName || null,
              avatar: user.discord.avatar || null,
              connectedAt: user.discord.connectedAt || null,
            }
          : null,
        gameCount,
        points: user.points || 0,
      },
      cosmetics,
      ownedCount,
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
    // Le flux du journal en direct est adressé aux admins : la liste vient
    // d'être invalidée, sans quoi le nouveau promu attendrait une minute.
    forgetAdmins();
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
    forgetAdmins();
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
//  Journal du serveur — l'onglet « Logs »
// ======================================================================
// Ce qui s'est passé, par qui, quand. Les lignes sont écrites par
// lib/audit.js ; ici on ne fait que les relire, les filtrer et les compter.
//
// Le direct ne passe PAS par ici : les nouvelles lignes arrivent par le flux
// SSE de la messagerie (évènement `adminlog`), déjà ouvert dans chaque onglet.
// Cette route sert au premier chargement, au filtrage et à la remontée dans le
// temps — le reste tombe tout seul.

// Fenêtre de temps : accepte une date ISO ou un raccourci (« 15m », « 24h »,
// « 7d »). Le raccourci est ce qu'on tape en pratique quand on cherche « ce
// qui s'est passé dans la dernière heure ».
function parseSince(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const rel = raw.match(/^(\d+)\s*(m|h|d)$/i);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2].toLowerCase()];
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Résout le filtre « par utilisateur » : un identifiant Mongo, ou un pseudo
// (c'est ce qu'on a sous les yeux quand on lit le journal).
async function resolveUserFilter(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw)) return new mongoose.Types.ObjectId(raw);
  const u = await User.findOne({ username: raw })
    .collation({ locale: "fr", strength: 2 })
    .select("_id")
    .lean();
  return u?._id || new mongoose.Types.ObjectId(); // introuvable → aucun résultat
}

const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

// GET /api/admin/logs — le journal, filtré.
router.get("/logs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 120, 1), 300);
    const filter = {};

    const kinds = String(req.query.kind || "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => LOG_KINDS.includes(k));
    if (kinds.length) filter.kind = { $in: kinds };

    const since = parseSince(req.query.since);
    const until = parseSince(req.query.until);
    // `before` est le curseur de pagination (remonter dans le temps), distinct
    // de `until` qui est un filtre choisi par l'utilisateur.
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (since || until || (before && !Number.isNaN(before.getTime()))) {
      filter.at = {};
      if (since) filter.at.$gte = since;
      if (until) filter.at.$lte = until;
      if (before && !Number.isNaN(before.getTime())) filter.at.$lt = before;
    }

    if (req.query.user) {
      const id = await resolveUserFilter(req.query.user);
      // Une personne concerne une ligne qu'elle en soit l'auteur OU la cible :
      // filtrer sur « X » doit montrer les messages qu'il a reçus, pas
      // seulement ceux qu'il a envoyés.
      filter.$or = [{ actor: id }, { target: id }];
    }

    const q = String(req.query.q || "").trim();
    if (q) {
      const r = rx(q);
      const text = [
        { label: r },
        { path: r },
        { actorName: r },
        { targetName: r },
        { ip: r },
      ];
      // Les deux $or (personne + texte) ne peuvent pas cohabiter tels quels.
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: text }];
        delete filter.$or;
      } else filter.$or = text;
    }

    // Le décompte par nature sert les pastilles de filtre : il se calcule sur
    // les MÊMES critères, sauf celui des natures (sinon chaque pastille
    // afficherait le total de la sélection courante).
    const countFilter = { ...filter };
    delete countFilter.kind;

    const [rows, counts, total] = await Promise.all([
      ServerLog.find(filter)
        .sort({ at: -1 })
        .limit(limit + 1)
        .populate("actor", "username avatar")
        .lean(),
      ServerLog.aggregate([
        { $match: countFilter },
        { $group: { _id: "$kind", n: { $sum: 1 } } },
      ]),
      ServerLog.countDocuments(filter),
    ]);

    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit).map((l) => ({
      id: String(l._id),
      at: l.at,
      kind: l.kind,
      label: l.label || "",
      actor: l.actor
        ? {
            id: String(l.actor._id),
            username: l.actor.username,
            avatar: l.actor.avatar || null,
          }
        : null,
      actorName: l.actorName || l.actor?.username || "",
      target: l.target ? String(l.target) : null,
      targetName: l.targetName || "",
      method: l.method || "",
      path: l.path || "",
      status: l.status ?? null,
      ms: l.ms ?? null,
      ip: l.ip || "",
      ua: l.ua || "",
      meta: l.meta || null,
    }));

    res.json({
      entries,
      hasMore,
      total,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      kinds: LOG_KINDS,
      ttlDays: Math.max(1, Number(process.env.LOGS_TTL_DAYS) || 14),
    });
  } catch (err) {
    console.error("admin logs error:", err.message);
    res.status(500).json({ error: "Erreur lors de la lecture du journal." });
  }
});

// DELETE /api/admin/logs — vider le journal (super-admin).
// Le geste est tracé… dans le journal qu'on vient de vider : la ligne qui
// suit est donc la première du nouveau, et elle dit qui a effacé le précédent.
router.delete("/logs", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res.status(403).json({ error: "Réservé au super-administrateur." });
    const before = parseSince(req.query.before);
    const { deletedCount } = await ServerLog.deleteMany(
      before ? { at: { $lt: before } } : {}
    );
    logEvent({
      kind: "admin",
      label: "a vidé le journal du serveur",
      actor: req.userId,
      meta: { deleted: deletedCount, before: before || null },
    });
    res.json({ ok: true, deleted: deletedCount });
  } catch (err) {
    console.error("admin logs purge error:", err.message);
    res.status(500).json({ error: "Impossible de vider le journal." });
  }
});

// ======================================================================
//  Surveillance des messages privés — RÉSERVÉ AU SUPER-ADMIN
// ======================================================================
// Lire les messages des autres n'est pas un geste anodin : c'est l'outil de
// modération des situations graves (harcèlement, menaces, contenu illégal),
// et rien d'autre. Trois garde-fous, tous volontaires :
//   - super-admin uniquement, jamais un simple modérateur ;
//   - CHAQUE consultation laisse sa propre ligne dans le journal, au même
//     titre que n'importe quelle action — celui qui regarde est regardé ;
//   - on ne renvoie jamais le mot de passe d'une conversation ni son contenu
//     supprimé (un message effacé reste effacé).

// Titre d'un fil du point de vue de personne : un groupe porte son nom, un DM
// les deux pseudos. C'est ce qui s'affiche dans la colonne de gauche.
function convCard(c, counts) {
  const people = (c.participants || []).map((p) => ({
    id: String(p._id),
    username: p.username,
    avatar: p.avatar || null,
  }));
  return {
    id: String(c._id),
    group: !!c.isGroup,
    title: c.isGroup
      ? c.name || people.map((p) => p.username).join(", ") || "Groupe"
      : people.map((p) => p.username).join(" ↔ "),
    people,
    messages: counts?.get(String(c._id)) || 0,
    lastMessage: c.lastMessage?.at
      ? {
          at: c.lastMessage.at,
          text: c.lastMessage.text || "",
          authorName: c.lastMessage.authorName || "",
        }
      : null,
    lastMessageAt: c.lastMessageAt,
  };
}

// Une bulle, telle qu'elle s'affichera dans le fil reconstitué.
function adminBubble(m) {
  const deleted = !!m.deletedAt;
  return {
    id: String(m._id),
    at: m.createdAt,
    author: m.author
      ? {
          id: String(m.author._id),
          username: m.author.username,
          avatar: m.author.avatar || null,
        }
      : null,
    // Un message supprimé RESTE supprimé, même ici : la bulle garde sa place
    // dans le fil (sans quoi on lirait une conversation à trous) mais son
    // contenu ne revient pas d'entre les morts.
    deleted,
    text: deleted ? "" : m.text || "",
    media: deleted ? [] : (m.media || []).map((x) => ({ kind: x.kind, url: x.url })),
    card: m.game ? "jeu" : m.ost ? "OST" : m.party ? "séance" : m.mot ? "mot du jour" : null,
    system: m.system || null,
    edited: !!m.editedAt,
    replyTo: m.replyTo
      ? {
          author: m.replyTo.author?.username || "",
          text: m.replyTo.deletedAt ? "" : m.replyTo.text || "",
        }
      : null,
  };
}

// GET /api/admin/conversations — la colonne de gauche : tous les fils.
router.get("/conversations", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res.status(403).json({ error: "Réservé au super-administrateur." });

    const filter = {};
    if (req.query.user) {
      const id = await resolveUserFilter(req.query.user);
      filter.participants = id;
    }

    let convs = await Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .populate("participants", "username avatar")
      .lean();

    // La recherche porte sur ce qu'on lit : les pseudos et le nom du groupe.
    // Elle se fait ici plutôt qu'en base, parce que le nom d'un DM n'existe
    // pas — il est composé des participants au moment de l'affichage.
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q)
      convs = convs.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.participants || []).some((p) => (p.username || "").toLowerCase().includes(q))
      );
    convs = convs.slice(0, 80);

    // Un fil jamais utilisé (ouvert puis abandonné) n'a rien à montrer.
    const alive = convs.filter((c) => c.lastMessage?.at);

    const counts = new Map(
      (
        await Message.aggregate([
          { $match: { conversation: { $in: alive.map((c) => c._id) } } },
          { $group: { _id: "$conversation", n: { $sum: 1 } } },
        ])
      ).map((r) => [String(r._id), r.n])
    );

    res.json({ conversations: alive.map((c) => convCard(c, counts)) });
  } catch (err) {
    console.error("admin conversations error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des discussions." });
  }
});

// GET /api/admin/conversations/:id — le fil, dans l'ordre où il s'est écrit.
router.get("/conversations/:id", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res.status(403).json({ error: "Réservé au super-administrateur." });
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Discussion introuvable." });

    const conv = await Conversation.findById(req.params.id)
      .populate("participants", "username avatar")
      .lean();
    if (!conv) return res.status(404).json({ error: "Discussion introuvable." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const query = { conversation: conv._id };
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

    const raw = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("author", "username avatar")
      .populate({ path: "replyTo", select: "text deletedAt author", populate: { path: "author", select: "username" } })
      .lean();
    const hasMore = raw.length > limit;

    // La consultation ne se trace qu'à L'OUVERTURE du fil, pas à chaque page
    // remontée : sinon lire une longue conversation produirait vingt lignes
    // identiques dans le journal, et noierait le fait notable — quelqu'un est
    // allé lire les messages de X.
    if (!before) {
      const names = (conv.participants || []).map((p) => p.username).join(", ");
      logEvent({
        kind: "admin",
        label: "a ouvert une conversation privée",
        actor: req.userId,
        targetName: names,
        meta: { conversation: String(conv._id), group: !!conv.isGroup, participants: names },
      });
    }

    res.json({
      conversation: convCard(conv, null),
      messages: raw.slice(0, limit).reverse().map(adminBubble),
      hasMore,
    });
  } catch (err) {
    console.error("admin conversation error:", err.message);
    res.status(500).json({ error: "Erreur lors de la lecture de la discussion." });
  }
});

// GET /api/admin/messages — la RECHERCHE, tous fils confondus.
// Elle répond à « qui a écrit ça ? » ; le fil complet, lui, s'ouvre ensuite.
router.get("/messages", async (req, res) => {
  try {
    if (!req.isSuperAdmin)
      return res.status(403).json({ error: "Réservé au super-administrateur." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
    const filter = { system: null, deletedAt: null };

    const since = parseSince(req.query.since);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (since || (before && !Number.isNaN(before.getTime()))) {
      filter.createdAt = {};
      if (since) filter.createdAt.$gte = since;
      if (before && !Number.isNaN(before.getTime())) filter.createdAt.$lt = before;
    }

    if (req.query.conversation && mongoose.isValidObjectId(req.query.conversation))
      filter.conversation = new mongoose.Types.ObjectId(String(req.query.conversation));

    // Filtrer par personne, c'est voir la conversation DES DEUX CÔTÉS : on
    // prend donc tous les fils où elle est, pas seulement ce qu'elle a écrit.
    let convOf = null;
    if (req.query.user) {
      const id = await resolveUserFilter(req.query.user);
      const convs = await Conversation.find({ participants: id }).select("_id").lean();
      convOf = convs.map((c) => c._id);
      filter.conversation = filter.conversation
        ? filter.conversation
        : { $in: convOf };
    }

    const q = String(req.query.q || "").trim();
    if (q) filter.text = rx(q);

    const rows = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("author", "username avatar")
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Les fils concernés, pour donner un titre et des participants à chaque
    // bulle (sans quoi on lit des phrases sans savoir qui les reçoit).
    const convIds = [...new Set(page.map((m) => String(m.conversation)))];
    const convs = await Conversation.find({ _id: { $in: convIds } })
      .select("isGroup name participants")
      .populate("participants", "username avatar")
      .lean();
    const convById = new Map(convs.map((c) => [String(c._id), c]));

    logEvent({
      kind: "admin",
      label: "a consulté les messages privés",
      actor: req.userId,
      meta: {
        user: req.query.user || null,
        conversation: req.query.conversation || null,
        q: q || null,
        results: page.length,
      },
    });

    res.json({
      hasMore,
      messages: page.map((m) => {
        const c = convById.get(String(m.conversation));
        const people = (c?.participants || []).map((p) => ({
          id: String(p._id),
          username: p.username,
          avatar: p.avatar || null,
        }));
        return {
          id: String(m._id),
          at: m.createdAt,
          text: m.text || "",
          media: (m.media || []).length,
          edited: !!m.editedAt,
          card: m.game ? "jeu" : m.ost ? "OST" : m.party ? "séance" : m.mot ? "mot du jour" : null,
          author: m.author
            ? {
                id: String(m.author._id),
                username: m.author.username,
                avatar: m.author.avatar || null,
              }
            : null,
          conversation: {
            id: String(m.conversation),
            group: !!c?.isGroup,
            title: c?.isGroup
              ? c.name || "Groupe"
              : people.map((p) => p.username).join(" ↔ "),
            people,
          },
        };
      }),
    });
  } catch (err) {
    console.error("admin messages error:", err.message);
    res.status(500).json({ error: "Erreur lors de la lecture des messages." });
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

// ======================================================================
//  Listes d'événements — synchro IGDB depuis le panel
// ======================================================================
// Même travail que `npm run sync:events`, mais déclenché d'un bouton : après
// une conférence, plus besoin d'ouvrir un SSH sur le VPS.

// GET /api/admin/events — état actuel (pour afficher quoi que ce soit d'utile
// avant de lancer quoi que ce soit).
router.get("/events", async (_req, res) => {
  try {
    const lists = await List.find({ "event.igdbId": { $exists: true } })
      .select("title event.startTime items")
      .sort({ "event.startTime": -1 })
      .lean();
    res.json({
      count: lists.length,
      gameCount: lists.reduce((n, l) => n + (l.items || []).length, 0),
      latest: lists.slice(0, 5).map((l) => ({
        title: l.title,
        startTime: l.event?.startTime || null,
        items: (l.items || []).length,
      })),
    });
  } catch (err) {
    console.error("admin events state error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement." });
  }
});

// POST /api/admin/events/sync — lance la synchro et renvoie le journal.
// Une trentaine d'appels IGDB : la requête tient la ligne une poignée de
// secondes, d'où le bouton avec son indicateur côté client. On sérialise avec
// un verrou : deux clics d'affilée créeraient les mêmes listes en double.
let eventSyncRunning = false;

router.post("/events/sync", async (req, res) => {
  if (eventSyncRunning)
    return res.status(409).json({ error: "Une synchro est déjà en cours." });
  eventSyncRunning = true;
  const log = [];
  try {
    const sinceRaw = String(req.body?.since || "").trim();
    const parsed = sinceRaw ? Date.parse(sinceRaw) : NaN;
    const since = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : defaultSince();

    const summary = await syncEventLists({
      since,
      all: !!req.body?.all,
      // Les couvertures générées sont servies par /uploads : on prend le
      // domaine de la requête en cours, pas besoin de configurer PUBLIC_URL.
      baseUrl: process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`,
      log: (line) => log.push(line),
    });
    res.json({ summary, log });
  } catch (err) {
    console.error("admin events sync error:", err.message);
    res.status(err.status || 500).json({ error: err.message, log });
  } finally {
    eventSyncRunning = false;
  }
});

// ======================================================================
//  Notifications push — annonces écrites depuis le panel
// ======================================================================
// De quoi prévenir tout le monde d'une nouveauté sans passer par un script.
// Une notification push ne se rattrape pas : envoyée, elle a sonné sur le
// téléphone des gens. D'où les garde-fous — l'envoi de test à soi-même, le
// décompte des appareils affiché avant, et l'historique gardé après.

const PUSH_TITLE_MAX = 60; // au-delà, Android tronque de toute façon
const PUSH_BODY_MAX = 300;

// GET /api/admin/push/audience — qui a l'app installée, et sur combien
// d'appareils. C'est ce qui alimente la sélection nominative côté panel.
router.get("/push/audience", async (_req, res) => {
  try {
    // `pushTokens` est en `select: false` dans le modèle (c'est une adresse
    // d'appareil) : il faut le redemander explicitement.
    const users = await User.find({ "pushTokens.0": { $exists: true } })
      .select("+pushTokens username avatar lastSeenAt isAdmin isSuperAdmin")
      .sort({ lastSeenAt: -1, username: 1 })
      .lean();

    const totalUsers = await User.estimatedDocumentCount();

    res.json({
      totalUsers,
      reachable: users.length,
      devices: users.reduce((n, u) => n + (u.pushTokens || []).length, 0),
      users: users.map((u) => ({
        id: u._id,
        username: u.username,
        avatar: u.avatar || null,
        lastSeenAt: u.lastSeenAt || null,
        isAdmin: !!u.isAdmin || !!u.isSuperAdmin,
        devices: (u.pushTokens || []).length,
        platforms: [...new Set((u.pushTokens || []).map((t) => t.platform))],
      })),
    });
  } catch (err) {
    console.error("admin push audience error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de l'audience." });
  }
});

// GET /api/admin/push/history — les dernières annonces envoyées.
router.get("/push/history", async (_req, res) => {
  try {
    const items = await Broadcast.find()
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("sentBy", "username avatar")
      .lean();

    res.json({
      items: items.map((b) => ({
        id: b._id,
        title: b.title,
        body: b.body,
        path: b.path || "",
        audience: b.audience,
        recipients: (b.recipients || []).map(String),
        devices: b.devices,
        accepted: b.accepted,
        failed: b.failed,
        errors: b.failures || [],
        createdAt: b.createdAt,
        sentBy: b.sentBy
          ? { username: b.sentBy.username, avatar: b.sentBy.avatar || null }
          : null,
      })),
    });
  } catch (err) {
    console.error("admin push history error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de l'historique." });
  }
});

// POST /api/admin/push/send — écrit et envoie l'annonce.
//   audience: "test"     → à soi-même uniquement (rien n'est enregistré)
//             "selected" → aux comptes cochés
//             "all"      → à tous ceux qui ont un appareil enregistré
router.post("/push/send", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, PUSH_TITLE_MAX) || "MyPlayLog";
    const body = String(req.body?.body || "").trim().slice(0, PUSH_BODY_MAX);
    const path = String(req.body?.path || "").trim();

    if (!body) return res.status(400).json({ error: "Le message est vide." });
    // Un chemin doit rester interne : la notification ouvre l'app mobile, pas
    // un navigateur. Les parenthèses sont admises — expo-router s'en sert pour
    // ses groupes de routes (« /(tabs)/explorer »). On refuse plutôt que de
    // nettoyer en silence.
    if (path && !/^\/[\w\-/.()]*$/.test(path))
      return res
        .status(400)
        .json({ error: "La destination doit être un chemin interne (ex. /notifications)." });

    const audience =
      req.body?.audience === "test" || req.body?.audience === "selected"
        ? req.body.audience
        : "all";

    let ids;
    if (audience === "test") {
      ids = [String(req.userId)];
    } else if (audience === "selected") {
      ids = [...new Set((req.body?.userIds || []).map(String))].filter((id) =>
        mongoose.isValidObjectId(id)
      );
      if (!ids.length)
        return res.status(400).json({ error: "Aucun destinataire sélectionné." });
    } else {
      const all = await User.find({ "pushTokens.0": { $exists: true } })
        .select("_id")
        .lean();
      ids = all.map((u) => String(u._id));
    }

    if (!ids.length)
      return res.status(400).json({ error: "Personne n'a encore l'app mobile installée." });

    const report = await sendPush(ids, {
      title,
      body,
      // `path` est lu par l'app mobile pour ouvrir le bon écran au tap ; sans
      // lui, la notification se contente de ramener l'app au premier plan.
      data: path ? { type: "broadcast", path } : { type: "broadcast" },
    });

    // Un test est un brouillon : on ne le garde pas dans l'historique, sinon
    // trois essais de formulation y laisseraient trois fausses annonces.
    let saved = null;
    if (audience !== "test") {
      saved = await Broadcast.create({
        title,
        body,
        path,
        audience,
        recipients: audience === "selected" ? ids : [],
        devices: report.devices,
        accepted: report.accepted,
        failed: report.failed,
        failures: report.errors,
        sentBy: req.userId,
      });

      logEvent({
        kind: "admin",
        label:
          audience === "all"
            ? "a envoyé une notification à tout le monde"
            : `a envoyé une notification à ${ids.length} personne${ids.length > 1 ? "s" : ""}`,
        actor: req.userId,
        method: "POST",
        path: "/api/admin/push/send",
        meta: { title, body, audience, devices: report.devices, accepted: report.accepted },
      });
    }

    res.json({ ...report, audience, recipients: ids.length, id: saved?._id || null });
  } catch (err) {
    console.error("admin push send error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi." });
  }
});

// ======================================================================
//  Scripts de maintenance (onglet « Scripts »)
// ======================================================================
// La liste des scripts disponibles. Le `run` reste côté serveur : on n'expose
// que de quoi afficher les cartes.
router.get("/scripts", (_req, res) => {
  res.json({
    scripts: SCRIPTS.map(({ key, label, description, danger }) => ({
      key,
      label,
      description,
      danger: !!danger,
    })),
  });
});

// Exécution. `dryRun` simule sans rien écrire — c'est le mode par défaut si le
// client ne dit rien, pour qu'un appel maladroit ne casse pas de données.
router.post("/scripts/:key/run", async (req, res) => {
  const script = findScript(req.params.key);
  if (!script) return res.status(404).json({ error: "Script inconnu." });

  const dryRun = req.body?.dryRun !== false;
  const startedAt = Date.now();
  try {
    const out = (await script.run({ dryRun })) || {};
    const ms = Date.now() - startedAt;

    if (!dryRun) {
      logEvent({
        kind: "admin",
        label: `a lancé le script « ${script.label} »`,
        actor: req.userId,
        method: "POST",
        path: `/api/admin/scripts/${script.key}/run`,
        meta: { key: script.key, summary: out.summary, ms },
      });
    }

    res.json({
      key: script.key,
      dryRun,
      ms,
      summary: out.summary || "Terminé.",
      log: out.log || [],
    });
  } catch (err) {
    console.error(`admin script ${script.key} error:`, err.message);
    res.status(500).json({ error: err.message || "Le script a échoué." });
  }
});

export default router;
