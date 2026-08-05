import express from "express";
import Documentary from "../models/Documentary.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { searchDocs, searchEvergreen } from "../lib/videos.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";
import { notify } from "../lib/notify.js";
import { triggerMissionCheck } from "../lib/missions.js";
import {
  resolveVideoId,
  getOrCreateSocial,
  recommendersOf,
  loadSocialCounts,
  loadMyRelations,
  loadEngagedFriends,
} from "../lib/videoSocial.js";

// Extrait l'id d'une vidéo YouTube d'une URL (watch, youtu.be, embed, shorts).
function extractVideoId(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}

// Métadonnées d'une vidéo via l'oEmbed public de YouTube (titre, chaîne,
// miniature) — pas de clé requise. La durée n'est pas exposée par oEmbed.
async function fetchOEmbed(videoId) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

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

// Card de base d'une vidéo. Les champs sociaux (likes / commentaires) et la
// relation du VIEWER (recommandée / plus tard) + les avatars d'amis sont
// remplis par enrichCards() : ils sont GLOBAUX (par videoId), pas propres au
// Documentary affiché.
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
    // Historique / reprise (position du propriétaire de ce doc).
    positionSeconds: doc.positionSeconds || 0,
    durationSeconds: doc.durationSeconds || 0,
    watchedAt: doc.watchedAt || null,
    recommendedAt: doc.recommendedAt || null,
    // Remplis par enrichCards (défauts pour une réponse à une seule card).
    recommended: false,
    later: false,
    liked: false,
    likeCount: 0,
    commentCount: 0,
    friends: [],
    friendCount: 0,
    createdAt: doc.recommendedAt || doc.createdAt,
  };
}

// Enrichit un lot de cards avec la couche sociale globale + la relation du
// viewer + les avatars d'amis ayant regardé/liké chaque vidéo.
async function enrichCards(cards, viewerId) {
  const ids = cards.map((c) => c.videoId);
  const [counts, relations, friends] = await Promise.all([
    loadSocialCounts(ids, viewerId),
    loadMyRelations(ids, viewerId),
    loadEngagedFriends(ids, viewerId),
  ]);
  for (const c of cards) {
    const s = counts.get(c.videoId);
    if (s) Object.assign(c, s);
    const r = relations.get(c.videoId);
    if (r) {
      c.recommended = r.recommended;
      c.later = r.later;
    }
    const f = friends.get(c.videoId);
    if (f) {
      c.friends = f.friends;
      c.friendCount = f.total;
    }
  }
  return cards;
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

    // 4) Pool communautaire : vidéos recommandées par les joueurs que JE suis
    //    (curé humain, gros bonus de score pour qu'il ressorte en priorité).
    //    Restreint aux abonnements : pas de recos d'inconnus dans le feed.
    const me = await User.findById(req.userId).select("following").lean();
    const following = me?.following || [];
    const pool = following.length
      ? await Documentary.find({ recommended: true, user: { $in: following } })
          .populate("user", "username avatar")
          .sort({ recommendedAt: -1 })
          .limit(40)
          .lean()
      : [];
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

// Snapshot vidéo « souple » (métadonnées uniquement) fourni par le client sur
// like / commentaire : le videoId de référence vient de l'URL, pas du corps.
function pickSnapshot(body, videoId) {
  const v = body?.video || {};
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

// Marque une relation horodatée (liked / commented) de CE joueur sur une vidéo
// pour alimenter le fil. Si le client n'a pas fourni de titre, on emprunte les
// métadonnées d'un Documentary existant sur ce videoId (le fil affiche un vrai
// titre plutôt qu'une carte vide).
async function markVideoRelation(userId, videoId, body, set) {
  let snap = pickSnapshot(body, videoId);
  if (!snap.title) {
    const meta = await Documentary.findOne({ videoId })
      .select("title author thumb duration gameId gameName")
      .lean();
    if (meta) {
      snap = {
        videoId,
        title: meta.title || "",
        author: meta.author || snap.author,
        thumb: meta.thumb || snap.thumb,
        duration: meta.duration || null,
        gameId: meta.gameId || null,
        gameName: meta.gameName || null,
      };
    }
  }
  return applyAction(userId, snap, set);
}

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
      existing.laterAt = null;
      await existing.save({ validateModifiedOnly: true });
      return res.json({ later: false });
    }
    await applyAction(req.userId, video, { later: true, laterAt: new Date(), seen: true });
    res.json({ later: true });
  } catch (err) {
    console.error("video later error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Recommander une vidéo à partir d'une URL YouTube collée (onglet Vidéos) ---
router.post("/recommend-url", requireAuth, async (req, res) => {
  const videoId = extractVideoId(req.body?.url);
  if (!videoId) return res.status(400).json({ error: "URL YouTube invalide." });
  try {
    const meta = await fetchOEmbed(videoId);
    if (!meta) return res.status(400).json({ error: "Vidéo introuvable sur YouTube." });
    const video = {
      videoId,
      title: String(meta.title || "").slice(0, 300),
      author: String(meta.author_name || "").slice(0, 120),
      thumb: meta.thumbnail_url
        ? String(meta.thumbnail_url).slice(0, 400)
        : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: null,
      gameId: null,
      gameName: null,
    };
    const doc = await applyAction(req.userId, video, {
      recommended: true,
      recommendedAt: new Date(),
      seen: true,
    });
    await doc.populate("user", "username avatar");
    const [card] = await enrichCards([videoCard(doc)], req.userId);
    res.status(201).json({ video: card });
  } catch (err) {
    console.error("video recommend-url error:", err.message);
    res.status(500).json({ error: "Erreur lors de la recommandation." });
  }
});

// --- Sauvegarde de la position de lecture (reprise) + « regardée » au seuil ---
// { video, position, duration, watched } — appelé pendant/à la fin de la lecture.
router.post("/progress", requireAuth, async (req, res) => {
  const video = pickVideo(req.body);
  if (!video) return res.status(400).json({ error: "Vidéo invalide." });
  const position = Math.max(0, Math.floor(Number(req.body.position) || 0));
  const duration = Math.max(0, Math.floor(Number(req.body.duration) || 0));
  const watched = !!req.body.watched;
  try {
    const set = { positionSeconds: position };
    if (duration > 0) set.durationSeconds = duration;
    if (watched) set.seen = true;
    // watchedAt n'est posé qu'une fois : sinon l'évènement « a regardé »
    // remonterait en boucle dans le fil à chaque sauvegarde de position.
    if (watched) {
      const existing = await Documentary.findOne({
        user: req.userId,
        videoId: video.videoId,
      }).select("watched");
      if (!existing?.watched) {
        set.watched = true;
        set.watchedAt = new Date();
      }
    }
    await applyAction(req.userId, video, set);
    if (set.watched) triggerMissionCheck(req.userId); // mission « Ciné-club »
    res.json({ ok: true });
  } catch (err) {
    console.error("video progress error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liste pour l'onglet Vidéos du profil (recommandations/historique publics,
//     « regarder plus tard » privé) ---
router.get("/user/:username", optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select("_id");
    if (!user) return res.status(404).json({ error: "Profil introuvable." });
    const isMe = String(user._id) === String(req.userId);
    const type = ["later", "history"].includes(req.query.type)
      ? req.query.type
      : "recommended";

    // « Regarder plus tard » est privé ; « recommandations » et « historique »
    // sont publics.
    if (type === "later" && !isMe) return res.json({ videos: [] });

    // Historique = vidéos réellement regardées (flag `watched`).
    const flag = type === "history" ? "watched" : type;
    const query = { user: user._id, [flag]: true };
    const sortField =
      type === "recommended"
        ? { recommendedAt: -1 }
        : type === "history"
          ? { watchedAt: -1 }
          : { updatedAt: -1 };
    const docs = await Documentary.find(query)
      .populate("user", "username avatar")
      .sort(sortField)
      .limit(100)
      .lean();
    const cards = await enrichCards(docs.map(videoCard), req.userId);
    res.json({ videos: cards });
  } catch (err) {
    console.error("videos user error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des vidéos." });
  }
});

// --- État social + relation perso d'une vidéo (pour le lecteur en modale) ---
router.get("/:id/social", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const [counts, relations] = await Promise.all([
      loadSocialCounts([videoId], req.userId),
      loadMyRelations([videoId], req.userId),
    ]);
    const s = counts.get(videoId) || { likeCount: 0, liked: false, commentCount: 0 };
    const r = relations.get(videoId) || { recommended: false, later: false };
    res.json({
      liked: s.liked,
      likeCount: s.likeCount,
      commentCount: s.commentCount,
      recommended: r.recommended,
      later: r.later,
    });
  } catch (err) {
    console.error("video social error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Like d'une vidéo (toggle) — GLOBAL par videoId (couche VideoSocial) ---
// On date aussi la relation perso (Documentary.liked/likedAt) pour l'évènement
// « a aimé une vidéo » du fil ; le client envoie un snapshot des métadonnées.
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const social = await getOrCreateSocial(videoId);
    const uid = String(req.userId);
    const has = social.likes.some((u) => String(u) === uid);
    if (has) social.likes = social.likes.filter((u) => String(u) !== uid);
    else social.likes.push(req.userId);
    await social.save({ validateModifiedOnly: true });
    // Marqueur horodaté pour le fil (best-effort, ne bloque pas la réponse).
    markVideoRelation(req.userId, videoId, req.body, {
      liked: !has,
      likedAt: has ? null : new Date(),
      seen: true,
    })
      // Mission « Pouce en l'air » — après le marqueur, qui est ce qu'elle mesure.
      .then(() => !has && triggerMissionCheck(req.userId))
      .catch(() => {});
    res.json({ liked: !has, likeCount: social.likes.length });
  } catch (err) {
    console.error("video like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Commentaires d'une vidéo — GLOBAUX par videoId (couche VideoSocial), même
//  système que reposts/listes (Composer, fils à un niveau, médias, likes,
//  édition, historique). Deux profils affichant la même vidéo partagent le fil.
// ============================================================

// GET /api/videos/:id/comments — fil de commentaires de la vidéo.
router.get("/:id/comments", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const social = await getOrCreateSocial(videoId);
    await social.populate("comments.user", "username avatar");
    const comments = (social.comments || []).map((c) =>
      toComment(c, social.comments, req.userId)
    );
    // « mine » (modération de tout le fil) = j'ai recommandé cette vidéo.
    const recs = await recommendersOf(videoId);
    const mine = recs.some((u) => String(u) === String(req.userId));
    res.json({ comments, mine });
  } catch (err) {
    console.error("video comments fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des commentaires." });
  }
});

// POST /api/videos/:id/comments — ajouter un commentaire (ou une réponse).
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const social = await getOrCreateSocial(videoId);
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau).
    let parent = null;
    let replyTargetUser = null;
    if (req.body?.parent) {
      const p = social.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    social.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
    });
    await social.save({ validateModifiedOnly: true });
    await social.populate("comments.user", "username avatar");
    const c = social.comments[social.comments.length - 1];

    // Marqueur horodaté pour le fil (« a commenté une vidéo »), best-effort.
    markVideoRelation(req.userId, videoId, req.body, {
      commented: true,
      commentedAt: new Date(),
      seen: true,
    }).catch(() => {});

    // Notifications : cible d'une réponse + mentions + chaque recommandeur de la
    // vidéo (« on a commenté ta reco »), un seul message par destinataire.
    const recs = await recommendersOf(videoId);
    const repOwner = recs[0] || null; // lien /u/…?tab=videos pour réponse/mention
    const recipients = new Map(); // uid -> { type, videoOwner }
    const actorStr = String(req.userId);
    const add = (uid, type, videoOwner) => {
      if (!uid) return;
      const s = String(uid);
      if (s === actorStr || recipients.has(s)) return;
      recipients.set(s, { type, videoOwner });
    };
    if (replyTargetUser) add(replyTargetUser, "comment_reply", repOwner);
    mentions.forEach((m) => add(m.user, "mention", repOwner));
    recs.forEach((u) => add(u, "video_comment", u)); // recommandeurs
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, { type, videoOwner }] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        videoOwner,
        comment: c._id,
        snippet,
      });
    }

    res.status(201).json({ comment: toComment(c, social.comments, req.userId) });
  } catch (err) {
    console.error("video comment add error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/videos/:id/comments/:commentId — modifier son commentaire (max 2 fois).
router.put("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const social = await getOrCreateSocial(videoId);
    const c = social.comments.id(req.params.commentId);
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

    await social.save({ validateModifiedOnly: true });
    await social.populate("comments.user", "username avatar");
    const updated = social.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, social.comments, req.userId) });
  } catch (err) {
    console.error("video comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/videos/:id/comments/:commentId/like — basculer le like.
router.post("/:id/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.status(404).json({ error: "Vidéo introuvable." });
    const social = await getOrCreateSocial(videoId);
    const c = social.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await social.save({ validateModifiedOnly: true });
    if (!has) {
      const recs = await recommendersOf(videoId);
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        videoOwner: recs[0] || null,
        comment: c._id,
        snippet: c.text,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("video comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/videos/:id/comments/:commentId — retirer son commentaire
// (ou n'importe lequel si on a recommandé la vidéo).
router.delete("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const videoId = await resolveVideoId(req.params.id);
    if (!videoId) return res.json({ ok: true });
    const social = await getOrCreateSocial(videoId);
    const c = social.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isAuthor = String(c.user) === String(req.userId);
    let isOwner = false;
    if (!isAuthor) {
      const recs = await recommendersOf(videoId);
      isOwner = recs.some((u) => String(u) === String(req.userId));
    }
    if (!isAuthor && !isOwner)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await social.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
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
