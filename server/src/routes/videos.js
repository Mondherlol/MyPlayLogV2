import express from "express";
import Documentary from "../models/Documentary.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { searchDocs, searchEvergreen } from "../lib/videos.js";

// Feed de documentaires jeux vidéo (« Lancer un documentaire ») + onglet Vidéos
// du profil. Voir models/Documentary.js pour le modèle de données.
const router = express.Router();

const GAMES_PER_BATCH = 5; // nombre de jeux échantillonnés par chargement de feed
const FEED_SIZE = 20; // taille max du lot renvoyé
const RANK_POOL = 40; // on garde le top qualité puis on mélange pour varier

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Nettoie/normalise le snapshot vidéo reçu du client (actions seen/reco/later).
function pickVideo(body) {
  const v = body?.video || {};
  const videoId = String(v.videoId || "").trim();
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  return {
    videoId,
    title: String(v.title || "").slice(0, 300),
    author: String(v.author || "").slice(0, 120),
    thumb: v.thumb ? String(v.thumb).slice(0, 400) : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: v.duration ? String(v.duration).slice(0, 20) : null,
    gameId: Number(v.gameId) || null,
    gameName: v.gameName ? String(v.gameName).slice(0, 200) : null,
  };
}

function videoCard(doc) {
  return {
    id: String(doc._id),
    videoId: doc.videoId,
    title: doc.title,
    author: doc.author,
    thumb: doc.thumb || `https://i.ytimg.com/vi/${doc.videoId}/hqdefault.jpg`,
    duration: doc.duration,
    game: doc.gameId ? { id: doc.gameId, name: doc.gameName } : null,
    recommendedBy: doc.user?.username
      ? { username: doc.user.username, avatar: doc.user.avatar || null }
      : null,
    recommended: doc.recommended,
    later: doc.later,
    createdAt: doc.recommendedAt || doc.createdAt,
  };
}

// --- Feed « Lancer un documentaire » : jeux joués + pool communautaire ---
router.get("/feed", requireAuth, async (req, res) => {
  try {
    const langs = String(req.query.lang || "fr").split(",");
    const en = langs.includes("en");
    const scope = req.query.scope === "all" ? "all" : "played";

    // 1) Jeux candidats de la bibliothèque.
    const q = { user: req.userId };
    if (scope === "played") q.status = { $ne: "wishlist" };
    const games = await UserGame.find(q).select("gameId name").lean();

    // 2) Vidéos déjà « consommées » par ce user (exclusion du feed).
    const consumed = await Documentary.find({ user: req.userId })
      .select("videoId")
      .lean();
    const exclude = new Set(consumed.map((d) => d.videoId));

    // 3) Documentaires depuis un échantillon aléatoire de jeux joués
    //    + documentaires « culture jeu vidéo » (consoles, studios, devs, sagas).
    const sample = shuffle(games).slice(0, GAMES_PER_BATCH);
    const [perGame, evergreen] = await Promise.all([
      Promise.all(
        sample.map((g) =>
          searchDocs(g.name, { en })
            .then((vids) => vids.map((v) => ({ ...v, game: { id: g.gameId, name: g.name } })))
            .catch(() => [])
        )
      ),
      searchEvergreen({ en }).catch(() => []),
    ]);

    // 4) Pool communautaire : vidéos recommandées par n'importe qui (curé humain,
    //    on lui donne un gros bonus de score pour qu'il ressorte en priorité).
    const pool = await Documentary.find({ recommended: true })
      .populate("user", "username avatar")
      .sort({ recommendedAt: -1 })
      .limit(40)
      .lean();
    const poolVideos = pool.map((d) => ({
      videoId: d.videoId,
      title: d.title,
      author: d.author,
      thumb: d.thumb,
      duration: d.duration,
      game: d.gameId ? { id: d.gameId, name: d.gameName } : null,
      recommendedBy: d.user?.username
        ? { username: d.user.username, avatar: d.user.avatar || null }
        : null,
      _score: 100, // recommandations humaines = top qualité
    }));

    // 5) Fusion + dédup + exclusion des vidéos vues, puis tri par score qualité.
    const seen = new Set();
    const merged = [];
    for (const v of [...poolVideos, ...perGame.flat(), ...evergreen]) {
      if (!v.videoId || exclude.has(v.videoId) || seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      merged.push(v);
    }
    merged.sort((a, b) => (b._score || 0) - (a._score || 0));

    // On garde le haut du panier (qualité) puis on mélange pour varier l'ordre
    // d'une ouverture à l'autre. On nettoie le score interne avant l'envoi.
    const top = shuffle(merged.slice(0, RANK_POOL)).slice(0, FEED_SIZE);
    top.forEach((v) => delete v._score);
    res.json({ videos: top });
  } catch (err) {
    console.error("videos feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des documentaires." });
  }
});

// Upsert générique d'une action sur une vidéo (seen / recommend / later).
async function applyAction(userId, video, set) {
  return Documentary.findOneAndUpdate(
    { user: userId, videoId: video.videoId },
    {
      $set: set,
      $setOnInsert: {
        user: userId,
        videoId: video.videoId,
        title: video.title,
        author: video.author,
        thumb: video.thumb,
        duration: video.duration,
        gameId: video.gameId,
        gameName: video.gameName,
      },
    },
    { upsert: true, new: true }
  );
}

// --- Marquer une vidéo comme vue (Passer / lancement de lecture) ---
router.post("/seen", requireAuth, async (req, res) => {
  const video = pickVideo(req.body);
  if (!video) return res.status(400).json({ error: "Vidéo invalide." });
  try {
    await applyAction(req.userId, video, { seen: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("video seen error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Recommander / annuler la recommandation (toggle) ---
router.post("/recommend", requireAuth, async (req, res) => {
  const video = pickVideo(req.body);
  if (!video) return res.status(400).json({ error: "Vidéo invalide." });
  try {
    const existing = await Documentary.findOne({
      user: req.userId,
      videoId: video.videoId,
    });
    if (existing?.recommended) {
      existing.recommended = false;
      existing.recommendedAt = null;
      await existing.save({ validateModifiedOnly: true });
      return res.json({ recommended: false });
    }
    await applyAction(req.userId, video, {
      recommended: true,
      recommendedAt: new Date(),
      seen: true,
    });
    res.json({ recommended: true });
  } catch (err) {
    console.error("video recommend error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Regarder plus tard / retirer (toggle) ---
router.post("/later", requireAuth, async (req, res) => {
  const video = pickVideo(req.body);
  if (!video) return res.status(400).json({ error: "Vidéo invalide." });
  try {
    const existing = await Documentary.findOne({
      user: req.userId,
      videoId: video.videoId,
    });
    if (existing?.later) {
      existing.later = false;
      await existing.save({ validateModifiedOnly: true });
      return res.json({ later: false });
    }
    await applyAction(req.userId, video, { later: true, seen: true });
    res.json({ later: true });
  } catch (err) {
    console.error("video later error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liste pour l'onglet Vidéos du profil (recommended public / later privé) ---
router.get("/user/:username", requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select("_id");
    if (!user) return res.status(404).json({ error: "Profil introuvable." });
    const isMe = String(user._id) === String(req.userId);
    const type = req.query.type === "later" ? "later" : "recommended";

    // « Regarder plus tard » est privé : visible uniquement par soi.
    if (type === "later" && !isMe) return res.json({ videos: [] });

    const query = { user: user._id, [type]: true };
    const sortField = type === "recommended" ? { recommendedAt: -1 } : { updatedAt: -1 };
    const docs = await Documentary.find(query)
      .populate("user", "username avatar")
      .sort(sortField)
      .limit(100)
      .lean();
    res.json({ videos: docs.map(videoCard) });
  } catch (err) {
    console.error("videos user error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des vidéos." });
  }
});

// --- Retirer une vidéo d'un onglet de MON profil ---
// ?type=recommended|later : ne retire que ce flag ; supprime le doc s'il ne
// reste plus aucune relation active (à part « seen »).
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await Documentary.findOne({ _id: req.params.id, user: req.userId });
    if (!doc) return res.status(404).json({ error: "Vidéo introuvable." });
    const type = req.query.type === "later" ? "later" : "recommended";
    if (type === "recommended") {
      doc.recommended = false;
      doc.recommendedAt = null;
    } else {
      doc.later = false;
    }
    await doc.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("video delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
