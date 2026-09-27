import express from "express";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import List from "../models/List.js";
import Activity from "../models/Activity.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { isUserAdmin } from "../lib/admin.js";
import { notify } from "../lib/notify.js";
import {
  recordActivity,
  removeActivity,
  recordListItemsActivity,
} from "../lib/activity.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";
import EventBingo from "../models/EventBingo.js";
import GameEvent from "../models/GameEvent.js";
import { gridsForEvent } from "../lib/eventGrids.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { nineSuggestions } from "../lib/nineSuggest.js";
import { boardKey, boardSlot, cleanBoardItems } from "../lib/boards.js";
import { ensureGameMeta } from "../lib/gameMeta.js";
import { igdbQuery } from "../lib/igdb.js";
import { similarGames } from "../lib/recoEngine.js";

const router = express.Router();

const TYPES = ["classic", "ranked", "tier", "playlist"];

// « Le principe des 9 » (cf. models/List, champ `nine`). Neuf jeux, pas un de
// plus : c'est la règle du jeu, et la grille 3 × 3 qui l'affiche n'a pas de
// dixième case.
const NINE_MAX = 9;
const nineKey = (raw) => {
  const k = String(raw || "").trim().toLowerCase();
  return /^[a-z0-9-]{2,32}$/.test(k) ? k : null;
};
const TOO_MANY_NINE = "Une liste des 9 contient neuf jeux, pas un de plus.";
const VISIBILITIES = ["public", "private"];
const ITEM_KINDS = ["game", "character", "ost"];

// Kind d'item attendu pour une liste (itemKind "ost" ⇔ items "track").
const expectedKind = (list) =>
  (list.itemKind || "game") === "ost" ? "track" : list.itemKind || "game";

// --- Upload d'images de réaction (commentaires) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMENTS_DIR = path.join(__dirname, "../../uploads/comments");
fs.mkdirSync(COMMENTS_DIR, { recursive: true });

const commentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, COMMENTS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `c-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// --- Upload des couvertures de liste ---
const COVERS_DIR = path.join(__dirname, "../../uploads/lists");
fs.mkdirSync(COVERS_DIR, { recursive: true });

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, COVERS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `l-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// Paliers par défaut d'une nouvelle tier list (esprit S/A/B/C/D).
const DEFAULT_TIERS = [
  { id: "s", label: "S", color: "#ff5470" },
  { id: "a", label: "A", color: "#ff8b3d" },
  { id: "b", label: "B", color: "#f2b70b" },
  { id: "c", label: "C", color: "#3dd68c" },
  { id: "d", label: "D", color: "#4aa8ff" },
];

// Normalise un élément reçu du client (on ne fait pas confiance au brut).
function sanitizeItem(raw) {
  if (!raw || raw.refId == null || !raw.name) return null;
  const kind =
    raw.kind === "character" ? "character" : raw.kind === "track" ? "track" : "game";
  const rating =
    raw.rating == null || raw.rating === ""
      ? null
      : Math.max(0, Math.min(100, Number(raw.rating) || 0));
  return {
    kind,
    refId: String(raw.refId),
    gameId: raw.gameId != null ? Number(raw.gameId) || null : null,
    gameName: raw.gameName ? String(raw.gameName).slice(0, 200) : null,
    name: String(raw.name).slice(0, 200),
    image: raw.image ? String(raw.image) : null,
    // Piste d'OST : de quoi la rejouer (YouTube) + infos affichées.
    videoId: kind === "track" && raw.videoId ? String(raw.videoId).slice(0, 20) : null,
    url: kind === "track" && raw.url ? String(raw.url).slice(0, 500) : null,
    artist: kind === "track" && raw.artist ? String(raw.artist).slice(0, 200) : null,
    releaseYear:
      kind === "track" && raw.releaseYear ? Number(raw.releaseYear) || null : null,
    durationSec:
      kind === "track" && raw.durationSec ? Number(raw.durationSec) || null : null,
    note: raw.note ? String(raw.note).slice(0, 500) : "",
    media: sanitizeMediaList(raw.media),
    rating,
    tier: raw.tier ? String(raw.tier) : null,
    slot: raw.slot ? String(raw.slot).slice(0, 32) : null,
    charName: raw.charName ? String(raw.charName).slice(0, 120) : null,
    charImage: raw.charImage ? String(raw.charImage).slice(0, 600) : null,
  };
}

// Tags d'une liste : 8 au plus, 24 caractères chacun, sans doublon (casse
// ignorée). La première écriture d'un tag fait foi pour son affichage.
export function sanitizeTags(raw) {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const tag = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
    const k = tag.toLowerCase();
    if (!tag || seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeTiers(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((t) => t && t.id)
    .slice(0, 12)
    .map((t) => ({
      id: String(t.id).slice(0, 40),
      label: String(t.label ?? "").slice(0, 24),
      color: /^#[0-9a-fA-F]{3,8}$/.test(t.color || "") ? t.color : "#f2b70b",
    }));
}

// Durée totale d'écoute d'une playlist : durées iTunes connues + 4 min par
// défaut pour les pistes sans info. `durationEstimated` dès qu'il en manque.
export function playlistDuration(items) {
  if (!items.length) return { durationSec: 0, durationEstimated: false };
  const known = items.filter((i) => i.durationSec > 0);
  return {
    durationSec:
      known.reduce((s, i) => s + i.durationSec, 0) +
      (items.length - known.length) * 240,
    durationEstimated: known.length < items.length,
  };
}

// Événement d'origine d'une liste officielle (null pour une liste de joueur).
// Même forme côté carte et côté détail : la page en a besoin pour la rediff,
// la carte pour son bandeau de date.
function toEvent(l) {
  if (!l.event?.igdbId) return null;
  return {
    igdbId: l.event.igdbId,
    name: l.event.name || null,
    startTime: l.event.startTime || null,
    logo: l.event.logo || null,
    videoUrl: l.event.videoUrl || null,
    videoId: l.event.videoId || null,
    // ⚠️ RENSEIGNÉS PAR LA SEULE PAGE DE DÉTAIL (cf. GET /:id). Les compter sur
    // chaque carte d'un fil de listes ferait une requête de bingo par vignette,
    // pour une pastille que la carte n'affiche pas.
    eventId: null,
    gridCount: 0,
  };
}

// ----------------------------------------------------------------------
//  Les grilles de bingo d'une liste d'événement
// ----------------------------------------------------------------------
// ⚠️ LE RENDEZ-VOUS ET SA LISTE SONT DEUX DOCUMENTS, RELIÉS PAR L'ID IGDB.
// `GameEvent` porte le compte à rebours et les grilles ; `List` porte les jeux
// annoncés. Rien ne les liait : une fois l'émission finie, la fiche du
// rendez-vous sort de l'accueil, et les grilles que tout le monde a remplies
// devenaient introuvables — alors que la liste, elle, reste dans l'explorateur
// pour toujours. C'est donc par elle qu'on y revient.
async function eventOfList(list) {
  if (!list?.event?.igdbId) return null;
  return GameEvent.findOne({ igdbEventId: list.event.igdbId })
    .select("_id name startsAt precision")
    .lean();
}

// Une liste publiée par le site : top, palmarès ou conférence.
const isOfficialList = (l) => !!(l.official?.key || l.event?.igdbId);

// Un admin peut changer l'image d'une liste officielle — et de rien d'autre :
// les listes des joueurs restent à leurs auteurs.
async function adminOnOfficial(req, list) {
  if (!isOfficialList(list)) return false;
  const me = await User.findById(req.userId).select("isAdmin isSuperAdmin").lean();
  return isUserAdmin(me);
}

// Marqueur d'une liste officielle (top ou cérémonie), null sinon.
function toOfficial(l) {
  if (!l.official?.key) return null;
  // `key` : les cartes des tops s'habillent d'après lui (couleur, console ou
  // héros de la saga, cf. client lib/topThemes).
  return { kind: l.official.kind, group: l.official.group || null, key: l.official.key };
}

// Auteur d'une liste. `isSystem` distingue le compte officiel du site pour lui
// coller sa pastille de compte vérifié.
function toAuthor(u) {
  if (!u) return null;
  return {
    id: u._id,
    username: u.username,
    avatar: u.avatar || null,
    isSystem: !!u.isSystem,
  };
}

// Vue "carte" (feed) : légère, sans les items complets.
function toCard(l, userId) {
  const items = l.items || [];
  return {
    event: toEvent(l),
    official: toOfficial(l),
    tags: l.tags || [],
    ...(l.type === "playlist" ? playlistDuration(items) : {}),
    id: l._id,
    title: l.title,
    description: l.description,
    cover: l.cover || null,
    coverDesign: l.coverDesign || null,
    type: l.type,
    itemKind: l.itemKind || "game",
    nine: l.nine || null,
    board: l.board || null,
    // Une grille se montre entière sur sa carte (profil, page Listes) : ses
    // cases, dans l'ordre, avec le perso des cases qui en ont un.
    ...(l.board
      ? {
          boardItems: items.map((i) => ({
            slot: i.slot,
            refId: i.refId,
            name: i.name,
            image: i.image,
            charName: i.charName || null,
            charImage: i.charImage || null,
          })),
        }
      : {}),
    visibility: l.visibility,
    author: toAuthor(l.user),
    mine: userId ? String(l.user?._id || l.user) === String(userId) : false,
    itemCount: items.length,
    // Aperçu : les premières images pour un montage visuel (jusqu'à 8 pour
    // laisser respirer l'éventail des listes classées — 9 pour une liste des
    // 9, dont la carte montre la grille entière).
    preview: items
      .filter((i) => i.image)
      .slice(0, l.nine ? NINE_MAX : 8)
      .map((i) => i.image),
    // Les entrées de l'aperçu au complet (identifiant, nom, image), dans
    // l'ordre de la liste. L'app en fait une SECTION de profil — un rayon de
    // jaquettes comme « Jeux favoris » —, ce qui demande le nom en plus de
    // l'image. `preview` et `previewIds` restent pour le site et les cartes.
    previewItems: items
      .filter((i) => i.image)
      .slice(0, 8)
      .map((i) => ({ refId: i.refId ?? null, name: i.name || "", image: i.image })),
    // Les jeux DE cet aperçu, dans le même ordre. L'app mobile en a besoin
    // pour retrouver le fond d'écran d'un jeu (celui que le joueur a choisi,
    // sinon celui du catalogue) : sur une liste d'un ou deux jeux, elle
    // montre les fonds plutôt que les jaquettes, qu'il faudrait sinon étirer
    // au point de les rendre méconnaissables.
    previewIds: items
      .filter((i) => i.image)
      .slice(0, 8)
      .map((i) => i.refId ?? null),
    // Aperçu de tier list : quelques images regroupées par palier (dans
    // l'ordre des paliers), pour un mini-rendu de la grille sur la carte.
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
    liked: userId
      ? (l.likes || []).some((u) => String(u) === String(userId))
      : false,
    commentCount: (l.comments || []).length,
    listenCount: l.listenCount || 0,
    updatedAt: l.updatedAt,
    createdAt: l.createdAt,
  };
}

// Vue complète (page détail).
function toFull(l, userId) {
  return {
    id: l._id,
    title: l.title,
    description: l.description,
    cover: l.cover || null,
    coverDesign: l.coverDesign || null,
    type: l.type,
    itemKind: l.itemKind || "game",
    nine: l.nine || null,
    board: l.board || null,
    visibility: l.visibility,
    author: toAuthor(l.user),
    event: toEvent(l),
    official: toOfficial(l),
    tags: l.tags || [],
    awards: (l.awards || []).map((a) => ({
      category: a.category,
      main: !!a.main,
      winner: a.winner,
      person: a.person || null,
      nominees: a.nominees || [],
    })),
    mine: userId ? String(l.user?._id || l.user) === String(userId) : false,
    items: (l.items || []).map((i) => ({
      _id: i._id,
      kind: i.kind,
      refId: i.refId,
      gameId: i.gameId,
      gameName: i.gameName,
      name: i.name,
      image: i.image,
      videoId: i.videoId || null,
      url: i.url || null,
      artist: i.artist || null,
      releaseYear: i.releaseYear || null,
      durationSec: i.durationSec || null,
      note: i.note,
      media: i.media || [],
      rating: i.rating,
      tier: i.tier,
      slot: i.slot || null,
      charName: i.charName || null,
      charImage: i.charImage || null,
    })),
    tiers: l.tiers || [],
    likeCount: (l.likes || []).length,
    liked: userId
      ? (l.likes || []).some((u) => String(u) === String(userId))
      : false,
    comments: (l.comments || []).map((c) => toComment(c, l.comments || [], userId)),
    listenCount: l.listenCount || 0,
    updatedAt: l.updatedAt,
    createdAt: l.createdAt,
  };
}

// GET /api/lists — feed : toutes les listes publiques + mes listes.
// ?scope=mine pour n'avoir que les miennes, ?sort=likes|recent,
// ?author=<userId> pour les listes d'UN joueur (publiques sauf si c'est moi).
router.get("/", optionalAuth, async (req, res) => {
  try {
    let scope = req.query.scope;
    // « De tes abonnements » et « Pour toi » (sections de découverte de l'app) :
    // tous deux demandent un compte. Sans lui — ou sans abonnement, sans
    // bibliothèque — ils retombent sur le fil habituel plutôt que sur du vide.
    let followingIds = null;
    let forYouIds = null;
    if (scope === "following" && req.userId) {
      const me = await User.findById(req.userId).select("following").lean();
      followingIds = me?.following || [];
    }
    if (scope === "foryou" && req.userId) {
      const games = await UserGame.find({ user: req.userId })
        .sort({ rating: -1, updatedAt: -1 })
        .limit(300)
        .select("gameId")
        .lean();
      forYouIds = games.map((g) => String(g.gameId));
      if (!forYouIds.length) forYouIds = null;
    }
    if ((scope === "following" && !followingIds) || (scope === "foryou" && !forYouIds)) {
      scope = scope === "foryou" ? "" : "none";
    }
    const author =
      req.query.author && mongoose.isValidObjectId(req.query.author)
        ? req.query.author
        : null;
    const filter = author
      ? {
          user: author,
          ...(String(author) === String(req.userId)
            ? {}
            : { visibility: "public" }),
        }
      : scope === "none"
        ? { _id: null }
      : followingIds
        ? { visibility: "public", user: { $in: followingIds } }
      : forYouIds
        ? // Des listes de joueurs qui partagent des jeux avec ma bibliothèque :
          // ni les miennes, ni les listes éditées par le site.
          {
            visibility: "public",
            user: { $ne: req.userId },
            itemKind: "game",
            official: null,
            event: null,
            "items.refId": { $in: forYouIds },
          }
      : scope === "mine"
        ? { user: req.userId }
        : scope === "events"
          ? // Listes officielles adossées à un événement (Nintendo Direct,
            // Summer Game Fest…), publiées par le compte du site.
            { visibility: "public", "event.igdbId": { $exists: true } }
          : scope === "tops"
            ? // Classements officiels (Top 100 Switch, meilleurs JRPG…).
              { visibility: "public", "official.kind": "top" }
          : scope === "awards"
            ? // Les palmarès de cérémonies (The Game Awards, Spike VGA…).
              // ⚠️ ILS N'AVAIENT AUCUNE PORTE. `official.kind` vaut "top" ou
              // "awards" ; seuls les tops avaient leur portée, et les palmarès
              // se noyaient dans le fil général au milieu des listes de
              // joueurs. Or ce sont exactement les listes qu'on vient chercher
              // de tête, une fois par an et pendant des années.
              { visibility: "public", "official.kind": "awards" }
            : { $or: [{ visibility: "public" }, { user: req.userId }] };
    // Filtres optionnels : type, itemKind (jeu/perso), rayon, tag, recherche.
    if (TYPES.includes(req.query.type)) filter.type = req.query.type;
    if (ITEM_KINDS.includes(req.query.itemKind))
      filter.itemKind = req.query.itemKind;
    if (scope === "tops" && req.query.group) filter["official.group"] = String(req.query.group);
    // ?nine=<thème> : les listes des 9 d'un thème (page d'une liste des 9,
    // « les autres ») ; ?nine=any : toutes les listes des 9.
    if (req.query.nine === "any") filter.nine = { $ne: null };
    else if (nineKey(req.query.nine)) filter.nine = nineKey(req.query.nine);
    // ?board=<modèle> | any : les grilles « un jeu par case » (profil).
    if (req.query.board === "any") filter.board = { $ne: null };
    else if (boardKey(req.query.board)) filter.board = boardKey(req.query.board);
    const tag = String(req.query.tag || "").trim();
    if (tag) filter.tags = new RegExp(`^${escapeRx(tag)}$`, "i");
    const search = String(req.query.q || "").trim();
    // ⚠️ « TOUTES LES LISTES », CE SONT CELLES DES JOUEURS. Les tops, les
    // conférences, les palmarès et les cartes de joueur ont chacun leur rayon
    // ou leur onglet : les remettre dans la grille du bas les montrait deux
    // fois, et leurs dizaines de listes officielles noyaient celles des gens.
    // Tout revient dès qu'on cherche quelque chose ou qu'on filtre par tag —
    // et un rayon qui DEMANDE les cartes de joueur (?board=) ou les listes
    // des 9 (?nine=) les obtient évidemment.
    if (!scope && !author && !search && !tag && !req.query.group && !req.query.board && !req.query.nine) {
      filter.official = null;
      filter["event.igdbId"] = { $exists: false };
      filter.board = null;
    }
    if (search) {
      // La recherche fouille tout : le titre, la description, les tags, les
      // JEUX de la liste (« Hollow Knight » trouve les listes qui le
      // contiennent) et le pseudo de l'auteur.
      const rx = new RegExp(escapeRx(search), "i");
      const authors = await User.find({ username: rx }).select("_id").limit(50).lean();
      filter.$and = [
        {
          $or: [
            { title: rx },
            { description: rx },
            { tags: rx },
            { "items.name": rx },
            ...(authors.length ? [{ user: { $in: authors.map((a) => a._id) } }] : []),
          ],
        },
      ];
    }
    // ⚠️ UN PLAFOND DEMANDABLE. L'accueil n'affiche qu'une rangée des
    // dernières conférences : lui renvoyer deux cents listes peuplées pour en
    // montrer douze, c'est deux cents `populate` et un JSON de plusieurs
    // centaines de Ko à chaque ouverture du site. Sans `limit`, rien ne change
    // pour la page Listes.
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 200));
    // ?offset= : la page suivante (défilement infini de la page Listes). Sans
    // lui, on rend la première page, comme avant.
    const offset = Math.min(5000, Math.max(0, Number(req.query.offset) || 0));
    // ⚠️ UN TRI QUI SE FAIT APRÈS COUP DOIT VOIR TOUT LE MONDE. Les « j'aime »
    // et le recoupement « pour toi » se comptent en mémoire : plafonner la
    // requête d'abord, c'était ranger les douze plus récentes, pas trouver
    // les douze plus aimées.
    const late = req.query.sort === "likes" || !!forYouIds;
    const lists = await List.find(filter)
      .populate("user", "username avatar isSystem")
      // Les événements se rangent par date de diffusion (la dernière
      // conférence en tête), pas par date de mise à jour de la liste.
      .sort(
        scope === "events"
          ? { "event.startTime": -1 }
          : scope === "tops"
            ? // L'ordre éditorial : consoles, puis genres, puis sagas.
              { "official.order": 1 }
            : scope === "awards"
              ? // La dernière cérémonie en tête (`official.order` = l'année).
                { "official.order": -1 }
              : { updatedAt: -1 }
      )
      // Un de plus que demandé : c'est ce qui dit s'il reste une page.
      .skip(late ? 0 : offset)
      .limit(late ? 200 : limit + 1)
      .lean();
    let cards = lists.map((l) => toCard(l, req.userId));
    if (forYouIds) {
      const owned = new Set(forYouIds);
      const overlap = new Map(
        lists.map((l) => [
          String(l._id),
          (l.items || []).filter((i) => owned.has(String(i.refId))).length,
        ])
      );
      cards = cards
        .map((c) => ({ c, n: overlap.get(String(c.id)) || 0 }))
        .sort((a, b) => b.n - a.n || b.c.likeCount - a.c.likeCount)
        .map((x) => x.c);
    }

    // Les listes d'UN auteur suivent le rangement de sa vitrine (User.listOrder,
    // réglé depuis son profil). Celles qu'il n'a pas rangées — les dernières
    // créées, le plus souvent — viennent après, la plus récente d'abord :
    // l'ordre par défaut, qui reste celui de tout le monde tant que personne
    // n'a rien rangé.
    if (author) {
      const owner = await User.findById(author).select("listOrder").lean();
      const rank = new Map((owner?.listOrder || []).map((id, i) => [String(id), i]));
      if (rank.size) {
        cards = cards
          .map((c, i) => ({ c, at: rank.has(String(c.id)) ? rank.get(String(c.id)) : 1e6 + i }))
          .sort((a, b) => a.at - b.at)
          .map((x) => x.c);
      }
    }
    if (req.query.sort === "likes") {
      cards = cards.sort((a, b) => b.likeCount - a.likeCount);
    }
    // ⚠️ PAR PAGES, PAS TOUT D'UN COUP. L'onglet Tops renvoyait ses 185 listes
    // en une réponse (430 Ko de JSON) et la page en dessinait les 185 cartes
    // — des milliers d'images — avant qu'on ait fait défiler quoi que ce soit.
    const start = late ? offset : 0;
    res.json({ lists: cards.slice(start, start + limit), hasMore: cards.length > start + limit });
  } catch (err) {
    console.error("lists feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des listes." });
  }
});

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/lists/tags?scope=tops&group= — les tags en usage, du plus fréquent
// au plus rare. Sert les pastilles de filtre de l'onglet Tops. Déclaré AVANT /:id.
router.get("/tags", async (req, res) => {
  try {
    const match = { visibility: "public" };
    if (req.query.scope === "tops") match["official.kind"] = "top";
    if (req.query.scope === "tops" && req.query.group) match["official.group"] = String(req.query.group);
    const rows = await List.aggregate([
      { $match: match },
      { $unwind: "$tags" },
      { $group: { _id: { $toLower: "$tags" }, tag: { $first: "$tags" }, count: { $sum: 1 } } },
      { $sort: { count: -1, tag: 1 } },
      { $limit: 80 },
    ]);
    res.json({ tags: rows.map((r) => ({ tag: r.tag, count: r.count })) });
  } catch (err) {
    console.error("list tags error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des tags." });
  }
});

// GET /api/lists/nines — « le principe des 9 », thème par thème.
// Déclaré AVANT /:id. Pour chaque thème : combien de joueurs l'ont fait (listes
// publiques), les visages de ceux que je suis qui l'ont fait, et MA liste si
// je l'ai déjà faite — la carte dit alors « voir la mienne » au lieu de
// « à toi », et montre mes neuf jaquettes.
router.get("/nines", optionalAuth, async (req, res) => {
  try {
    const me = req.userId
      ? await User.findById(req.userId).select("following").lean()
      : null;
    const following = (me?.following || []).slice(0, 300);

    const [counts, mine, friends] = await Promise.all([
      List.aggregate([
        { $match: { nine: { $ne: null }, visibility: "public" } },
        { $group: { _id: "$nine", n: { $sum: 1 } } },
      ]),
      req.userId
        ? List.find({ user: req.userId, nine: { $ne: null } })
            .sort({ updatedAt: -1 })
            .select("nine title items.image")
            .lean()
        : [],
      following.length
        ? List.find({ user: { $in: following }, nine: { $ne: null }, visibility: "public" })
            .sort({ updatedAt: -1 })
            .limit(400)
            .select("nine user items.image")
            .populate("user", "username avatar")
            .lean()
        : [],
    ]);

    const themes = {};
    const at = (k) => (themes[k] ||= { count: 0, faces: [], friends: [], mine: null });
    for (const c of counts) at(c._id).count = c.n;
    // ⚠️ LES VISAGES MÈNENT À LEURS LISTES. On voyait qui avait fait le thème
    // sans pouvoir aller voir SES neuf jeux : `friends` porte chaque liste
    // (une par ami, la plus récente), avec de quoi la prévisualiser.
    for (const l of friends) {
      if (!l.user || l.nine === "custom") continue;
      const th = at(l.nine);
      if (th.friends.some((f) => f.username === l.user.username)) continue;
      const who = { username: l.user.username, avatar: l.user.avatar || null };
      if (th.faces.length < 3) th.faces.push(who);
      if (th.friends.length < 30) {
        th.friends.push({
          ...who,
          id: String(l._id),
          preview: (l.items || []).map((i) => i.image).filter(Boolean).slice(0, NINE_MAX),
        });
      }
    }
    // Les thèmes inventés (« custom ») ne se regroupent pas : chacun est à
    // part, la carte « Invente le tien » ne montre donc pas « la mienne ».
    for (const l of mine) {
      if (l.nine === "custom") continue;
      const th = at(l.nine);
      if (th.mine) continue;
      th.mine = {
        id: String(l._id),
        preview: (l.items || []).map((i) => i.image).filter(Boolean).slice(0, NINE_MAX),
      };
    }
    res.json({ themes });
  } catch (err) {
    console.error("lists nines error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des thèmes." });
  }
});

// GET /api/lists/boards/:board/suggest/:slot — le rayon d'une case de grille :
// « Mon jeu préféré » ouvre sur les coups de cœur, « Meilleur jeu rétro » sur
// les jeux de plus de vingt ans (cf. lib/boards `suggest`, lib/nineSuggest).
router.get("/boards/:board/suggest/:slot", requireAuth, async (req, res) => {
  try {
    const slot = boardSlot(boardKey(req.params.board), String(req.params.slot || ""));
    const shelf = slot ? await nineSuggestions(req.userId, slot.suggest) : null;
    res.json({ shelf });
  } catch (err) {
    console.error("lists board suggest error:", err.message);
    res.json({ shelf: null });
  }
});

// GET /api/lists/nines/suggest/:theme — le rayon propre à un thème des 9 :
// « où j'ai englouti des heures » ouvre sur les plus longues parties, « de mon
// enfance » sur les jeux sortis il y a plus de douze ans (cf. lib/nineSuggest).
// `{ shelf: null }` quand le thème n'a pas de règle ou que rien ne colle.
router.get("/nines/suggest/:theme", requireAuth, async (req, res) => {
  try {
    const shelf = await nineSuggestions(req.userId, String(req.params.theme || ""));
    res.json({ shelf });
  } catch (err) {
    console.error("lists nines suggest error:", err.message);
    res.json({ shelf: null });
  }
});

// GET /api/lists/gifs — proxy de recherche GIF (GIPHY). Déclaré AVANT /:id
// pour ne pas être capturé par la route paramétrée.
router.get("/gifs", requireAuth, async (req, res) => {
  const key = process.env.GIPHY_KEY;
  if (!key)
    return res.status(503).json({ error: "Recherche GIF non configurée (GIPHY_KEY)." });
  try {
    const q = String(req.query.q || "").trim();
    const params = new URLSearchParams({
      api_key: key,
      limit: "24",
      rating: "pg-13",
      bundle: "messaging_non_clips",
    });
    if (q) params.set("q", q);
    const endpoint = q
      ? "https://api.giphy.com/v1/gifs/search"
      : "https://api.giphy.com/v1/gifs/trending";
    const r = await fetch(`${endpoint}?${params}`);
    if (!r.ok) throw new Error(`GIPHY ${r.status}`);
    const d = await r.json();
    const gifs = (d.data || [])
      .map((g) => {
        const img = g.images || {};
        const full = img.downsized_medium || img.original || {};
        return {
          id: g.id,
          preview: img.fixed_width?.url || img.fixed_width_small?.url || null,
          url: full.url || null,
          width: Number(full.width) || null,
          height: Number(full.height) || null,
          desc: g.title || "GIF",
        };
      })
      .filter((g) => g.preview && g.url);
    res.json({ gifs });
  } catch (err) {
    console.error("giphy error:", err.message);
    res.status(502).json({ error: "Recherche GIF indisponible." });
  }
});

// POST /api/lists/comments/media — upload d'une image de réaction. Renvoie l'URL.
router.post(
  "/comments/media",
  requireAuth,
  commentUpload.single("media"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
    const url = `${req.protocol}://${req.get("host")}/uploads/comments/${req.file.filename}`;
    res.status(201).json({ media: { type: "image", url } });
  }
);

// Garde-fou SSRF : on ne relaie que du http(s) public (jamais une IP privée).
function isSafeImageUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host.includes(":")) return false;
  return true;
}

// GET /api/lists/proxy-image?url= — relaie une image distante (jaquettes IGDB…)
// pour l'export PNG côté client : passer par notre origine évite de « souiller »
// le canvas (cross-origin), ce qui bloquerait `toBlob()`. Déclaré AVANT /:id.
router.get("/proxy-image", requireAuth, async (req, res) => {
  const url = String(req.query.url || "");
  if (!isSafeImageUrl(url))
    return res.status(400).json({ error: "URL d'image refusée." });
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "MyPlayLog/1.0" },
      redirect: "follow",
    });
    if (!r.ok) return res.status(502).json({ error: "Image indisponible." });
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/"))
      return res.status(415).json({ error: "Le contenu n'est pas une image." });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024)
      return res.status(413).json({ error: "Image trop lourde." });
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch {
    res.status(502).json({ error: "Relais d'image indisponible." });
  }
});

// GET /api/lists/mine/for-item?refId=&kind= — mes listes compatibles avec un
// élément, avec l'info « contient déjà ». Sert au quick-add depuis l'Explorer.
// Déclarée AVANT /:id pour ne pas être capturée par la route paramétrée.
router.get("/mine/for-item", requireAuth, async (req, res) => {
  try {
    const refId = req.query.refId != null ? String(req.query.refId) : null;
    const kind = ITEM_KINDS.includes(req.query.kind) ? req.query.kind : "game";
    const lists = await List.find({ user: req.userId, itemKind: kind })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    res.json({
      lists: lists.map((l) => ({
        id: l._id,
        title: l.title,
        cover: l.cover || null,
        coverDesign: l.coverDesign || null,
        type: l.type,
        itemKind: l.itemKind || "game",
        visibility: l.visibility,
        itemCount: (l.items || []).length,
        preview: (l.items || [])
          .filter((i) => i.image)
          .slice(0, 3)
          .map((i) => i.image),
        contains: refId
          ? (l.items || []).some((i) => String(i.refId) === refId)
          : false,
      })),
    });
  } catch (err) {
    console.error("lists for-item error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des listes." });
  }
});

// GET /api/lists/tops/for-me — les tops officiels faits pour le joueur (rayon
// « Tops pour toi » de l'accueil). Déclarée AVANT /:id.
//
// ⚠️ CE QUI INTÉRESSE, C'EST L'ÉCART. Un top dont on a joué la moitié dit
// « tu aimes ça, et il t'en reste » ; un top dont on a tout fait n'a plus rien
// à apprendre, et un top dont on ne connaît aucun jeu ne dit rien de nous. Le
// score monte avec le nombre de jeux déjà joués (ramené à la taille du top,
// sinon les Top 100 écraseraient tout) et retombe quand il ne reste rien à
// découvrir.
const TOPS_FOR_ME_MAX = 12;
router.get("/tops/for-me", requireAuth, async (req, res) => {
  try {
    const [entries, tops] = await Promise.all([
      UserGame.find({ user: req.userId }).select("gameId status").lean(),
      List.find({ "official.kind": "top", visibility: "public" }).select("items.gameId").lean(),
    ]);
    // Une envie compte à moitié : on la veut, on ne l'a pas encore jouée.
    const weight = new Map();
    for (const e of entries) {
      if (e.gameId == null) continue;
      weight.set(String(e.gameId), e.status === "wishlist" ? 0.5 : 1);
    }
    const scored = [];
    for (const t of tops) {
      const ids = (t.items || []).map((i) => String(i.gameId));
      if (!ids.length) continue;
      let owned = 0;
      let played = 0;
      for (const id of ids) {
        const w = weight.get(id);
        if (!w) continue;
        owned += w;
        if (w === 1) played += 1;
      }
      if (played < 2) continue;
      const left = ids.length - played;
      const score = (owned / Math.sqrt(ids.length)) * (left > 0 ? 1 : 0.25);
      scored.push({ id: t._id, score, played, total: ids.length });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored.slice(0, TOPS_FOR_ME_MAX);
    const docs = await List.find({ _id: { $in: best.map((b) => b.id) } })
      .populate("user", "username avatar isSystem")
      .lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const lists = best
      .map((b) => {
        const d = byId.get(String(b.id));
        return d ? { ...toCard(d, req.userId), played: b.played } : null;
      })
      .filter(Boolean);
    res.json({ lists });
  } catch (err) {
    console.error("tops for me error:", err.message);
    res.json({ lists: [] });
  }
});

// GET /api/lists/suggest/tiers — des tier lists à faire, tirées des sagas que
// le joueur a jouées (« Tier list des jeux Pokémon »). La page Listes les
// propose quand le rayon des tier lists est vide, ou tant que le joueur n'en a
// fait aucune. Chaque suggestion porte ses jeux : un clic crée la tier list
// déjà remplie, il ne reste qu'à ranger.
// Déclarée AVANT /:id pour ne pas être capturée par la route paramétrée.
const TIER_SUGGEST_MAX = 8;
const TIER_POOL_MAX = 60;
const IGDB_COVER = "https://images.igdb.com/igdb/image/upload/t_cover_big";

// Les jeux d'une saga, pour remplir le bac d'une tier list suggérée.
// ⚠️ PAS SEULEMENT CEUX QU'ON A JOUÉS. « Tier list des jeux Pokémon » ne
// proposait que les six Pokémon de la bibliothèque : on ne classe pas une
// saga avec six jeux. On part du top officiel de la saga s'il existe (déjà
// trié, jaquettes comprises, sans appel IGDB) ; sinon des épisodes de la
// franchise sur IGDB — jeux principaux, remakes, remasters — gardés un jour.
const sagaPoolCache = new Map(); // "franchise:12" -> { at, games }
const SAGA_POOL_TTL = 24 * 3600 * 1000;

async function sagaPool(saga, ref) {
  const top = await List.findOne({
    "official.kind": "top",
    "official.group": "series",
    title: new RegExp(`meilleurs\\s+(?:jeux\\s+)?${escapeRx(saga)}\\s*$`, "i"),
  })
    .select("items.gameId items.name items.image")
    .lean();
  if (top?.items?.length) {
    return top.items.map((i) => ({ gameId: i.gameId, name: i.name, cover: i.image || null }));
  }
  if (!ref?.franchiseId) return [];
  const key = `${ref.franchiseKind}:${ref.franchiseId}`;
  const hit = sagaPoolCache.get(key);
  if (hit && Date.now() - hit.at < SAGA_POOL_TTL) return hit.games;
  const field = ref.franchiseKind === "collection" ? "collections" : "franchises";
  let games = [];
  try {
    const rows = await igdbQuery(
      "games",
      `fields name, cover.image_id; where ${field} = (${Number(ref.franchiseId)}) & game_type = (0,8,9) & cover != null & version_parent = null; sort total_rating_count desc; limit ${TIER_POOL_MAX};`
    );
    // ⚠️ LES FRANCHISES IGDB COMPTENT LES CROSSOVERS : Smash Bros. et Mario
    // Kart sortaient dans « Zelda ». On garde les jeux qui portent le nom de la
    // saga, sauf s'il en reste trop peu (saga au nom différent de ses jeux).
    const plain = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
    const named = rows.filter((g) => plain(g.name).includes(plain(saga)));
    games = (named.length >= 5 ? named : rows).map((g) => ({
      gameId: g.id,
      name: g.name,
      cover: `${IGDB_COVER}/${g.cover.image_id}.jpg`,
    }));
  } catch {
    games = [];
  }
  sagaPoolCache.set(key, { at: Date.now(), games });
  return games;
}
router.get("/suggest/tiers", requireAuth, async (req, res) => {
  try {
    const [entries, mine] = await Promise.all([
      UserGame.find({ user: req.userId, status: { $ne: "wishlist" } })
        .select("gameId name cover")
        .lean(),
      List.find({ user: req.userId, type: "tier" }).select("title").lean(),
    ]);
    const meta = await ensureGameMeta(entries.map((e) => e.gameId));

    const bySaga = new Map();
    const refOf = new Map(); // saga -> { franchiseId, franchiseKind }
    for (const e of entries) {
      const m = meta.get(e.gameId);
      const saga = m?.franchise;
      if (!saga) continue;
      if (!bySaga.has(saga)) bySaga.set(saga, []);
      bySaga.get(saga).push(e);
      if (m.franchiseId && !refOf.has(saga)) {
        refOf.set(saga, { franchiseId: m.franchiseId, franchiseKind: m.franchiseKind });
      }
    }
    // Une saga déjà classée par le joueur ne se repropose pas.
    const done = mine.map((l) => l.title.toLowerCase());
    const fresh = [...bySaga].filter(
      ([saga]) => !done.some((t) => t.includes(saga.toLowerCase()))
    );
    // Trois jeux au moins font une tier list qui vaut d'être rangée ; à défaut,
    // on se contente de deux plutôt que de ne rien proposer.
    const min = fresh.some(([, games]) => games.length >= 3) ? 3 : 2;

    const picked = fresh
      .filter(([, games]) => games.length >= min)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, TIER_SUGGEST_MAX);
    // Les bacs complets, en parallèle (un top officiel ou une requête IGDB
    // par saga, cette dernière gardée un jour).
    const pools = await Promise.all(picked.map(([saga]) => sagaPool(saga, refOf.get(saga))));
    const suggestions = picked.map(([saga, played], i) => {
      // Ses jeux d'abord (ce sont ceux qu'il a en tête), puis le reste de la
      // saga, sans doublon.
      const seen = new Set(played.map((g) => String(g.gameId)));
      const games = [
        ...played,
        ...pools[i].filter((g) => g.gameId && !seen.has(String(g.gameId)) && seen.add(String(g.gameId))),
      ].slice(0, TIER_POOL_MAX);
      return {
        saga,
        title: `Tier list des jeux ${saga}`,
        count: games.length,
        played: played.length,
        covers: played.filter((g) => g.cover).slice(0, 3).map((g) => g.cover),
        games: games.map((g) => ({ gameId: g.gameId, name: g.name, cover: g.cover || null })),
      };
    });

    res.json({ hasOwnTier: mine.length > 0, suggestions });
  } catch (err) {
    console.error("tier suggest error:", err.message);
    res.status(500).json({ error: "Suggestions indisponibles." });
  }
});

// ----------------------------------------------------------------------
//  « T'en veux plus ? » — sous le top d'une saga, les jeux dans son esprit
// ----------------------------------------------------------------------
// Kingdom Hearts, Ace Attorney, Touhou… ces sagas ont peu d'épisodes : leur
// top se lit vite, et on reste sur sa faim. Plutôt qu'écrire un « top des
// Kingdom Hearts-like » à la main pour chacune des cent sagas, on le calcule :
// les jeux qui ressemblent le plus aux MEILLEURS épisodes (moteur de
// recommandation, cf. lib/recoEngine `similarGames`), moins la saga elle-même.
//
// Quelques sagas ont déjà leur top « -like » écrit à la main : on le reprend
// tel quel, il vaut mieux qu'un calcul.
// Les sagas qui appartiennent nettement à un genre : le top de ce genre, écrit
// à la main, est un meilleur « dans son esprit » que le calcul (qui, pour un
// Yakuza, remontait surtout de grands jeux d'action à la mode).
const CURATED_LIKE = {
  "top-zelda": "top-zelda-like",
  "top-persona": "top-persona-like",
  "top-smt": "top-persona-like",
  "top-fromsoftware": "top-soulslike",
  "top-metroid": "top-metroidvania",
  "top-castlevania": "top-metroidvania",
  "top-ace-attorney": "top-deduction",
  "top-danganronpa": "top-deduction",
  "top-pokemon": "top-monster-collecting",
  "top-monster-hunter": "top-monster-hunting",
  "top-metal-gear": "top-stealth",
  "top-splinter-cell": "top-stealth",
  "top-hitman": "top-stealth",
  "top-street-fighter": "top-fighting",
  "top-tekken": "top-fighting",
  "top-mortal-kombat": "top-fighting",
  "top-fighting-sagas": "top-fighting",
  "top-mario": "top-platformer",
  "top-donkey-kong": "top-platformer",
  "top-crash": "top-platformer",
  "top-spyro": "top-platformer",
  "top-rayman": "top-platformer",
  "top-jak-sly": "top-platformer",
  "top-sonic": "top-platformer",
  "top-devil-may-cry": "top-character-action",
  "top-bayonetta": "top-character-action",
  "top-resident-evil": "top-survival-horror",
  "top-silent-hill": "top-survival-horror",
  "top-fire-emblem": "top-tactical-rpg",
  "top-disgaea": "top-tactical-rpg",
  "top-civilization": "top-strategy",
  "top-total-war": "top-strategy",
  "top-age-of-empires": "top-strategy",
  "top-xcom": "top-strategy",
  "top-gran-turismo-forza": "top-racing",
  "top-nfs-burnout": "top-racing",
  "top-harvest-moon": "top-cozy",
  "top-animal-crossing": "top-cozy",
  "top-touhou": "top-shmup",
  "top-metal-slug": "top-shmup",
};
const MORE_SEEDS = 12;
const MORE_MAX = 50;
const MORE_TTL = 24 * 3600 * 1000;
const moreCache = new Map(); // id de liste -> { at, payload }

// « Les 25 meilleurs Kingdom Hearts » → « Kingdom Hearts » ; « Les 10
// meilleurs jeux Batman » → « Batman ».
function sagaSubject(title) {
  const m = String(title || "").match(/^les\s+\d+\s+meilleur(?:e?s)\s+(.+)$/i);
  const raw = m ? m[1] : String(title || "");
  return raw
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/^jeux\s+/i, "")
    .trim();
}

const plainName = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

router.get("/:id/more", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.json({ more: null });
    const hit = moreCache.get(req.params.id);
    if (hit && Date.now() - hit.at < MORE_TTL) return res.json({ more: hit.payload });

    const top = await List.findById(req.params.id).select("title official items.gameId items.name").lean();
    if (top?.official?.kind !== "top" || top.official.group !== "series") return res.json({ more: null });
    const subject = sagaSubject(top.title);
    const own = new Set((top.items || []).map((i) => String(i.gameId)));
    // La saga elle-même (autres épisodes, spin-offs) n'est pas « dans son
    // esprit » : c'est elle. Un nom composé (« Yakuza & Like a Dragon »,
    // « Pikmin, Star Fox & Splatoon ») donne plusieurs noms à écarter.
    const keys = subject.split(/&|,/).map(plainName).filter((k) => k.length >= 3);
    const isSaga = (name) => keys.some((k) => plainName(name).includes(k));

    let payload = null;
    const curatedKey = CURATED_LIKE[top.official.key];
    if (curatedKey) {
      const like = await List.findOne({ "official.key": curatedKey })
        .select("title items.gameId items.name items.image")
        .lean();
      if (like) {
        const games = like.items
          .filter((i) => !own.has(String(i.gameId)) && !isSaga(i.name))
          .map((i) => ({ id: i.gameId, name: i.name, cover: i.image || null }));
        payload = { subject, listId: String(like._id), listTitle: like.title, games };
      }
    }

    if (!payload) {
      // Les meilleurs épisodes servent de graines ; un jeu recommandé par
      // plusieurs d'entre eux, et par les mieux classés, remonte.
      const seeds = (top.items || []).slice(0, MORE_SEEDS).map((i) => Number(i.gameId)).filter(Boolean);
      const lists = await Promise.all(
        seeds.map((id) => similarGames(id, { limit: 40 }).catch(() => null))
      );
      const score = new Map();
      const hits = new Map();
      const cardOf = new Map();
      lists.forEach((games, rank) => {
        for (const [pos, g] of (games || []).entries()) {
          if (!g?.id || own.has(String(g.id)) || isSaga(g.name)) continue;
          const w = (1 / (1 + rank * 0.15)) * (1 / (1 + pos * 0.05));
          score.set(g.id, (score.get(g.id) || 0) + w);
          hits.set(g.id, (hits.get(g.id) || 0) + 1);
          if (!cardOf.has(g.id)) cardOf.set(g.id, { id: g.id, name: g.name, cover: g.cover });
        }
      });
      // Un jeu que PLUSIEURS épisodes recommandent passe devant un jeu qu'un
      // seul a fait remonter : c'est le consensus qui fait « l'esprit ».
      const games = [...score]
        .map(([id, v]) => [id, v * Math.sqrt(hits.get(id) / Math.max(1, seeds.length))])
        .sort((a, b) => b[1] - a[1])
        .slice(0, MORE_MAX)
        .map(([id]) => cardOf.get(id))
        .filter((g) => g.cover);
      payload = games.length >= 5 ? { subject, listId: null, listTitle: null, games } : null;
    }

    moreCache.set(req.params.id, { at: Date.now(), payload });
    res.json({ more: payload });
  } catch (err) {
    console.error("list more error:", err.message);
    res.json({ more: null });
  }
});

// GET /api/lists/:id — détail d'une liste (respecte la confidentialité).
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Liste introuvable." });
    const l = await List.findById(req.params.id)
      .populate("user", "username avatar isSystem")
      .populate("comments.user", "username avatar")
      .lean();
    if (!l) return res.status(404).json({ error: "Liste introuvable." });
    const isOwner = String(l.user?._id || l.user) === String(req.userId);
    if (l.visibility === "private" && !isOwner)
      return res.status(403).json({ error: "Cette liste est privée." });

    const full = toFull(l, req.userId);
    // La porte vers les grilles ne s'ouvre que s'il y a quelque chose derrière :
    // un bouton « les grilles » sur un événement où personne n'a joué mène à une
    // page vide, et une page vide vaut moins que pas de bouton.
    if (full.event) {
      const ev = await eventOfList(l).catch(() => null);
      if (ev) {
        full.event.eventId = String(ev._id);
        full.event.gridCount = await EventBingo.countDocuments({
          event: ev._id,
          published: true,
        }).catch(() => 0);
      }
    }
    res.json({ list: full });
  } catch (err) {
    console.error("list detail error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de la liste." });
  }
});

// ============================================================
//  GET /api/lists/:id/grids — les grilles de bingo de l'événement
// ============================================================
// La MÊME lecture que la fiche du rendez-vous (cf. lib/eventGrids) : mêmes
// règles de visibilité, même classement, mêmes grilles. Ce n'est pas une copie
// des grilles dans la liste, c'est une seconde porte vers les mêmes documents —
// une grille cochée pendant l'émission est la même vue des deux côtés.
router.get("/:id/grids", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Liste introuvable." });
    const l = await List.findById(req.params.id).select("visibility user event title").lean();
    if (!l) return res.status(404).json({ error: "Liste introuvable." });
    if (l.visibility === "private" && String(l.user) !== String(req.userId))
      return res.status(403).json({ error: "Cette liste est privée." });

    const ev = await eventOfList(l);
    // Une liste de joueur n'a pas de rendez-vous, et un rendez-vous que le
    // calendrier ne connaît plus n'a pas de grilles : dans les deux cas la
    // réponse est vide, pas une erreur — le client n'a rien à afficher, c'est
    // tout ce qu'il a besoin de savoir.
    if (!ev) return res.json({ event: null, mine: null, grids: [], total: 0 });

    const { mine, grids, total } = await gridsForEvent(ev._id, req.userId, { limit: 60 });
    res.json({
      event: { id: String(ev._id), name: ev.name, startsAt: ev.startsAt },
      mine,
      grids,
      total,
    });
  } catch (err) {
    console.error("list grids error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des grilles." });
  }
});

// POST /api/lists — créer une liste.
router.post("/", requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "Un titre est requis." });
    const type = TYPES.includes(b.type) ? b.type : "classic";
    // Le "kind" (jeux OU personnages) s'applique à tous les types de listes.
    // Une playlist contient toujours des OST ; l'inverse est vrai aussi.
    const itemKind =
      type === "playlist"
        ? "ost"
        : ITEM_KINDS.includes(b.itemKind) && b.itemKind !== "ost"
          ? b.itemKind
          : "game";
    const visibility = VISIBILITIES.includes(b.visibility)
      ? b.visibility
      : "public";
    const items = Array.isArray(b.items)
      ? b.items.map(sanitizeItem).filter(Boolean)
      : [];
    // Une liste des 9 est une liste simple de jeux : ni classement, ni
    // paliers, ni personnages — la grille EST sa forme.
    const nine = nineKey(b.nine);
    if (nine && items.length > NINE_MAX) return res.status(400).json({ error: TOO_MANY_NINE });
    // Une grille « un jeu par case » : une seule par modèle et par joueur —
    // c'est SA carte. La seconde création renvoie vers la première.
    const board = nine ? null : boardKey(b.board);
    if (board) {
      const existing = await List.findOne({ user: req.userId, board }).select("_id").lean();
      if (existing)
        return res.status(409).json({ error: "Tu as déjà ta carte : modifie-la.", id: existing._id });
    }
    const tiers =
      type === "tier" && !nine && !board
        ? sanitizeTiers(b.tiers) || DEFAULT_TIERS
        : [];

    const list = await List.create({
      user: req.userId,
      title,
      description: String(b.description || "").slice(0, 2000),
      cover: b.cover ? String(b.cover) : null,
      type: nine || board ? "classic" : type,
      itemKind: nine || board ? "game" : itemKind,
      nine,
      board,
      visibility,
      items: board
        ? cleanBoardItems(board, items)
        : nine
          ? items.filter((i) => i.kind === "game")
          : items,
      tiers,
      tags: sanitizeTags(b.tags) || [],
    });
    // Fil : « X a créé une liste » (les listes privées n'y apparaissent pas —
    // le feed refiltre de toute façon sur la visibilité actuelle).
    recordActivity({ actor: req.userId, type: "list_create", list: list._id });
    // Missions « Grand ordonnateur » (tier list) / « DJ du dimanche » (playlist).
    triggerMissionCheck(req.userId);

    const full = await List.findById(list._id)
      .populate("user", "username avatar isSystem")
      .lean();
    res.status(201).json({ list: toFull(full, req.userId) });
  } catch (err) {
    console.error("list create error:", err.message);
    res.status(500).json({ error: "Erreur lors de la création." });
  }
});

// PUT /api/lists/:id — mettre à jour (propriétaire uniquement).
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });

    const b = req.body || {};
    if (b.title !== undefined) {
      const title = String(b.title).trim();
      if (!title) return res.status(400).json({ error: "Un titre est requis." });
      list.title = title.slice(0, 120);
    }
    if (b.description !== undefined)
      list.description = String(b.description).slice(0, 2000);
    if (b.cover !== undefined) list.cover = b.cover ? String(b.cover) : null;
    if (b.coverDesign !== undefined) {
      const cd = b.coverDesign;
      if (cd && typeof cd === "object") {
        // On borne la liste d'éléments ; le sous-schéma nettoie/caste le reste.
        if (Array.isArray(cd.elements)) cd.elements = cd.elements.slice(0, 24);
        list.coverDesign = cd;
      } else {
        list.coverDesign = null;
      }
    }
    if (b.visibility !== undefined && VISIBILITIES.includes(b.visibility))
      list.visibility = b.visibility;
    if (b.tags !== undefined) {
      const tags = sanitizeTags(b.tags);
      if (tags) list.tags = tags;
    }
    // Changement de type : on garde les items (itemKind figé). En quittant
    // "tier" on déclasse tout ; en y entrant on pose des paliers par défaut.
    // Une playlist ne change pas de type (et rien ne devient playlist) : le
    // contenu (pistes vs jeux/persos) n'est pas compatible.
    if (
      b.type !== undefined &&
      TYPES.includes(b.type) &&
      b.type !== list.type &&
      b.type !== "playlist" &&
      list.type !== "playlist" &&
      !list.nine &&
      !list.board
    ) {
      const wasTier = list.type === "tier";
      list.type = b.type;
      if (b.type !== "tier" && wasTier)
        list.items.forEach((i) => (i.tier = null));
      if (b.type === "tier" && (!list.tiers || list.tiers.length === 0))
        list.tiers = DEFAULT_TIERS;
    }
    let addedCount = 0;
    let addedRefIds = [];
    if (b.items !== undefined && Array.isArray(b.items)) {
      const next = b.items.map(sanitizeItem).filter(Boolean);
      if (list.nine && next.length > NINE_MAX)
        return res.status(400).json({ error: TOO_MANY_NINE });
      const before = new Set(list.items.map((i) => String(i.refId)));
      list.items = list.board ? cleanBoardItems(list.board, next) : next;
      const fresh = list.items.filter((i) => !before.has(String(i.refId)));
      addedCount = fresh.length;
      addedRefIds = fresh.map((i) => String(i.refId));
    }
    if (b.tiers !== undefined && list.type === "tier") {
      const t = sanitizeTiers(b.tiers);
      if (t) list.tiers = t;
    }
    // Invariant : hors tier list, aucun item ne conserve de palier.
    if (list.type !== "tier") list.items.forEach((i) => (i.tier = null));

    await list.save({ validateModifiedOnly: true });
    // Fil : « X a ajouté n jeux à sa liste » (fusionné si ajouts rapprochés).
    if (addedCount > 0)
      recordListItemsActivity({
        actor: req.userId,
        list: list._id,
        added: addedCount,
        refIds: addedRefIds,
      });
    const full = await List.findById(list._id)
      .populate("user", "username avatar isSystem")
      .populate("comments.user", "username avatar")
      .lean();
    res.json({ list: toFull(full, req.userId) });
  } catch (err) {
    console.error("list update error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// DELETE /api/lists/:id
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.json({ ok: true });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    await list.deleteOne();
    // Plus de liste → plus de cartes du fil qui pointent dessus.
    removeActivity({ list: list._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// POST /api/lists/:id/like — basculer le like.
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const uid = String(req.userId);
    const has = list.likes.some((u) => String(u) === uid);
    if (has) list.likes = list.likes.filter((u) => String(u) !== uid);
    else list.likes.push(req.userId);
    // timestamps:false → un like ne doit pas « bumper » la liste (sinon elle
    // remonte dans le fil comme « a mis à jour sa liste »). L'activité sociale
    // est portée par les notifications (cf. feed.js).
    await list.save({ validateModifiedOnly: true, timestamps: false });
    if (!has) {
      notify({
        user: list.user,
        type: "list_like",
        actor: req.userId,
        list: list._id,
        snippet: list.title,
      });
      recordActivity({
        actor: req.userId,
        type: "list_like",
        target: list.user,
        list: list._id,
        snippet: list.title,
      });
      // Mission « Bon public ».
      triggerMissionCheck(req.userId);
    } else {
      removeActivity({ actor: req.userId, type: "list_like", list: list._id });
    }
    res.json({ liked: !has, likeCount: list.likes.length });
  } catch (err) {
    console.error("list like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/lists/:id/cover — uploader une couverture (propriétaire).
router.post(
  "/:id/cover",
  requireAuth,
  coverUpload.single("cover"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Aucun fichier." });
      const list = await List.findById(req.params.id);
      if (!list) return res.status(404).json({ error: "Liste introuvable." });
      const owner = String(list.user) === String(req.userId);
      if (!owner && !(await adminOnOfficial(req, list)))
        return res.status(403).json({ error: "Action non autorisée." });
      const url = `${req.protocol}://${req.get("host")}/uploads/lists/${req.file.filename}`;
      list.cover = url;
      if (isOfficialList(list)) list.coverLocked = true;
      await list.save({ validateModifiedOnly: true });
      res.status(201).json({ cover: url });
    } catch (err) {
      console.error("list cover error:", err.message);
      res.status(500).json({ error: "Erreur lors de l'upload." });
    }
  }
);

// DELETE /api/lists/:id/cover — un admin retire la couverture d'une liste
// officielle : le verrou saute, la synchro remettra l'image d'IGDB (et un top
// retrouve son visuel par défaut, cf. client lib/topThemes).
router.delete("/:id/cover", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const owner = String(list.user) === String(req.userId);
    if (!owner && !(await adminOnOfficial(req, list)))
      return res.status(403).json({ error: "Action non autorisée." });
    list.cover = null;
    list.coverLocked = false;
    await list.save({ validateModifiedOnly: true });
    res.json({ cover: null });
  } catch (err) {
    console.error("list cover delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// POST /api/lists/:id/items — ajouter un élément (quick-add). Dédup sur refId.
router.post("/:id/items", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    const item = sanitizeItem(req.body);
    if (!item) return res.status(400).json({ error: "Élément invalide." });
    if (item.kind !== expectedKind(list))
      return res
        .status(400)
        .json({ error: "Cette liste n'accepte pas ce type d'élément." });
    const exists = list.items.some((i) => String(i.refId) === item.refId);
    if (!exists && list.nine && list.items.length >= NINE_MAX)
      return res.status(400).json({ error: TOO_MANY_NINE, full: true });
    if (!exists) {
      item.tier = null;
      list.items.push(item);
      await list.save({ validateModifiedOnly: true });
      // Fil : ajouts quick-add cumulés dans une seule carte.
      recordListItemsActivity({
        actor: req.userId,
        list: list._id,
        added: 1,
        refIds: [item.refId],
      });
    }
    res.status(201).json({ added: !exists, itemCount: list.items.length });
  } catch (err) {
    console.error("list add item error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout." });
  }
});

// DELETE /api/lists/:id/items/:refId — retirer un élément (quick-add).
router.delete("/:id/items/:refId", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    const refId = String(req.params.refId);
    list.items = list.items.filter((i) => String(i.refId) !== refId);
    await list.save({ validateModifiedOnly: true });
    res.json({ itemCount: list.items.length });
  } catch (err) {
    console.error("list remove item error:", err.message);
    res.status(500).json({ error: "Erreur lors du retrait." });
  }
});

// POST /api/lists/:id/listen — signale l'écoute d'une playlist par quelqu'un
// d'autre que son propriétaire. Anti-spam : la carte du fil est UNIQUE par
// (auditeur, playlist) et simplement re-datée (max 1×/6 h) ; le propriétaire
// n'est notifié qu'une seule fois par auditeur.
router.post("/:id/listen", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id).select(
      "user title type visibility"
    );
    if (!list || list.type !== "playlist")
      return res.status(404).json({ error: "Playlist introuvable." });
    // Écouter sa propre playlist n'est pas un évènement social.
    if (String(list.user) === String(req.userId)) return res.json({ ok: true });
    if (list.visibility === "private")
      return res.status(403).json({ error: "Playlist privée." });

    // Compteur d'écoutes : +1 à chaque lecture par un tiers (le client ne ping
    // qu'une fois par visite, cf. listenSent). Atomique, best-effort.
    const updated = await List.findByIdAndUpdate(
      list._id,
      { $inc: { listenCount: 1 } },
      { new: true, select: "listenCount" }
    ).lean();

    // L'activité « playlist_listen » ne produit PLUS de carte dans le fil (une
    // écoute n'apprend rien aux abonnés, cf. routes/feed.js) : elle ne sert
    // plus qu'ici, de registre « cet auditeur a-t-il déjà été signalé ? » pour
    // ne notifier le propriétaire qu'une fois.
    const existing = await Activity.findOne({
      actor: req.userId,
      type: "playlist_listen",
      list: list._id,
    }).lean();
    if (!existing) {
      recordActivity({
        actor: req.userId,
        type: "playlist_listen",
        target: list.user,
        list: list._id,
        snippet: list.title,
      });
      // Première écoute de cet auditeur : on prévient le propriétaire.
      notify({
        user: list.user,
        type: "playlist_listen",
        actor: req.userId,
        list: list._id,
        snippet: list.title,
      });
    }
    res.json({ ok: true, listenCount: updated?.listenCount ?? null });
  } catch (err) {
    console.error("playlist listen error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /api/lists/:id/enrich — enrichit les pistes d'une playlist (compositeur
// + année de sortie) via l'API de recherche iTunes. Best-effort : on ne touche
// que les pistes auxquelles il manque une info, 12 max par appel (le client
// rappelle tant que `remaining` > 0).
router.post("/:id/enrich", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });

    const missing = list.items.filter(
      (i) => i.kind === "track" && (!i.artist || !i.releaseYear || !i.durationSec)
    );
    const batch = missing.slice(0, 12);
    await Promise.allSettled(
      batch.map(async (it) => {
        const term = `${it.gameName || ""} ${it.name}`.trim();
        const params = new URLSearchParams({
          term,
          media: "music",
          entity: "song",
          limit: "1",
        });
        const r = await fetch(`https://itunes.apple.com/search?${params}`);
        if (!r.ok) return;
        const s = (await r.json())?.results?.[0];
        if (!s) return;
        if (!it.artist && s.artistName)
          it.artist = String(s.artistName).slice(0, 200);
        if (!it.releaseYear && s.releaseDate) {
          const y = new Date(s.releaseDate).getFullYear();
          if (y > 1950 && y < 2100) it.releaseYear = y;
        }
        if (!it.durationSec && s.trackTimeMillis) {
          const d = Math.round(s.trackTimeMillis / 1000);
          if (d > 10 && d < 3600) it.durationSec = d;
        }
      })
    );
    // Un enrichissement ne « bumpe » pas la liste dans le feed.
    await list.save({ validateModifiedOnly: true, timestamps: false });
    res.json({
      items: list.items.map((i) => ({
        refId: i.refId,
        artist: i.artist || null,
        releaseYear: i.releaseYear || null,
        durationSec: i.durationSec || null,
      })),
      remaining: Math.max(0, missing.length - batch.length),
    });
  } catch (err) {
    console.error("playlist enrich error:", err.message);
    res.status(500).json({ error: "Enrichissement indisponible." });
  }
});

// POST /api/lists/:id/comments — ajouter un commentaire (texte et/ou média,
// éventuellement en réponse à un autre commentaire).
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    if (list.visibility === "private" && String(list.user) !== String(req.userId))
      return res.status(403).json({ error: "Liste privée." });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau
    // d'imbrication). Répondre à une réponse cible donc le même parent.
    let parent = null;
    let replyTargetUser = null; // auteur du message auquel on répond (pour la notif)
    if (req.body?.parent) {
      const p = list.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    list.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media,
      mentions,
      parent,
      // createdAt explicite : on sauvegarde avec timestamps:false (pour ne pas
      // « bumper » la liste), il faut donc horodater le commentaire nous-mêmes.
      createdAt: new Date(),
    });
    await list.save({ validateModifiedOnly: true, timestamps: false });
    await list.populate("comments.user", "username avatar");
    const c = list.comments[list.comments.length - 1];

    // Notifications (un seul message par destinataire, par priorité).
    const recipients = new Map();
    const actorStr = String(req.userId);
    const add = (uid, type) => {
      if (!uid) return;
      const s = String(uid);
      if (s === actorStr || recipients.has(s)) return;
      recipients.set(s, type);
    };
    if (replyTargetUser) add(replyTargetUser, "comment_reply");
    mentions.forEach((m) => add(m.user, "mention"));
    add(list.user, "list_comment");
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        list: list._id,
        comment: c._id,
        snippet,
      });
    }

    // Fil d'accueil : un commentaire racine ou une réponse (cible = auteur du
    // commentaire parent pour une réponse, sinon propriétaire de la liste).
    recordActivity({
      actor: req.userId,
      type: parent ? "comment_reply" : "list_comment",
      target: replyTargetUser || list.user,
      list: list._id,
      comment: c._id,
      snippet,
    });

    triggerMissionCheck(req.userId); // mission « Mot de la fin »
    res.status(201).json({ comment: toComment(c, list.comments, req.userId) });
  } catch (err) {
    console.error("list comment error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/lists/:id/comments/:commentId — modifier son commentaire (max 2 fois).
router.put("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    if (String(c.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if ((c.editCount || 0) >= 2)
      return res.status(403).json({ error: "Limite de modifications atteinte (2)." });

    const text = String(req.body?.text || "").trim();
    const media = sanitizeMediaList(req.body?.media);
    if (!text && media.length === 0)
      return res.status(400).json({ error: "Message vide." });

    // Sauvegarde la version actuelle avant de la remplacer.
    c.history.push({ text: c.text, media: c.media, at: new Date() });
    c.text = text.slice(0, 300);
    c.media = media;
    c.mentions = await resolveMentions(text);
    c.editCount = (c.editCount || 0) + 1;
    c.editedAt = new Date();

    await list.save({ validateModifiedOnly: true, timestamps: false });
    await list.populate("comments.user", "username avatar");
    const updated = list.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, list.comments, req.userId) });
  } catch (err) {
    console.error("comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/lists/:id/comments/:commentId/like — basculer le like d'un commentaire.
router.post("/:id/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.status(404).json({ error: "Liste introuvable." });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await list.save({ validateModifiedOnly: true, timestamps: false });
    if (!has) {
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        list: list._id,
        comment: c._id,
        snippet: c.text,
      });
      recordActivity({
        actor: req.userId,
        type: "comment_like",
        target: c.user,
        list: list._id,
        comment: c._id,
        snippet: c.text,
      });
    } else {
      removeActivity({
        actor: req.userId,
        type: "comment_like",
        comment: c._id,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/lists/:id/comments/:commentId — retirer son commentaire
// (ou n'importe lequel si on possède la liste).
router.delete("/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);
    if (!list) return res.json({ ok: true });
    const c = list.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    const isCommentAuthor = String(c.user) === String(req.userId);
    const isListOwner = String(list.user) === String(req.userId);
    if (!isCommentAuthor && !isListOwner)
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await list.save({ validateModifiedOnly: true, timestamps: false });
    // On retire du fil les activités liées à ce commentaire (le commentaire
    // lui-même + les likes qu'il a reçus).
    removeActivity({ comment: c._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
