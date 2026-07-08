import express from "express";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import Repost from "../models/Repost.js";
import Documentary from "../models/Documentary.js";
import Notification from "../models/Notification.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";

// Flux de la page d'accueil : activité des joueurs suivis (jeux, reviews,
// listes, fan arts republiés, documentaires recommandés) fusionnée en une
// timeline paginée par curseur, + rail « découverte » (jeux du moment,
// sorties marquantes, suggestions personnalisées).
const router = express.Router();

const person = (u) =>
  u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null;

// Interactions sociales remontées dans le fil (commentaires, réponses, likes
// sur les listes et les avis). Seule trace horodatée des likes : les
// notifications. On repère celles émises PAR les joueurs suivis.
const INTERACTION_TYPES = [
  "list_comment",
  "comment_reply",
  "list_like",
  "comment_like",
  "review_comment",
  "review_comment_reply",
  "review_comment_like",
];
const isReplyType = (t) =>
  t === "comment_reply" || t === "review_comment_reply";
const isCommentAddType = (t) =>
  t === "list_comment" ||
  t === "comment_reply" ||
  t === "review_comment" ||
  t === "review_comment_reply";

// ============================================================
//  GET /api/feed/home?limit&before — timeline de l'accueil
// ============================================================
// Fusionne 4 sources triées par date décroissante. Chaque source est bornée
// à `limit` : on est donc sûr d'avoir les `limit` évènements les plus récents
// toutes sources confondues. Curseur = date du dernier évènement affiché.
router.get("/home", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 25);
    const before = req.query.before ? new Date(req.query.before) : null;
    const hasBefore = before && !Number.isNaN(before.getTime());
    const lt = (field) => (hasBefore ? { [field]: { $lt: before } } : {});

    const me = await User.findById(req.userId).select("following");
    const followed = (me?.following || []).map(String);
    // Personne à suivre encore : on ouvre le feed à toute la communauté pour
    // que la page ne soit jamais vide (petite appli entre amis). Dans tous
    // les cas, on n'affiche jamais ses PROPRES activités dans son fil.
    const community = followed.length === 0;
    const scope = community
      ? { user: { $ne: req.userId } }
      : { user: { $in: followed } };

    // Filtre « acteur » pour les interactions (le champ scope cible le
    // propriétaire du contenu ; ici on veut l'auteur de l'action).
    const actorScope = community
      ? { $ne: req.userId }
      : { $in: followed };

    const [entries, lists, reposts, docs, notifs] = await Promise.all([
      UserGame.find({ ...scope, ...lt("updatedAt") })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate("user", "username avatar")
        .lean(),
      List.find({ ...scope, visibility: "public", ...lt("updatedAt") })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate("user", "username avatar")
        .lean(),
      Repost.find({ ...scope, ...lt("createdAt") })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "username avatar")
        .lean(),
      Documentary.find({
        ...scope,
        recommended: true,
        ...(hasBefore ? { recommendedAt: { $lt: before } } : {}),
      })
        .sort({ recommendedAt: -1 })
        .limit(limit)
        .populate("user", "username avatar")
        .lean(),
      Notification.find({
        actor: actorScope,
        type: { $in: INTERACTION_TYPES },
        ...lt("createdAt"),
      })
        .sort({ createdAt: -1 })
        // On surdimensionne : une action génère plusieurs notifs (réponse =
        // parent + propriétaire) qu'on dédoublonne ensuite.
        .limit(limit * 3)
        .populate("actor", "username avatar")
        .populate("user", "username")
        .populate("list", "title type visibility items")
        .lean(),
    ]);

    const events = [];

    // --- Entrées de bibliothèque : ajout / statut / note / review ---
    for (const e of entries) {
      if (!e.user) continue;
      const hasReview = !!(
        (e.review && e.review.trim()) ||
        (e.pros || []).length ||
        (e.cons || []).length ||
        (e.reviewMedia || []).length
      );
      events.push({
        type: "game",
        id: `g-${e._id}`,
        date: e.updatedAt,
        user: person(e.user),
        game: { id: e.gameId, name: e.name, cover: e.cover || null },
        status: e.status,
        rating: e.rating ?? null,
        favorite: !!e.favorite,
        platform: e.platform || null,
        playtimeHours: e.playtimeHours ?? null,
        hasReview,
        review: hasReview ? String(e.review || "").slice(0, 420) : "",
        spoiler: !!e.spoiler,
        pros: hasReview ? (e.pros || []).slice(0, 3) : [],
        cons: hasReview ? (e.cons || []).slice(0, 3) : [],
        reviewImage: hasReview ? e.reviewMedia?.[0]?.url || null : null,
        reactionCount: (e.reactions || []).length,
        commentCount: (e.comments || []).length,
      });
    }

    // --- Listes créées ou mises à jour ---
    for (const l of lists) {
      if (!l.user) continue;
      const items = l.items || [];
      const created =
        new Date(l.updatedAt) - new Date(l.createdAt) < 5 * 60 * 1000;
      const chars = items.filter((i) => i.kind === "character").length;
      events.push({
        type: "list",
        id: `l-${l._id}`,
        date: l.updatedAt,
        user: person(l.user),
        created,
        list: {
          id: String(l._id),
          title: l.title,
          type: l.type,
          itemKind: items.length > 0 && chars === items.length ? "character" : "game",
          itemCount: items.length,
          preview: items.filter((i) => i.image).slice(0, 5).map((i) => i.image),
          likeCount: (l.likes || []).length,
          commentCount: (l.comments || []).length,
        },
      });
    }

    // --- Fan arts republiés (images locales, cf. routes/reposts.js) ---
    // Le lecteur a-t-il déjà ces fan arts sur SON feed ? (état du bouton)
    const myReposts = reposts.length
      ? await Repost.find({
          user: req.userId,
          itemId: { $in: reposts.map((r) => r.itemId) },
        })
          .select("itemId")
          .lean()
      : [];
    const myItemIds = new Set(myReposts.map((r) => r.itemId));
    const base = `${req.protocol}://${req.get("host")}`;
    for (const r of reposts) {
      if (!r.user) continue;
      events.push({
        type: "repost",
        id: `r-${r._id}`,
        date: r.createdAt,
        user: person(r.user),
        repost: {
          id: String(r._id),
          image: `${base}/uploads/reposts/${r.image}`,
          w: r.w || null,
          h: r.h || null,
          source: r.source,
          author: r.author || "",
          url: r.url || "",
          likeCount: (r.likes || []).length,
          liked: (r.likes || []).some((u) => String(u) === String(req.userId)),
          commentCount: (r.comments || []).length,
          repostedByMe:
            String(r.user._id) === String(req.userId) || myItemIds.has(r.itemId),
        },
        game: { id: r.gameId, name: r.gameName, cover: r.gameCover || null },
      });
    }

    // --- Documentaires recommandés ---
    for (const d of docs) {
      if (!d.user) continue;
      events.push({
        type: "video",
        id: `v-${d._id}`,
        date: d.recommendedAt || d.createdAt,
        user: person(d.user),
        video: {
          videoId: d.videoId,
          title: d.title,
          author: d.author || "",
          thumb: d.thumb || `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
          duration: d.duration || null,
        },
        game: d.gameId ? { id: d.gameId, name: d.gameName } : null,
      });
    }

    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    const page = events.slice(0, limit);
    const nextCursor =
      events.length > page.length && page.length
        ? new Date(page[page.length - 1].date).toISOString()
        : null;

    res.json({ items: page, nextCursor, community });
  } catch (err) {
    console.error("home feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du flux." });
  }
});

// ============================================================
//  GET /api/feed/discover — jeux du moment, sorties, suggestions
// ============================================================

const IMG = "https://images.igdb.com/igdb/image/upload";

function discoverGame(g) {
  const fr = (g.alternative_names || []).find((a) => /french/i.test(a.comment || ""));
  return {
    id: g.id,
    name: fr?.name || g.name,
    cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    screenshot: g.screenshots?.[0]?.image_id
      ? `${IMG}/t_screenshot_med/${g.screenshots[0].image_id}.jpg`
      : null,
    rating: g.total_rating ? Math.round(g.total_rating) : null,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null,
    releaseDate: g.first_release_date || null,
    hypes: g.hypes || 0,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || []).map((p) => p.abbreviation || p.name).filter(Boolean),
  };
}

const DISCOVER_FIELDS =
  "fields name,alternative_names.name,alternative_names.comment,cover.image_id,screenshots.image_id,total_rating,total_rating_count,first_release_date,hypes,genres.name,platforms.abbreviation,platforms.name";

// « Jeux du moment » et « sorties marquantes » : identiques pour tout le
// monde, mis en cache mémoire par jour (comme /games/releases).
const sharedCache = { day: 0, hot: null, upcoming: null };
// Suggestions personnalisées : cache par utilisateur (6 h).
const forYouCache = new Map();
const FOR_YOU_TTL = 6 * 60 * 60 * 1000;

async function fetchHot(now) {
  // Sortis dans les 9 derniers mois, les plus joués/notés d'abord.
  const q = `${DISCOVER_FIELDS}; where cover != null & version_parent = null & game_type = (0,8,9) & first_release_date >= ${now - 270 * 86400} & first_release_date <= ${now} & total_rating_count > 3; sort total_rating_count desc; limit 16;`;
  return (await igdbQuery("games", q)).map(discoverGame);
}

async function fetchUpcoming(now) {
  // À venir dans les 8 prochains mois, triés par hype décroissante puis
  // réordonnés par date : les sorties « marquantes » les plus proches d'abord.
  const q = `${DISCOVER_FIELDS}; where cover != null & version_parent = null & game_type = (0,8,9) & first_release_date > ${now} & first_release_date <= ${now + 240 * 86400} & hypes > 5; sort hypes desc; limit 12;`;
  const games = (await igdbQuery("games", q)).map(discoverGame);
  return games.sort((a, b) => (a.releaseDate || 0) - (b.releaseDate || 0));
}

// Suggestions « pour toi » : jeux bien notés dans les genres favoris de la
// bibliothèque, en excluant les jeux déjà possédés. Best-effort (2 appels IGDB).
async function fetchForYou(userId) {
  const owned = await UserGame.find({ user: userId }).select("gameId").lean();
  const ownedIds = owned.map((e) => e.gameId);
  if (!ownedIds.length) return [];

  const sample = ownedIds.slice(-200); // les ajouts les plus récents pèsent
  const raw = await igdbQuery(
    "games",
    `fields genres; where id = (${sample.join(",")}); limit 200;`
  );
  const counts = new Map();
  for (const g of raw)
    for (const id of g.genres || []) counts.set(id, (counts.get(id) || 0) + 1);
  const topGenres = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
  if (!topGenres.length) return [];

  const exclude = ownedIds.slice(0, 400);
  const q = `${DISCOVER_FIELDS}; where cover != null & version_parent = null & game_type = (0,8,9) & genres = (${topGenres.join(",")}) & total_rating >= 78 & total_rating_count > 80 & id != (${exclude.join(",")}); sort total_rating_count desc; limit 36;`;
  const pool = (await igdbQuery("games", q)).map(discoverGame);

  // Mélange léger pour varier d'une visite à l'autre.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 12);
}

router.get("/discover", requireAuth, async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const day = now - (now % 86400);

    if (sharedCache.day !== day) {
      const [hot, upcoming] = await Promise.all([
        fetchHot(now).catch(() => []),
        fetchUpcoming(now).catch(() => []),
      ]);
      // On n'écrase le cache que si IGDB a répondu (sinon on retente au
      // prochain appel tout en servant l'ancien contenu s'il existe).
      if (hot.length || upcoming.length) {
        sharedCache.day = day;
        sharedCache.hot = hot;
        sharedCache.upcoming = upcoming;
      }
    }

    const key = String(req.userId);
    let forYou = forYouCache.get(key);
    if (!forYou || Date.now() - forYou.at > FOR_YOU_TTL) {
      forYou = { at: Date.now(), games: await fetchForYou(req.userId).catch(() => []) };
      forYouCache.set(key, forYou);
    }

    res.json({
      hot: sharedCache.hot || [],
      upcoming: sharedCache.upcoming || [],
      forYou: forYou.games,
    });
  } catch (err) {
    console.error("discover error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des découvertes." });
  }
});

export default router;
