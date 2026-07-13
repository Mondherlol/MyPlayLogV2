import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import mongoose from "mongoose";
import { igdbQuery } from "../lib/igdb.js";
import { getValidAccessToken, fetchUserTitles, fetchTitleTrophies } from "../lib/psn.js";
import { isAdminEmail } from "../lib/admin.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { notify } from "../lib/notify.js";
import { recordActivity, removeActivity } from "../lib/activity.js";
import { summarizeReactions, reviewComment } from "../lib/reviewSerialize.js";
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

const FIELDS =
  "fields name,alternative_names.name,alternative_names.comment,cover.image_id,total_rating,total_rating_count,first_release_date,genres.name,platforms.abbreviation,platforms.name";

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
async function resolveTimeToBeat(id, name, released = true) {
  const ttbArr = await igdbQuery(
    "game_time_to_beats",
    `fields hastily,normally,completely; where game_id = ${id};`
  ).catch(() => []);
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

function buildQuery(opts) {
  const { search, sort, dir, limit, offset, filters, typeIds } = opts;
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

  const field = SORT_FIELDS[sort] || SORT_FIELDS.popularity;
  const direction = dir === "asc" ? "asc" : "desc";
  const now = Math.floor(Date.now() / 1000);

  // Filtres "qualité" uniquement en navigation : en recherche on ne veut pas
  // masquer un jeu peu noté / pas encore sorti que l'utilisateur cherche.
  if (!search) {
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

    const query = buildQuery({ search, sort, dir, limit, offset, filters, typeIds });
    const raw = await igdbQuery("games", query);
    const games = raw.map(mapGame);

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
const windowCache = new Map(); // "from-to" -> { at, games }
const WINDOW_TTL = 6 * 60 * 60 * 1000;
const WINDOW_MAX = 60;

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
      if (hit && Date.now() - hit.at < WINDOW_TTL) {
        return res.json({ games: hit.games });
      }
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

    const fields =
      "fields name,alternative_names.name,alternative_names.comment,cover.image_id,total_rating,total_rating_count,first_release_date,hypes,genres.name,platforms.abbreviation,platforms.name,keywords.name";
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
    }));

    if (isGeneral) {
      releasesCache.games = games;
      releasesCache.day = startOfToday;
    } else if (isWindow) {
      if (windowCache.size >= WINDOW_MAX) {
        // Purge simple : on jette l'entrée la plus ancienne.
        const oldest = [...windowCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) windowCache.delete(oldest[0]);
      }
      windowCache.set(windowKey, { at: Date.now(), games });
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
    // Consoles/portables/ordinateurs, triés par génération décroissante
    // (les plus récents d'abord — pas l'Amiga en tête !)
    const platforms = await cachedList(
      "platforms",
      "platforms",
      "fields name,abbreviation,generation; where platform_type = (1,5,6); sort generation desc; limit 80;",
      (p) => ({ id: p.id, name: p.name, abbr: p.abbreviation || p.name })
    );
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
  };
}

// --- OST d'un jeu : pistes YouTube (scrapées auto + communauté), moins les masquées ---
router.get("/:id/ost", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = String(req.query.q || "").trim();
    // Pistes déjà en base (auto par ordre de playlist, puis ajouts manuels).
    let customs = await CustomOst.find({ gameId: id }).sort({ order: 1, createdAt: 1 });
    // Première ouverture (aucune piste) : scraping auto d'une playlist YouTube.
    if (!customs.length) {
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
    res.json({ tracks, hiddenTracks });
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
router.post("/:id/ost", requireAuth, async (req, res) => {
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
router.post("/:id/ost/playlist", requireAuth, async (req, res) => {
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
router.post("/:id/ost/hide", requireAuth, async (req, res) => {
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
router.post("/:id/ost/unhide", requireAuth, async (req, res) => {
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
router.post("/:id/ost/rename", requireAuth, async (req, res) => {
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
router.get("/:id/details", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const [gameArr, customCovers, charArr, customChars] = await Promise.all([
      igdbQuery(
        "games",
        `fields name,cover.image_id,artworks.image_id,platforms.id,platforms.name,genres.id,genres.name,game_modes,first_release_date,total_rating_count; where id = ${id};`
      ),
      CustomCover.find({ gameId: id }).sort({ createdAt: -1 }),
      igdbQuery(
        "characters",
        `fields name,mug_shot.image_id; where games = (${id}); limit 50;`
      ).catch(() => []),
      CustomCharacter.find({ gameId: id }).sort({ createdAt: -1 }),
    ]);

    const g = gameArr[0] || {};
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
    const [ttb, vnChars] = await Promise.all([
      resolveTimeToBeat(id, g.name, released),
      isVn ? resolveVnCharacters(id, g.name) : Promise.resolve([]),
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
    const endlessHint = (g.game_modes || []).some((m) => [2, 5, 6].includes(m));

    res.json({
      platforms: (g.platforms || []).map((p) => ({ id: p.id, name: p.name })),
      covers,
      characters,
      timeToBeat: ttb.times,
      // Scrape HLTB en cours : le client re-poll pour récupérer les temps.
      timeToBeatPending: ttb.pending,
      endlessHint,
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
router.post("/:id/character", requireAuth, upload.single("image"), async (req, res) => {
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

// --- Modifier un perso custom (uniquement le sien) ---
router.put("/:id/character/:charId", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const cc = await CustomCharacter.findById(req.params.charId);
    if (!cc) return res.status(404).json({ error: "Personnage introuvable." });
    if (String(cc.addedBy) !== String(req.userId))
      return res.status(403).json({ error: "Tu ne peux modifier que tes personnages." });
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

// --- Retirer un perso custom (uniquement le sien) ---
router.delete("/:id/character/:charId", requireAuth, async (req, res) => {
  try {
    const cc = await CustomCharacter.findById(req.params.charId);
    if (!cc) return res.json({ ok: true });
    if (String(cc.addedBy) !== String(req.userId))
      return res.status(403).json({ error: "Tu ne peux retirer que tes personnages." });
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

const FULL_FIELDS = [
  "name",
  "summary",
  "storyline",
  "game_type",
  "parent_game.name",
  "parent_game.cover.image_id",
  "version_parent.name",
  "version_parent.cover.image_id",
  "cover.image_id",
  "artworks.image_id",
  "artworks.width",
  "artworks.height",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "genres.name",
  "themes.name",
  "game_modes.name",
  "player_perspectives.name",
  "platforms.id",
  "platforms.name",
  "platforms.abbreviation",
  "first_release_date",
  "rating",
  "rating_count",
  "total_rating",
  "total_rating_count",
  "aggregated_rating",
  "aggregated_rating_count",
  "language_supports.language.name",
  "language_supports.language.locale",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "videos.video_id",
  "videos.name",
  "websites.url",
  "websites.category",
  "game_engines.name",
  "franchises.name",
  "collections.name",
  "alternative_names.name",
  "alternative_names.comment",
  "similar_games.name",
  "similar_games.cover.image_id",
  "similar_games.total_rating",
  "similar_games.first_release_date",
].join(",");

router.get("/:id/full", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = await igdbQuery("games", `fields ${FULL_FIELDS}; where id = ${id};`);
    const g = arr[0];
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
    const timeToBeat = (await resolveTimeToBeat(id, g.name, released)).times;

    // « Ce jeu est un remake / DLC / … de … » : type IGDB + jeu parent.
    const typeFr = GAME_TYPES_FR[g.game_type];
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

    res.json({
      id: g.id,
      name: fr?.name || g.name,
      originalName: g.name,
      summary: g.summary || null,
      storyline: g.storyline || null,
      cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
      backdrop,
      media,
      genres: (g.genres || []).map((x) => frName(GENRES_FR, x.name)),
      themes: (g.themes || []).map((x) => frName(THEMES_FR, x.name)),
      gameModes: (g.game_modes || []).map((x) => frName(MODES_FR, x.name)),
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
      engines: (g.game_engines || []).map((e) => e.name).filter(Boolean),
      franchise: g.franchises?.[0]?.name || g.collections?.[0]?.name || null,
      relation,
      websites,
      similar,
      timeToBeat,
    });
  } catch (err) {
    console.error("game full error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// --- Onglet Patchs : mods + patchs de traduction. Cas spécifique traité : les
// visual novels non disponibles en français → on cherche sur VNDB s'il existe
// un patch de fan-traduction FR (avec son lien de téléchargement). ---
router.get("/:id/patches", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = await igdbQuery(
      "games",
      `fields name,genres.id,genres.name,platforms.id,platforms.name,language_supports.language.name; where id = ${id};`
    );
    const g = arr[0];
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

    const isVn = (g.genres || []).some(
      (x) => x.id === 34 || /visual novel/i.test(x.name || "")
    );
    const hasFr = (g.language_supports || []).some((ls) =>
      /french|français/i.test(ls.language?.name || "")
    );
    // Nintendo Switch (id IGDB 130) et Switch 2 (id 508) → patch FR nxbrew.
    const isSwitch = (g.platforms || []).some(
      (p) => p.id === 130 || p.id === 508 || /switch/i.test(p.name || "")
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
router.get("/:id/hd-packs", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const arr = await igdbQuery(
      "games",
      `fields name,cover.image_id; where id = ${id};`
    );
    const g = arr[0];
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

// --- Proxy de téléchargement d'un .torrent C411 réécrit pour le compte de
// l'utilisateur : on récupère le fichier via notre clé partagée (aucun ratio
// consommé) puis on remplace l'URL d'annonce par le passkey de l'utilisateur
// → le leech des données comptera sur SON ratio. Nécessite d'être connecté et
// d'avoir renseigné son passkey. ---
router.get("/:id/hd-packs/:torrentId/torrent", requireAuth, async (req, res) => {
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
const REL_SUBFIELDS = ["name", "cover.image_id", "total_rating", "first_release_date", "game_type"];
const relFields = (f) => REL_SUBFIELDS.map((s) => `${f}.${s}`).join(",");

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
  };
}

router.get("/:id/related", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    const fields = [
      "name",
      "game_type",
      "first_release_date",
      "franchises.name",
      "collections.name",
      relFields("parent_game"),
      relFields("version_parent"),
      relFields("dlcs"),
      relFields("expansions"),
      relFields("standalone_expansions"),
      relFields("remakes"),
      relFields("remasters"),
      relFields("expanded_games"),
      relFields("ports"),
      relFields("bundles"),
      relFields("forks"),
    ].join(",");

    const arr = await igdbQuery("games", `fields ${fields}; where id = ${id};`);
    const g = arr[0];
    if (!g) return res.status(404).json({ error: "Jeu introuvable." });

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
    const editions = await igdbQuery(
      "games",
      `fields ${REL_SUBFIELDS.join(",")}; where version_parent = ${id}; limit 50;`
    ).catch(() => []);
    rawGroups.push({ id: "editions", items: editions });

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
    // hors éditions/remasters « version de », en ordre chronologique.
    const fid = g.franchises?.[0]?.id;
    const cid = g.collections?.[0]?.id;
    let series = [];
    if (fid || cid) {
      const whereRel = fid ? `franchises = (${fid})` : `collections = (${cid})`;
      // limit 500 = maximum autorisé par IGDB ; tri desc pour garder les jeux
      // les plus récents si la licence dépasse quand même la limite.
      const list = await igdbQuery(
        "games",
        `fields ${REL_SUBFIELDS.join(",")}; where ${whereRel} & id != ${id} & version_parent = null & cover != null; sort first_release_date desc; limit 500;`
      ).catch(() => []);
      series = list.filter((s) => !seen.has(s.id)).map(mapRelGame);
    }

    res.json({
      franchise: g.franchises?.[0]?.name || g.collections?.[0]?.name || null,
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
const steamAchCache = new Map(); // appid -> { ts, data }
const STEAM_ACH_TTL = 6 * 60 * 60 * 1000; // 6h

async function resolveSteamAppId(gameId) {
  try {
    // external_game_source = 1 → Steam (uid = appid). IGDB a remplacé l'ancien
    // champ `category` par `external_game_source`.
    let rows = await igdbQuery(
      "external_games",
      `fields uid,url; where game = ${gameId} & external_game_source = 1;`
    );
    // Filet de sécurité : si l'enum évolue encore, on scanne tous les liens
    // externes et on garde ceux qui pointent vers le store Steam.
    if (!rows.length) {
      const all = await igdbQuery(
        "external_games",
        `fields uid,url; where game = ${gameId}; limit 50;`
      );
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
    if (cached && Date.now() - cached.ts < STEAM_ACH_TTL) return res.json(cached.data);

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
    steamAchCache.set(appid, { ts: Date.now(), data });
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

async function getAdminPsnUser() {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  if (!email) return null;
  const admin = await User.findOne({ email: email.toLowerCase() });
  return admin && isAdminEmail(admin.email) ? admin : null;
}

// Le viewer (par son id) est-il l'administrateur ? Sert à la modération des
// reviews et des réponses (suppression de n'importe quel contenu).
async function isUserAdmin(userId) {
  if (!userId) return false;
  const u = await User.findById(userId).select("email").lean();
  return isAdminEmail(u?.email);
}

router.get("/:id/psn-trophies", optionalAuth, async (req, res) => {
  try {
    const admin = await getAdminPsnUser();
    if (!admin?.psn?.refreshToken) return res.json({ available: false, reason: "not_connected" });

    let accessToken = null;
    try {
      accessToken = await getValidAccessToken(admin);
    } catch {
      accessToken = null;
    }
    if (!accessToken) return res.json({ available: false, reason: "not_connected" });

    // Bibliothèque de trophées du compte admin (cache global 30 min)
    let titles = psnTitlesCache.titles;
    if (!titles || Date.now() - psnTitlesCache.ts >= PSN_TITLES_TTL) {
      titles = await fetchUserTitles(accessToken);
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
      match.npServiceName
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

router.get("/:id/reviews", optionalAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id invalide." });

    // Avis joueurs Steam en parallèle : complètent les reviews de nos users
    // (qui restent prioritaires). Échoue silencieusement en null.
    const [entries, steam, viewerIsAdmin] = await Promise.all([
      UserGame.find({ gameId: id })
        .populate("user", "username avatar")
        .populate("comments.user", "username avatar")
        .sort({ updatedAt: -1 }),
      fetchSteamReviews(id).catch(() => null),
      isUserAdmin(req.userId),
    ]);

    // Une entrée compte comme review si elle a du contenu rédigé OU une note.
    const hasContent = (e) =>
      (e.review && e.review.trim()) ||
      (e.pros && e.pros.length) ||
      (e.cons && e.cons.length) ||
      (e.reviewMedia && e.reviewMedia.length) ||
      e.rating != null;

    const reviews = entries
      .filter(hasContent)
      .map((e) => gameReviewCard(e, req.userId, viewerIsAdmin));
    // Visiteur non connecté : pas de review « à moi ». (Le garde évite aussi
    // qu'une entrée orpheline — user supprimé, e.user null — matche req.userId
    // undefined et soit renvoyée à tort comme la review du lecteur.)
    const mine = req.userId
      ? entries.find((e) => String(e.user?._id) === String(req.userId))
      : null;

    res.json({
      reviews,
      mine: mine ? gameReviewCard(mine, req.userId, viewerIsAdmin) : null,
      steam,
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
        .populate("user", "username avatar")
        .populate("comments.user", "username avatar"),
      isUserAdmin(req.userId),
    ]);
    if (!entry) return res.status(404).json({ error: "Review introuvable." });
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
    if (!["heart", "clap", "funny"].includes(type))
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
    });

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
    const feed = await buildGameFeed(id, name);
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
