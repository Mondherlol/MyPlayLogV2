import express from "express";
import Notification from "../models/Notification.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function serialize(n) {
  return {
    id: n._id,
    type: n.type,
    actor: n.actor
      ? { id: n.actor._id, username: n.actor.username, avatar: n.actor.avatar || null }
      : null,
    listId: n.list?._id || n.list || null,
    listTitle: n.list?.title || null,
    // Type de la liste visée : les notifs adaptent leur wording (playlist).
    listType: n.list?.type || null,
    commentId: n.comment ? String(n.comment) : null,
    game: n.game || null,
    gameName: n.gameName || "",
    // OST : pseudo du propriétaire du profil (pour le lien /u/…?tab=ost).
    ostOwner: n.ostOwner?.username || null,
    // Repost : pseudo du propriétaire du feed (pour le lien /u/…?tab=feed).
    repostOwner: n.repostOwner?.username || null,
    snippet: n.snippet || "",
    read: n.read,
    createdAt: n.createdAt,
  };
}

// GET /api/notifications — dernières notifs + nombre de non lues.
router.get("/", requireAuth, async (req, res) => {
  try {
    const [notifs, unread] = await Promise.all([
      Notification.find({ user: req.userId })
        .sort({ createdAt: -1 })
        .limit(30)
        .populate("actor", "username avatar")
        .populate("list", "title type")
        .populate("ostOwner", "username")
        .populate("repostOwner", "username")
        .lean(),
      Notification.countDocuments({ user: req.userId, read: false }),
    ]);
    res.json({ notifications: notifs.map(serialize), unread });
  } catch (err) {
    console.error("notifications fetch error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /api/notifications/unread-count — léger, pour le polling.
router.get("/unread-count", requireAuth, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({ user: req.userId, read: false });
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/notifications/read — tout marquer comme lu.
router.post("/read", requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.userId, read: false },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
