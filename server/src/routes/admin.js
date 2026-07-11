import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
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
import { isAdminEmail } from "../lib/admin.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// Toutes les routes de ce fichier sont réservées à l'admin (ADMIN_EMAIL).
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
      .select("username email avatar createdAt lastSeenAt following")
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
        isAdmin: isAdminEmail(u.email),
        gameCount: gameCount.get(String(u._id)) || 0,
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

    const target = await User.findById(id).select("email");
    if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (isAdminEmail(target.email))
      return res.status(403).json({ error: "Impossible de supprimer un compte administrateur." });

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

export default router;
