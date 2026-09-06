import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import mongoose from "mongoose";
import { igdbQuery } from "../lib/igdb.js";
import { isConfigured, getServiceAccessToken, fetchUserTitles, fetchTitleTrophies } from "../lib/psn.js";
import {
  requireAuth,
  optionalAuth,
  requireDownloadAccess,
  requireStaff,
  markStaff,
} from "../middleware/auth.js";
import { notify } from "../lib/notify.js";
import { recordActivity, removeActivity } from "../lib/activity.js";
import { summarizeReactions, reviewComment } from "../lib/reviewSerialize.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { ensureEntityLogos } from "../lib/entityLogos.js";
import { reviewVisibility, privacyOf, isFollower } from "../lib/privacy.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import CustomCover from "../models/CustomCover.js";
import CustomCharacter from "../models/CustomCharacter.js";
import CustomOst from "../models/CustomOst.js";
import GameTime from "../models/GameTime.js";
import HiddenOst from "../models/HiddenOst.js";
import OstRename from "../models/OstRename.js";
import VnCache from "../models/VnCache.js";
import SwitchPatchCache from "../models/SwitchPatchCache.js";
import { fetchHltbTimes } from "../lib/hltb.js";
import { buildGameFeed, fetchSteamReviews } from "../lib/feed.js";
import { findVnId, fetchVnCharacters, fetchVnFrPatches } from "../lib/vndb.js";
import { GENRES_FR, MODES_FR, THEMES_FR, LANGUAGES_FR, frName } from "../lib/translations.js";
import { ensureScraped, ytPlaylistTracks } from "../lib/ostScrape.js";
import { fetchC411Packs, fetchC411Torrent, rewriteAnnounce } from "../lib/c411.js";
import { fetchFitgirlRepacks } from "../lib/fitgirl.js";
import { fetchZipertoGames } from "../lib/ziperto.js";
import { getCachedTranslation, translateGameText } from "../lib/gameText.js";
import { ensureTrivia, reactToFact, serializeTrivia } from "../lib/gameTrivia.js";
import { ensureGameScores } from "../lib/gameScores.js";
// Le cache serveur d'IGDB : toutes les lectures « ce que sait IGDB du jeu X »
// passent par ici et sont partagées par tous les visiteurs (cf. lib/gameIgdb.js).
import { createTtlCache } from "../lib/ttlCache.js";
import {
  gameBundleContents,
  gameCharacters,
  gameCore,
  gameRelatives,
  gameTimeToBeat,
} from "../lib/gameIgdb.js";
import {
  decorateFranchises,
  franchiseGames,
  franchiseName,
  franchisesOf,
  mainFranchise,
} from "../lib/franchises.js";

function youtubeId(url) {
  const m = String(url).match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}
function youtubePlaylistId(url) {
  const m = String(url).match(/[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

// Titre + auteur d'une vidéo YouTube via oembed (public, sans clé)
async function ytOembed(videoId) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title, author: j.author_name };
  } catch {
    return null;
  }
}

const router = express.Router();

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

// --- Upload de covers custom ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/covers");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)),
});

// `game_type` voyage avec les résultats : c'est lui qui dit qu'un titre est un
// DLC ou une extension, et le client ne propose pas de le « marquer comme
// joué » — un contenu additionnel se coche sur son jeu de base (cf. lib/dlc.js
// côté mobile).
const FIELDS =
  "fields name,alternative_names.name,alternative_names.comment,cover.image_id,total_rating,total_rating_count,first_release_date,game_type,genres.name,platforms.abbreviation,platforms.name";

// Champs de tri disponibles
const SORT_FIELDS = {
  popularity: "total_rating_count",
  rating: "total_rating",
  release: "first_release_date",
  name: "name",
};

function mapGame(g) {
  // Titre français si IGDB en a un (commentaire "French title")
  const fr = (g.alternative_names || []).find((a) =>
    /french/i.test(a.comment || "")
  );
  return {
    id: g.id,
    name: fr?.name || g.name,
    gameType: g.game_type ?? null,
    cover: g.cover?.image_id
      ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg`
      : null,
    rating: g.total_rating ? Math.round(g.total_rating) : null,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null,
    genres: (g.genres || []).map((x) => x.name),
    platforms: (g.platforms || [])
      .map((p) => p.abbreviation || p.name)
      .filter(Boolean),
  };
}

// On re-scrape HowLongToBeat au plus une fois tous les 3 mois par jeu (pour
// tenir compte des maj de HLTB), y compris quand un précédent scrape avait
// échoué (source "none") : HLTB a peut-être la donnée depuis.
const HLTB_REFRESH_MS = 90 * 24 * 60 * 60 * 1000;
// Au-delà, un "pending" est considéré bloqué (ex: crash serveur pendant le
// scrape) et peut être repris, plutôt que de rester coincé indéfiniment.
const HLTB_PENDING_TIMEOUT_MS = 60 * 60 * 1000;

// Version de la logique de scrape HLTB. À incrémenter quand on corrige le
// scraper : toutes les entrées d'une version antérieure sont re-scrapées à la
// prochaine ouverture (ex: v1 = passage au protocole /api/bleed de HLTB).
const HLTB_VERSION = 1;

// Lance (en arrière-plan) le scrape HLTB d'un jeu, avec garde anti-course : la
// première requête pose l'état "pending" atomiquement, les autres s'abstiennent.
// `cached` = entrée GameTime existante (null si premier scrape).
async function scheduleHltbScrape(id, name, cached) {
  try {
    if (!cached) {
      // Création atomique (index unique sur gameId) : une seule requête gagne.
      await GameTime.create({ gameId: id, source: "pending" });
    } else {
      // Re-scrape périmé : passe en "pending" seulement si personne d'actif ne
      // le fait déjà (garde anti-course). On peut reprendre un "pending" bloqué
      // depuis > timeout. Les valeurs existantes sont conservées.
      const stalePending = new Date(Date.now() - HLTB_PENDING_TIMEOUT_MS);
      const upd = await GameTime.updateOne(
        {
          gameId: id,
          $or: [{ source: { $ne: "pending" } }, { updatedAt: { $lt: stalePending } }],
        },
        { $set: { source: "pending" } }
      );
      if (upd.modifiedCount === 0) return; // déjà en cours ailleurs
    }
    // On garde les anciennes valeurs si le scrape échoue (pas de perte de data).
    fetchHltbTimes(name)
      .then((res) =>
        GameTime.updateOne(
          { gameId: id },
          {
            $set: res
              ? { ...res, source: "hltb", ver: HLTB_VERSION }
              : { source: "none", ver: HLTB_VERSION },
          }
        )
      )
      .catch(() => {});
  } catch {
    /* course : déjà créé par une autre requête */
  }
}

// Temps de jeu (Time to Beat) : IGDB en priorité, sinon fallback HowLongToBeat
// mis en cache (scrape en arrière-plan, re-scrape au plus tous les 3 mois). On
// ne scrape que les jeux SORTIS : `released` doit être vrai pour tenter HLTB.
// Renvoie `{ times, pending }` : `pending` est vrai quand un scrape HLTB tourne
// en arrière-plan et qu'on n'a pas encore de valeurs → le client peut re-poller
// pour afficher les temps dès qu'ils arrivent (sans avoir à rouvrir la modale).
// `releaseDate` (timestamp IGDB) ne sert qu'à dater l'entrée de cache : un jeu
// à paraître se revoit toutes les 6 h, un vieux jeu tous les six mois.
async function resolveTimeToBeat(id, name, released = true, releaseDate = null) {
  const ttbArr = (await gameTimeToBeat(id, releaseDate).catch(() => [])) || [];
  const toH = (s) => (s ? Math.round(s / 3600) : null);
  const t = ttbArr[0];
  if (t) {
    return {
      times: { hastily: toH(t.hastily), normally: toH(t.normally), completely: toH(t.completely) },
      pending: false,
    };
  }

  // Pas de temps IGDB → fallback HLTB, mais uniquement pour les jeux sortis.
  if (!name || !released) return { times: null, pending: false };

  const cached = await GameTime.findOne({ gameId: id });
  const age = cached ? Date.now() - cached.updatedAt.getTime() : 0;
  // Un "pending" récent = scrape en cours ailleurs, on le laisse tranquille.
  const inProgress = cached?.source === "pending" && age < HLTB_PENDING_TIMEOUT_MS;
  // Périmé si : produit par une version antérieure du scraper, plus vieux que
  // 3 mois, ou "pending" bloqué depuis trop longtemps (crash serveur).
  const stale =
    cached && !inProgress &&
    (cached.ver !== HLTB_VERSION || age > HLTB_REFRESH_MS || cached.source === "pending");

  // Premier scrape (aucune entrée) ou entrée périmée → en arrière-plan.
  // La réponse courante renvoie les valeurs déjà connues (ou null la 1re fois).
  if (!cached || stale) {
    scheduleHltbScrape(id, name, cached);
  }

  if (cached && (cached.hastily || cached.normally || cached.completely)) {
    return {
      times: {
        hastily: cached.hastily,
        normally: cached.normally,
        completely: cached.completely,
      },
      pending: false,
    };
  }
  // Pas (encore) de valeurs : un scrape tourne si on vient d'en programmer un
  // (nouveau/périmé) ou si un autre est déjà en cours.
  return { times: null, pending: !cached || stale || inProgress };
}

// Comparaison tolérante de noms de perso (casse, ponctuation, accents) pour dédoublonner.
function normCharName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

// Personnages VNDB d'un visual novel, avec cache DB (re-tente si vide et périmé).
// VN_VERSION : à incrémenter dès qu'on change la logique de résolution, pour
// invalider automatiquement les entrées mises en cache par l'ancienne version.
const VN_VERSION = 2;
const VN_STALE_MS = 7 * 24 * 60 * 60 * 1000;
async function resolveVnCharacters(gameId, name) {
  try {
    const cached = await VnCache.findOne({ gameId });
    const fresh =
      cached &&
      cached.ver === VN_VERSION &&
      (cached.characters?.length || Date.now() - cached.updatedAt.getTime() < VN_STALE_MS);
    if (fresh) return cached.characters || [];

    const vnId = await findVnId(name);
    const characters = vnId ? await fetchVnCharacters(vnId) : [];
    await VnCache.updateOne(
      { gameId },
      { $set: { vnId: vnId || null, characters, ver: VN_VERSION } },
      { upsert: true }
    ).catch(() => {});
    return characters;
  } catch {
    return [];
  }
}

// Patchs de traduction FR (VNDB) d'un visual novel, avec cache DB séparé de
// celui des personnages (mêmes staleness, versionné indépendamment). On réutilise
// l'id VNDB déjà résolu par l'onglet Personnages quand il est disponible.
const PATCH_VERSION = 1;
async function resolveVnFrPatches(gameId, name) {
  try {
    const cached = await VnCache.findOne({ gameId });
    if (
      cached &&
      cached.frPatchesVer === PATCH_VERSION &&
      (cached.frPatches?.length ||
        (cached.frPatchesAt && Date.now() - cached.frPatchesAt.getTime() < VN_STALE_MS))
    ) {
      return cached.frPatches || [];
    }

    // Réutilise l'id VNDB déjà résolu (par les personnages) si présent, sinon
    // on le cherche. `vnId` vaut null quand une résolution précédente n'a rien
    // trouvé — on ne re-cherche que si aucune résolution n'a jamais eu lieu.
    const alreadyResolved = cached && cached.ver > 0;
    const vnId = alreadyResolved ? cached.vnId : await findVnId(name);
    const frPatches = vnId ? await fetchVnFrPatches(vnId) : [];
    await VnCache.updateOne(
      { gameId },
      {
        $set: {
          vnId: vnId || null,
          frPatches,
          frPatchesVer: PATCH_VERSION,
          frPatchesAt: new Date(),
        },
      },
      { upsert: true }
    ).catch(() => {});
    return frPatches;
  } catch {
    return [];
  }
}

// Patch FR Switch (nxbrew.net) d'un jeu. Le serveur ne scrape PLUS (IP datacenter
// bloquée par Cloudflare) : il lit simplement ce que l'app locale a poussé. On
// renvoie { patch, requested } pour que le client sache s'il doit proposer le
// bouton « Demander ».
async function resolveSwitchFrPatch(gameId) {
  try {
    const doc = await SwitchPatchCache.findOne({ gameId });
    return { patch: doc?.data || null, requested: !!doc?.requested };
  } catch {
    return { patch: null, requested: false };
  }
}

// Liens de recherche vers les grandes plateformes de mods, pré-remplis avec le
// nom du jeu (aucune API gratuite fiable pour lister les mods → on renvoie vers
// la recherche de chaque site).
function buildModLinks(name) {
  const q = encodeURIComponent(name);
  return [
    { key: "nexus", label: "Nexus Mods", url: `https://www.nexusmods.com/games?keyword=${q}` },
    { key: "moddb", label: "ModDB", url: `https://www.moddb.com/search?q=${q}` },
    {
      key: "workshop",
      label: "Steam Workshop",
      url: `https://steamcommunity.com/workshop/browse/?searchtext=${q}`,
    },
    {
      key: "google",
      label: "Rechercher sur le web",
      url: `https://www.google.com/search?q=${encodeURIComponent(name + " mods")}`,
    },
  ];
}

// Liste d'ids "1,2,3" -> [1,2,3]
function parseIds(str) {
  return String(str || "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n));
}

// Construit une clause pour une catégorie multi-valeurs avec mode ET/OU
function clause(field, ids, mode) {
  if (!ids.length) return null;
  if (ids.length === 1) return `${field} = (${ids[0]})`;
  const parts = ids.map((id) => `${field} = (${id})`);
  return mode === "and" ? parts.join(" & ") : `(${parts.join(" | ")})`;
}

// Le catalogue et la recherche, partagés par tout le monde. Deux personnes qui
// tapent « zelda » à une minute d'intervalle posaient deux fois la question à
// IGDB — et une frappe, c'est une requête PAR LETTRE.
//
// Plafonné : l'espace des requêtes possibles est infini (n'importe quel texte,
// n'importe quelle combinaison de filtres), donc c'est un LRU borné et non un
// cache en base comme pour les fiches.
const SEARCH_TTL = 10 * 60 * 1000;
const BROWSE_TTL = 30 * 60 * 1000;
const searchCache = createTtlCache({ name: "games:search", max: 600, ttl: SEARCH_TTL });

function buildQuery(opts) {
  const { search, sort, dir, limit, offset, filters, typeIds, release } = opts;
  // version_parent = null : exclut les éditions/remasters "version de" (Deluxe,
  // Collector's, Ellie Edition…) qu'IGDB classe pourtant en game_type = 0.
  const where = ["cover != null", "version_parent = null"];

  // Type de jeu (game_type) : un jeu n'a qu'un type -> toujours en OU.
  if (typeIds && typeIds.length) {
    const parts = typeIds.map((id) => `game_type = ${id}`);
    where.push(parts.length === 1 ? parts[0] : `(${parts.join(" | ")})`);
  }

  // Recherche par nom + titres alternatifs (toutes langues / régions).
  // ~ *"..."* est compatible avec sort et les filtres (pas la commande `search`).
  if (search)
    where.push(
      `(name ~ *"${search}"* | alternative_names.name ~ *"${search}"*)`
    );

  for (const f of filters) {
    const c = clause(f.field, f.ids, f.mode);
    if (c) where.push(c);
  }

  // Fenêtre de sortie. Trois cas, et « ce qui n'est pas sorti » n'est pas une
  // année : c'est tout ce qui vient après maintenant, jeux SANS date compris —
  // souvent les plus attendus (annoncés, pas datés).
  const rightNow = Math.floor(Date.now() / 1000);
  const unreleased = `(first_release_date = null | first_release_date > ${rightNow})`;
  if (release?.upcoming === "only") {
    where.push(unreleased);
  } else if (release?.from || release?.to) {
    if (release.upcoming === "with") {
      // La fenêtre monte jusqu'à « Futur » : ce qui n'est pas sorti en fait
      // partie, avec ou sans date.
      const lower = release.from ? `first_release_date >= ${release.from}` : null;
      where.push(lower ? `(${lower} | first_release_date = null)` : unreleased);
    } else {
      where.push("first_release_date != null");
      if (release.from) where.push(`first_release_date >= ${release.from}`);
      if (release.to) where.push(`first_release_date <= ${release.to}`);
    }
  }

  const field = SORT_FIELDS[sort] || SORT_FIELDS.popularity;
  const direction = dir === "asc" ? "asc" : "desc";
  const now = Math.floor(Date.now() / 1000);

  // Filtres "qualité" uniquement en navigation : en recherche on ne veut pas
  // masquer un jeu peu noté / pas encore sorti que l'utilisateur cherche.
  //
  // ⚠️ Ni quand une FENÊTRE DE SORTIE est demandée : « ce qui arrive » se
  // heurterait à la clause `first_release_date <= maintenant` posée ici pour le
  // tri par date, et la recherche ne rendrait rien du tout.
  const windowed = !!(release?.upcoming || release?.from || release?.to);
  if (!search && !windowed) {
    if (sort === "rating")
      where.push("total_rating != null", "total_rating_count > 80");
    else if (sort === "release") {
      where.push("first_release_date != null");
      if (direction === "desc") where.push(`first_release_date <= ${now}`);
    } else where.push("total_rating_count != null");
  }

  return `${FIELDS}; where ${where.join(
    " & "
  )}; sort ${field} ${direction}; limit ${limit}; offset ${offset};`;
}

// GET /api/games?page&limit&search&sort&dir&genre&genreMode&platform&platformMode&mode&modeMode&theme&themeMode
router.get("/", requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 24));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "")
      .trim()
      .replace(/["\\]/g, "");
    const sort = SORT_FIELDS[req.query.sort] ? req.query.sort : "popularity";
    const dir = req.query.dir === "asc" ? "asc" : "desc";
    const typeIds = parseIds(req.query.type);

    const filters = [
      { field: "genres", ids: parseIds(req.query.genre), mode: req.query.genreMode },
      {
        field: "platforms",
        ids: parseIds(req.query.platform),
        mode: req.query.platformMode,
      },
      {
        field: "game_modes",
        ids: parseIds(req.query.mode),
        mode: req.query.modeMode,
      },
      { field: "themes", ids: parseIds(req.query.theme), mode: req.query.themeMode },
      {
        field: "language_supports.language",
        ids: parseIds(req.query.language),
        mode: req.query.languageMode,
      },
    ];

    // Fenêtre de sortie : deux années pleines (le 1er janvier de l'une au 31
    // décembre de l'autre), ou le drapeau « pas encore sorti ».
    const yearFrom = parseInt(req.query.from, 10);
    const yearTo = parseInt(req.query.to, 10);
    const release = {
      // "only" = seulement ce qui arrive ; "with" = la fenêtre l'inclut.
      upcoming: req.query.upcoming === "only" || req.query.upcoming === "with"
        ? req.query.upcoming
        : null,
      from: yearFrom ? Math.floor(Date.UTC(yearFrom, 0, 1) / 1000) : null,
      to: yearTo ? Math.floor(Date.UTC(yearTo, 11, 31, 23, 59, 59) / 1000) : null,
    };

    // On CLÉ SUR LES PARAMÈTRES, pas sur la requête Apicalypse : celle-ci
    // contient l'instant présent (pour « déjà sorti »), donc elle change à
    // chaque seconde et ne collerait jamais deux fois.
    const key = JSON.stringify([search, sort, dir, limit, offset, typeIds, filters, release]);
    // Une frappe de recherche vieillit vite (un jeu vient d'être ajouté chez
    // IGDB), une page de catalogue beaucoup moins.
    const games = await searchCache.remember(
      key,
      async () => {
        const query = buildQuery({ search, sort, dir, limit, offset, filters, typeIds, release });
        return (await igdbQuery("games", query)).map(mapGame);
      },
      search ? SEARCH_TTL : BROWSE_TTL
    );

    res.json({
      page,
      limit,
      count: games.length,
      hasMore: games.length === limit,
      games,
    });
  } catch (err) {
    console.error("games error:", err.message);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Erreur lors de la récupération des jeux." });
  }
});

// GET /api/games/releases?from&to&ids
// Calendrier des sorties : jeux à venir triés par date de sortie croissante.
// - Sans `ids` : toutes les sorties à venir dans la fenêtre [from, to].
// - Avec `ids` (ex: bibliothèque de souhaits) : uniquement ces jeux, sans borne
//   haute (une envie peut sortir dans longtemps).
// La liste générale (sans ids) est la même pour tout le monde : on la met en
// cache mémoire partagé (par jour) pour ne pas rappeler IGDB à chaque visite.
// Les fenêtres passées (feed « jours précédents » de la page Sorties) sont
// aussi partagées : cache par fenêtre from-to, TTL 6 h, plafonné.
const releasesCache = { day: 0, games: null };
// (l'éviction et l'expiration sont désormais dans lib/ttlCache.js — c'était
// un tri de toute la Map à chaque insertion.)
const windowCache = createTtlCache({
  name: "games:release-windows",
  max: 60,
  ttl: 6 * 60 * 60 * 1000,
});

// Quelle CONFIANCE accorder à `first_release_date` ? On retrouve la ligne de
// `release_dates` qui l'a produite (celle dont la date est la même) et on lit
// son libellé humain :
//   « Dec 31, 2026 » → jour connu   « Dec 2026 » → mois seulement
//   « Q4 2026 »      → trimestre    « 2026 »     → année seulement
// Sans ligne correspondante (IGDB ne renvoie pas toujours le détail), on reste
// prudent : « day », le comportement d'avant.
function precisionOf(g) {
  const ts = g.first_release_date || null;
  if (!ts) return { precision: null, releaseHuman: null };
  const row = (g.release_dates || []).find((r) => r?.date === ts);
  const human = row?.human || null;
  let precision = "day";
  if (human) {
    if (/^\d{4}$/.test(human)) precision = "year";
    else if (/^Q[1-4]\s+\d{4}$/i.test(human)) precision = "quarter";
    else if (/^[A-Za-z]{3,}\s+\d{4}$/.test(human)) precision = "month";
  }
  return { precision, releaseHuman: human };
}

router.get("/releases", optionalAuth, async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const startOfToday = now - (now % 86400); // minuit UTC : inclut les sorties du jour
    const from = parseInt(req.query.from, 10) || startOfToday;
    const ids = parseIds(req.query.ids);
    const isGeneral = !ids.length && !req.query.from && !req.query.to;
    const isWindow = !ids.length && !isGeneral;

    // Cache partagé pour la liste générale du jour.
    if (isGeneral && releasesCache.games && releasesCache.day === startOfToday) {
      return res.json({ games: releasesCache.games });
    }

    const to = parseInt(req.query.to, 10) || now + 300 * 86400; // ~10 mois
    const windowKey = `${from}-${to}`;
    if (isWindow) {
      const hit = windowCache.get(windowKey);
      if (hit !== undefined) return res.json({ games: hit });
    }

    const where = [
      "cover != null",
      "version_parent = null",
      `first_release_date >= ${from}`,
    ];

    if (ids.length) {
      where.push(`id = (${ids.join(",")})`);
    } else {
      where.push(`first_release_date <= ${to}`);
      where.push("game_type = (0,8,9)"); // jeu principal + remake + remaster
    }

    // ⚠️ « 31 DÉCEMBRE » N'EST PRESQUE JAMAIS UNE DATE. Quand IGDB ne connaît
    // que l'ANNÉE de sortie, `first_release_date` vaut le 31 décembre de cette
    // année-là ; le trimestre donne le dernier jour du trimestre, le mois le
    // dernier jour du mois. Un calendrier qui lit ce nombre au premier degré
    // empile donc huit jeux « le 31 décembre » et ment à qui le regarde.
    //
    // La PRÉCISION se lit dans `release_dates.human` (« 2026 », « Q4 2026 »,
    // « Dec 2026 », « Dec 31, 2026 ») — plus sûr que le champ `category`, qu'IGDB
    // a renommé en cours de route.
    //
    // On la demande pour une liste d'ids (les jeux attendus de quelqu'un) ET
    // pour une FENÊTRE de dates : c'est ce que lit le fil des sorties du
    // mobile, jour par jour, et sans précision il empilait quarante jeux sur le
    // 31 décembre. Une fenêtre fait sept jours, soit quelques dizaines de
    // lignes, et le résultat est gardé six heures — l'expansion s'y paie sans
    // douleur. Seule la liste générale s'en passe : ses 500 lignes, elles,
    // auraient coûté cher pour un affichage qui range par mois de toute façon.
    const wantPrecision = ids.length > 0 || isWindow;
    // ⚠️ LES IDENTIFIANTS, PAS SEULEMENT LES NOMS. Le fil des sorties du mobile
    // filtre ce qu'il a déjà chargé (console, genre, langue) sans repasser par
    // le réseau : cocher « PS5 » doit répondre au doigt, pas en une seconde et
    // demie. Or les noms ne s'y prêtent pas — les genres de `/games/genres`
    // sont traduits en français, ceux d'ici sont ceux d'IGDB, et rien ne
    // porte la langue. On envoie donc les ids bruts, en plus, sur les fenêtres.
    const fields =
      "fields name,alternative_names.name,alternative_names.comment,cover.image_id,total_rating,total_rating_count,first_release_date,hypes,genres.id,genres.name,platforms.id,platforms.abbreviation,platforms.name,keywords.name" +
      (wantPrecision ? ",release_dates.date,release_dates.human" : "") +
      (isWindow ? ",language_supports.language" : "");
    const query = `${fields}; where ${where.join(
      " & "
    )}; sort first_release_date asc; limit 500;`;

    const raw = await igdbQuery("games", query);
    // Contenu généré par IA : détecté via les mots-clés IGDB (ex : "ai-generated
    // artwork", "ai-generated translations", "generative ai"). On ne renvoie
    // qu'un booléen (payload léger) que le client peut filtrer.
    const AI_RE = /\bai[- ]generated\b|generative[- ]ai/i;
    const games = raw.map((g) => ({
      ...mapGame(g),
      releaseDate: g.first_release_date || null,
      hypes: g.hypes || 0,
      ratingCount: g.total_rating_count || 0,
      ai: (g.keywords || []).some((k) => AI_RE.test(k.name || "")),
      ...(wantPrecision ? precisionOf(g) : null),
      ...(isWindow
        ? {
            genreIds: (g.genres || []).map((x) => x.id).filter(Boolean),
            platformIds: (g.platforms || []).map((x) => x.id).filter(Boolean),
            // `language_supports` répète la même langue une fois par type de
            // support (audio, sous-titres, interface) : on ne garde que la
            // langue, une seule fois.
            languageIds: [
              ...new Set((g.language_supports || []).map((l) => l.language).filter(Boolean)),
            ],
          }
        : null),
    }));

    if (isGeneral) {
      releasesCache.games = games;
      releasesCache.day = startOfToday;
    } else if (isWindow) {
      windowCache.set(windowKey, games);
    }

    res.json({ games });
  } catch (err) {
    console.error("releases error:", err.message);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Erreur lors de la récupération des sorties." });
  }
});

// --- Listes pour les filtres (mises en cache en mémoire) ---
const cache = {};

async function cachedList(key, endpoint, query, mapFn) {
  if (!cache[key]) {
    const raw = await igdbQuery(endpoint, query);
    cache[key] = raw.map(mapFn);
  }
  return cache[key];
}

router.get("/genres", requireAuth, async (req, res) => {
  try {
    const genres = (
      await cachedList("genres", "genres", "fields name; limit 50;", (g) => ({
        id: g.id,
        name: frName(GENRES_FR, g.name),
      }))
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ genres });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/platforms", requireAuth, async (req, res) => {
  try {
    // Consoles/portables/ordinateurs.
    //
    // On demande AUSSI la date de sortie, et pas seulement la génération : à
    // génération égale (la Switch 2 et la PS5 sont toutes deux « 9 »), c'est
    // elle qui départage, et c'est ce qu'on cherche — la machine qu'on a sous
    // la main d'abord, l'Amiga tout en bas. IGDB ne la porte pas sur la
    // plateforme elle-même mais sur ses RÉVISIONS matérielles : on prend la
    // plus ancienne, qui est la sortie d'origine.
    const mapPlatform = (p) => {
      const dates = (p.versions || [])
        .flatMap((v) => v.platform_version_release_dates || [])
        .map((d) => d.date)
        .filter((d) => typeof d === "number");
      const released = dates.length ? Math.min(...dates) : null;
      return {
        id: p.id,
        name: p.name,
        abbr: p.abbreviation || p.name,
        generation: p.generation || 0,
        // En secondes, comme partout ailleurs chez IGDB.
        released,
        year: released ? new Date(released * 1000).getUTCFullYear() : null,
      };
    };

    // ⚠️ REPLI SI L'EXPANSION IMBRIQUÉE PASSE MAL. `versions.…release_dates.date`
    // descend de deux niveaux ; le jour où IGDB le refuse, la liste des consoles
    // ne doit pas disparaître du panneau de filtres pour autant — on retombe sur
    // la version d'avant, sans date, et le client trie alors par génération.
    let platforms;
    try {
      platforms = await cachedList(
        "platforms",
        "platforms",
        "fields name,abbreviation,generation,versions.platform_version_release_dates.date; " +
          "where platform_type = (1,5,6); sort generation desc; limit 80;",
        mapPlatform
      );
    } catch (err) {
      console.warn("platforms: dates indisponibles, repli sans elles —", err.message);
      platforms = await cachedList(
        "platforms-plain",
        "platforms",
        "fields name,abbreviation,generation; where platform_type = (1,5,6); sort generation desc; limit 80;",
        mapPlatform
      );
    }
    res.json({ platforms });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/modes", requireAuth, async (req, res) => {
  try {
    const modes = (
      await cachedList("modes", "game_modes", "fields name; limit 20;", (m) => ({
        id: m.id,
        name: frName(MODES_FR, m.name),
      }))
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ modes });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/themes", requireAuth, async (req, res) => {
  try {
    const themes = (
      await cachedList("themes", "themes", "fields name; limit 30;", (t) => ({
        id: t.id,
        name: frName(THEMES_FR, t.name),
      }))
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ themes });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/languages", requireAuth, async (req, res) => {
  try {
    const languages = (
      await cachedList(
        "languages",
        "languages",
        "fields name,native_name; limit 100;",
        (l) => ({ id: l.id, name: frName(LANGUAGES_FR, l.name) })
      )
    )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    res.json({ languages });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/games/yt-durations?ids=abc,def — la durée de vidéos YouTube.
//
// ⚠️ NI L'API DATA, NI OEMBED. La première demande une clé et un quota pour
// une information qui ne change jamais ; la seconde ne donne pas la durée. On
// lit donc la page de la vidéo, comme le scraping des OST le fait déjà
// (lib/ostScrape) : `lengthSeconds` y est posé en clair dans le JSON du
// lecteur.
//
// ⚠️ EN MÉMOIRE, ET C'EST SUFFISANT. La durée d'une vidéo est immuable : un
// cache qui survit à la session du serveur n'apporterait rien qu'une table de
// plus. Au pire, un redémarrage refait quelques requêtes.
// Une durée de vidéo ne change jamais : c'est une mémo, pas un cache. Elle a
// quand même besoin d'un plafond — sinon elle retient chaque vidéo croisée
// depuis le démarrage.
const ytDurations = createTtlCache({ name: "yt:durations", max: 5000, ttl: 7 * 24 * 60 * 60 * 1000 });
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

async function ytDuration(videoId) {
  const known = ytDurations.get(videoId);
  if (known !== undefined) return known;
  let seconds = null;
  try {
    const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
        "Accept-Language": "en",
      },
    }).then((r) => r.text());
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    if (m) seconds = Number(m[1]) || null;
  } catch {
    /* vidéo privée, réseau coupé : on retient `null` plutôt que de réessayer
       à chaque affichage de la fiche. */
  }
  ytDurations.set(videoId, seconds);
  return seconds;
}

router.get("/yt-durations", optionalAuth, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => YT_ID.test(x))
    .slice(0, 12);
  const out = {};
  // En parallèle : douze pages de moins d'une seconde chacune, contre douze
  // secondes à la file.
  await Promise.all(
    ids.map(async (id) => {
      out[id] = await ytDuration(id);
    })
  );
  res.json({ durations: out });
});

// GET /api/games/backdrops?ids=1,2,3 — UNE image large par jeu, rien d'autre.
//
// Le strict nécessaire pour habiller une carte : l'artwork le plus grand,
// sinon la capture la plus grande — c'est-à-dire exactement ce que `/:id/full`
// choisit comme fond, mais sans les cinquante autres champs qu'il calcule.
// `list-details` aurait pu servir, il rend aussi les langues, les genres, les
// plateformes et douze captures par jeu : beaucoup de données pour poser une
// image derrière un titre.
const MAX_BACKDROPS = 40;

router.get("/backdrops", optionalAuth, async (req, res) => {
  try {
    const ids = [...new Set(parseIds(req.query.ids))].slice(0, MAX_BACKDROPS);
    if (!ids.length) return res.json({ backdrops: {} });

    const rows = await igdbQuery(
      "games",
      `fields artworks.image_id,artworks.width,artworks.height,screenshots.image_id,` +
        `screenshots.width,screenshots.height; where id = (${ids.join(",")}); limit ${ids.length};`
    );

    const byArea = (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0);
    const backdrops = {};
    for (const g of rows) {
      const best =
        [...(g.artworks || [])].filter((a) => a.image_id).sort(byArea)[0] ||
        [...(g.screenshots || [])].filter((s) => s.image_id).sort(byArea)[0];
      // `t_720p` : ces images habillent une vignette, jamais un plein écran.
      backdrops[g.id] = best ? `${IMG_BASE}/t_720p/${best.image_id}.jpg` : null;
    }
    // Les jeux sans image répondent `null` : le client saura qu'il a demandé
    // et n'y reviendra pas à chaque affichage.
    for (const id of ids) if (backdrops[id] === undefined) backdrops[id] = null;

    res.json({ backdrops });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/games/list-details?ids=1,2,3 — fiche CONDENSÉE de plusieurs jeux en
// une requête, pour la vue détaillée des listes (une ligne par jeu).
//
// `/:id/full` donnerait tout ça, mais il scrape HowLongToBeat, traduit, croise
// la base… : soixante-douze appels pour afficher une liste, impensable. Ici,
// une seule requête IGDB pour tout le lot, et uniquement les champs affichés.
const LIST_DETAIL_FIELDS = [
  "name",
  "summary",
  "cover.image_id",
  "first_release_date",
  "total_rating",
  "total_rating_count",
  "genres.name",
  "platforms.id",
  "platforms.name",
  "platforms.abbreviation",
  "language_supports.language.name",
  "language_supports.language.locale",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "videos.video_id",
  "videos.name",
  // « DLC de … », « Remaster de … » : le type IGDB et le jeu parent.
  "game_type",
  "parent_game.id",
  "parent_game.name",
  "version_parent.id",
  "version_parent.name",
  // Pays du studio : sert à deviner la langue d'origine (cf. ORIGIN_LANGUAGES).
  "involved_companies.developer",
  "involved_companies.company.country",
].join(",");

// Langue d'origine, devinée depuis le PAYS DU STUDIO (code ISO 3166-1
// numérique, tel qu'IGDB le fournit). C'est le seul signal disponible : l'API
// dit quelles langues un jeu propose, jamais laquelle est la sienne. Un studio
// japonais → jeu pensé en japonais, un studio polonais → en polonais, etc.
// Pour tout le reste (et les studios sans pays renseigné), on retombe sur
// l'anglais, qui est la langue de référence du secteur.
const ORIGIN_LANGUAGES = {
  392: "Japonais",
  410: "Coréen",
  156: "Chinois (simplifié)",
  158: "Chinois (traditionnel)",
  250: "Français",
  276: "Allemand",
  380: "Italien",
  724: "Espagnol (Espagne)",
  616: "Polonais",
  643: "Russe",
  804: "Ukrainien",
  752: "Suédois",
  578: "Norvégien",
  208: "Danois",
  246: "Finnois",
  528: "Néerlandais",
  76: "Portugais (Brésil)",
  620: "Portugais (Portugal)",
  203: "Tchèque",
  348: "Hongrois",
  792: "Turc",
  764: "Thaï",
  704: "Vietnamien",
  360: "Indonésien",
  484: "Espagnol (Amérique latine)",
  32: "Espagnol (Amérique latine)",
};

const MAX_LIST_DETAILS = 60;

router.get("/list-details", optionalAuth, async (req, res) => {
  try {
    const ids = [...new Set(parseIds(req.query.ids))].slice(0, MAX_LIST_DETAILS);
    if (!ids.length) return res.json({ games: [] });

    const rows = await igdbQuery(
      "games",
      `fields ${LIST_DETAIL_FIELDS}; where id = (${ids.join(",")}); limit ${ids.length};`
    );

    const byArea = (a, b) =>
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0);
    const nowSec = Math.floor(Date.now() / 1000);

    const games = rows.map((g) => {
      // Langues dédupliquées + code pays du drapeau (même logique que /full).
      const langByName = new Map();
      for (const ls of g.language_supports || []) {
        const raw = ls.language?.name;
        if (!raw) continue;
        const name = frName(LANGUAGES_FR, raw);
        if (langByName.has(name)) continue;
        const region = (ls.language?.locale || "").split("-")[1];
        langByName.set(name, { name, cc: region ? region.toLowerCase() : null });
      }

      // La bande-annonce d'abord : IGDB range rarement les vidéos, mais celle
      // qui s'appelle « trailer » est presque toujours la bonne.
      const videos = (g.videos || []).filter((v) => v.video_id);
      const trailer =
        videos.find((v) => /trailer|bande|reveal/i.test(v.name || "")) || videos[0];

      // Langue d'origine : pays du premier studio de développement connu.
      const devCountry = (g.involved_companies || []).find(
        (c) => c.developer && c.company?.country
      )?.company?.country;
      const guessed = ORIGIN_LANGUAGES[devCountry] || "Anglais";
      // On ne l'annonce que si le jeu la propose vraiment ; sinon la mention
      // serait fausse (studio japonais dont le jeu ne sort qu'en anglais).
      const original =
        [...langByName.values()].find((l) => l.name === guessed) ||
        langByName.get("Anglais") ||
        null;

      // « DLC de … », « Remaster de … » : rien à afficher pour un jeu de base.
      const typeFr = GAME_TYPES_FR[g.game_type];
      const parent = g.parent_game || g.version_parent || null;

      return {
        id: g.id,
        name: g.name,
        summary: g.summary ? String(g.summary).slice(0, 600) : null,
        cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
        releaseDate: g.first_release_date || null,
        released: !!(g.first_release_date && g.first_release_date <= nowSec),
        rating: g.total_rating ? Math.round(g.total_rating) : null,
        ratingCount: g.total_rating_count || 0,
        genres: (g.genres || []).map((x) => frName(GENRES_FR, x.name)),
        platforms: (g.platforms || []).map((p) => ({
          id: p.id,
          name: p.name,
          abbr: p.abbreviation || p.name,
        })),
        languages: [...langByName.values()].sort((a, b) =>
          a.name.localeCompare(b.name, "fr")
        ),
        originalLanguage: original,
        french: langByName.get("Français") || null,
        kind: typeFr
          ? {
              label: typeFr.label,
              parent: parent ? { id: parent.id, name: parent.name } : null,
            }
          : null,
        screenshots: (g.screenshots || [])
          .filter((s) => s.image_id)
          .sort(byArea)
          // Le rail mobile les fait toutes défiler : une douzaine donne de quoi
          // glisser sans gonfler la réponse pour soixante jeux.
          .slice(0, 12)
          .map((s) => ({
            id: s.image_id,
            thumb: `${IMG_BASE}/t_screenshot_med/${s.image_id}.jpg`,
            full: `${IMG_BASE}/t_1080p/${s.image_id}.jpg`,
          })),
        trailer: trailer
          ? { videoId: trailer.video_id, name: trailer.name || "Bande-annonce" }
          : null,
      };
    });

    res.json({ games });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Parmi une liste d'ids de jeux, ceux qui ont AU MOINS un personnage
// (IGDB ou communauté) — pour signaler les jeux exploitables avant de cliquer.
router.get("/characters-availability", requireAuth, async (req, res) => {
  try {
    const ids = parseIds(req.query.ids);
    if (!ids.length) return res.json({ ids: [] });
    const [igdbChars, customIds] = await Promise.all([
      igdbQuery(
        "characters",
        `fields games; where games = (${ids.join(",")}); limit 500;`
      ).catch(() => []),
      CustomCharacter.find({ gameId: { $in: ids } }).distinct("gameId"),
    ]);
    const set = new Set();
    for (const c of igdbChars) for (const g of c.games || []) set.add(g);
    for (const g of customIds) set.add(g);
    res.json({ ids: ids.filter((id) => set.has(id)) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Recherche de personnages par nom (IGDB + communauté).
router.get("/characters-search", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().replace(/["\\]/g, "");
    if (!q) return res.json({ characters: [] });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const [raw, customs] = await Promise.all([
      igdbQuery(
        "characters",
        `search "${q}"; fields name,mug_shot.image_id,games.name; limit 24;`
      ).catch(() => []),
      CustomCharacter.find({ name: rx }).sort({ createdAt: -1 }).limit(24),
    ]);

    // Résout le nom des jeux des persos communautaires en un seul appel.
    const gameIds = [...new Set(customs.map((c) => c.gameId).filter(Boolean))];
    let nameById = {};
    if (gameIds.length) {
      const gs = await igdbQuery(
        "games",
        `fields name; where id = (${gameIds.join(",")}); limit ${gameIds.length};`
      ).catch(() => []);
      nameById = Object.fromEntries(gs.map((g) => [g.id, g.name]));
    }

    const characters = [
      ...customs.map((c) => ({
        id: String(c._id),
        name: c.name,
        image: c.image,
        gameId: c.gameId,
        gameName: nameById[c.gameId] || "",
        custom: true,
        mine: String(c.addedBy) === String(req.userId),
      })),
      ...raw.map((c) => ({
        id: `igdb-${c.id}`,
        name: c.name,
        image: c.mug_shot?.image_id
          ? `${IMG_BASE}/t_cover_big/${c.mug_shot.image_id}.jpg`
          : null,
        gameId: c.games?.[0]?.id ?? null,
        gameName: c.games?.[0]?.name || "",
      })),
    ];
    res.json({ characters });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function ostFromCustom(c) {
  return {
    id: `yt-${c._id}`,
    name: c.name,
    artist: c.artist || "YouTube",
    artwork: c.artwork,
    youtube: true,
    videoId: c.videoId,
    url: c.url,
    // Relevés au scraping (cf. lib/ostScrape). Ils servaient au blind test ;
    // ils servent aussi à trier et filtrer une bande originale de deux cents
    // pistes — « les plus écoutées » et « les plus longues » sont les deux
    // façons d'y entrer quand on ne connaît pas le jeu.
    views: c.views ?? null,
    durationSec: c.durationSec ?? null,
  };
}

// --- OST d'un jeu : pistes YouTube (scrapées auto + communauté), moins les masquées ---
router.get("/:id/ost", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = String(req.query.q || "").trim();
    // `peek=1` : « montre ce que tu as déjà, ne va rien chercher ». C'est le
    // mode de l'aperçu sur la fiche d'un jeu — sans lui, feuilleter vingt
    // fiches lancerait vingt scrapings YouTube pour des OST que personne n'a
    // demandé à écouter.
    const peek = req.query.peek === "1";
    // Pistes déjà en base (auto par ordre de playlist, puis ajouts manuels).
    let customs = await CustomOst.find({ gameId: id }).sort({ order: 1, createdAt: 1 });
    // Première ouverture (aucune piste) : scraping auto d'une playlist YouTube.
    if (!customs.length && !peek) {
      customs = await ensureScraped(id, q);
    }
    // Masquages / renommages sont propres à chaque utilisateur : rien pour un
    // visiteur non connecté (il voit toutes les pistes, sans corbeille perso).
    const [hiddenDoc, renameDoc] = req.userId
      ? await Promise.all([
          HiddenOst.findOne({ user: req.userId, gameId: id }),
          OstRename.findOne({ user: req.userId, gameId: id }),
        ])
      : [null, null];
    const hidden = new Set(hiddenDoc?.hidden || []);
    const renames = renameDoc?.renames;
    const all = customs.map(ostFromCustom).map((t) => {
      const renamed = renames?.get(t.id);
      return renamed ? { ...t, name: renamed } : t;
    });
    // Visibles + masquées (la corbeille) : on renvoie les deux pour pouvoir
    // proposer de restaurer une piste retirée.
    const tracks = all.filter((t) => !hidden.has(t.id));
    const hiddenTracks = all.filter((t) => hidden.has(t.id));
    // `pending` : rien en base ET on n'a pas cherché. Le client sait alors
    // qu'il reste peut-être une OST à découvrir, et propose de l'ouvrir.
    res.json({ tracks, hiddenTracks, pending: peek && !customs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Infos d'une vidéo YouTube (titre auto) ---
router.get("/yt-info", requireAuth, async (req, res) => {
  const videoId = youtubeId(req.query.url || "");
  if (!videoId) return res.json({ videoId: null });
  const info = await ytOembed(videoId);
  res.json({ videoId, title: info?.title || "", author: info?.author || "" });
});

// --- Ajout d'une piste d'OST via un lien YouTube (titre auto si absent) ---
// L'OST d'un jeu est commune à tout le site : ajouter, retirer ou renommer une
// piste est réservé au staff (voir requireStaff).
router.post("/:id/ost", requireAuth, requireStaff, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const videoId = youtubeId(url);
    if (!videoId) return res.status(400).json({ error: "Lien YouTube invalide." });
    let name = String(req.body?.name || "").trim();
    let artist = String(req.body?.artist || "").trim();
    if (!name || !artist) {
      const info = await ytOembed(videoId);
      if (!name) name = info?.title || "OST";
      if (!artist) artist = info?.author || null;
    }
    const co = await CustomOst.create({
      gameId: Number(req.params.id),
      name,
      artist: artist || null,
      url,
      videoId,
      artwork: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      source: "user",
      order: Date.now(), // après les pistes auto (ordres 0..199)
      addedBy: req.userId,
    });
    res.status(201).json({ track: ostFromCustom(co) });
  } catch (err) {
    console.error("ost add error:", err.message);
    res.status(500).json({ error: "Échec de l'ajout." });
  }
});

// --- Import d'une playlist YouTube entière ---
router.post("/:id/ost/playlist", requireAuth, requireStaff, async (req, res) => {
  try {
    const playlistId = youtubePlaylistId(req.body?.url || "");
    if (!playlistId)
      return res.status(400).json({ error: "Lien de playlist YouTube invalide." });
    const items = await ytPlaylistTracks(playlistId);
    if (!items.length)
      return res.status(404).json({ error: "Playlist vide ou introuvable." });

    const gameId = Number(req.params.id);
    const limited = items.slice(0, 200);
    const base = Date.now();
    const docs = await CustomOst.insertMany(
      limited.map((it, i) => ({
        gameId,
        name: it.title,
        artist: null,
        url: `https://www.youtube.com/watch?v=${it.videoId}`,
        videoId: it.videoId,
        artwork: `https://img.youtube.com/vi/${it.videoId}/mqdefault.jpg`,
        source: "user",
        order: base + i, // après les pistes auto, dans l'ordre de la playlist
        addedBy: req.userId,
      }))
    );
    res.status(201).json({ tracks: docs.map(ostFromCustom), count: docs.length });
  } catch (err) {
    console.error("ost playlist error:", err.message);
    res.status(500).json({ error: "Échec de l'import de la playlist." });
  }
});

// --- Masquer des OST pour cet utilisateur (retirer "pour de bon") ---
router.post("/:id/ost/hide", requireAuth, requireStaff, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: "Aucune piste." });
    await HiddenOst.updateOne(
      { user: req.userId, gameId: Number(req.params.id) },
      { $addToSet: { hidden: { $each: ids } } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Échec." });
  }
});

// --- Restaurer des OST masquées (les sortir de la corbeille) ---
router.post("/:id/ost/unhide", requireAuth, requireStaff, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: "Aucune piste." });
    await HiddenOst.updateOne(
      { user: req.userId, gameId: Number(req.params.id) },
      { $pull: { hidden: { $in: ids } } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Échec." });
  }
});

// --- Renommer des OST en masse pour cet utilisateur (ex: retirer un préfixe) ---
router.post("/:id/ost/rename", requireAuth, requireStaff, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.renames) ? req.body.renames : [];
    const entries = list
      .map((r) => [String(r?.id || ""), String(r?.name || "").trim()])
      .filter(([id, name]) => id && name);
    if (!entries.length) return res.status(400).json({ error: "Aucune piste." });
    const set = {};
    for (const [id, name] of entries) set[`renames.${id}`] = name;
    await OstRename.updateOne(
      { user: req.userId, gameId: Number(req.params.id) },
      { $set: set },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Échec du renommage." });
  }
});

// --- Détails d'un jeu pour la modal : covers alternatives, plateformes, temps ---
// Jeux inclus dans un bundle (game_type 3) : IGDB n'a pas de champ « contenu »
// sur le bundle lui-même — on interroge les jeux qui le référencent dans LEUR
// champ `bundles`. Ordre chronologique de sortie.
async function fetchBundleGames(bundleId, releaseDate = null) {
  const list = (await gameBundleContents(bundleId, releaseDate).catch(() => [])) || [];
  return list
    .map((g) => ({
      id: g.id,
      name: g.name,
      cover: g.cover?.image_id
        ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg`
        : null,
      rating: g.total_rating ? Math.round(g.total_rating) : null,
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getFullYear()
        : null,
      releaseDate: g.first_release_date || null,
    }))
    .sort((a, b) => (a.releaseDate || Infinity) - (b.releaseDate || Infinity));
}

// ======================================================================
//  Les contenus additionnels d'un jeu
// ======================================================================
// Un DLC n'est pas un jeu qu'on RANGE : c'est quelque chose qu'on a, ou pas,
// SUR un jeu qu'on a déjà. Lui donner une entrée de bibliothèque à lui — avec
// son statut, sa note, son temps de jeu — gonflait le compte de jeux de
// quinze packs de skins et laissait « Blood and Wine » terminé à côté d'un
// Sorceleur 3 en cours, comme deux titres sans rapport.
//
// La feuille de suivi du jeu de base les liste donc à cocher (cf. `dlcs` dans
// server/src/routes/library.js). Ils viennent de la fiche déjà chargée, sans
// une requête de plus.
//
// ⚠️ LES EXTENSIONS N'EN SONT PAS, ET C'EST VOLONTAIRE. Phantom Liberty,
// Blood and Wine, Shadow of the Erdtree : ce sont des jeux qu'on lance, qu'on
// finit, qu'on note — pas des cases à cocher. Seul le `game_type` 1 (DLC) est
// retenu ; les extensions (2) et les extensions autonomes (4) gardent leur
// fiche et leur suivi.
const DLC_RELATIONS = ["dlcs", "expansions", "standalone_expansions"];
const DLC_TYPE = 1;

function gameDlcs(g) {
  const seen = new Set();
  const out = [];
  for (const rel of DLC_RELATIONS) {
    for (const d of g?.[rel] || []) {
      if (!d?.id || !d?.name || seen.has(d.id)) continue;
      if (d.game_type !== DLC_TYPE) continue;
      seen.add(d.id);
      out.push({
        id: d.id,
        name: d.name,
        cover: d.cover?.image_id ? `${IMG_BASE}/t_cover_big/${d.cover.image_id}.jpg` : null,
        // Le type dit ce qu'on coche : une extension de trente heures et un
        // pack d'armures ne se cochent pas du même cœur.
        typeLabel: GAME_TYPES_FR[d.game_type]?.label || null,
        year: d.first_release_date
          ? new Date(d.first_release_date * 1000).getFullYear()
          : null,
        releaseDate: d.first_release_date || null,
      });
    }
  }
  // Du plus ancien au plus récent : c'est l'ordre où on les a joués.
  return out.sort((a, b) => (a.releaseDate || Infinity) - (b.releaseDate || Infinity));
}

// ======================================================================
//  Les éditions d'un jeu : la même partie, dans une autre boîte
// ======================================================================
// « Deluxe », « GOTY », « édition Nintendo Switch 2 », le portage PC d'un jeu
// console : ce ne sont pas d'autres jeux. C'est LE jeu, acheté autrement. Leur
// donner chacun une entrée de bibliothèque coupait la même partie en trois
// lignes, avec trois notes et trois temps de jeu.
//
// La feuille de suivi pose donc UNE question à la place : à quelle édition
// as-tu joué ? La réponse par défaut est « Standard » — c'est le cas de la
// grande majorité —, et le client n'envoie que ce qui s'en écarte (cf. le
// champ `edition` dans server/src/routes/library.js).
//
// ⚠️ REMAKES, REMASTERS ET VERSIONS ENRICHIES RESTENT DES JEUX. On ne note pas
// Demon's Souls 2020 comme celui de 2009, et Persona 4 Golden a sa propre
// histoire : eux gardent leur fiche et leur suivi.
const EDITION_PORT_TYPE = 11;

function editionRow(g, fallbackLabel) {
  return {
    id: g.id,
    name: g.name,
    cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
    typeLabel: GAME_TYPES_FR[g.game_type]?.label || fallbackLabel,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    releaseDate: g.first_release_date || null,
  };
}

/** Les éditions (dont ce jeu est le parent) et ses portages, en une liste. */
function gameEditions(g, editions) {
  const seen = new Set();
  const out = [];
  for (const e of editions || []) {
    if (!e?.id || !e?.name || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(editionRow(e, "Édition"));
  }
  for (const p of g?.ports || []) {
    if (!p?.id || !p?.name || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(editionRow(p, "Portage"));
  }
  return out.sort((a, b) => (a.releaseDate || Infinity) - (b.releaseDate || Infinity));
}

// Les boutiques où un jeu se vend, telles qu'IGDB les connaît. La feuille de
// suivi du mobile s'en sert pour remplacer « physique ou démat ? » — qui ne
// veut rien dire sur PC — par « où l'as-tu pris ? ».
//
// ⚠️ DEUX LECTURES, PARCE QU'IGDB A CHANGÉ D'AVIS. L'ancien champ `category`
// est devenu `external_game_source` ; on lit la source quand elle est là, et
// on retombe sur l'URL du lien, qui, elle, ne bouge pas.
const STORE_SOURCES = {
  1: "steam",
  5: "gog",
  11: "microsoft",
  13: "appstore",
  15: "googleplay",
  26: "epic",
  30: "itch",
  36: "playstation",
};

const STORE_URLS = [
  [/steampowered.com|steamcommunity.com/i, "steam"],
  [/gog.com/i, "gog"],
  [/epicgames.com/i, "epic"],
  [/itch.io/i, "itch"],
  [/microsoft.com|xbox.com/i, "microsoft"],
  [/play.google.com/i, "googleplay"],
  [/apps.apple.com|itunes.apple.com/i, "appstore"],
  [/playstation.com/i, "playstation"],
];

//
// Les liens externes viennent maintenant de la fiche elle-même (`external_games`
// fait partie des champs demandés à IGDB en une fois) : plus de requête à part.
function storesFrom(externalGames) {
  const found = new Set();
  for (const r of externalGames || []) {
    const bySource = STORE_SOURCES[r.external_game_source];
    if (bySource) found.add(bySource);
    const byUrl = STORE_URLS.find(([re]) => re.test(String(r.url || "")));
    if (byUrl) found.add(byUrl[1]);
  }
  return [...found];
}

router.get("/:id/details", optionalAuth, markStaff, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    // La fiche part en premier, mais on n'attend PAS qu'elle arrive pour lancer
    // le reste : les personnages n'ont besoin de sa date de sortie que pour
    // dater leur entrée de cache, et ça se promet.
    const corePromise = gameCore(id);
    const datePromise = corePromise.then((g) => g?.first_release_date ?? null).catch(() => null);

    const [core, customCovers, charArr, customChars] = await Promise.all([
      corePromise,
      CustomCover.find({ gameId: id }).sort({ createdAt: -1 }),
      gameCharacters(id, datePromise).catch(() => []),
      CustomCharacter.find({ gameId: id }).sort({ createdAt: -1 }),
    ]);

    const g = core || {};
    const covers = [];
    if (g.cover?.image_id)
      covers.push({ id: g.cover.image_id, url: `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` });
    for (const a of g.artworks || [])
      covers.push({ id: a.image_id, url: `${IMG_BASE}/t_720p/${a.image_id}.jpg` });
    for (const c of customCovers)
      covers.push({ id: String(c._id), url: c.url, custom: true });

    const igdbChars = (charArr || []).map((c) => ({
      id: `igdb-${c.id}`,
      name: c.name,
      image: c.mug_shot?.image_id
        ? `${IMG_BASE}/t_cover_big/${c.mug_shot.image_id}.jpg`
        : null,
    }));
    const communityChars = (customChars || []).map((c) => ({
      id: String(c._id),
      name: c.name,
      image: c.image,
      custom: true,
      mine: String(c.addedBy) === String(req.userId),
      // Modifiable / supprimable : le staff modère les personnages de tous,
      // les autres n'ont plus la main (même sur les leurs) depuis que
      // l'ajout est réservé au staff.
      editable: !!req.isStaff,
    }));

    // Pour les visual novels, on complète avec les personnages de VNDB
    // (IGDB en manque souvent). Les deux appels externes tournent en parallèle.
    const isVn = (g.genres || []).some(
      (x) => x.id === 34 || /visual novel/i.test(x.name || "")
    );
    // Jeu « sorti » : date passée, ou (à défaut de date) déjà noté par la
    // communauté → on ne scrape HLTB que dans ce cas.
    const nowSec = Math.floor(Date.now() / 1000);
    const released =
      (g.first_release_date && g.first_release_date <= nowSec) ||
      (!g.first_release_date && (g.total_rating_count || 0) > 0);
    const stores = storesFrom(g.external_games);
    // Les éditions de CE jeu (Deluxe, GOTY, édition console…) : ce sont
    // d'AUTRES jeux qui le citent comme parent, IGDB ne les porte donc pas sur
    // sa fiche. ⚠️ On repose la question EXACTEMENT comme /related (même saga
    // en second membre) : la réponse est mise en cache sous la seule clé du
    // jeu, et une question plus étroite priverait l'onglet Univers de sa saga.
    const bestFranchise = franchisesOf(g)[0] || null;
    const whereRel = bestFranchise
      ? `${bestFranchise.kind === "collection" ? "collections" : "franchises"} = (${bestFranchise.id})`
      : null;
    const [ttb, vnChars, bundleGames, relatives] = await Promise.all([
      resolveTimeToBeat(id, g.name, released, g.first_release_date ?? null),
      isVn ? resolveVnCharacters(id, g.name) : Promise.resolve([]),
      // Bundle : la modale « joué » propose de cocher chaque jeu inclus.
      g.game_type === 3
        ? fetchBundleGames(id, g.first_release_date ?? null)
        : Promise.resolve([]),
      gameRelatives(id, whereRel, g.first_release_date ?? null).catch(() => null),
    ]);

    // Dédoublonnage : on n'ajoute un perso VNDB que si son nom n'existe pas déjà.
    const seen = new Set([...igdbChars, ...communityChars].map((c) => normCharName(c.name)));
    const vnAdd = vnChars.filter((c) => {
      const k = normCharName(c.name);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Personnages : IGDB + VNDB + communauté, portraits d'abord (tri stable).
    const characters = [...igdbChars, ...vnAdd, ...communityChars].sort(
      (a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0)
    );

    // Jeux « sans fin » potentiels : multijoueur (2), MMO (5) ou battle
    // royale (6) selon IGDB → la modale propose alors le statut « Sans fin ».
    // (la fiche partagée développe `game_modes` en { id, name } — l'ancienne
    // requête d'ici n'en demandait que les ids bruts.)
    const endlessHint = (g.game_modes || []).some((m) => [2, 5, 6].includes(m?.id ?? m));

    // Date de sortie PAR PLATEFORME : un jeu ne sort pas le même jour partout,
    // et la feuille de suivi propose « commencé à la sortie » sur la console
    // qu'on a cochée. On garde la plus ancienne date de chaque plateforme —
    // IGDB en liste une par région, et c'est la première qui fait foi.
    const releaseByPlatform = new Map();
    for (const r of g.release_dates || []) {
      if (!r?.platform || !r?.date) continue;
      const known = releaseByPlatform.get(r.platform);
      if (known == null || r.date < known) releaseByPlatform.set(r.platform, r.date);
    }

    res.json({
      platforms: (g.platforms || []).map((p) => ({
        id: p.id,
        name: p.name,
        // Le nom court d'IGDB (« PS5 », « PC »…) : de quoi tenir dans une
        // pastille sans réécrire « PC (Microsoft Windows) ».
        abbr: p.abbreviation || null,
        releaseDate: releaseByPlatform.get(p.id) ?? null,
      })),
      covers,
      characters,
      timeToBeat: ttb.times,
      // Scrape HLTB en cours : le client re-poll pour récupérer les temps.
      timeToBeatPending: ttb.pending,
      endlessHint,
      stores,
      bundleGames,
      // Les contenus additionnels, à cocher dans la feuille de suivi.
      dlcs: gameDlcs(g),
      // Les éditions et portages : « à quelle édition as-tu joué ? »
      editions: gameEditions(g, relatives?.editions),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// --- Upload d'une cover custom (réutilisable par les autres) ---
router.post("/:id/cover", requireAuth, upload.single("cover"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Image manquante ou invalide." });
    const url = `${req.protocol}://${req.get("host")}/uploads/covers/${req.file.filename}`;
    const cc = await CustomCover.create({
      gameId: Number(req.params.id),
      url,
      uploadedBy: req.userId,
    });
    res.status(201).json({ cover: { id: String(cc._id), url, custom: true } });
  } catch (err) {
    console.error("cover upload error:", err.message);
    res.status(500).json({ error: "Échec de l'upload." });
  }
});

// --- Ajout d'un personnage custom (nom + image optionnelle, partagé) ---
// Partagé par tout le site → réservé au staff, comme l'OST.
router.post("/:id/character", requireAuth, requireStaff, upload.single("image"), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Le nom du personnage est requis." });
    const image = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/covers/${req.file.filename}`
      : null;
    const cc = await CustomCharacter.create({
      gameId: Number(req.params.id),
      name,
      image,
      addedBy: req.userId,
    });
    res
      .status(201)
      .json({ character: { id: String(cc._id), name, image, custom: true, mine: true } });
  } catch (err) {
    console.error("character add error:", err.message);
    res.status(500).json({ error: "Échec de l'ajout du personnage." });
  }
});

// --- Modifier un perso custom (le staff modère ceux de tout le monde) ---
router.put("/:id/character/:charId", requireAuth, requireStaff, upload.single("image"), async (req, res) => {
  try {
    const cc = await CustomCharacter.findById(req.params.charId);
    if (!cc) return res.status(404).json({ error: "Personnage introuvable." });
    const name = String(req.body?.name || "").trim();
    if (name) cc.name = name;
    if (req.file)
      cc.image = `${req.protocol}://${req.get("host")}/uploads/covers/${req.file.filename}`;
    await cc.save();
    res.json({
      character: { id: String(cc._id), name: cc.name, image: cc.image, custom: true, mine: true },
    });
  } catch (err) {
    console.error("character edit error:", err.message);
    res.status(500).json({ error: "Échec de la modification." });
  }
});

// --- Retirer un perso custom (le staff modère ceux de tout le monde) ---
router.delete("/:id/character/:charId", requireAuth, requireStaff, async (req, res) => {
  try {
    const cc = await CustomCharacter.findById(req.params.charId);
    if (!cc) return res.json({ ok: true });
    await cc.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Échec." });
  }
});

// --- Page complète d'un jeu : description, studios, médias, similaires… ---

// IGDB website.category -> réseau/plateforme reconnaissable côté client
const WEBSITE_KINDS = {
  1: "official",
  3: "wikipedia",
  9: "youtube",
  13: "steam",
  16: "epic",
  17: "gog",
  15: "itch",
  6: "twitch",
  5: "twitter",
  14: "reddit",
  18: "discord",
};

// Types de jeu IGDB (game_type) : libellé + tournure française pour la
// mention « Ce jeu est un remake de … » et les badges de l'onglet Univers.
const GAME_TYPES_FR = {
  1: { label: "DLC", phrase: "un DLC" },
  2: { label: "Extension", phrase: "une extension" },
  3: { label: "Bundle", phrase: "un bundle" },
  4: { label: "Extension autonome", phrase: "une extension autonome" },
  5: { label: "Mod", phrase: "un mod" },
  6: { label: "Épisode", phrase: "un épisode" },
  7: { label: "Saison", phrase: "une saison" },
  8: { label: "Remake", phrase: "un remake" },
  9: { label: "Remaster", phrase: "un remaster" },
  10: { label: "Version enrichie", phrase: "une version enrichie" },
  11: { label: "Portage", phrase: "un portage" },
  12: { label: "Fork", phrase: "un fork" },
  13: { label: "Pack", phrase: "un pack" },
  14: { label: "Mise à jour", phrase: "une mise à jour" },
};

// (l'ancienne liste FULL_FIELDS est devenue CORE_FIELDS dans lib/gameIgdb.js,
// partagée avec /details, /ratings, /related, /howlong… — une seule requête.)

router.get("/:id/full", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    // Titre français si IGDB en a un
    const fr = (g.alternative_names || []).find((a) => /french/i.test(a.comment || ""));

    // Médias : artworks + captures en 1080p (fond/plein écran) avec vignette,
    // typés pour permettre le filtrage côté client. Triés par résolution
    // décroissante (les plus nettes d'abord — pour un beau fond de page).
    const imgFull = (imgId) => `${IMG_BASE}/t_1080p/${imgId}.jpg`;
    const imgThumb = (imgId) => `${IMG_BASE}/t_screenshot_med/${imgId}.jpg`;
    const byArea = (a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0);
    const artworks = (g.artworks || []).filter((a) => a.image_id).sort(byArea);
    const screenshots = (g.screenshots || []).filter((s) => s.image_id).sort(byArea);

    const toMedia = (type) => (a) => ({
      type,
      id: a.image_id,
      full: imgFull(a.image_id),
      thumb: imgThumb(a.image_id),
      w: a.width || null,
      h: a.height || null,
    });

    const media = [
      ...(g.videos || [])
        .filter((v) => v.video_id)
        .map((v) => ({
          type: "video",
          videoId: v.video_id,
          name: v.name || "Vidéo",
          thumb: `https://img.youtube.com/vi/${v.video_id}/hqdefault.jpg`,
        })),
      ...artworks.map(toMedia("artwork")),
      ...screenshots.map(toMedia("screenshot")),
    ];

    // Fond de page : l'artwork le PLUS haute résolution (déjà trié), sinon la
    // meilleure capture. Jamais la jaquette portrait (affreuse étirée en fond).
    const backdrop = artworks[0]
      ? imgFull(artworks[0].image_id)
      : screenshots[0]
      ? imgFull(screenshots[0].image_id)
      : null;

    const companies = g.involved_companies || [];
    const developers = [
      ...new Set(companies.filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean)),
    ];
    const publishers = [
      ...new Set(companies.filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean)),
    ];

    // ⚠️ LES TROIS SOURCES LENTES PARTENT ENSEMBLE.
    //
    // Les logos des studios (Mongo, IGDB au premier appel), les temps de
    // complétion (qui peuvent aller jusqu'à HowLongToBeat) et la traduction
    // s'attendaient l'une l'autre : la fiche coûtait leur SOMME. Elles ne
    // dépendent de rien l'une chez l'autre — elle coûte maintenant la plus
    // lente des trois.
    const logosPromise = ensureEntityLogos("company", [...developers, ...publishers])
      .then((found) => Object.fromEntries(found))
      .catch(() => ({})); // best-effort : une fiche sans logo reste une fiche

    const websites = (g.websites || [])
      .map((w) => ({ url: w.url, kind: WEBSITE_KINDS[w.category] }))
      .filter((w) => w.kind);

    const similar = (g.similar_games || [])
      .filter((s) => s.cover?.image_id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        cover: `${IMG_BASE}/t_cover_big/${s.cover.image_id}.jpg`,
        rating: s.total_rating ? Math.round(s.total_rating) : null,
        year: s.first_release_date
          ? new Date(s.first_release_date * 1000).getFullYear()
          : null,
      }))
      .slice(0, 12);

    // Langues (dédupliquées) + code pays du drapeau, déduit de la locale IGDB
    // (ex: "fr-FR" -> "fr", "pt-BR" -> "br").
    const langByName = new Map();
    for (const ls of g.language_supports || []) {
      const raw = ls.language?.name;
      if (!raw) continue;
      const name = frName(LANGUAGES_FR, raw);
      if (langByName.has(name)) continue;
      const region = (ls.language?.locale || "").split("-")[1];
      langByName.set(name, { name, cc: region ? region.toLowerCase() : null });
    }
    const languages = [...langByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "fr")
    );

    // Jeu « sorti » : date passée, ou (à défaut de date) déjà noté par la
    // communauté. On ne scrape HLTB que dans ce cas (pas de temps pour un jeu
    // pas encore sorti). Aligné sur la logique upcoming/tbd du front.
    const nowSec = Math.floor(Date.now() / 1000);
    const released =
      (g.first_release_date && g.first_release_date <= nowSec) ||
      (!g.first_release_date && (g.total_rating_count || 0) > 0);
    const beatPromise = resolveTimeToBeat(id, g.name, released, g.first_release_date ?? null)
      .then((r) => r.times)
      .catch(() => null);

    // « Ce jeu est un remake / DLC / … de … » : type IGDB + jeu parent.
    //
    // ⚠️ LES ÉDITIONS N'ONT PAS DE TYPE CHEZ IGDB. « Deluxe », « GOTY »,
    // « édition Nintendo Switch 2 » sont des jeux de type 0 (jeu principal)
    // qui désignent leur original par `version_parent` — et rien d'autre ne
    // les distingue. Sans ce cas, la fiche d'une Deluxe ne disait pas de quoi
    // elle est l'édition, et l'app la suivait comme un jeu séparé.
    const typeFr =
      GAME_TYPES_FR[g.game_type] ||
      (g.version_parent ? { label: "Édition", phrase: "une édition" } : null);
    const relParent = g.parent_game || g.version_parent || null;
    const relation = typeFr
      ? {
          type: g.game_type,
          label: typeFr.label,
          phrase: typeFr.phrase,
          of: relParent
            ? {
                id: relParent.id,
                name: relParent.name,
                cover: relParent.cover?.image_id
                  ? `${IMG_BASE}/t_cover_small/${relParent.cover.image_id}.jpg`
                  : null,
              }
            : null,
        }
      : null;

    // Traduction FR du résumé/scénario si elle a déjà été demandée une fois
    // (best-effort, lecture Mongo seule — jamais d'appel Gemini ici).
    const [companyLogos, timeToBeat, translation, bundleGames] = await Promise.all([
      logosPromise,
      beatPromise,
      getCachedTranslation(id, g.summary || null, g.storyline || null).catch(() => ({
        summaryFr: null,
        storylineFr: null,
      })),
      // Bundle : les jeux inclus, affichés en section sur la fiche.
      g.game_type === 3
        ? fetchBundleGames(id, g.first_release_date ?? null)
        : Promise.resolve([]),
    ]);

    res.json({
      id: g.id,
      name: fr?.name || g.name,
      originalName: g.name,
      summary: g.summary || null,
      storyline: g.storyline || null,
      summaryFr: translation.summaryFr,
      storylineFr: translation.storylineFr,
      cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
      backdrop,
      media,
      // { id, name } : l'id IGDB permet de rendre les puces cliquables côté
      // client (→ Explorer filtré). Le name est traduit pour l'affichage.
      genres: (g.genres || []).map((x) => ({ id: x.id, name: frName(GENRES_FR, x.name) })),
      themes: (g.themes || []).map((x) => ({ id: x.id, name: frName(THEMES_FR, x.name) })),
      gameModes: (g.game_modes || []).map((x) => ({ id: x.id, name: frName(MODES_FR, x.name) })),
      perspectives: (g.player_perspectives || []).map((x) => x.name),
      platforms: (g.platforms || []).map((p) => ({
        id: p.id,
        name: p.name,
        abbr: p.abbreviation || p.name,
      })),
      releaseDate: g.first_release_date || null,
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getFullYear()
        : null,
      rating: g.total_rating ? Math.round(g.total_rating) : null,
      ratingCount: g.total_rating_count || 0,
      // Note des joueurs (IGDB) vs note des critiques (agrégée type Metacritic)
      playerRating: g.rating
        ? Math.round(g.rating)
        : g.total_rating
        ? Math.round(g.total_rating)
        : null,
      playerRatingCount: g.rating_count || g.total_rating_count || 0,
      criticRating: g.aggregated_rating ? Math.round(g.aggregated_rating) : null,
      criticRatingCount: g.aggregated_rating_count || 0,
      languages,
      developers,
      publishers,
      companyLogos,
      engines: (g.game_engines || []).map((e) => e.name).filter(Boolean),
      // ⚠️ PAS `franchises[0]`. IGDB range un crossover dans TOUTES les
      // licences qu'il invite — Super Smash Bros. Ultimate est chez Metroid,
      // Zelda, Kirby autant que chez lui —, et l'ordre du tableau n'est qu'un
      // ordre d'identifiants. La fiche annonçait donc « Saga Metroid » sous
      // Smash Bros. On choisit désormais celle dont le nom explique le titre
      // (cf. lib/franchises.js), et on rend la liste entière : quand il y en a
      // plusieurs, la fiche les montre toutes.
      franchise: mainFranchise(g),
      franchises: franchisesOf(g).map((f) => ({ id: f.id, kind: f.kind, name: f.name })),
      // Les autres noms du jeu — japonais, coréen, romanisations, titres de
      // travail. La fiche en fait une feuille où l'on peut adopter celui qu'on
      // préfère (cf. components/game/TitlesSheet.jsx côté mobile).
      titles: (g.alternative_names || [])
        .map((a) => ({ name: String(a?.name || "").trim(), comment: a?.comment || null }))
        .filter((a) => a.name && a.name !== g.name),
      relation,
      bundleGames,
      websites,
      similar,
      timeToBeat,
    });
  } catch (err) {
    console.error("game full error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Traduire en FR le résumé (« À propos ») et le scénario, à la demande.
// Traduit via Gemini au 1er clic puis met en cache (GameText) : les visites
// suivantes de tous les utilisateurs relisent la trad sans rappeler l'IA. ---
router.post("/:id/translate", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = [await gameCore(id)].filter(Boolean);
    const g = arr[0];
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });
    if (!g.summary && !g.storyline) {
      return res.status(400).json({ error: "Rien à traduire pour ce jeu." });
    }

    const out = await translateGameText(id, g.summary || null, g.storyline || null);
    res.json(out);
  } catch (err) {
    console.error("game translate error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Traduction impossible." });
  }
});

// ----------------------------------------------------------------------
//  Mode Trivia : les anecdotes de coulisses d'un jeu
// ----------------------------------------------------------------------
// Écrites une fois par jeu puis partagées par tout le monde (cf.
// lib/gameTrivia.js). C'est un paquet de cartes qu'on fait défiler et sur
// lesquelles on colle un émoji — pas une section de la fiche.

// Le paquet. Sur un jeu froid, la réponse arrive VIDE avec `pending: true` :
// l'écriture par l'IA dure plus longtemps que le mobile n'attend une réponse,
// donc c'est l'écran qui redemande (cf. lib/gameTrivia.js). `?retry=1` relance
// après une panne — un geste explicite, pas un sondage.
router.get("/:id/trivia", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const { doc, pending, error } = await ensureTrivia(id, g, {
      retry: req.query.retry === "1",
    });
    res.json({ ...serializeTrivia(doc, req.userId), pending, failed: error });
  } catch (err) {
    console.error("game trivia error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Anecdotes indisponibles." });
  }
});

// Coller (ou décoller) un émoji sur une anecdote. `emoji: null` retire.
router.post("/:id/trivia/react", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const key = String(req.body?.key || "").trim();
    if (!key) return res.status(400).json({ error: "Anecdote manquante." });

    const emoji = req.body?.emoji ? String(req.body.emoji) : null;
    const doc = await reactToFact(id, key, emoji, req.userId);
    res.json({ ...serializeTrivia(doc, req.userId), pending: false, failed: null });
  } catch (err) {
    console.error("game trivia react error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Réaction impossible." });
  }
});

// --- Onglet Patchs : mods + patchs de traduction. Cas spécifique traité : les
// visual novels non disponibles en français → on cherche sur VNDB s'il existe
// un patch de fan-traduction FR (avec son lien de téléchargement). ---
router.get("/:id/patches", requireAuth, requireDownloadAccess, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const isVn = (g.genres || []).some(
      (x) => x.id === 34 || /visual novel/i.test(x.name || "")
    );
    const hasFr = (g.language_supports || []).some((ls) =>
      /french|français/i.test(ls.language?.name || "")
    );
    // Nintendo Switch (id IGDB 130) → téléchargement nxbrew. On EXCLUT la
    // Switch 2 (id 508, nom « Nintendo Switch 2 ») : nxbrew ne la couvre pas.
    const isSwitch = (g.platforms || []).some(
      (p) =>
        p.id === 130 ||
        (p.id !== 508 && /switch/i.test(p.name || "") && !/switch\s*2/i.test(p.name || ""))
    );
    // PC Windows (id IGDB 6) → repacks FitGirl (jeux PC uniquement).
    const isPc = (g.platforms || []).some(
      (p) => p.id === 6 || /\b(pc|windows)\b/i.test(p.name || "")
    );

    // On n'interroge VNDB que pour un VN pas déjà en FR ; pour tout jeu Switch
    // on lit le patch poussé par l'app locale (même déjà traduit : la version
    // Switch est parfois censurée).
    const [vnPatches, sw] = await Promise.all([
      isVn && !hasFr ? resolveVnFrPatches(id, g.name) : Promise.resolve(null),
      isSwitch ? resolveSwitchFrPatch(id) : Promise.resolve(null),
    ]);

    res.json({
      name: g.name,
      isVn,
      hasFr,
      isSwitch,
      isPc,
      vnPatches, // null si non pertinent (pas un VN, ou déjà dispo en FR)
      switchPatch: sw?.patch || null, // patch poussé par l'app locale, ou null
      switchPatchRequested: !!sw?.requested, // une demande de scrape est en attente
      modLinks: buildModLinks(g.name),
    });
  } catch (err) {
    console.error("game patches error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Packs HD / torrents C411 pour un jeu (chargé à la demande depuis l'onglet
// Patchs, car l'appel externe est lent et ne concerne pas tous les jeux). ---
router.get("/:id/hd-packs", requireAuth, requireDownloadAccess, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const cover = g.cover?.image_id
      ? `${IMG_BASE}/t_cover_small/${g.cover.image_id}.jpg`
      : null;
    const packs = await fetchC411Packs(g.name);
    res.json({ name: g.name, cover, packs });
  } catch (err) {
    console.error("game hd-packs error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Repacks FitGirl (jeux PC) pour un jeu, chargés à la demande depuis l'onglet
// Patchs (l'appel externe est lent). Renvoie une liste de repacks avec poids et
// lien magnet. Le client ne monte ce bloc que pour les jeux PC (data.isPc). ---
router.get("/:id/fitgirl", requireAuth, requireDownloadAccess, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = [await gameCore(id)].filter(Boolean);
    const g = arr[0];
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const repacks = await fetchFitgirlRepacks(g.name);
    res.json({ name: g.name, repacks });
  } catch (err) {
    console.error("game fitgirl error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Résultats Ziperto (ROMs/NSP/XCI Switch & 3DS, jeux PC, VPK PS Vita…) pour un
// jeu, chargés à la demande depuis l'onglet Patchs (le scraping externe est lent).
// Renvoie une liste de posts avec titre, plateforme, jaquette et lien vers la page
// du jeu sur Ziperto (le lien de téléchargement se trouve sur cette page). ---
router.get("/:id/ziperto", requireAuth, requireDownloadAccess, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = [await gameCore(id)].filter(Boolean);
    const g = arr[0];
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const results = await fetchZipertoGames(g.name);
    res.json({ name: g.name, results });
  } catch (err) {
    console.error("game ziperto error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Proxy de téléchargement d'un .torrent C411 réécrit pour le compte de
// l'utilisateur : on récupère le fichier via notre clé partagée (aucun ratio
// consommé) puis on remplace l'URL d'annonce par le passkey de l'utilisateur
// → le leech des données comptera sur SON ratio. Nécessite d'être connecté et
// d'avoir renseigné son passkey. ---
router.get("/:id/hd-packs/:torrentId/torrent", requireAuth, requireDownloadAccess, async (req, res) => {
  try {
    const torrentId = String(req.params.torrentId || "").toLowerCase();
    if (!/^[a-f0-9]{20,64}$/.test(torrentId))
      return res.status(400).json({ error: "Torrent invalide." });

    const user = await User.findById(req.userId).select("+c411Passkey");
    const passkey = user?.c411Passkey;
    if (!passkey)
      return res
        .status(400)
        .json({ error: "Renseigne d'abord ton passkey C411 dans l'onglet Pack HD." });

    const buf = await fetchC411Torrent(torrentId);
    const out = rewriteAnnounce(buf, passkey);

    res.setHeader("Content-Type", "application/x-bittorrent");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${torrentId}.torrent"`
    );
    res.send(out);
  } catch (err) {
    console.error("hd-pack torrent proxy error:", err.message);
    res.status(err.status || 502).json({ error: err.message || "Erreur." });
  }
});

// --- Contenus liés (onglet Univers) : DLC, remakes, remasters, éditions,
// portages… + tous les jeux de la même licence en chronologie. ---
function mapRelGame(g) {
  return {
    id: g.id,
    name: g.name,
    cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
    rating: g.total_rating ? Math.round(g.total_rating) : null,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null,
    releaseDate: g.first_release_date || null,
    typeLabel: GAME_TYPES_FR[g.game_type]?.label || null,
    // Les consoles étaient déjà demandées à IGDB (cf. REL_EXPAND) mais
    // jetées ici. La page des extensions les affiche : sur un DLC, « sur
    // quelle machine » est la question qui vient juste après « c'est quoi ».
    platforms: (g.platforms || []).map((p) => ({
      id: p.id,
      name: p.name,
      abbr: p.abbreviation || p.name,
    })),
  };
}

// ======================================================================
//  Les licences d'un jeu, en cartes — et la page d'une licence
// ======================================================================
// Séparées de la fiche EXPRÈS. Habiller une licence coûte une requête IGDB de
// plus (une licence n'a pas d'image à elle : elle emprunte la jaquette de son
// jeu phare), et la fiche est la page la plus ouverte de l'app. Elle demande
// donc ça à côté, quand elle a fini de s'afficher.

router.get("/:id/franchises", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });
    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const list = franchisesOf(g);
    if (!list.length) return res.json({ franchises: [] });
    res.json({ franchises: await decorateFranchises(list) });
  } catch (err) {
    console.error("game franchises error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// ⚠️ TROIS SEGMENTS, LE MILIEU LITTÉRAL : aucune route `/:id/...` déclarée
// au-dessus ne peut l'attraper (leur deuxième segment est toujours un mot
// fixe — « reviews », « character »… — et jamais « franchise »).
router.get("/franchises/:kind/:fid", optionalAuth, async (req, res) => {
  try {
    const fid = Number(req.params.fid);
    const kind = req.params.kind === "collection" ? "collection" : "franchise";
    if (!fid) return res.status(400).json({ error: "licence invalide." });

    const [rows, name] = await Promise.all([
      franchiseGames(kind, fid),
      franchiseName(kind, fid).catch(() => null),
    ]);
    res.json({
      id: fid,
      kind,
      name: name || null,
      games: (rows || []).map(mapRelGame),
    });
  } catch (err) {
    console.error("franchise games error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

router.get("/:id/related", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    // La fiche porte déjà toute la parenté (DLC, remakes, portages, bundles…) :
    // ce sont des champs du jeu, ils voyagent avec lui.
    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    // Ce qu'IGDB ne peut PAS dire depuis la fiche, parce que ce sont d'autres
    // jeux qui pointent vers celui-ci (éditions) ou vers sa licence (saga) :
    // une requête pour les deux (cf. lib/gameIgdb.js).
    // La saga qu'on montre est celle qu'on ANNONCE — la mieux accordée au
    // titre, pas la première de la liste d'IGDB (cf. lib/franchises.js).
    const best = franchisesOf(g)[0] || null;
    const whereRel = best
      ? `${best.kind === "collection" ? "collections" : "franchises"} = (${best.id})`
      : null;
    const { editions, series: sagaPool } = (await gameRelatives(
      id,
      whereRel,
      g.first_release_date ?? null
    ).catch(() => null)) || { editions: [], series: [] };

    const parent = g.parent_game || g.version_parent || null;

    // Groupes directs (l'ordre définit l'affichage côté client)
    const rawGroups = [
      { id: "parent", items: parent ? [parent] : [] },
      {
        id: "dlc",
        items: [
          ...(g.dlcs || []),
          ...(g.expansions || []),
          ...(g.standalone_expansions || []),
        ],
      },
      { id: "remakes", items: g.remakes || [] },
      { id: "remasters", items: g.remasters || [] },
      { id: "expanded", items: [...(g.expanded_games || []), ...(g.forks || [])] },
      { id: "ports", items: g.ports || [] },
      { id: "bundles", items: g.bundles || [] },
    ];

    // Éditions de CE jeu (Deluxe, GOTY…) : jeux dont il est le version_parent.
    rawGroups.push({ id: "editions", items: editions || [] });

    // Dédup + mapping ; on garde la trace des ids déjà casés pour la saga.
    const seen = new Set([id]);
    const groups = [];
    for (const grp of rawGroups) {
      const items = [];
      for (const it of grp.items) {
        if (!it?.id || seen.has(it.id)) continue;
        seen.add(it.id);
        items.push(mapRelGame(it));
      }
      if (items.length) {
        items.sort((a, b) => (a.releaseDate || Infinity) - (b.releaseDate || Infinity));
        groups.push({ id: grp.id, items });
      }
    }

    // Saga : tous les jeux principaux de la même franchise (ou collection),
    // hors éditions/remasters « version de », en ordre chronologique. Le pool
    // est déjà là (même requête que les éditions) ; il ne reste qu'à retirer ce
    // qui a déjà trouvé sa place dans un groupe ci-dessus.
    const series = (sagaPool || []).filter((x) => !seen.has(x.id)).map(mapRelGame);

    res.json({
      franchise: mainFranchise(g),
      groups,
      series,
    });
  } catch (err) {
    console.error("game related error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Succès Steam d'un jeu ---
// L'appid Steam est déduit d'IGDB (external_games catégorie 1 = Steam, sinon
// l'URL du site Steam). On liste ensuite les succès (schéma) + leur rareté
// (pourcentage global de déblocage). Nécessite STEAM_API_KEY dans server/.env.
const steamAchCache = createTtlCache({
  name: "steam:achievements",
  max: 300,
  ttl: 6 * 60 * 60 * 1000,
});

async function resolveSteamAppId(gameId) {
  try {
    // Les liens externes font partie de la fiche mise en cache : deux requêtes
    // IGDB de moins, et zéro dès la deuxième visite.
    const all = (await gameCore(gameId))?.external_games || [];
    // external_game_source = 1 → Steam (uid = appid). IGDB a remplacé l'ancien
    // champ `category` par `external_game_source` ; si l'enum évolue encore, on
    // retombe sur les liens qui pointent vers le store Steam.
    let rows = all.filter((r) => r.external_game_source === 1);
    if (!rows.length) {
      rows = all.filter((r) => /steampowered\.com\/app\//.test(String(r.url || "")));
    }
    for (const r of rows) {
      const m = String(r.url || "").match(/app\/(\d+)/);
      if (m) return m[1]; // l'appid depuis l'URL (le plus fiable)
      if (r.uid && /^\d+$/.test(String(r.uid))) return String(r.uid);
    }
  } catch {
    /* IGDB indispo / champ inconnu : pas d'appid */
  }
  return null;
}

router.get("/:id/achievements", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });
    if (!process.env.STEAM_API_KEY) return res.json({ available: false, reason: "no_key" });

    const appid = await resolveSteamAppId(id);
    if (!appid) return res.json({ available: false, reason: "no_appid" });

    const cached = steamAchCache.get(appid);
    if (cached !== undefined) return res.json(cached);

    const key = process.env.STEAM_API_KEY;
    const [schemaRes, pctRes] = await Promise.all([
      fetch(
        `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=french`
      ),
      fetch(
        `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`
      ),
    ]);
    const schema = schemaRes.ok ? await schemaRes.json().catch(() => null) : null;
    const pct = pctRes.ok ? await pctRes.json().catch(() => null) : null;

    const list = schema?.game?.availableGameStats?.achievements || [];
    const pctMap = new Map(
      (pct?.achievementpercentages?.achievements || []).map((a) => [a.name, a.percent])
    );
    const achievements = list
      .map((a) => ({
        name: a.name,
        title: a.displayName || a.name,
        desc: a.description || "",
        hidden: a.hidden === 1 || a.hidden === true,
        icon: a.icon || null,
        percent: pctMap.has(a.name)
          ? Math.round(pctMap.get(a.name) * 10) / 10
          : null,
      }))
      // Les plus communs d'abord (progression), les plus rares en bas.
      .sort((x, y) => (y.percent ?? -1) - (x.percent ?? -1));

    const data = {
      available: true,
      appid,
      gameName: schema?.game?.gameName || null,
      count: achievements.length,
      achievements,
    };
    steamAchCache.set(appid, data);
    res.json(data);
  } catch (err) {
    console.error("steam achievements error:", err.message);
    res.json({ available: false, reason: "error" });
  }
});

// --- Trophées PSN d'un jeu (liste générique, visible par TOUS) ---
// Source unique : le compte PSN de l'admin (ADMIN_EMAIL). On y retrouve le jeu
// par nom, puis on renvoie la LISTE des trophées à débloquer + leur rareté
// globale. Aucune donnée perso (progression/obtenus) n'est exposée.
const psnTitlesCache = { ts: 0, titles: null }; // cache global (compte admin)
const PSN_TITLES_TTL = 30 * 60 * 1000; // 30 min

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[®™:'’.,!?_/\\|-]/g, " ")
    .replace(
      /\b(the|remastered|remaster|definitive|deluxe|goty|edition|hd|complete|trophies?)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

// Le viewer (par son id) est-il administrateur ? Sert à la modération des
// reviews et des réponses (suppression de n'importe quel contenu).
async function isUserAdmin(userId) {
  if (!userId) return false;
  const u = await User.findById(userId).select("isAdmin isSuperAdmin").lean();
  return !!(u?.isSuperAdmin || u?.isAdmin);
}

router.get("/:id/psn-trophies", optionalAuth, async (req, res) => {
  try {
    if (!isConfigured()) return res.json({ available: false, reason: "not_connected" });

    let accessToken = null;
    try {
      accessToken = await getServiceAccessToken();
    } catch {
      accessToken = null;
    }
    if (!accessToken) return res.json({ available: false, reason: "not_connected" });

    // Bibliothèque de trophées du compte de service (cache global 30 min)
    let titles = psnTitlesCache.titles;
    if (!titles || Date.now() - psnTitlesCache.ts >= PSN_TITLES_TTL) {
      titles = await fetchUserTitles(accessToken, "me");
      psnTitlesCache.titles = titles;
      psnTitlesCache.ts = Date.now();
    }

    const wanted = [req.query.name, req.query.altName]
      .filter(Boolean)
      .map(normName)
      .filter(Boolean);
    const match =
      titles.find((t) => wanted.includes(normName(t.trophyTitleName))) ||
      titles.find((t) => {
        const n = normName(t.trophyTitleName);
        return wanted.some((w) => n.includes(w) || w.includes(n));
      });

    if (!match) return res.json({ available: false, reason: "not_found" });

    const raw = await fetchTitleTrophies(
      accessToken,
      match.npCommunicationId,
      match.npServiceName,
      "me"
    );
    // On enlève tout ce qui est personnel à l'admin (obtenu / date). On garde la
    // définition du trophée + sa rareté globale (% de joueurs l'ayant débloqué).
    const trophies = raw.map((t) => ({
      id: t.id,
      name: t.name,
      detail: t.detail,
      icon: t.icon,
      type: t.type,
      hidden: t.hidden,
      percent: t.percent,
    }));

    res.json({
      available: true,
      title: {
        name: match.trophyTitleName,
        icon: match.trophyTitleIconUrl || null,
        platform: match.trophyTitlePlatform || null,
        defined: match.definedTrophies || {},
      },
      trophies,
    });
  } catch (err) {
    console.error("psn trophies error:", err.message);
    res.json({ available: false, reason: "error" });
  }
});

// --- Reviews d'un jeu (tous les utilisateurs) ---
// Nettoie les médias reçus du client (mêmes règles que les commentaires de liste).
function sanitizeReviewMedia(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m) =>
      m && (m.type === "gif" || m.type === "image") && m.url
        ? {
            type: m.type,
            url: String(m.url).slice(0, 1000),
            width: m.width != null ? Number(m.width) || null : null,
            height: m.height != null ? Number(m.height) || null : null,
          }
        : null
    )
    .filter(Boolean)
    .slice(0, 4);
}

// Extrait les @pseudo existants d'un texte → [{ user, username }].
const REVIEW_MENTION_RE = /@([\p{L}\p{N}_.-]{2,32})/gu;
async function resolveReviewMentions(text) {
  const names = [...new Set([...(text || "").matchAll(REVIEW_MENTION_RE)].map((m) => m[1]))];
  if (!names.length) return [];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`^(${escaped.join("|")})$`, "i");
  const users = await User.find({ username: rx }).select("username").limit(20).lean();
  return users.map((u) => ({ user: u._id, username: u.username }));
}

// « Cette entrée de bibliothèque est-elle une review ? », version Mongo. Sert à
// ne remonter QUE celles-là au lieu de filtrer après coup en mémoire.
const HAS_REVIEW_CONTENT = {
  $or: [
    { review: { $type: "string", $ne: "" } },
    { rating: { $ne: null } },
    { "pros.0": { $exists: true } },
    { "cons.0": { $exists: true } },
    { "reviewMedia.0": { $exists: true } },
  ],
};

function gameReviewCard(e, meId, isAdmin = false) {
  const { counts, mine } = summarizeReactions(e.reactions, meId);
  const isMe = String(e.user?._id || e.user) === String(meId);
  return {
    user: e.user
      ? { id: e.user._id, username: e.user.username, avatar: e.user.avatar || null }
      : null,
    isMe,
    // L'auteur peut supprimer sa review — l'admin, celle de n'importe qui.
    canDelete: isMe || isAdmin,
    reactions: counts,
    myReaction: mine,
    status: e.status,
    rating: e.rating,
    review: e.review || "",
    spoiler: !!e.spoiler,
    pros: e.pros || [],
    cons: e.cons || [],
    platform: e.platform,
    playtimeHours: e.playtimeHours,
    media: (e.reviewMedia || []).map((m) => ({
      type: m.type,
      url: m.url,
      width: m.width,
      height: m.height,
    })),
    favoriteCharacter: e.favoriteCharacter?.name
      ? { name: e.favoriteCharacter.name, image: e.favoriteCharacter.image || null }
      : null,
    favoriteOst: e.favoriteOst?.name
      ? {
          name: e.favoriteOst.name,
          artist: e.favoriteOst.artist || null,
          artwork: e.favoriteOst.artwork || null,
          preview: e.favoriteOst.preview || null,
          youtube: !!e.favoriteOst.youtube,
          url: e.favoriteOst.url || null,
        }
      : null,
    comments: (e.comments || []).map((c) => reviewComment(c, e.comments, meId, isAdmin)),
    reviewedAt: e.reviewedAt || e.updatedAt,
    updatedAt: e.updatedAt,
  };
}

// --- Les dates de sortie, console par console, et les autres versions -------
// La fiche affiche UNE année. Or « quand est-ce sorti ? » n'a presque jamais
// une seule réponse : un jeu sort sur PS4 en mars, sur Switch en novembre, et
// se rejoue dix ans plus tard dans un remaster qui a sa propre date. Cette
// route rassemble les trois : la date par console, les versions parentes et
// dérivées (remakes, remasters, portages, éditions, bundles), et de quoi
// afficher un compte à rebours pour ce qui n'est pas encore sorti.
const REGIONS_FR = {
  1: "Europe",
  2: "Amérique du Nord",
  3: "Australie",
  4: "Nouvelle-Zélande",
  5: "Japon",
  6: "Chine",
  7: "Asie",
  8: "Mondial",
  9: "Corée",
  10: "Brésil",
};

// Statuts de sortie IGDB (endpoint release_date_statuses). ⚠️ LE 6 EST LA
// SORTIE NORMALE — « Full Release » — et il n'est donc PAS affiché : le noter
// sur chaque ligne remplirait la feuille d'une évidence. Seul ce qui s'écarte
// d'une sortie ordinaire est dit.
const RELEASE_STATUS_FR = {
  1: "Alpha",
  2: "Bêta",
  3: "Accès anticipé",
  4: "Hors ligne",
  5: "Annulé",
  34: "Accès anticipé (précommande)",
  35: "Rétrocompatible",
  36: "Patch nouvelle génération",
};

// (les champs des jeux liés sont demandés par lib/gameIgdb.js.)

// Les liens de parenté qu'on remonte, dans l'ordre où on les montre.
const VERSION_LINKS = [
  ["remakes", "Remake"],
  ["remasters", "Remaster"],
  ["ports", "Portage"],
  ["expansions", "Extension"],
  ["standalone_expansions", "Extension autonome"],
  ["dlcs", "DLC"],
  ["bundles", "Bundle"],
  ["expanded_games", "Jeu enrichi"],
];

router.get("/:id/releases", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const g = await gameCore(id);
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const platformName = new Map(
      (g.platforms || []).map((p) => [p.id, { name: p.name, abbr: p.abbreviation || p.name }])
    );

    // Une console = UNE ligne, celle de sa sortie la plus ancienne. IGDB en
    // liste souvent trois pour la même machine (Europe, Amérique, Japon) : les
    // empiler donnerait un mur de dates qui disent toutes la même chose.
    const byPlatform = new Map();
    for (const r of g.release_dates || []) {
      if (!r.platform || !r.date) continue;
      const known = byPlatform.get(r.platform);
      if (!known || r.date < known.date) {
        byPlatform.set(r.platform, {
          platform: r.platform,
          name: platformName.get(r.platform)?.name || "Autre",
          abbr: platformName.get(r.platform)?.abbr || null,
          date: r.date,
          human: r.human || null,
          region: REGIONS_FR[r.region] || null,
          status: RELEASE_STATUS_FR[r.status] || null,
        });
      }
    }
    const platforms = [...byPlatform.values()].sort((a, b) => a.date - b.date);

    // Une console annoncée mais sans date connue reste une information : sans
    // elle, la feuille laisserait croire que le jeu n'y sort pas.
    for (const p of g.platforms || []) {
      if (byPlatform.has(p.id)) continue;
      platforms.push({
        platform: p.id,
        name: p.name,
        abbr: p.abbreviation || p.name,
        date: null,
        human: null,
        region: null,
        status: null,
      });
    }

    const slim = (x, label) => ({
      id: x.id,
      name: x.name,
      cover: x.cover?.image_id ? `${IMG_BASE}/t_cover_small/${x.cover.image_id}.jpg` : null,
      label: GAME_TYPES_FR[x.game_type]?.label || label,
      date: x.first_release_date || null,
      platforms: (x.platforms || []).map((p) => p.abbreviation || p.name).filter(Boolean),
    });

    const versions = [];
    // Le jeu d'origine en tête : c'est lui qui date la série.
    for (const [key, label] of [
      ["parent_game", "Jeu d'origine"],
      ["version_parent", "Édition d'origine"],
    ]) {
      if (g[key]) versions.push({ ...slim(g[key], label), label, origin: true });
    }
    for (const [rel, label] of VERSION_LINKS) {
      for (const x of g[rel] || []) versions.push(slim(x, label));
    }
    // Une même édition peut être à la fois « port » et « bundle » chez IGDB.
    const seen = new Set();
    const uniqueVersions = versions
      .filter((v) => v.id && !seen.has(v.id) && seen.add(v.id))
      .sort((a, b) => (a.date || Infinity) - (b.date || Infinity));

    res.json({
      name: g.name,
      releaseDate: g.first_release_date || null,
      type: GAME_TYPES_FR[g.game_type]?.label || null,
      platforms,
      versions: uniqueVersions,
    });
  } catch (err) {
    console.error("game releases error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des dates de sortie." });
  }
});

// --- Combien de temps pour en venir à bout ---------------------------------
// La fiche donne « 58 h pour finir » et c'est tout. Ce nombre vient d'IGDB ou
// de HowLongToBeat, c'est-à-dire de joueurs qu'on ne connaît pas — alors qu'on
// a, ici, les heures VRAIES de gens qu'on suit sur exactement ce jeu. Cette
// route met les deux côte à côte.
router.get("/:id/howlong", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const [rows, entries, viewer] = await Promise.all([
      gameCore(id).catch(() => null),
      UserGame.find({ gameId: id, playtimeHours: { $gt: 0 } })
        .select("user rating status platform playtimeHours platinum")
        .populate("user", "username avatar privacy")
        .lean(),
      req.userId ? User.findById(req.userId).select("following").lean() : null,
    ]);

    const g = rows || {};
    const released = g.first_release_date
      ? g.first_release_date * 1000 < Date.now()
      : true;
    const ttb = await resolveTimeToBeat(id, g.name, released).catch(() => ({
      times: null,
      pending: false,
    }));

    const hours = entries.map((e) => e.playtimeHours).sort((a, b) => a - b);
    const median = (list) =>
      list.length ? Math.round(list[Math.floor(list.length / 2)] * 10) / 10 : null;

    // Paliers : la forme de la dispersion vaut mieux qu'une moyenne. Un jeu où
    // tout le monde tourne autour de 40 h n'est pas un jeu qu'on lâche à 3 h ou
    // qu'on use pendant 300.
    const EDGES = [0, 5, 10, 20, 40, 60, 100, 200, Infinity];
    const dist = EDGES.slice(0, -1).map((min, i) => ({
      min,
      max: EDGES[i + 1] === Infinity ? null : EDGES[i + 1],
      count: hours.filter((h) => h >= min && h < EDGES[i + 1]).length,
    }));

    const groupMedian = (filter) => {
      const list = entries
        .filter(filter)
        .map((e) => e.playtimeHours)
        .sort((a, b) => a - b);
      return { median: median(list), count: list.length };
    };

    // Les gens qu'on suit : leurs heures sur CE jeu, la seule mesure dont on
    // connaît l'auteur.
    const circle = new Set([
      ...(viewer?.following || []).map(String),
      ...(req.userId ? [String(req.userId)] : []),
    ]);
    const friends = entries
      .filter((e) => e.user && circle.has(String(e.user._id)))
      .map((e) => ({
        id: String(e.user._id),
        username: e.user.username,
        avatar: e.user.avatar || null,
        isMe: String(e.user._id) === String(req.userId),
        hours: e.playtimeHours,
        status: e.status,
        rating: e.rating ?? null,
        platinum: !!e.platinum,
      }))
      .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.hours - a.hours);

    res.json({
      igdb: ttb.times,
      pending: ttb.pending,
      community: {
        count: hours.length,
        median: median(hours),
        avg: hours.length
          ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10
          : null,
        min: hours[0] ?? null,
        max: hours[hours.length - 1] ?? null,
        dist,
        finished: groupMedian((e) => e.status === "finished"),
        dropped: groupMedian((e) => e.status === "dropped"),
        platinum: groupMedian((e) => e.platinum),
        friends,
      },
    });
  } catch (err) {
    console.error("game howlong error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des temps de jeu." });
  }
});

// --- Le détail derrière la note d'un jeu ----------------------------------
// La fiche affiche « 90 · 1 388 avis » et s'arrête là. Ce chiffre recouvre
// pourtant quatre choses différentes : la presse, les joueurs du monde, les
// joueurs D'ICI, et les gens qu'on suit. Cette route les sépare — et ajoute ce
// qu'un chiffre unique ne dira jamais : la forme de la distribution, la note
// par console, son évolution dans le temps.
//
// Tout est best-effort et parallèle : IGDB, Steam ou une source extérieure
// indisponible laisse simplement son bloc vide.
router.get("/:id/ratings", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const [rows, entries, steam, viewer] = await Promise.all([
      gameCore(id).catch(() => null),
      // Seules les entrées NOTÉES : une bibliothèque sans note ne dit rien
      // d'une note.
      UserGame.find({ gameId: id, rating: { $ne: null } })
        .select("user rating status platform playtimeHours review reviewedAt updatedAt")
        .populate("user", "username avatar privacy")
        .lean(),
      fetchSteamReviews(id).catch(() => null),
      req.userId ? User.findById(req.userId).select("following").lean() : null,
    ]);

    const g = rows || {};
    const year = g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null;

    const igdb = {
      total: g.total_rating
        ? { score: Math.round(g.total_rating), count: g.total_rating_count || 0 }
        : null,
      players: g.rating ? { score: Math.round(g.rating), count: g.rating_count || 0 } : null,
      critics: g.aggregated_rating
        ? { score: Math.round(g.aggregated_rating), count: g.aggregated_rating_count || 0 }
        : null,
    };

    // -- La communauté MyPlayLog : ce que le site sait et qu'aucun autre ne sait --
    const notes = entries.map((e) => e.rating);
    const count = notes.length;
    const avg = count ? Math.round(notes.reduce((s, n) => s + n, 0) / count) : null;

    // Distribution en 10 paliers, comme la page Statistiques : c'est la FORME
    // qui parle — un 75 de consensus n'est pas un 75 de guerre civile.
    const dist = Array.from({ length: 10 }, () => 0);
    for (const n of notes) dist[Math.min(9, Math.floor(n / 10))] += 1;

    const avgOf = (list) =>
      list.length ? Math.round(list.reduce((s, e) => s + e.rating, 0) / list.length) : null;

    // Par console : on ne joue pas au même jeu sur Switch et sur PC.
    const platMap = new Map();
    for (const e of entries) {
      if (!e.platform) continue;
      if (!platMap.has(e.platform)) platMap.set(e.platform, []);
      platMap.get(e.platform).push(e);
    }
    const byPlatform = [...platMap.entries()]
      .map(([name, list]) => ({ name, avg: avgOf(list), count: list.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Dans le temps : la date de l'AVIS, pas celle du jeu. Un jeu peut vieillir
    // en bien (une note qui monte) comme en mal.
    const yearMap = new Map();
    for (const e of entries) {
      const d = e.reviewedAt || e.updatedAt;
      const y = d ? new Date(d).getFullYear() : null;
      if (!y) continue;
      if (!yearMap.has(y)) yearMap.set(y, []);
      yearMap.get(y).push(e);
    }
    const byYear = [...yearMap.entries()]
      .map(([y, list]) => ({ year: y, avg: avgOf(list), count: list.length }))
      .sort((a, b) => a.year - b.year)
      .slice(-8);

    // Par statut : ceux qui l'ont fini le notent-ils comme ceux qui l'ont lâché ?
    const statusMap = new Map();
    for (const e of entries) {
      const k = e.status || "playing";
      if (!statusMap.has(k)) statusMap.set(k, []);
      statusMap.get(k).push(e);
    }
    const byStatus = [...statusMap.entries()]
      .map(([key, list]) => ({ key, avg: avgOf(list), count: list.length }))
      .sort((a, b) => b.count - a.count);

    // -- Les gens qu'on suit : la seule note qui vaille vraiment --
    // Un 82 de moyenne mondiale ne vaut pas le 60 d'un ami dont on connaît les
    // goûts. Ils passent donc devant tout le reste dans la feuille.
    const circle = new Set([
      ...(viewer?.following || []).map(String),
      ...(req.userId ? [String(req.userId)] : []),
    ]);
    const friends = entries
      .filter((e) => e.user && circle.has(String(e.user._id)))
      .map((e) => ({
        id: String(e.user._id),
        username: e.user.username,
        avatar: e.user.avatar || null,
        isMe: String(e.user._id) === String(req.userId),
        rating: e.rating,
        status: e.status,
        hours: e.playtimeHours ?? null,
        hasReview: !!(e.review || "").trim(),
      }))
      .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0) || b.rating - a.rating);

    const hoursNoted = entries
      .map((e) => e.playtimeHours)
      .filter((h) => h != null && h > 0)
      .sort((a, b) => a - b);

    const external = await ensureGameScores(id, { name: g.name, year }).catch(() => []);

    // -- Où ce jeu se situe DANS SA SAGA --------------------------------------
    // « 82 » ne dit rien tout seul. « 82, le deuxième mieux noté des sept
    // Assassin's Creed » dit quelque chose. C'est la comparaison que les
    // joueurs font de tête et qui manquait ici.
    //
    // On réutilise la requête de parenté (cf. lib/gameIgdb, `gameRelatives`) :
    // elle est déjà en cache pour ce jeu, l'ajout ne coûte donc pas un appel
    // IGDB de plus dans le cas courant. Et on ne compare QUE sur la note
    // mondiale d'IGDB : c'est la seule dont on dispose pour tous les jeux de la
    // saga, et comparer des notes venues d'échelles différentes serait faux.
    let saga = null;
    // La saga qu'on montre est celle qu'on ANNONCE — la mieux accordée au
    // titre, pas la première de la liste d'IGDB (cf. lib/franchises.js).
    const best = franchisesOf(g)[0] || null;
    const whereRel = best
      ? `${best.kind === "collection" ? "collections" : "franchises"} = (${best.id})`
      : null;
    if (whereRel && igdb.total) {
      const { series } = (await gameRelatives(
        id,
        whereRel,
        g.first_release_date ?? null
      ).catch(() => null)) || { series: [] };

      const siblings = (series || [])
        // Sans note, un jeu ne se compare pas : le laisser à zéro le mettrait
        // bon dernier, ce qui serait un jugement qu'on n'a pas.
        .filter((x) => x?.id && x.total_rating)
        // Jeu principal, remake, remaster (cf. `game_type` d'IGDB). Les DLC et
        // les compilations feraient nombre sans rien comparer.
        .filter((x) => [0, 8, 9].includes(x.game_type))
        .map((x) => ({
          id: x.id,
          name: x.name,
          cover: x.cover?.image_id ? `${IMG_BASE}/t_cover_big/${x.cover.image_id}.jpg` : null,
          score: Math.round(x.total_rating),
          year: x.first_release_date
            ? new Date(x.first_release_date * 1000).getFullYear()
            : null,
        }));

      // Seul dans sa saga : il n'y a rien à comparer, et un classement « 1er
      // sur 1 » est une moquerie.
      if (siblings.length >= 2) {
        const all = [
          ...siblings,
          { id, name: g.name, cover: null, score: igdb.total.score, year, isThis: true },
        ].sort((a, b) => b.score - a.score);
        saga = {
          name: mainFranchise(g),
          total: all.length,
          rank: all.findIndex((x) => x.isThis) + 1,
          // Plafonné : au-delà, la liste devient un annuaire. Le rang, lui,
          // reste calculé sur la saga ENTIÈRE — c'est l'affichage qu'on
          // tronque, pas le classement.
          games: all.slice(0, 12),
        };
      }
    }

    res.json({
      igdb,
      saga,
      community: {
        avg,
        count,
        dist,
        byPlatform,
        byYear,
        byStatus,
        friends,
        reviews: entries.filter((e) => (e.review || "").trim()).length,
        // Médiane, pas moyenne : un seul joueur à 900 h fausserait la moyenne
        // d'une communauté qui tourne autour de 30.
        medianHours: hoursNoted.length
          ? Math.round(hoursNoted[Math.floor(hoursNoted.length / 2)])
          : null,
      },
      steam: steam
        ? {
            positive: steam.positive,
            negative: steam.negative,
            total: steam.total,
            percent: steam.total ? Math.round((steam.positive / steam.total) * 100) : null,
            scoreDesc: steam.scoreDesc,
            url: steam.storeUrl,
          }
        : null,
      external,
    });
  } catch (err) {
    console.error("game ratings error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des notes." });
  }
});

router.get("/:id/reviews", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    // Pagination facultative : sans `limit`, la route rend tout comme avant
    // (le client actuel ne pagine pas). Le plafond, lui, s'applique toujours —
    // c'est un garde-fou, pas une troncature : il faudrait des centaines
    // d'avis sur un même jeu pour l'atteindre, et `hasMore` le dit alors.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const skip = (page - 1) * limit;

    // Avis joueurs Steam en parallèle : complètent les reviews de nos users
    // (qui restent prioritaires). Échoue silencieusement en null.
    const [entries, myEntry, steam, viewerIsAdmin, canSee] = await Promise.all([
      // ⚠️ LE TRI SE FAIT EN BASE, PAS EN MÉMOIRE. `find({ gameId })` ramenait
      // TOUTE la bibliothèque du jeu — y compris les milliers de gens qui l'ont
      // juste ajouté sans écrire une ligne — puis jetait 95 % du résultat en
      // JavaScript. On ne demande plus que les entrées qui ont quelque chose à
      // dire, et `.lean()` évite de construire un document Mongoose complet
      // (avec ses getters et son suivi de modifications) pour chacune.
      UserGame.find({ gameId: id, ...HAS_REVIEW_CONTENT })
        .populate("user", "username avatar privacy")
        .populate("comments.user", "username avatar")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit + 1) // +1 : sert uniquement à savoir s'il y a une suite
        .lean(),
      // Ma propre review, cherchée à part : elle doit apparaître même si elle
      // tombe hors de la page demandée.
      req.userId
        ? UserGame.findOne({ gameId: id, user: req.userId })
            .populate("user", "username avatar privacy")
            .populate("comments.user", "username avatar")
            .lean()
        : null,
      fetchSteamReviews(id).catch(() => null),
      isUserAdmin(req.userId),
      // Reviews des comptes privés ayant coché « masquer mes reviews » :
      // invisibles ici pour qui ne les suit pas.
      reviewVisibility(req.userId),
    ]);

    const hasMore = entries.length > limit;
    const pageEntries = hasMore ? entries.slice(0, limit) : entries;

    // Une entrée compte comme review si elle a du contenu rédigé OU une note.
    // Le filtre de la base est volontairement un peu plus large (il ne sait pas
    // couper les espaces) : celui-ci tranche, et le résultat est identique à ce
    // que la route rendait avant.
    const hasContent = (e) =>
      (e.review && e.review.trim()) ||
      (e.pros && e.pros.length) ||
      (e.cons && e.cons.length) ||
      (e.reviewMedia && e.reviewMedia.length) ||
      e.rating != null;

    const reviews = pageEntries
      .filter(hasContent)
      .filter((e) => canSee(e.user))
      .map((e) => gameReviewCard(e, req.userId, viewerIsAdmin));
    // Visiteur non connecté : pas de review « à moi ». (Le garde évite aussi
    // qu'une entrée orpheline — user supprimé, e.user null — matche req.userId
    // undefined et soit renvoyée à tort comme la review du lecteur.)
    const mine = myEntry && hasContent(myEntry) ? myEntry : null;

    res.json({
      reviews,
      mine: mine ? gameReviewCard(mine, req.userId, viewerIsAdmin) : null,
      steam,
      page,
      hasMore,
    });
  } catch (err) {
    console.error("game reviews error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des reviews." });
  }
});

// --- Une review précise (chargée à la volée depuis les cartes du fil :
// réactions à jour + fil de réponses complet) ---
router.get("/:id/reviews/:userId", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || !mongoose.isValidObjectId(req.params.userId))
      return res.status(400).json({ error: "id invalide." });
    const [entry, viewerIsAdmin] = await Promise.all([
      UserGame.findOne({ gameId: id, user: req.params.userId })
        .populate("user", "username avatar privacy")
        .populate("comments.user", "username avatar"),
      isUserAdmin(req.userId),
    ]);
    if (!entry) return res.status(404).json({ error: "Review introuvable." });
    // Review d'un compte privé qui les masque : réservée à ses abonnés.
    if (
      entry.user &&
      privacyOf(entry.user).hideReviews &&
      !(await isFollower(entry.user._id, req.userId))
    )
      return res.status(403).json({ error: "Ce compte est privé.", locked: true });
    res.json({ review: gameReviewCard(entry, req.userId, viewerIsAdmin) });
  } catch (err) {
    console.error("single review error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de la review." });
  }
});

// --- Supprimer une review (son auteur, ou l'administrateur pour modération) ---
// On vide le contenu rédigé sans retirer le jeu de la bibliothèque du joueur
// (même logique que la suppression « par soi-même » côté client).
router.delete("/:id/reviews/:userId", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.params;
    if (!id || !mongoose.isValidObjectId(userId))
      return res.status(400).json({ error: "id invalide." });

    if (String(userId) !== String(req.userId) && !(await isUserAdmin(req.userId)))
      return res.status(403).json({ error: "Action non autorisée." });

    const entry = await UserGame.findOne({ gameId: id, user: userId });
    if (!entry) return res.status(404).json({ error: "Review introuvable." });

    Object.assign(entry, {
      review: "",
      reviewMedia: [],
      spoiler: false,
      pros: [],
      cons: [],
      rating: null,
    });
    await entry.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("review delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// --- Réagir à la review d'un joueur (toggle like / dislike / rigolo) ---
router.post("/:id/reviews/:userId/react", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.params;
    const { type } = req.body || {};
    if (!id) return res.status(400).json({ error: "id invalide." });
    if (!["heart", "clap", "funny", "dislike"].includes(type))
      return res.status(400).json({ error: "type invalide." });
    // On ne réagit pas à sa propre review.
    if (String(userId) === String(req.userId))
      return res.status(400).json({ error: "Impossible de réagir à sa propre review." });

    const entry = await UserGame.findOne({ gameId: id, user: userId });
    if (!entry) return res.status(404).json({ error: "Review introuvable." });

    const reactions = (entry.reactions || []).filter(
      (r) => String(r.user) !== String(req.userId)
    );
    const prev = (entry.reactions || []).find(
      (r) => String(r.user) === String(req.userId)
    );
    // Toggle : re-cliquer sur la même réaction la retire ; sinon on remplace.
    const removed = prev && prev.type === type;
    if (!removed) reactions.push({ user: req.userId, type });

    // timestamps:false → réagir ne « rajeunit » pas la review dans les tris.
    await UserGame.updateOne(
      { _id: entry._id },
      { $set: { reactions } },
      { timestamps: false }
    );

    // Fil d'accueil : une seule activité « réaction » par (acteur, avis) — on
    // remplace la précédente (changement de type) ou on la retire (toggle-off).
    await removeActivity({
      actor: req.userId,
      type: "review_react",
      game: id,
      target: entry.user,
    });
    if (!removed) {
      recordActivity({
        actor: req.userId,
        type: "review_react",
        target: entry.user,
        game: id,
        gameName: entry.name,
        snippet: type,
      });
    }

    const { counts, mine } = summarizeReactions(reactions, req.userId);
    res.json({ reactions: counts, myReaction: mine });
  } catch (err) {
    console.error("review react error:", err.message);
    res.status(500).json({ error: "Erreur lors de la réaction." });
  }
});

// --- Répondre à la review d'un joueur (commentaire, fil à un niveau) ---
router.post("/:id/reviews/:userId/comments", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId } = req.params;
    if (!id) return res.status(400).json({ error: "id invalide." });

    const text = String(req.body?.text || "").trim().slice(0, 300);
    const media = sanitizeReviewMedia(req.body?.media);
    if (!text && !media.length)
      return res.status(400).json({ error: "Réponse vide." });

    const entry = await UserGame.findOne({ gameId: id, user: userId });
    if (!entry) return res.status(404).json({ error: "Review introuvable." });

    // Réponse à un commentaire : on remonte toujours à la racine (fil à 1 niveau).
    let parent = null;
    let replyTargetUser = null; // auteur du message auquel on répond (pour la notif)
    if (req.body?.parent) {
      const p = (entry.comments || []).find(
        (c) => String(c._id) === String(req.body.parent)
      );
      if (p) {
        parent = p.parent ? p.parent : p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveReviewMentions(text);
    entry.comments.push({ user: req.userId, text, media, mentions, parent });
    await entry.save({ timestamps: false });
    await entry.populate("comments.user", "username avatar");

    const created = entry.comments[entry.comments.length - 1];

    // Notifications (un seul message par destinataire, par priorité).
    const recipients = new Map();
    const actorStr = String(req.userId);
    const add = (uid, type) => {
      if (!uid) return;
      const s = String(uid);
      if (s === actorStr || recipients.has(s)) return;
      recipients.set(s, type);
    };
    if (replyTargetUser) add(replyTargetUser, "review_comment_reply");
    mentions.forEach((m) => add(m.user, "mention"));
    add(entry.user, "review_comment"); // l'auteur de la review
    const snippet = text || (media.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        game: id,
        gameName: entry.name,
        comment: created._id,
        snippet,
      });
    }

    // Fil d'accueil : commentaire racine ou réponse sous un avis (cible =
    // auteur du commentaire parent pour une réponse, sinon auteur de l'avis).
    recordActivity({
      actor: req.userId,
      type: parent ? "review_comment_reply" : "review_comment",
      target: replyTargetUser || entry.user,
      game: id,
      gameName: entry.name,
      comment: created._id,
      snippet,
      // Propriétaire de l'avis (≠ cible quand c'est une réponse) : permet au fil
      // d'ouvrir le bon thread de réponses focalisé sur ce commentaire.
      meta: { reviewUser: String(entry.user) },
    });

    // Mission « Droit de réponse » (répondre à l'avis de quelqu'un d'autre).
    if (String(entry.user) !== actorStr) triggerMissionCheck(req.userId);

    res.status(201).json({ comment: reviewComment(created, entry.comments, req.userId) });
  } catch (err) {
    console.error("review comment error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi de la réponse." });
  }
});

// --- Liker / déliker une réponse sous une review ---
router.post("/:id/reviews/:userId/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId, commentId } = req.params;
    if (!id) return res.status(400).json({ error: "id invalide." });

    const entry = await UserGame.findOne({ gameId: id, user: userId });
    if (!entry) return res.status(404).json({ error: "Review introuvable." });
    const c = (entry.comments || []).find((x) => String(x._id) === String(commentId));
    if (!c) return res.status(404).json({ error: "Réponse introuvable." });

    const uid = String(req.userId);
    const has = (c.likes || []).some((u) => String(u) === uid);
    c.likes = has
      ? (c.likes || []).filter((u) => String(u) !== uid)
      : [...(c.likes || []), req.userId];
    await entry.save({ timestamps: false });

    if (!has) {
      notify({
        user: c.user,
        type: "review_comment_like",
        actor: req.userId,
        game: id,
        gameName: entry.name,
        comment: c._id,
        snippet: c.text,
      });
      recordActivity({
        actor: req.userId,
        type: "review_comment_like",
        target: c.user,
        game: id,
        gameName: entry.name,
        comment: c._id,
        snippet: c.text,
      });
    } else {
      removeActivity({
        actor: req.userId,
        type: "review_comment_like",
        comment: c._id,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("review comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Supprimer une réponse (son auteur, ou l'administrateur) ---
router.delete("/:id/reviews/:userId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { userId, commentId } = req.params;
    if (!id) return res.status(400).json({ error: "id invalide." });

    const entry = await UserGame.findOne({ gameId: id, user: userId });
    if (!entry) return res.status(404).json({ error: "Review introuvable." });

    const c = (entry.comments || []).find((x) => String(x._id) === String(commentId));
    if (!c) return res.status(404).json({ error: "Réponse introuvable." });

    if (String(c.user) !== String(req.userId) && !(await isUserAdmin(req.userId)))
      return res.status(403).json({ error: "Action non autorisée." });

    // On retire le commentaire ET ses réponses éventuelles.
    const removedIds = (entry.comments || [])
      .filter(
        (x) =>
          String(x._id) === String(commentId) ||
          String(x.parent) === String(commentId)
      )
      .map((x) => x._id);
    entry.comments = (entry.comments || []).filter(
      (x) =>
        String(x._id) !== String(commentId) && String(x.parent) !== String(commentId)
    );
    await entry.save({ timestamps: false });
    // Nettoie le fil d'accueil (commentaires supprimés + likes reçus).
    if (removedIds.length) removeActivity({ comment: { $in: removedIds } });
    res.json({ ok: true });
  } catch (err) {
    console.error("review comment delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

// --- Feed communautaire d'un jeu : Twitch live + Reddit + YouTube ---
router.get("/:id/feed", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Nom du jeu manquant." });
    // `alt` : nom original/international (IGDB) — décisif pour la recherche de
    // fan arts quand le titre affiché est localisé en français.
    const alt = String(req.query.alt || "").trim() || null;
    const feed = await buildGameFeed(id, name, alt);
    res.json(feed);
  } catch (err) {
    console.error("game feed error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du feed." });
  }
});

// --- Amis (abonnements) qui ont ce jeu dans leur bibliothèque ---
router.get("/:id/friends", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    // Visiteur non connecté : pas d'abonnements → aucun « ami » à afficher.
    if (!req.userId) return res.json({ friends: [] });

    const me = await User.findById(req.userId).select("following");
    const following = me?.following || [];
    if (!following.length) return res.json({ friends: [] });

    const entries = await UserGame.find({ user: { $in: following }, gameId: id })
      .populate("user", "username avatar")
      .lean();

    const friends = entries
      .filter((e) => e.user)
      .map((e) => ({
        user: { id: e.user._id, username: e.user.username, avatar: e.user.avatar || null },
        status: e.status,
        rating: e.rating ?? null,
      }));
    res.json({ friends });
  } catch (err) {
    console.error("game friends error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
