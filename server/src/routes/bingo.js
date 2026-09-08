import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

import EventBingo from "../models/EventBingo.js";
import GameEvent from "../models/GameEvent.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveMentions, sanitizeMediaList, toComment } from "../lib/commentThread.js";
import { notify } from "../lib/notify.js";
import { privacyOf } from "../lib/privacy.js";

const router = express.Router();

// ======================================================================
//  LES GRILLES DE BINGO D'UN RENDEZ-VOUS
// ======================================================================
// Le modèle porte la règle du jeu et la raison d'être (cf. models/EventBingo).
// Ce fichier porte les DEUX GARDES qui la rendent vraie :
//
//   • avant le début, on compose et on ne coche pas ;
//   • après le début, on coche et on ne compose plus.
//
// ⚠️ ELLES SE DÉDUISENT DE L'HEURE DE L'ÉVÉNEMENT, JAMAIS D'UN CHAMP. Un
// drapeau « verrouillée » posé en base demanderait un travail de fond pour le
// retourner à l'heure dite ; le jour où ce travail ne tourne pas, tout le monde
// peut composer sa grille pendant l'émission, en regardant les annonces
// tomber. La règle doit tenir toute seule, à la lecture de l'horloge.

const MAX_TEXT = 300; // même limite que le fil de commentaires des listes

// --- Upload des images de case ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINGO_DIR = path.join(__dirname, "../../uploads/bingo");
fs.mkdirSync(BINGO_DIR, { recursive: true });

const cellUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, BINGO_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `b-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 Mo
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// ----------------------------------------------------------------------
//  Les deux âges d'une grille
// ----------------------------------------------------------------------
// ⚠️ LA BASCULE EST L'HEURE DE DÉBUT, MÊME QUAND ON NE LA CONNAÎT QU'AU JOUR
// PRÈS. Une entrée datée au jour près est enregistrée à minuit UTC : la grille
// se fige donc au petit matin du jour J, avant le vrai début. C'est le sens qui
// va dans le bon sens — on préfère fermer un peu trop tôt que laisser quelqu'un
// écrire son pronostic une fois l'annonce faite.
const startedAt = (ev) => new Date(ev.startsAt).getTime();
const hasStarted = (ev, now = Date.now()) => {
  const ts = startedAt(ev);
  return !Number.isNaN(ts) && now >= ts;
};

function serializeCells(cells, size) {
  const byIndex = new Map((cells || []).map((c) => [c.index, c]));
  // ⚠️ ON REND TOUJOURS UN TABLEAU DENSE. Le client dessine une grille : il lui
  // faut `size * size` cases, y compris celles que personne n'a remplies. Lui
  // laisser reconstituer les trous, c'est un `size` mal lu quelque part et une
  // grille de travers.
  return Array.from({ length: size * size }, (_, i) => {
    const c = byIndex.get(i);
    return {
      index: i,
      text: c?.text || "",
      image: c?.image || null,
      gameId: c?.gameId ?? null,
      gameName: c?.gameName || "",
      free: !!c?.free,
      checked: !!c?.checked || !!c?.free,
      checkedAt: c?.checkedAt || null,
    };
  });
}

function serialize(grid, userId, { withComments = false } = {}) {
  const cells = serializeCells(grid.cells, grid.size);
  const filled = cells.filter((c) => c.text || c.image || c.free).length;
  const author = grid.user && grid.user.username ? grid.user : null;
  return {
    id: String(grid._id),
    eventId: String(grid.event),
    title: grid.title || "",
    size: grid.size,
    cells,
    filled,
    checked: cells.filter((c) => c.checked).length,
    published: !!grid.published,
    publishedAt: grid.publishedAt || null,
    createdAt: grid.createdAt,
    updatedAt: grid.updatedAt,
    author: author
      ? { id: String(author._id), username: author.username, avatar: author.avatar || null }
      : { id: String(grid.user), username: null, avatar: null },
    mine: String(grid.user?._id || grid.user) === String(userId),
    likeCount: (grid.likes || []).length,
    liked: (grid.likes || []).some((u) => String(u) === String(userId)),
    commentCount: (grid.comments || []).length,
    ...(withComments
      ? { comments: (grid.comments || []).map((c) => toComment(c, grid.comments || [], userId)) }
      : null),
  };
}

/** Normalise ce que le client envoie : on ne fait confiance à rien. */
function sanitizeCells(raw, size) {
  const arr = Array.isArray(raw) ? raw : [];
  const total = size * size;
  // Le centre d'une grille impaire, la case offerte du bingo.
  const center = size % 2 === 1 ? Math.floor(total / 2) : -1;
  const out = [];
  for (let i = 0; i < total; i++) {
    const c = arr.find((x) => Number(x?.index) === i) || arr[i] || {};
    const free = i === center && !!c.free;
    const text = String(c.text || "").trim().slice(0, 120);
    const image = typeof c.image === "string" && c.image.trim() ? c.image.trim().slice(0, 1000) : null;
    if (!text && !image && !free) continue; // une case vide ne pèse rien en base
    out.push({
      index: i,
      text,
      image,
      gameId: Number.isFinite(Number(c.gameId)) && c.gameId != null ? Number(c.gameId) : null,
      gameName: String(c.gameName || "").slice(0, 120),
      free,
    });
  }
  return out;
}

// ============================================================
//  POST /api/bingo/media — une image de case, depuis le téléphone
// ============================================================
router.post("/media", requireAuth, cellUpload.single("media"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
  const url = `${req.protocol}://${req.get("host")}/uploads/bingo/${req.file.filename}`;
  res.status(201).json({ url });
});

// ============================================================
//  GET /api/bingo/event/:eventId — ma grille, et celles des autres
// ============================================================
// ⚠️ UNE SEULE ROUTE POUR LES DEUX, PARCE QUE C'EST UN SEUL ÉCRAN. La page d'un
// rendez-vous montre « ta grille » et « celles de ton cercle » l'une sous
// l'autre : deux appels, ce sont deux temps de chargement, et une section qui
// apparaît une seconde après l'autre sous le doigt de quelqu'un qui défile.
router.get("/event/:eventId", requireAuth, async (req, res) => {
  try {
    const ev = await GameEvent.findById(req.params.eventId).select("startsAt precision name").lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });

    const [mine, others, me] = await Promise.all([
      EventBingo.findOne({ event: ev._id, user: req.userId })
        .populate("user", "username avatar")
        .lean(),
      EventBingo.find({ event: ev._id, published: true, user: { $ne: req.userId } })
        .populate("user", "username avatar privacy")
        .sort({ createdAt: -1 })
        .limit(120)
        .lean(),
      User.findById(req.userId).select("following").lean(),
    ]);

    const following = new Set((me?.following || []).map(String));
    const visible = others.filter((g) => {
      // Un compte privé ne s'expose pas à toute l'application parce qu'il a
      // rempli une grille : elle ne sort que vers ses abonnés.
      if (!privacyOf(g.user).isPrivate) return true;
      return following.has(String(g.user?._id));
    });

    // ⚠️ LE CERCLE D'ABORD, LES POPULAIRES ENSUITE. « Les grilles de mes amis »
    // est la promesse de la section ; un classement par likes seul la
    // remplacerait par un palmarès, où l'on ne retrouve jamais la grille de la
    // personne pour qui on est venu.
    visible.sort((a, b) => {
      const fa = following.has(String(a.user?._id)) ? 1 : 0;
      const fb = following.has(String(b.user?._id)) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      const la = (a.likes || []).length;
      const lb = (b.likes || []).length;
      if (la !== lb) return lb - la;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json({
      // Ce que le client a besoin de savoir pour dessiner les bons boutons,
      // sans avoir à refaire le calcul d'horloge de son côté.
      started: hasStarted(ev),
      startsAt: ev.startsAt,
      mine: mine ? serialize(mine, req.userId) : null,
      grids: visible.slice(0, 40).map((g) => serialize(g, req.userId)),
      total: visible.length,
    });
  } catch (err) {
    console.error("bingo list error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des grilles." });
  }
});

// ============================================================
//  PUT /api/bingo/event/:eventId — composer (ou recomposer) sa grille
// ============================================================
// Un `PUT` idempotent plutôt qu'un `POST` puis des `PATCH` : l'éditeur du
// téléphone tient la grille entière en mémoire et l'envoie telle quelle. Deux
// enregistrements qui se croisent donnent alors le dernier état voulu, pas un
// mélange des deux.
router.put("/event/:eventId", requireAuth, async (req, res) => {
  try {
    const ev = await GameEvent.findById(req.params.eventId).select("startsAt precision").lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });
    if (hasStarted(ev))
      return res.status(403).json({ error: "L'événement a commencé : la grille est figée." });

    const size = Math.min(5, Math.max(2, Number(req.body?.size) || 3));
    const cells = sanitizeCells(req.body?.cells, size);
    if (!cells.length) return res.status(400).json({ error: "Une grille vide ne se poste pas." });

    const title = String(req.body?.title || "").trim().slice(0, 80);
    const published = req.body?.published === true;

    // ⚠️ `upsert` PLUTÔT QU'UN « CHERCHE PUIS CRÉE ». L'index unique
    // (event, user) refuserait la seconde de deux créations concurrentes, et
    // l'utilisateur verrait une erreur pour avoir appuyé deux fois.
    const existing = await EventBingo.findOne({ event: ev._id, user: req.userId }).lean();
    const grid = await EventBingo.findOneAndUpdate(
      { event: ev._id, user: req.userId },
      {
        $set: {
          title,
          size,
          cells,
          published,
          // La date de publication ne bouge plus une fois posée : c'est celle
          // de la première fois qu'on l'a montrée, et une grille retouchée
          // n'est pas une grille nouvelle.
          publishedAt: published ? existing?.publishedAt || new Date() : null,
        },
        $setOnInsert: { event: ev._id, user: req.userId },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).populate("user", "username avatar");

    res.json({ grid: serialize(grid.toObject(), req.userId) });
  } catch (err) {
    console.error("bingo save error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la grille." });
  }
});

// ============================================================
//  GET /api/bingo/:id — une grille, commentaires compris
// ============================================================
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id)
      .populate("user", "username avatar privacy")
      .populate("comments.user", "username avatar")
      .lean();
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });

    const mine = String(grid.user?._id || grid.user) === String(req.userId);
    // Un brouillon n'appartient qu'à son auteur : personne ne lit un pronostic
    // que son auteur n'a pas encore décidé de montrer.
    if (!mine && !grid.published) return res.status(403).json({ error: "Grille non publiée." });
    if (!mine && privacyOf(grid.user).isPrivate) {
      const follows = await User.exists({ _id: req.userId, following: grid.user._id });
      if (!follows) return res.status(403).json({ error: "Compte privé." });
    }

    const ev = await GameEvent.findById(grid.event)
      .select("name startsAt precision endsAt durationMin image brand logo kind")
      .lean();

    res.json({
      grid: serialize(grid, req.userId, { withComments: true }),
      started: ev ? hasStarted(ev) : true,
      event: ev
        ? {
            id: String(ev._id),
            name: ev.name,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt || null,
            durationMin: ev.durationMin || null,
            precision: ev.precision || "day",
            image: ev.image || null,
            brand: ev.brand || null,
            logo: ev.logo || null,
            kind: ev.kind || "showcase",
          }
        : null,
    });
  } catch (err) {
    res.status(404).json({ error: "Grille introuvable." });
  }
});

// ============================================================
//  POST /api/bingo/:id/publish — montrer, ou remettre au brouillon
// ============================================================
router.post("/:id/publish", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });
    if (String(grid.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });

    const want = req.body?.published !== false;
    grid.published = want;
    if (want && !grid.publishedAt) grid.publishedAt = new Date();
    if (!want) grid.publishedAt = null;
    await grid.save();
    res.json({ published: want });
  } catch (err) {
    console.error("bingo publish error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  POST /api/bingo/:id/check — cocher une case, pendant l'émission
// ============================================================
// ⚠️ UNE CASE À LA FOIS, ET LE CLIENT DIT L'ÉTAT VOULU. Le geste est fait dans
// l'excitation d'une annonce, souvent deux fois de suite : un serveur qui
// « inverse l'état actuel » laisserait alors la case dans l'état inverse de ce
// qu'on voit à l'écran. C'est la même règle que la cloche d'un événement.
router.post("/:id/check", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });
    if (String(grid.user) !== String(req.userId))
      return res.status(403).json({ error: "Ce n'est pas ta grille." });

    const ev = await GameEvent.findById(grid.event).select("startsAt precision").lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });
    if (!hasStarted(ev))
      return res.status(403).json({ error: "L'événement n'a pas commencé." });

    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0 || index >= grid.size * grid.size)
      return res.status(400).json({ error: "Case inconnue." });

    const cell = grid.cells.find((c) => c.index === index);
    if (!cell) return res.status(404).json({ error: "Case vide." });
    if (cell.free) return res.json({ index, checked: true }); // la case offerte ne se décoche pas

    const want = req.body?.checked !== false;
    cell.checked = want;
    cell.checkedAt = want ? new Date() : null;
    await grid.save();

    const checked = grid.cells.filter((c) => c.checked || c.free).length;
    res.json({ index, checked: want, checkedCount: checked });
  } catch (err) {
    console.error("bingo check error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  POST /api/bingo/:id/like
// ============================================================
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });
    if (!grid.published && String(grid.user) !== String(req.userId))
      return res.status(403).json({ error: "Grille non publiée." });

    const uid = String(req.userId);
    const has = grid.likes.some((u) => String(u) === uid);
    if (has) grid.likes = grid.likes.filter((u) => String(u) !== uid);
    else grid.likes.push(req.userId);
    await grid.save();

    if (!has) {
      notify({
        user: grid.user,
        type: "bingo_like",
        actor: req.userId,
        bingo: grid._id,
        snippet: grid.title,
      });
    }
    res.json({ liked: !has, likeCount: grid.likes.length });
  } catch (err) {
    console.error("bingo like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  DELETE /api/bingo/:id
// ============================================================
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id).select("user").lean();
    if (!grid) return res.json({ ok: true });
    if (String(grid.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    await EventBingo.deleteOne({ _id: grid._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  LE FIL DE COMMENTAIRES
// ======================================================================
// ⚠️ EXACTEMENT CELUI DES LISTES, ET PAS UNE VARIANTE. Même schéma
// (cf. models/List, `commentSchema`), mêmes règles (médias, mentions, deux
// modifications maximum), mêmes réponses JSON — c'est ce qui permet au
// téléphone de rebrancher LE MÊME composant sur une autre adresse plutôt que
// d'en écrire un second qui dériverait au premier correctif.

async function loadForComment(req, res) {
  const grid = await EventBingo.findById(req.params.id);
  if (!grid) {
    res.status(404).json({ error: "Grille introuvable." });
    return null;
  }
  if (!grid.published && String(grid.user) !== String(req.userId)) {
    res.status(403).json({ error: "Grille non publiée." });
    return null;
  }
  return grid;
}

router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0) return res.status(400).json({ error: "Message vide." });

    const grid = await loadForComment(req, res);
    if (!grid) return undefined;

    // Un seul niveau d'imbrication : répondre à une réponse vise le même
    // parent qu'elle (même règle que les listes).
    let parent = null;
    let replyTargetUser = null;
    if (req.body?.parent) {
      const p = grid.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    grid.comments.push({
      user: req.userId,
      text: text.slice(0, MAX_TEXT),
      media,
      mentions,
      parent,
      createdAt: new Date(),
    });
    await grid.save();
    await grid.populate("comments.user", "username avatar");
    const c = grid.comments[grid.comments.length - 1];

    const recipients = new Map();
    const actorStr = String(req.userId);
    const add = (uid, type) => {
      if (!uid) return;
      const s = String(uid);
      if (s === actorStr || recipients.has(s)) return;
      recipients.set(s, type);
    };
    if (replyTargetUser) add(replyTargetUser, "bingo_comment_reply");
    mentions.forEach((m) => add(m.user, "mention"));
    add(grid.user, "bingo_comment");
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({ user: uid, type, actor: req.userId, bingo: grid._id, comment: c._id, snippet });
    }

    res.status(201).json({ comment: toComment(c, grid.comments, req.userId) });
  } catch (err) {
    console.error("bingo comment error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

router.put("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });
    const c = grid.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    if (String(c.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if ((c.editCount || 0) >= 2)
      return res.status(403).json({ error: "Limite de modifications atteinte (2)." });

    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0) return res.status(400).json({ error: "Message vide." });

    c.history.push({ text: c.text, media: c.media, at: new Date() });
    c.text = text.slice(0, MAX_TEXT);
    c.media = media;
    c.mentions = await resolveMentions(text);
    c.editCount = (c.editCount || 0) + 1;
    c.editedAt = new Date();

    await grid.save();
    await grid.populate("comments.user", "username avatar");
    res.json({ comment: toComment(grid.comments.id(req.params.commentId), grid.comments, req.userId) });
  } catch (err) {
    console.error("bingo comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

router.post("/:id/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.status(404).json({ error: "Grille introuvable." });
    const c = grid.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });

    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await grid.save();

    if (!has) {
      notify({
        user: c.user,
        type: "bingo_comment_like",
        actor: req.userId,
        bingo: grid._id,
        comment: c._id,
        snippet: c.text,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("bingo comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

router.delete("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const grid = await EventBingo.findById(req.params.id);
    if (!grid) return res.json({ ok: true });
    const c = grid.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    // L'auteur du commentaire, ou celui de la grille : chez soi, on fait le
    // ménage.
    if (String(c.user) !== String(req.userId) && String(grid.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await grid.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
