import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import Repost from "../models/Repost.js";
import Download from "../models/Download.js";
import Documentary from "../models/Documentary.js";
import Activity from "../models/Activity.js";
import GemDiscovery from "../models/GemDiscovery.js";
import GemSkip from "../models/GemSkip.js";
import Recommendation from "../models/Recommendation.js";
import { ensureGameMeta } from "../lib/gameMeta.js";
import { igdbQuery } from "../lib/igdb.js";
import { geminiJson, isGeminiConfigured } from "../lib/gemini.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { summarizeReactions } from "../lib/reviewSerialize.js";
import { buildRepostStats } from "./reposts.js";
import { playlistDuration } from "./lists.js";
import { loadSocialCounts } from "../lib/videoSocial.js";

// Flux de la page d'accueil : activité des joueurs suivis (jeux, reviews,
// listes, fan arts republiés, documentaires recommandés) fusionnée en une
// timeline paginée par curseur, + rail « découverte » (jeux du moment,
// sorties marquantes, suggestions personnalisées).
const router = express.Router();

const person = (u) =>
  u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null;

// Interactions sociales « secondaires » (l'acteur agit sur le contenu d'un autre).
const INTERACTIONS = [
  "list_comment",
  "comment_reply",
  "list_like",
  "comment_like",
  "playlist_listen",
  "review_comment",
  "review_comment_reply",
  "review_comment_like",
  "review_react",
  "recommendation",
  "recommendation_boost",
  "recommendation_comment",
];
const RECO_TYPES = ["recommendation", "recommendation_boost", "recommendation_comment"];

// Mini-carte de liste embarquée dans les évènements.
function listMini(l) {
  const items = l.items || [];
  const chars = items.filter((i) => i.kind === "character").length;
  const tracks = items.filter((i) => i.kind === "track").length;
  const itemKind =
    items.length > 0 && tracks === items.length
      ? "ost"
      : items.length > 0 && chars === items.length
        ? "character"
        : "game";
  return {
    id: String(l._id),
    title: l.title,
    type: l.type,
    cover: l.cover || null, // pochette (CD des mini-cartes playlist)
    itemKind: l.type === "playlist" ? "ost" : itemKind,
    itemCount: items.length,
    preview: items.filter((i) => i.image).slice(0, 5).map((i) => i.image),
    likeCount: (l.likes || []).length,
    commentCount: (l.comments || []).length,
    // Playlist : durée totale + premières pistes jouables (miniatures
    // écoutables directement depuis la carte du fil).
    ...(l.type === "playlist"
      ? {
          ...playlistDuration(items),
          tracks: items
            .filter((i) => i.kind === "track" && (i.videoId || i.url))
            .slice(0, 6)
            .map((i) => ({
              refId: i.refId,
              name: i.name,
              artist: i.artist || null,
              image: i.image || null,
              videoId: i.videoId || null,
              url: i.url || null,
              gameId: i.gameId || null,
              gameName: i.gameName || null,
            })),
        }
      : {}),
  };
}

// ============================================================
//  Construction de la timeline (partagée accueil / feed de profil)
// ============================================================
// La timeline est bâtie sur le journal Activity (les VRAIES actions : passage
// en « terminé », note posée, OST choisie…), plus les reposts, documentaires
// recommandés et découvertes de pépites. On n'infère plus rien des updatedAt :
// modifier une entrée ne la fait plus remonter comme « nouvellement terminée ».
// Chaque source est bornée à `limit` : on est donc sûr d'avoir les `limit`
// évènements les plus récents toutes sources confondues.
// `only: "media"` restreint la timeline aux fan arts republiés (onglet
// « Médias » du feed de profil, et bento indépendant du fil).
async function buildTimeline(req, { userScope, actorScope, before, limit, only = null }) {
  const hasBefore = before && !Number.isNaN(before.getTime());
  const lt = (field) => (hasBefore ? { [field]: { $lt: before } } : {});
  const wantAll = only !== "media";
  // limit + 1 : s'il reste au moins un évènement au-delà de la page, le total
  // dépasse `limit` et le curseur de pagination est renvoyé — indispensable
  // quand une seule source remplit exactement la page (ex. onglet Médias).
  const cap = limit + 1;

  const [reposts, docs, watched, liked, commented, later, acts, gems, downloads] =
    await Promise.all([
    Repost.find({ user: userScope, ...lt("createdAt") })
      .sort({ createdAt: -1 })
      .limit(cap)
      .populate("user", "username avatar")
      .lean(),
    !wantAll
      ? Promise.resolve([])
      : Documentary.find({
          user: userScope,
          recommended: true,
          ...(hasBefore ? { recommendedAt: { $lt: before } } : {}),
        })
          .sort({ recommendedAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    // Vidéos réellement regardées (seuil franchi) → évènement « a regardé ».
    !wantAll
      ? Promise.resolve([])
      : Documentary.find({
          user: userScope,
          watched: true,
          ...(hasBefore ? { watchedAt: { $lt: before } } : {}),
        })
          .sort({ watchedAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    // Vidéos aimées → évènement « a aimé une vidéo ».
    !wantAll
      ? Promise.resolve([])
      : Documentary.find({
          user: userScope,
          liked: true,
          ...(hasBefore ? { likedAt: { $lt: before } } : {}),
        })
          .sort({ likedAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    // Vidéos commentées → évènement « a commenté une vidéo ».
    !wantAll
      ? Promise.resolve([])
      : Documentary.find({
          user: userScope,
          commented: true,
          ...(hasBefore ? { commentedAt: { $lt: before } } : {}),
        })
          .sort({ commentedAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    // Vidéos mises en « à regarder plus tard » → évènement « a ajouté… ».
    !wantAll
      ? Promise.resolve([])
      : Documentary.find({
          user: userScope,
          later: true,
          ...(hasBefore ? { laterAt: { $lt: before } } : {}),
        })
          .sort({ laterAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    !wantAll
      ? Promise.resolve([])
      : Activity.find({ actor: actorScope, ...lt("createdAt") })
          .sort({ createdAt: -1 })
          .limit(limit * 2) // les activités portent plusieurs types d'évènements
          .populate("actor", "username avatar")
          .populate("target", "username avatar")
          .populate("list", "title type cover visibility items likes comments")
          .lean(),
    !wantAll
      ? Promise.resolve([])
      : GemDiscovery.find({ user: userScope, ...lt("updatedAt") })
          .sort({ updatedAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
    // Délits de téléchargement (cf. models/Download.js) — card moqueuse du fil.
    !wantAll
      ? Promise.resolve([])
      : Download.find({ user: userScope, ...lt("createdAt") })
          .sort({ createdAt: -1 })
          .limit(cap)
          .populate("user", "username avatar")
          .lean(),
  ]);

  const events = [];
  const blindtests = []; // regroupés en rafale après la boucle des activités

  // --- Actions de bibliothèque (game_update) : on complète la carte avec
  // l'état ACTUEL de l'entrée (review, note, réactions…) pour pouvoir y
  // réagir/répondre directement depuis le fil. ---
  const gameActs = acts.filter((a) => a.type === "game_update" && a.actor && a.game);
  // Aperçu de l'avis visé par une interaction (réaction / commentaire) : on
  // charge aussi l'entrée du PROPRIÉTAIRE de l'avis (a.target) pour embarquer
  // jaquette + note + extrait dans la carte.
  const rvActs = acts.filter(
    (a) =>
      (a.type === "review_react" || a.type === "review_comment") &&
      a.actor &&
      a.game &&
      a.target
  );
  const pairs = [
    ...gameActs.map((a) => ({ user: a.actor._id, gameId: a.game })),
    ...rvActs.map((a) => ({ user: a.target._id, gameId: a.game })),
  ];
  const entries = pairs.length ? await UserGame.find({ $or: pairs }).lean() : [];
  const entryByKey = new Map(entries.map((e) => [`${e.user}-${e.gameId}`, e]));

  // Recommandations : la carte embarque l'état ACTUEL de la reco (score,
  // ai-je déjà +1 ?) pour proposer le bouton +1 directement dans le fil, et
  // quelques métadonnées du jeu (année, genre, note — cache GameMeta).
  const recoActs = acts.filter(
    (a) => RECO_TYPES.includes(a.type) && a.actor && a.game && a.target
  );
  let recByKey = new Map();
  let recoMeta = new Map();
  if (recoActs.length) {
    const [recs, meta] = await Promise.all([
      Recommendation.find({
        $or: recoActs.map((a) => ({ to: a.target._id, gameId: a.game })),
      }).lean(),
      ensureGameMeta(recoActs.map((a) => a.game)).catch(() => new Map()),
    ]);
    recByKey = new Map(recs.map((r) => [`${r.to}-${r.gameId}`, r]));
    recoMeta = meta;
  }

  const gameEvents = [];
  for (const a of gameActs) {
    const changes = a.meta?.changes || [];
    if (!changes.length) continue;
    const e = entryByKey.get(`${a.actor._id}-${a.game}`);
    const hasReview = !!(
      e &&
      ((e.review && e.review.trim()) ||
        (e.pros || []).length ||
        (e.cons || []).length ||
        (e.reviewMedia || []).length)
    );
    // Le corps de la review n'est montré que si la review fait partie des
    // actions de la carte (sinon on n'affiche que ce qui a réellement changé).
    const showReview =
      hasReview && changes.some((c) => c.kind === "review" || c.kind === "added");
    const { counts, mine } = summarizeReactions(e?.reactions || [], req.userId);
    const kinds = new Set(changes.map((c) => c.kind));
    gameEvents.push({
      type: "game",
      id: `a-${a._id}`,
      date: a.createdAt,
      user: person(a.actor),
      game: {
        id: a.game,
        name: a.gameName || e?.name || "",
        cover: a.gameCover || e?.cover || null,
      },
      changes,
      status:
        e?.status ||
        changes.find((c) => c.kind === "status")?.to ||
        changes.find((c) => c.kind === "added")?.status ||
        null,
      rating: e?.rating ?? null,
      favorite: !!e?.favorite,
      platform: e?.platform || null,
      playtimeHours: e?.playtimeHours ?? null,
      hasReview: showReview,
      review: showReview ? String(e.review || "").slice(0, 420) : "",
      spoiler: !!e?.spoiler,
      pros: showReview ? (e.pros || []).slice(0, 3) : [],
      cons: showReview ? (e.cons || []).slice(0, 3) : [],
      reviewImage: showReview ? e.reviewMedia?.[0]?.url || null : null,
      // OST / personnage : seulement si c'est une des actions de la carte.
      ost: kinds.has("ost") && e?.favoriteOst?.name
        ? {
            name: e.favoriteOst.name,
            artist: e.favoriteOst.artist || "",
            artwork: e.favoriteOst.artwork || null,
            preview: e.favoriteOst.preview || null,
            youtube: !!e.favoriteOst.youtube,
            url: e.favoriteOst.url || null,
          }
        : changes.find((c) => c.kind === "ost") || null,
      character: kinds.has("character")
        ? e?.favoriteCharacter?.name
          ? { name: e.favoriteCharacter.name, image: e.favoriteCharacter.image || null }
          : changes.find((c) => c.kind === "character") || null
        : null,
      // Barre de réactions : dès que la carte porte un avis ou une note.
      canReact:
        (hasReview || e?.rating != null) &&
        changes.some((c) => ["review", "rating", "added", "status"].includes(c.kind)),
      reactions: counts,
      myReaction: mine,
      commentCount: (e?.comments || []).length,
    });
  }

  // Regroupement anti-rafale : plusieurs cartes « simples » (juste un statut,
  // sans note/review/OST) d'un même joueur, même statut, rapprochées dans le
  // temps → UNE carte « a ajouté N jeux à sa liste de souhaits » avec les
  // jaquettes. Les cartes riches restent individuelles.
  const GROUP_GAP = 2 * 60 * 60 * 1000; // 2 h entre deux évènements consécutifs
  const isSimple = (ev) =>
    !!ev.status &&
    !ev.hasReview &&
    (ev.changes || []).every((c) => c.kind === "added" || c.kind === "status");
  gameEvents.sort((x, y) => new Date(y.date) - new Date(x.date));
  const clusters = [];
  for (const ev of gameEvents) {
    const last = clusters[clusters.length - 1];
    if (
      last &&
      last.simple &&
      isSimple(ev) &&
      last.user.id === ev.user.id &&
      last.status === ev.status &&
      new Date(last.lastDate) - new Date(ev.date) <= GROUP_GAP
    ) {
      last.members.push(ev);
      last.lastDate = ev.date;
    } else {
      clusters.push({
        simple: isSimple(ev),
        user: ev.user,
        status: ev.status,
        date: ev.date,
        lastDate: ev.date,
        members: [ev],
      });
    }
  }
  for (const c of clusters) {
    if (c.simple && c.members.length >= 2) {
      events.push({
        type: "gamegroup",
        id: `gg-${c.members[0].id}`,
        date: c.date, // le plus récent du groupe
        user: c.user,
        status: c.status,
        games: c.members.map((m) => m.game),
      });
    } else {
      events.push(...c.members);
    }
  }

  // --- Autres activités : listes, abonnements, interactions ---
  for (const a of acts) {
    if (!a.actor || a.type === "game_update") continue;

    if (a.type === "list_create" || a.type === "list_items") {
      // Liste supprimée ou passée en privé : on masque.
      if (!a.list || a.list.visibility === "private") continue;
      if (a.type === "list_create") {
        events.push({
          type: "list",
          id: `a-${a._id}`,
          date: a.createdAt,
          user: person(a.actor),
          created: true,
          list: listMini(a.list),
        });
      } else {
        events.push({
          type: "listadd",
          id: `a-${a._id}`,
          date: a.createdAt,
          user: person(a.actor),
          count: a.meta?.added || 1,
          list: listMini(a.list),
        });
      }
      continue;
    }

    if (a.type === "follow") {
      if (!a.target) continue;
      events.push({
        type: "follow",
        id: `a-${a._id}`,
        date: a.createdAt,
        user: person(a.actor),
        target: person(a.target),
      });
      continue;
    }

    if (a.type === "blindtest") {
      if (!a.meta?.blindTestId) continue;
      blindtests.push({
        type: "blindtest",
        id: `a-${a._id}`,
        date: a.createdAt,
        user: person(a.actor),
        blindTestId: a.meta.blindTestId,
        score: a.meta.score || 0,
        correct: a.meta.correct || 0,
        total: a.meta.total || 0,
        challenge: a.meta.challenge || null,
      });
      continue;
    }

    if (!INTERACTIONS.includes(a.type)) continue;

    const onList = !!a.list;
    // Liste supprimée ou passée en privé → lien cassé pour l'abonné : on masque.
    if (onList && a.list.visibility === "private") continue;
    // Activité « liste » dont la liste n'existe plus (populate → null).
    const listMissing =
      (a.type === "list_comment" ||
        a.type === "list_like" ||
        a.type === "comment_reply" ||
        a.type === "comment_like" ||
        a.type === "playlist_listen") &&
      !onList;
    if (listMissing) continue;

    // Aperçu de l'avis visé (réaction ou commentaire racine) : jaquette,
    // note, extrait — pour une carte parlante au lieu d'un simple lien.
    let review = null;
    if (
      (a.type === "review_react" || a.type === "review_comment") &&
      a.game &&
      a.target
    ) {
      const e = entryByKey.get(`${a.target._id}-${a.game}`);
      if (e) {
        review = {
          gameCover: e.cover || null,
          rating: e.rating ?? null,
          text: String(e.review || "").slice(0, 220),
          spoiler: !!e.spoiler,
          pros: (e.pros || []).slice(0, 2),
          cons: (e.cons || []).slice(0, 2),
        };
      }
    }

    // État de la reco visée (score + mon +1) et méta du jeu pour la mini-carte.
    let reco = null;
    let gm = null;
    if (RECO_TYPES.includes(a.type) && a.game && a.target) {
      const r = recByKey.get(`${a.target._id}-${a.game}`);
      if (r) {
        reco = {
          id: String(r._id),
          count: (r.recommenders || []).length + (r.boosters || []).length,
          iBoosted: (r.boosters || []).some((u) => String(u) === String(req.userId)),
          iRecommended: (r.recommenders || []).some(
            (x) => String(x.user) === String(req.userId)
          ),
        };
      }
      gm = recoMeta.get(a.game) || null;
    }

    events.push({
      type: "interaction",
      id: `a-${a._id}`,
      date: a.createdAt,
      user: person(a.actor),
      action: a.type,
      target: person(a.target),
      snippet: a.snippet || "",
      list: onList ? listMini(a.list) : null,
      game: a.game
        ? {
            id: a.game,
            name: a.gameName || "",
            cover: a.gameCover || null,
            ...(gm
              ? {
                  year: gm.year ?? null,
                  rating: gm.rating ?? null,
                  genres: (gm.genres || []).slice(0, 2),
                }
              : {}),
          }
        : null,
      review,
      reco,
    });
  }

  // --- Fan arts républiés (images locales, cf. routes/reposts.js) ---
  // Le lecteur a-t-il déjà ces fan arts sur SON feed ? (état du bouton)
  // Invité (pas de req.userId) : aucune republication « à moi ».
  const myReposts = reposts.length && req.userId
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
        id: String(d._id), // doc de la reco : cible des likes / commentaires
        videoId: d.videoId,
        title: d.title,
        author: d.author || "",
        thumb: d.thumb || `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
        duration: d.duration || null,
        positionSeconds: d.positionSeconds || 0,
        durationSeconds: d.durationSeconds || 0,
        // Défauts : remplacés par les compteurs GLOBAUX (loadSocialCounts).
        likeCount: 0,
        liked: false,
        commentCount: 0,
      },
      game: d.gameId ? { id: d.gameId, name: d.gameName } : null,
    });
  }

  // --- Activités vidéo : regardée / aimée / commentée / « plus tard ». Chaque
  //     type est regroupé en rafale (« a aimé N vidéos ») comme les visionnages,
  //     via une carte générique { type: videoact(group), kind }. ---
  const actVideo = (d) => ({
    id: String(d._id),
    videoId: d.videoId,
    title: d.title,
    author: d.author || "",
    thumb: d.thumb || `https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`,
    duration: d.duration || null,
    positionSeconds: d.positionSeconds || 0,
    durationSeconds: d.durationSeconds || 0,
    game: d.gameId ? { id: d.gameId, name: d.gameName } : null,
  });
  const pushVideoActivity = (kind, list, dateField) => {
    const items = list
      .filter((d) => d.user)
      .map((d) => ({ user: d.user, date: d[dateField] || d.createdAt, video: actVideo(d) }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const clusters = [];
    for (const w of items) {
      const last = clusters[clusters.length - 1];
      if (
        last &&
        String(last.user._id) === String(w.user._id) &&
        new Date(last.lastDate) - new Date(w.date) <= GROUP_GAP
      ) {
        last.videos.push(w.video);
        last.lastDate = w.date;
      } else {
        clusters.push({ user: w.user, date: w.date, lastDate: w.date, videos: [w.video] });
      }
    }
    for (const c of clusters) {
      if (c.videos.length >= 2) {
        events.push({
          type: "videoactgroup",
          kind,
          id: `va-${kind}-g-${c.videos[0].id}`,
          date: c.date,
          user: person(c.user),
          videos: c.videos,
        });
      } else {
        events.push({
          type: "videoact",
          kind,
          id: `va-${kind}-${c.videos[0].id}`,
          date: c.date,
          user: person(c.user),
          video: c.videos[0],
        });
      }
    }
  };
  pushVideoActivity("watch", watched, "watchedAt");
  pushVideoActivity("like", liked, "likedAt");
  pushVideoActivity("comment", commented, "commentedAt");
  pushVideoActivity("later", later, "laterAt");

  // --- Blind tests : plusieurs parties d'un même joueur rapprochées dans le
  //     temps → UNE carte « a fait N blind tests » (jouer plusieurs fois de
  //     suite est courant et noyait le fil). Une seule partie = carte normale. ---
  blindtests.sort((a, b) => new Date(b.date) - new Date(a.date));
  {
    const clusters = [];
    for (const bt of blindtests) {
      const last = clusters[clusters.length - 1];
      if (
        last &&
        last.user.id === bt.user.id &&
        new Date(last.lastDate) - new Date(bt.date) <= GROUP_GAP
      ) {
        last.members.push(bt);
        last.lastDate = bt.date;
      } else {
        clusters.push({ user: bt.user, date: bt.date, lastDate: bt.date, members: [bt] });
      }
    }
    for (const c of clusters) {
      if (c.members.length >= 2) {
        const best = c.members.reduce((a, b) => (b.score > a.score ? b : a));
        events.push({
          type: "blindtestgroup",
          id: `bt-g-${c.members[0].id}`,
          date: c.date, // le plus récent du groupe
          user: c.user,
          count: c.members.length,
          bestScore: best.score,
          best: {
            blindTestId: best.blindTestId,
            score: best.score,
            correct: best.correct,
            total: best.total,
            challenge: best.challenge,
          },
          games: c.members.map((m) => ({
            id: m.id,
            blindTestId: m.blindTestId,
            date: m.date,
            score: m.score,
            correct: m.correct,
            total: m.total,
            challenge: m.challenge,
          })),
        });
      } else {
        events.push(c.members[0]);
      }
    }
  }

  // --- Découvertes de pépites indés (une carte par jour et par joueur) ---
  for (const g of gems) {
    if (!g.user || !(g.seeds || []).length) continue;
    events.push({
      type: "gems",
      id: `gd-${g._id}`,
      gemsId: String(g._id), // pour GET /feed/gems/:id (modale « ses pépites »)
      date: g.updatedAt,
      user: person(g.user),
      seeds: g.seeds.map((s) => ({
        id: s.gameId,
        name: s.name,
        cover: s.cover || null,
      })),
      gameCount: (g.games || []).length,
      count: g.count || 1,
    });
  }

  // --- Délits de téléchargement : « X a téléchargé Y depuis Z » + réactions
  //     moqueuses (huer / jeter une tomate / traiter de monstre). ---
  for (const d of downloads) {
    if (!d.user) continue;
    const counts = { boo: 0, tomato: 0, monster: 0 };
    const mine = [];
    for (const r of d.reactions || []) {
      if (counts[r.type] != null) counts[r.type]++;
      if (String(r.user) === String(req.userId)) mine.push(r.type);
    }
    events.push({
      type: "download",
      id: `dl-${d._id}`,
      date: d.createdAt,
      user: person(d.user),
      source: d.source,
      variant: d.variant || 0,
      game: { id: d.gameId, name: d.gameName, cover: d.gameCover || null },
      downloadId: String(d._id),
      reactions: counts,
      myReactions: mine,
    });
  }

  // Compteurs sociaux GLOBAUX (par videoId) sur les cards vidéo recommandées :
  // liker/commenter depuis le fil agit sur la même vidéo que dans les profils.
  const videoEvents = events.filter((e) => e.type === "video" && e.video?.videoId);
  if (videoEvents.length) {
    const counts = await loadSocialCounts(
      videoEvents.map((e) => e.video.videoId),
      req.userId
    );
    for (const e of videoEvents) {
      const s = counts.get(e.video.videoId);
      if (s) Object.assign(e.video, s);
    }
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}

// ============================================================
//  GET /api/feed/home?limit&before — timeline de l'accueil
// ============================================================
// Curseur = date du dernier évènement affiché.
router.get("/home", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 25);
    const before = req.query.before ? new Date(req.query.before) : null;
    // Filtre « un seul joueur » (avatars au-dessus du fil) : on ne montre que
    // l'activité de cet utilisateur.
    const onlyUser =
      req.query.u && mongoose.isValidObjectId(req.query.u) ? req.query.u : null;

    const me = await User.findById(req.userId).select("following");
    const followed = (me?.following || []).map(String);
    // Personne à suivre encore : on ouvre le feed à toute la communauté pour
    // que la page ne soit jamais vide (petite appli entre amis). Dans tous
    // les cas, on n'affiche jamais ses PROPRES activités dans son fil.
    const community = !onlyUser && followed.length === 0;
    const userScope = onlyUser
      ? onlyUser
      : community
        ? { $ne: req.userId }
        : { $in: followed };

    const events = await buildTimeline(req, {
      userScope,
      actorScope: userScope,
      before,
      limit,
    });

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
//  GET /api/feed/user/:username?limit&before — feed d'un profil
// ============================================================
// Toute l'activité d'UN joueur (actions de bibliothèque, listes, abonnements,
// interactions, fan arts, documentaires, pépites), même format que /home.
// Première page : stats des reposts en plus (rail latéral de l'onglet Feed).
router.get("/user/:username", optionalAuth, async (req, res) => {
  try {
    const u = await User.findOne({ username: req.params.username }).select("_id");
    if (!u) return res.status(404).json({ error: "Profil introuvable." });

    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 25);
    const before = req.query.before ? new Date(req.query.before) : null;
    const only = req.query.only === "media" ? "media" : null;

    const [events, stats] = await Promise.all([
      buildTimeline(req, {
        userScope: u._id,
        actorScope: u._id,
        before,
        limit,
        only,
      }),
      before ? Promise.resolve(null) : buildRepostStats(u._id),
    ]);

    const page = events.slice(0, limit);
    const nextCursor =
      events.length > page.length && page.length
        ? new Date(page[page.length - 1].date).toISOString()
        : null;

    res.json({ items: page, nextCursor, ...(stats ? { stats } : {}) });
  } catch (err) {
    console.error("user feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du feed." });
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

// ============================================================
//  POST /api/feed/recommend — « Trouve-moi des pépites »
//  À partir de 3 jeux choisis (+ plateformes), on sort une petite liste
//  sur mesure. Deux moteurs :
//   1. Gemini (principal) : le LLM propose des titres « au feeling »
//      (ambiance, narration, style visuel — pas juste les genres IGDB),
//      chaque titre étant ensuite résolu et validé sur IGDB (jaquette, note,
//      exclusions) — un nom halluciné est simplement jeté.
//   2. IGDB pur (repli / complément) : similar_games + genres/thèmes scorés.
//      D'abord en mode strict (pépites indés récentes), puis assoupli si
//      trop peu de résultats — le filtre « indé récent » vidait par
//      construction les requêtes sur plateformes rétro (ex. DS).
// ============================================================

const RECO_FIELDS = `${DISCOVER_FIELDS},themes`;
const SIX_YEARS = 6 * 365 * 86400;
// Genre IGDB « Indie » : exigé dans les pools stricts — on veut des pépites
// indés, pas des AAA qui traînent dans les similar_games.
const INDIE_GENRE = 32;

// Score d'un candidat : plus il recoupe les 3 jeux de départ (et plus il est
// confidentiel/bien noté), plus il remonte.
function scoreCandidate(g, ctx) {
  let s = 0;
  if (ctx.similar.has(g.id)) s += 6; // IGDB le juge déjà proche : gros signal
  for (const ge of g.genres || []) s += 2 * (ctx.genres.get(ge.id) || 0);
  for (const th of g.themes || []) s += 1.5 * (ctx.themes.get(th) || 0);
  // Bonus « pépite » : moins il a de votes, plus il est méconnu (borné à 0).
  s += Math.max(0, 2 - (g.total_rating_count || 0) / 400);
  // Léger bonus qualité (les candidats sont déjà filtrés côté note).
  if (g.total_rating) s += (g.total_rating - 70) / 30;
  return s;
}

// --- Moteur IGDB pur (repli) ---------------------------------------------
// strict : pépites indés récentes (comportement historique).
// assoupli : plus de filtre indé ni de fenêtre de récence, plafonds élargis —
// indispensable pour les plateformes rétro où « indé récent » = ensemble vide.
async function igdbGemPools(ctx, { strict }) {
  const { similar, genres, themes, platClause, excludeClause } = ctx;
  const now = Math.floor(Date.now() / 1000);
  const topGenres = [...genres.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => id);

  // `genres = [32]` (crochets) : le tableau doit CONTENIR Indie ; les
  // parenthèses (`= (a,b)`) signifient « au moins un de ».
  const indieClause = strict ? ` & genres = [${INDIE_GENRE}]` : "";
  const recencyClause = strict ? ` & first_release_date >= ${now - SIX_YEARS}` : "";

  // Pool A : jeux similaires selon IGDB (signal fort).
  const capA = strict ? " & total_rating_count <= 2500" : "";
  const qA = similar.size
    ? `${RECO_FIELDS}; where id = (${[...similar].slice(0, 300).join(
        ","
      )}) & cover != null & version_parent = null & total_rating >= 65${capA}${indieClause}${platClause}${excludeClause}; limit 80;`
    : null;
  // Pool B : découverte de jeux confidentiels bien notés dans les mêmes genres.
  const qB = topGenres.length
    ? `${RECO_FIELDS}; where cover != null & version_parent = null & game_type = (0,8,9)${indieClause} & genres = (${topGenres.join(
        ","
      )}) & total_rating >= ${strict ? 72 : 70} & total_rating_count >= ${
        strict ? 8 : 4
      } & total_rating_count <= ${strict ? 700 : 2500}${recencyClause}${platClause}${excludeClause}; sort total_rating_count desc; limit 80;`
    : null;

  const [poolA, poolB] = await Promise.all([
    qA ? igdbQuery("games", qA).catch(() => []) : Promise.resolve([]),
    qB ? igdbQuery("games", qB).catch(() => []) : Promise.resolve([]),
  ]);

  // Fusion + dédoublonnage, puis score.
  const byId = new Map();
  for (const g of [...poolA, ...poolB]) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()]
    .map((g) => ({ g, score: scoreCandidate(g, { genres, themes, similar }) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => discoverGame(x.g));
}

// --- Moteur Gemini ---------------------------------------------------------

// Titres déjà proposés par le LLM, par utilisateur + jeux de départ : à la
// fournée suivante on lui demande explicitement d'autres jeux, sinon il
// redonnerait à peu près la même liste. Mémoire process, TTL 24 h.
const llmSeenCache = new Map();
const LLM_SEEN_TTL = 24 * 60 * 60 * 1000;

function llmSeen(key) {
  const now = Date.now();
  for (const [k, v] of llmSeenCache)
    if (now - v.at > LLM_SEEN_TTL) llmSeenCache.delete(k);
  let entry = llmSeenCache.get(key);
  if (!entry) {
    entry = { at: now, names: [] };
    llmSeenCache.set(key, entry);
  }
  entry.at = now;
  return entry;
}

// Demande au LLM ~20 jeux « du même esprit » que les seeds.
// Renvoie [{ name, year, reason }] — noms à valider ensuite sur IGDB.
async function llmSuggest(seeds, platNames, avoidNames) {
  const seedLines = seeds.map((s) => {
    const year = s.first_release_date
      ? new Date(s.first_release_date * 1000).getFullYear()
      : "?";
    const genres = (s.genres || []).map((g) => g.name).join(", ");
    const sum = (s.summary || "").replace(/\s+/g, " ").slice(0, 280);
    return `- ${s.name} (${year})${genres ? ` — ${genres}` : ""}${sum ? ` — ${sum}` : ""}`;
  });

  const prompt = [
    "Tu es un expert en jeux vidéo à la culture encyclopédique, y compris les jeux confidentiels, rétro et les perles oubliées.",
    "Un joueur adore ces jeux :",
    ...seedLines,
    "",
    "Recommande-lui 20 jeux du même ESPRIT : ambiance, narration, rythme, style visuel, sensations — pas simplement le même genre. Pense « les joueurs qui ont adoré ces jeux ont aussi adoré… ».",
    "Mélange pépites méconnues et classiques moins évidents ; évite les blockbusters que tout le monde connaît déjà.",
    platNames.length
      ? `IMPORTANT : uniquement des jeux réellement disponibles sur ${platNames.join(", ")} (version d'origine ou portage).`
      : "Toutes plateformes confondues.",
    avoidNames.length
      ? `Ne propose AUCUN de ces jeux (déjà vus/possédés) : ${avoidNames.join(" ; ")}.`
      : "",
    'Réponds UNIQUEMENT avec un tableau JSON de cette forme : [{"name": "titre international exact du jeu, tel qu\'écrit dans les bases comme IGDB", "year": 2008, "reason": "une phrase courte en français, qui donne envie, expliquant le lien avec ses jeux"}]',
  ]
    .filter(Boolean)
    .join("\n");

  const out = await geminiJson(prompt);
  const arr = Array.isArray(out) ? out : out?.games;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({
      name: String(x?.name || "").trim(),
      year: Number(x?.year) || null,
      reason: String(x?.reason || "").trim().slice(0, 220),
    }))
    .filter((x) => x.name)
    .slice(0, 24);
}

const igdbEscape = (s) => s.replace(/\\/g, " ").replace(/"/g, '\\"');
// Normalisation pour comparer un titre LLM à un titre IGDB (casse, accents,
// ponctuation) : "Ghost Trick: Phantom Detective" ≈ "ghost trick phantom detective".
// NFKD décompose les lettres accentuées ; le filtre [^a-z0-9] jette ensuite
// les diacritiques comme la ponctuation.
const normName = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Tous les noms d'un candidat IGDB (titre principal + noms alternatifs,
// ex. « Trace Memory » = nom US d'Another Code), normalisés.
const candNames = (c) => [
  normName(c.name),
  ...(c.alternative_names || []).map((a) => normName(a.name || "")),
];

// Meilleur candidat IGDB pour un titre proposé par le LLM : nom identique
// (titre ou nom alternatif) + année cohérente d'abord, puis nom identique,
// puis inclusion large. Renvoie null si rien de crédible.
function pickCandidate(sugg, pool) {
  const target = normName(sugg.name);
  if (!target) return null;
  const exact = pool.filter((c) => candNames(c).includes(target));
  const loose = pool.filter(
    (c) =>
      !exact.includes(c) &&
      candNames(c).some((n) => n.includes(target) || (n && target.includes(n)))
  );
  const yearOk = (c) => {
    const y = c.first_release_date
      ? new Date(c.first_release_date * 1000).getFullYear()
      : null;
    return !sugg.year || !y || Math.abs(y - sugg.year) <= 1;
  };
  return exact.find(yearOk) || exact[0] || loose.find(yearOk) || loose[0] || null;
}

// Résout les titres proposés par le LLM sur IGDB. Le endpoint /multiquery ne
// supporte pas `search`, et 20 requêtes search séparées exploseraient le
// rate-limit IGDB (4 req/s) : on fait donc UNE requête « le nom contient un
// des titres » (insensible à la casse), puis un rattrapage `search` individuel
// (fuzzy), séquentiel et plafonné, pour les seuls titres non trouvés.
// Un titre halluciné par le LLM ne matche rien et est silencieusement jeté.
async function resolveOnIgdb(suggestions, { platClause, excludeSet }) {
  const withNames = suggestions.filter((s) => s.name.length >= 2);
  if (!withNames.length) return [];

  const or = withNames.map((s) => `name ~ *"${igdbEscape(s.name)}"*`).join(" | ");
  let pool = [];
  try {
    pool = await igdbQuery(
      "games",
      `${RECO_FIELDS}; where (${or}) & cover != null & version_parent = null & game_type = (0,4,8,9)${platClause}; limit 250;`
    );
  } catch {
    /* on tentera le rattrapage individuel */
  }

  const resolved = [];
  const seen = new Set();
  const unmatched = [];

  const keep = (sugg, pick) => {
    if (!pick || excludeSet.has(pick.id) || seen.has(pick.id)) return;
    seen.add(pick.id);
    resolved.push({ ...discoverGame(pick), reason: sugg.reason || null });
  };

  for (const sugg of withNames) {
    const pick = pickCandidate(sugg, pool);
    if (pick) keep(sugg, pick);
    else unmatched.push(sugg);
  }

  for (const sugg of unmatched.slice(0, 8)) {
    let found = [];
    try {
      found = await igdbQuery(
        "games",
        `search "${igdbEscape(sugg.name)}"; ${RECO_FIELDS}; where cover != null & version_parent = null & game_type = (0,4,8,9)${platClause}; limit 4;`
      );
    } catch {
      continue;
    }
    keep(sugg, pickCandidate(sugg, found));
    // Petite pause : reste sous les 4 requêtes/seconde d'IGDB.
    await new Promise((r) => setTimeout(r, 150));
  }

  return resolved;
}

router.post("/recommend", requireAuth, async (req, res) => {
  try {
    const seedIds = [
      ...new Set((req.body.gameIds || []).map(Number).filter(Number.isInteger)),
    ].slice(0, 3);
    if (!seedIds.length) {
      return res.status(400).json({ error: "Choisis au moins un jeu." });
    }
    const platIds = [
      ...new Set((req.body.platforms || []).map(Number).filter(Number.isInteger)),
    ].slice(0, 20);

    // 1. Contexte des jeux de départ (genres nommés + résumé pour le LLM,
    //    similar_games/thèmes pour le repli IGDB) + noms des plateformes.
    const [seeds, plats] = await Promise.all([
      igdbQuery(
        "games",
        `fields name,cover.image_id,summary,first_release_date,genres.name,themes,similar_games; where id = (${seedIds.join(",")});`
      ),
      platIds.length
        ? igdbQuery(
            "platforms",
            `fields name,abbreviation; where id = (${platIds.join(",")});`
          ).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (!seeds.length) {
      return res.status(404).json({ error: "Jeux introuvables sur IGDB." });
    }

    const genres = new Map();
    const themes = new Map();
    const similar = new Set();
    for (const s of seeds) {
      for (const g of s.genres || []) genres.set(g.id, (genres.get(g.id) || 0) + 1);
      for (const id of s.themes || []) themes.set(id, (themes.get(id) || 0) + 1);
      for (const id of s.similar_games || []) similar.add(id);
    }

    // On écarte les jeux de départ, la bibliothèque (découverte) et les jeux
    // déjà passés d'un swipe gauche (« je ne veux plus jamais le revoir »).
    const [owned, skips] = await Promise.all([
      UserGame.find({ user: req.userId }).select("gameId name").lean(),
      GemSkip.find({ user: req.userId }).select("gameId").lean(),
    ]);
    const excludeSet = new Set([
      ...seedIds,
      ...skips.map((s) => s.gameId),
      ...owned.map((o) => o.gameId),
    ]);
    const exclude = [...excludeSet].slice(0, 450);

    const platClause = platIds.length ? ` & platforms = (${platIds.join(",")})` : "";
    const excludeClause = ` & id != (${exclude.join(",")})`;

    // 2. Moteur principal : Gemini. Toute erreur (pas de clé, quota, réseau,
    //    JSON invalide) fait retomber en silence sur le moteur IGDB.
    let results = [];
    if (isGeminiConfigured()) {
      try {
        const seen = llmSeen(
          `${req.userId}:${[...seedIds].sort().join("-")}:${[...platIds].sort().join("-")}`
        );
        const ownedNames = owned.map((o) => o.name).filter(Boolean).slice(-60);
        const avoid = [...new Set([...seen.names, ...ownedNames])].slice(0, 120);
        const suggestions = await llmSuggest(
          seeds,
          plats.map((p) => p.name),
          avoid
        );
        seen.names.push(...suggestions.map((s) => s.name));
        if (seen.names.length > 200)
          seen.names.splice(0, seen.names.length - 200);
        results = await resolveOnIgdb(suggestions, { platClause, excludeSet });
        console.log(
          `gems: ${results.length}/${suggestions.length} propositions Gemini résolues sur IGDB`
        );
      } catch (err) {
        console.error("gemini recommend error:", err.message);
      }
    }
    const llmCount = results.length;

    // 3. Repli / complément IGDB : si le LLM est indisponible ou n'a pas
    //    donné assez de jeux valides, on complète (strict puis assoupli).
    if (results.length < 5) {
      const ctx = { similar, genres, themes, platClause, excludeClause };
      let pool = await igdbGemPools(ctx, { strict: true }).catch(() => []);
      if (pool.length < 5) {
        const relaxed = await igdbGemPools(ctx, { strict: false }).catch(() => []);
        pool = [...pool, ...relaxed];
      }
      const have = new Set(results.map((g) => g.id));
      for (const g of pool) {
        if (have.has(g.id) || excludeSet.has(g.id)) continue;
        have.add(g.id);
        results.push(g);
      }
    }

    results = results.slice(0, 15);

    // Journal pour le fil des abonnés : une carte par jour, mise à jour à
    // chaque nouvelle fournée (best-effort, ne bloque pas la réponse). On garde
    // aussi les pépites obtenues : les abonnés peuvent les parcourir.
    const day = new Date().toISOString().slice(0, 10);
    GemDiscovery.findOneAndUpdate(
      { user: req.userId, day },
      {
        $set: {
          seeds: seeds.map((s) => ({
            gameId: s.id,
            name: s.name,
            cover: s.cover?.image_id ? `${IMG}/t_cover_big/${s.cover.image_id}.jpg` : null,
          })),
          games: results.map((g) => ({
            gameId: g.id,
            name: g.name,
            cover: g.cover,
            rating: g.rating,
            year: g.year,
            genres: (g.genres || []).slice(0, 2),
          })),
        },
        $inc: { count: 1 },
      },
      { upsert: true }
    ).catch(() => {});

    res.json({
      games: results,
      seeds: seeds.map((s) => ({ id: s.id, name: s.name })),
      // « gemini » dès que le LLM a fourni au moins une pépite (le reste peut
      // être complété par le moteur IGDB), « igdb » pour le repli pur.
      engine: llmCount > 0 ? "gemini" : "igdb",
    });
  } catch (err) {
    console.error("recommend error:", err.message);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Erreur lors de la génération des recommandations." });
  }
});

// POST /api/feed/gems/skip — swipe gauche : ne plus JAMAIS proposer ce jeu.
router.post("/gems/skip", requireAuth, async (req, res) => {
  const gameId = Number(req.body.gameId);
  if (!Number.isInteger(gameId)) {
    return res.status(400).json({ error: "gameId invalide." });
  }
  try {
    await GemSkip.updateOne(
      { user: req.userId, gameId },
      { $setOnInsert: { user: req.userId, gameId } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("gems skip error:", err.message);
    res.status(500).json({ error: "Impossible d'écarter ce jeu." });
  }
});

// GET /api/feed/gems/:id — détail d'une découverte du fil : les pépites
// obtenues + le statut actuel de CE joueur sur chacune (wishlist, en cours…).
router.get("/gems/:id", requireAuth, async (req, res) => {
  try {
    const disco = await GemDiscovery.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!disco) return res.status(404).json({ error: "Découverte introuvable." });

    const ids = (disco.games || []).map((g) => g.gameId);
    const entries = ids.length
      ? await UserGame.find({ user: disco.user._id, gameId: { $in: ids } })
          .select("gameId status")
          .lean()
      : [];
    const statusById = new Map(entries.map((e) => [e.gameId, e.status]));

    res.json({
      user: person(disco.user),
      date: disco.updatedAt,
      count: disco.count || 1,
      seeds: (disco.seeds || []).map((s) => ({
        id: s.gameId,
        name: s.name,
        cover: s.cover || null,
      })),
      games: (disco.games || []).map((g) => ({
        id: g.gameId,
        name: g.name,
        cover: g.cover || null,
        rating: g.rating ?? null,
        year: g.year ?? null,
        genres: g.genres || [],
        ownerStatus: statusById.get(g.gameId) || null,
      })),
    });
  } catch (err) {
    console.error("gems detail error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des pépites." });
  }
});

export default router;
