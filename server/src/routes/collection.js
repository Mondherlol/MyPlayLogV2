import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import CollectionMedia from "../models/CollectionMedia.js";
import CollectionProgress from "../models/CollectionProgress.js";
import CollectionSave, {
  AUTO_SLOT,
  MANUAL_SLOTS,
  STATE_MAX,
} from "../models/CollectionSave.js";
import CollectionThread from "../models/CollectionThread.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { isUserAdmin } from "../lib/admin.js";
import { notify } from "../lib/notify.js";
import { recordActivity, removeActivity } from "../lib/activity.js";
import { sanitizeMediaList, resolveMentions, toComment } from "../lib/commentThread.js";
import {
  buildMedia,
  localizeCast,
  downloadArtwork,
  tvmazeSearch,
  wikiSearch,
  extractPlaylistId,
  extractVideoId,
  ytPlaylistItems,
  ytVideo,
  slugify,
  parseEpisodeLines,
  episodesToLines,
  hostLabel,
} from "../lib/collection.js";
import { checkEpisodes, purgeEpisodes, sourcesOf } from "../lib/collectionProbe.js";
import { importFromUrl, importFromSource, parseUrl } from "../lib/animeSama.js";
import {
  importFilmFromUrl,
  importFilmFromSource,
  looksLikeFilmPage,
} from "../lib/filmIndex.js";
import { extractComic, dropComic } from "../lib/comicArchive.js";
import { comicLookup } from "../lib/comicMeta.js";
import { readGbaFile } from "../lib/gbaRom.js";
import * as tmdb from "../lib/tmdb.js";

// ======================================================================
//  Collection — l'étagère de médias liés au jeu vidéo
// ======================================================================
// Le catalogue est curé côté admin (ajout par URL, enrichi automatiquement —
// voir lib/collection.js) ; côté joueur, tout est en lecture, plus sa
// progression personnelle (épisode en cours, position, épisodes vus).

const router = express.Router();

// Un épisode compte comme vu à partir de 88 % : les génériques de fin durent
// une éternité et personne ne les regarde jusqu'au bout.
const WATCHED_RATIO = 0.88;

// Visuels déposés à la main depuis le panneau d'admin (même dossier que les
// visuels rapatriés automatiquement, servi par /uploads).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/collection");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  // 25 Mo. Le client allège déjà tout ce qu il envoie (voir lib/imageFile.js,
  // budget 8 Mo), mais un format qu il n a pas su décoder passe TEL QUEL — une
  // jaquette d impression pèse alors une quinzaine de mégaoctets, et la refuser
  // ici reviendrait à refuser précisément les visuels de meilleure qualité.
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Les archives de comics ne passent PAS par le même multer que les visuels : un
// CBZ de vingt planches en pleine définition pèse déjà cinquante mégaoctets, et
// un tome relié en pleine résolution en fait quatre cents.
//
// ELLES VONT SUR LE DISQUE, PAS EN MÉMOIRE. Elles y étaient gardées — l'archive
// ne nous intéresse pas, seules les pages qu'on en sort sont conservées, et
// l'écrire pour la relire semblait du travail en double. Sauf qu'à ce
// poids-là, ce n'est plus un raccourci : c'est un demi-gigaoctet retenu le temps
// de l'envoi, auquel s'ajoutent les images décompressées — et le décodeur de rar
// en réclamait autant pour lui seul. Le fichier temporaire coûte une écriture
// et rend la mémoire au serveur.
const ARCHIVE_TMP = path.join(__dirname, "../../uploads/tmp");
fs.mkdirSync(ARCHIVE_TMP, { recursive: true });

// 600 Mo : de quoi accueillir un tome relié en pleine définition sans ouvrir la
// porte à n'importe quoi. Ce n'est plus la mémoire qui borne — c'est le disque,
// et le fichier est effacé dès l'extraction finie.
const ARCHIVE_MAX = 600 * 1024 * 1024;

const archiveUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ARCHIVE_TMP),
    filename: (req, file, cb) =>
      cb(null, `cbz-${Date.now()}-${Math.round(Math.random() * 1e6)}`),
  }),
  limits: { fileSize: ARCHIVE_MAX },
});

// UNE ARCHIVE TROP LOURDE EST UNE RÉPONSE, PAS UNE TRACE DE PILE. Multer jette
// son erreur dans le tuyau d'Express, qui la rend en page d'erreur : côté
// panneau d'admin, l'envoi échouait sans un mot, et la raison n'existait que
// dans le journal du serveur. On la traduit ici.
const takeArchive = archiveUpload.single("archive");
function archiveOr413(req, res, next) {
  takeArchive(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig
        ? `Archive trop lourde : ${Math.round(ARCHIVE_MAX / 1024 / 1024)} Mo au maximum.`
        : "Envoi invalide.",
    });
  });
}

// L'archive est un intermédiaire : une fois les planches sorties, elle n'a plus
// aucune raison d'être. Effacée quoi qu'il arrive, y compris quand l'extraction
// a échoué — c'est justement le cas où elle traînerait le plus longtemps.
async function dropArchive(file) {
  if (file?.path) await fs.promises.rm(file.path, { force: true }).catch(() => {});
}

// ----------------------------------------------------------------------
//  Les cartouches
// ----------------------------------------------------------------------
// À l'inverse d'un CBZ, une ROM n'est pas déballée : c'est ELLE qu'on sert au
// navigateur, telle quelle. Elle va donc DIRECTEMENT sur le disque, sans passer
// par la mémoire — trente mégaoctets retenus le temps d'un envoi, multipliés
// par les envois simultanés, c'est le genre de détail qui fait tomber un VPS à
// deux gigaoctets.
//
// Le nom du fichier est tiré au sort plutôt que construit sur le slug : deux
// dépôts successifs sur le même titre ne doivent pas se marcher dessus (le
// navigateur garderait l'ancien en cache pour la même URL), et le chemin
// enregistré en base fait foi.
const ROM_DIR = path.join(__dirname, "../../uploads/roms");
fs.mkdirSync(ROM_DIR, { recursive: true });

// `.agb` est le même fichier sous son nom d'usine, `.bin` la sortie de certains
// dumpeurs. Les trois passent : c'est l'en-tête qui tranche, pas l'extension
// (voir lib/gbaRom.js).
const ROM_RE = /\.(gba|agb|bin)$/i;

const romUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === "rom" ? ROM_DIR : UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".gba";
      const tag = `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${file.fieldname === "rom" ? "rom" : "up"}-${tag}${ext}`);
    },
  }),
  // Le bus de la GBA plafonne à 32 Mo de ROM : au-delà, ce n'est plus une
  // cartouche. La borne est donc PHYSIQUE cette fois, pas prudentielle.
  limits: { fileSize: 33 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "rom") return cb(null, ROM_RE.test(file.originalname));
    return cb(null, /^image\//.test(file.mimetype));
  },
});

const romFields = romUpload.fields([
  { name: "rom", maxCount: 1 },
  { name: "cover", maxCount: 1 },
]);

// Efface le fichier d'une cartouche. Best-effort : un fichier déjà disparu
// n'est pas une erreur, c'est le résultat recherché.
async function dropRom(stored) {
  if (!stored?.startsWith("/uploads/roms/")) return;
  await fs.promises
    .rm(path.join(ROM_DIR, path.basename(stored)), { force: true })
    .catch(() => {});
}

// Ce que la cartouche dit d'elle-même, prêt à être enregistré. L'admin garde la
// main sur tout : ce qu'il a saisi passe devant, la cartouche ne fait que
// remplir les blancs.
async function readCartridge(file) {
  const gba = await readGbaFile(file.path);
  return {
    gba,
    cartridge: {
      system: "gba",
      file: `/uploads/roms/${file.filename}`,
      bytes: file.size || 0,
      originalName: file.originalname || "",
      code: gba.code || "",
      region: gba.regionLabel || "",
      internalTitle: gba.internalTitle || "",
      version: Number.isFinite(gba.version) ? gba.version : null,
      saveType: gba.saveType || "",
      verified: !!gba.recognized,
    },
  };
}

// ----------------------------------------------------------------------
//  Les sauvegardes de partie
// ----------------------------------------------------------------------
// Un état de machine par (joueur, jeu, emplacement), posé à plat dans
// `uploads/saves/`. LE NOM DU FICHIER COMMENCE PAR L'IDENTIFIANT DU JOUEUR, et
// ce n'est pas cosmétique : c'est comme ça que l'onglet Système du panneau
// d'admin attribue le poids d'un fichier à quelqu'un (voir `scanUploads` dans
// routes/admin.js, qui lit le préfixe avant le premier tiret). Rangés dans des
// sous-dossiers par joueur, ils ne seraient comptés nulle part.
const SAVE_DIR = path.join(__dirname, "../../uploads/saves");
fs.mkdirSync(SAVE_DIR, { recursive: true });

const saveUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SAVE_DIR),
    // Un nom DÉTERMINISTE, à l'inverse des ROMs : écrire dans un emplacement
    // occupé doit ÉCRASER l'ancien état, pas en accumuler un deuxième. Le cache
    // du navigateur n'est pas un souci ici, la lecture passe par l'API.
    filename: (req, file, cb) => {
      const ext = file.fieldname === "shot" ? ".jpg" : ".state";
      cb(null, `${req.saveTag}-${file.fieldname === "shot" ? "shot" : "state"}${ext}`);
    },
  }),
  limits: { fileSize: STATE_MAX },
});

const saveFields = saveUpload.fields([
  { name: "state", maxCount: 1 },
  { name: "shot", maxCount: 1 },
]);

// L'emplacement demandé, ou rien. Les emplacements sont un ENSEMBLE FERMÉ (0 =
// automatique, 1 à 6 = manuels) : sans cette borne, un client pourrait semer
// autant de fichiers qu'il veut sur le disque en incrémentant un nombre.
function slotOf(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < AUTO_SLOT || n > MANUAL_SLOTS) return null;
  return n;
}

async function dropSaveFiles(save) {
  for (const stored of [save?.file, save?.thumb]) {
    if (!stored?.startsWith("/uploads/saves/")) continue;
    await fs.promises
      .rm(path.join(SAVE_DIR, path.basename(stored)), { force: true })
      .catch(() => {});
  }
}

const serializeSave = (req, s) => ({
  slot: s.slot,
  bytes: s.bytes || 0,
  thumb: abs(req, s.thumb),
  core: s.core || "",
  playSeconds: s.playSeconds || 0,
  label: s.label || "",
  at: s.updatedAt || s.createdAt,
});

// Champs qu'un admin peut corriger à la main. Liste blanche explicite : le
// corps de la requête ne doit jamais pouvoir écraser les épisodes, la
// progression des joueurs ou le slug.
const EDITABLE = [
  "title",
  "originalTitle",
  "kind",
  "animated",
  "format",
  "theater",
  "licence",
  "year",
  "endYear",
  "synopsis",
  "tagline",
  "genres",
  "runtime",
  "studio",
  "network",
  "country",
  "language",
  "franchise",
  "color",
  "readDirection",
  "authors",
  "publisher",
  "rating",
  "games",
  "featured",
  "order",
];

// Les champs qui sont des LISTES. Le formulaire les envoie tantôt en tableau,
// tantôt en texte à virgules (« Scénario, dessin ») : sans ce passage, Mongoose
// range la phrase entière comme un seul auteur, virgule comprise.
const LISTS = ["genres", "authors", "games"];

// Les dimensions sur mesure d'un boîtier, relues avec méfiance : elles pilotent
// une scène 3D, et une valeur aberrante (zéro, négative, un nombre venu d'un
// champ texte) donnerait un boîtier plat ou grand comme la pièce. Tout ce qui
// n'est pas dans une fourchette plausible est refusé en bloc plutôt que
// rafistolé — on retombe alors sur le gabarit DVD.
//
// Les bornes sont en unités du monde (1 unité ≈ 16 cm) et volontairement
// LARGES : elles sont là pour arrêter le zéro, le négatif et le « NaN » venu
// d'un champ texte, pas pour arbitrer ce qu'est un boîtier plausible — c'est
// l'outil de mesure qui s'en charge, et le serrage se règle de son côté. Une
// borne trop serrée ici refuserait en bloc une mesure parfaitement valide, avec
// pour seul retour « dimensions invalides ».
//
// Le plancher de la tranche (0,0125 ≈ 2 mm) est le seul vraiment physique :
// en deçà, ce n'est plus un boîtier mais une feuille, et la scène 3D n'a plus
// rien à texturer.
function cleanBox(raw) {
  let b = raw;
  // En multipart, tout arrive en texte : le corps est une chaîne JSON.
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  if (!b || typeof b !== "object") return null;
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  // Plafonds volontairement hors d atteinte : un boîtier d un mètre est absurde,
  // mais le refuser ici ne protège de rien — c est l outil de mesure qui sait ce
  // qui est plausible, lui seul connaît la jaquette. Ce filtre-ci n a qu un rôle :
  // qu aucune valeur non numérique, nulle ou négative n atteigne la scène 3D.
  const w = num(b.w, 0.0125, 50);
  const h = num(b.h, 0.2, 50);
  const d = num(b.d, 0.02, 50);
  if (w === null || h === null || d === null) return null;
  return {
    w,
    h,
    d,
    // Le trait de coupe est facultatif : sans lui, la jaquette se partage aux
    // proportions du boîtier, comme avant.
    // Bornes larges à dessein : hors fourchette, `num` renvoie null, et un
    // null ici ne lève PAS d erreur — il fait retomber le découpage sur le
    // partage proportionnel. Une borne trop serrée donnerait donc une jaquette
    // coupée au mauvais endroit, en silence, ce qui est pire qu un refus.
    spineX: num(b.spineX, 0, 1),
    spineW: num(b.spineW, 0.0005, 1),
    // La fenêtre utile de l'image. Facultative elle aussi : sans elle, on prend
    // l'image entière, ce que faisaient toutes les jaquettes d'avant.
    cropX: num(b.cropX, 0, 1),
    cropY: num(b.cropY, 0, 1),
    cropW: num(b.cropW, 0.02, 1),
    cropH: num(b.cropH, 0.02, 1),
  };
}

const abs = (req, p) =>
  p ? (p.startsWith("/uploads/") ? `${req.protocol}://${req.get("host")}${p}` : p) : null;

// LA COUVERTURE D'UN VOLUME DE PAPIER EST SA PREMIÈRE PLANCHE, toujours. Elle
// est dans l'archive : c'est l'objet qu'on a. Une affiche trouvée en ligne est
// une AUTRE image du même titre — autre édition, autre langue, autre cadrage —
// et le boîtier du rayon ne montrait alors pas la couverture qu'on découvre en
// l'ouvrant. Deux couvertures pour un livre, c'en est une de trop.
//
// LE CALCUL SE FAIT ICI, À LA SORTIE, et non dans ce qu'on écrit en base. Posée
// à l'import seulement, la règle ne vaudrait que pour les titres à venir : les
// fiches déjà déposées garderaient leur affiche jusqu'à ce qu'on repasse sur
// chacune. À la sortie, elle s'applique à tout le rayon, tout de suite, et sans
// rien détruire — l'affiche reste dans `artwork.poster` si on la veut un jour.
//
// LA JAQUETTE RESTE AU-DESSUS DE TOUT. Elle n'est pas une affiche mais le tour
// entier de l'objet, plats et dos compris, et le boîtier s'habille avec elle
// telle quelle sans que rien ne soit composé par-dessus (voir `paintCase`, côté
// client) : la couverture ci-dessous ne la concerne donc jamais.
const coverOf = (m) =>
  m.kind === "comic" && m.pages?.length ? m.pages[0].file : m.artwork?.poster;

// Vue « étagère » : tout sauf les épisodes (une série de 78 épisodes pèserait
// pour rien dans la liste).
function serializeCard(req, m, progress) {
  return {
    slug: m.slug,
    title: m.title,
    originalTitle: m.originalTitle,
    kind: m.kind,
    animated: m.animated,
    format: m.format,
    // L'hébergeur à brancher en premier. La carte le porte parce que la rangée
    // « Reprendre » lance la lecture sans passer par la fiche : sans lui, la
    // séance repartirait sur une source que quelqu'un a déjà écartée.
    defaultHost: m.source?.defaultHost || "",
    licence: m.licence,
    year: m.year,
    endYear: m.endYear,
    synopsis: m.synopsis,
    // L'accroche part avec la carte : c'est une des lignes qui s'impriment au
    // dos du boîtier (peint côté client, voir lib/collection.js), et le rayon
    // n'a que la carte sous la main.
    tagline: m.tagline || "",
    genres: m.genres,
    runtime: m.runtime,
    network: m.network,
    franchise: m.franchise,
    color: m.color,
    rating: m.rating,
    // Ce qui s'imprime au dos du boîtier (peint dans un canvas côté client,
    // voir lib/collection.js) : visa d'âge, langue d'origine, pistes annoncées.
    certification: m.certification || null,
    language: m.language || "",
    country: m.country || "",
    studio: m.studio || "",
    langs: m.source?.langs || [],
    episodeCount: m.episodes?.length || 0,
    // Le papier. `pageCount` suffit à la vignette et au compteur ; les planches
    // elles-mêmes ne partent qu'avec la fiche — une centaine d'URL par titre
    // alourdirait la liste pour rien.
    pageCount: m.pages?.length || 0,
    readDirection: m.readDirection || "ltr",
    authors: m.authors || [],
    publisher: m.publisher || "",
    // La cartouche part AVEC LA CARTE, fichier compris. C'est délibéré : on
    // peut lancer un jeu depuis la vitrine de l'étagère, sans passer par sa
    // fiche, et aller chercher la ROM au moment du clic mettrait une seconde
    // d'attente pile là où l'on veut voir la console s'allumer.
    cartridge: m.cartridge?.file
      ? {
          system: m.cartridge.system || "gba",
          rom: abs(req, m.cartridge.file),
          bytes: m.cartridge.bytes || 0,
          code: m.cartridge.code || "",
          region: m.cartridge.region || "",
          version: m.cartridge.version ?? null,
          saveType: m.cartridge.saveType || "",
          players: m.cartridge.players || null,
          verified: !!m.cartridge.verified,
        }
      : null,
    poster: abs(req, coverOf(m)),
    backdrop: abs(req, m.artwork?.backdrop),
    wrap: abs(req, m.artwork?.wrap),
    // Dimensions sur mesure du boîtier (null = gabarit DVD). La scène 3D en a
    // besoin dès le rayon, donc ça part avec la carte et non avec la fiche.
    box: m.box?.w && m.box?.h && m.box?.d ? m.box : null,
    channel: m.source?.channel || "",
    // Le lecteur du titre : la fiche et le panneau d'admin s'en servent pour
    // savoir ce qu'ils peuvent promettre (progression suivie ou non).
    provider: m.source?.provider || "youtube",
    // Quand ses liens ont été contrôlés pour la dernière fois, et ce qu'on y a
    // trouvé. Ne sert qu'au panneau d'admin, mais part avec la carte : c'est
    // depuis la LISTE qu'on décide quel titre repasser au contrôle.
    sourceCheck: m.sourceCheck?.at
      ? {
          at: m.sourceCheck.at,
          dead: m.sourceCheck.dead || 0,
          unknown: m.sourceCheck.unknown || 0,
          removed: m.sourceCheck.removed || 0,
        }
      : null,
    // QUAND LE BOÎTIER A ÉTÉ POSÉ. Rien ne l'affiche côté public — le rayon se
    // range par `order`, pas par date — mais le panneau d'admin s'ouvre sur les
    // derniers ajoutés : c'est là qu'on revient finir une fiche (la jaquette
    // qui manquait, la cartouche restée sur le disque), et sans cette date le
    // titre de tout à l'heure est perdu au milieu de cent autres.
    createdAt: m.createdAt || null,
    progress: progress
      ? {
          episodeIndex: progress.episodeIndex,
          positionSeconds: progress.positionSeconds,
          durationSeconds: progress.durationSeconds,
          watched: progress.watched,
          page: progress.page || 0,
          bookmarks: progress.bookmarks || [],
          playSeconds: progress.playSeconds || 0,
          completed: progress.completed,
          lastWatchedAt: progress.lastWatchedAt,
        }
      : null,
  };
}

// Exportée : la watchparty rejoue la MÊME fiche que la fiche solo (épisodes,
// miroirs, hébergeurs), sinon la salle et la page n'auraient pas les mêmes
// sources sous la main — et la séance partagée tomberait sur un lecteur que la
// fiche n'a jamais proposé. Elle est appelée sans progression : une salle n'a
// pas de « vu » à elle, chacun garde le sien.
export function serializeFull(req, m, progress) {
  return {
    ...serializeCard(req, m, progress),
    studio: m.studio,
    country: m.country,
    language: m.language,
    games: m.games,
    source: m.source,
    links: m.links,
    sources: m.sources,
    cast: (m.cast || []).map((c) => ({ ...c, photo: abs(req, c.photo) })),
    pages: (m.pages || []).map((pg) => ({
      index: pg.index,
      src: abs(req, pg.file),
      // La vignette part avec la planche : c'est elle que montrent les
      // planches-contact (fiche et lecteur), jamais `src`. Nulle sur un titre
      // importé avant qu'elles n'existent — l'affichage retombe sur `src`.
      thumb: abs(req, pg.thumb),
      w: pg.w,
      h: pg.h,
    })),
    episodes: (m.episodes || []).map((e) => ({
      index: e.index,
      season: e.season,
      number: e.number,
      title: e.title,
      synopsis: e.synopsis,
      // Le lecteur à employer, et de quoi le nourrir. Les miroirs partent avec :
      // c'est le poste qui bascule d'un hébergeur à l'autre, pas le serveur.
      provider: e.provider || "youtube",
      videoId: e.videoId,
      url: e.url || "",
      mirrors: e.mirrors || [],
      thumb: e.thumb,
      duration: e.duration,
      airDate: e.airDate,
    })),
  };
}

// GET /api/collection — l'étagère complète + ma progression.
router.get("/", requireAuth, async (req, res) => {
  try {
    const [media, progresses] = await Promise.all([
      CollectionMedia.find()
        .select("-episodes.synopsis -cast")
        .sort({ order: 1, createdAt: 1 })
        .lean(),
      CollectionProgress.find({ user: req.userId }).lean(),
    ]);
    const byMedia = new Map(progresses.map((p) => [String(p.media), p]));
    res.json({
      media: media.map((m) => serializeCard(req, m, byMedia.get(String(m._id)))),
    });
  } catch (err) {
    console.error("collection list error:", err.message);
    res.status(500).json({ error: "Impossible de charger la collection." });
  }
});

// GET /api/collection/lookup?q=&kind= — cherche la fiche externe à laquelle
// rattacher un boîtier (panneau d'admin). Déclarée AVANT /:slug, sinon
// « lookup » serait pris pour un slug.
router.get("/lookup", requireAuth, requireAdmin, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    // TMDB en tête quand il est configuré : c'est lui qui porte les films, les
    // web-séries et les images d'épisodes. TVmaze reste offert en second (il
    // connaît des séries télé que TMDB range autrement), et Wikipédia ferme la
    // marche. On annonce la provenance de chaque résultat : c'est l'admin qui
    // tranche à quelle fiche rattacher le boîtier.
    const [tmdbHits, shows, wiki] = await Promise.all([
      tmdb.search(q, req.query.kind),
      req.query.kind === "film" ? [] : tvmazeSearch(q),
      wikiSearch(q, "fr"),
    ]);
    res.json({ results: [...tmdbHits, ...shows, ...wiki], tmdb: tmdb.enabled() });
  } catch (err) {
    console.error("collection lookup error:", err.message);
    res.status(502).json({ error: "Recherche externe indisponible." });
  }
});

// GET /api/collection/preview?url= — ce que YouTube dit de cette URL, avant
// tout enregistrement : de quoi vérifier qu'on a bien la bonne playlist.
router.get("/preview", requireAuth, requireAdmin, async (req, res) => {
  const url = String(req.query.url || "");
  const playlistId = extractPlaylistId(url);
  const videoId = extractVideoId(url);
  if (!playlistId && !videoId)
    return res.status(400).json({ error: "Ce lien n'est pas une URL YouTube." });
  try {
    const [video, playlist] = await Promise.all([
      videoId ? ytVideo(videoId) : null,
      playlistId ? ytPlaylistItems(playlistId) : null,
    ]);
    res.json({
      videoId,
      playlistId,
      title: video?.title || playlist?.title || "",
      channel: video?.channel || "",
      thumb: video?.thumbFallback || null,
      playlistTitle: playlist?.title || "",
      count: playlist?.items?.length || (videoId ? 1 : 0),
      episodes: (playlist?.items || []).slice(0, 6).map((i) => i.title),
      // Le titre de la PLAYLIST d'abord : celui de la première vidéo porte le
      // décorum de la chaîne (« EP01 … | English Dub | Full Episode »).
      suggestedSlug: slugify(playlist?.title || video?.title || ""),
    });
  } catch (err) {
    console.error("collection preview error:", err.message);
    res.status(502).json({ error: "Lecture de l'URL impossible." });
  }
});

// POST /api/collection/preview-list — relit la LISTE de liens collée dans le
// panneau d'admin sans rien enregistrer : combien d'épisodes, chez quels
// hébergeurs, avec quels miroirs. Aucun appel réseau — c'est de la lecture de
// texte, et l'admin doit pouvoir corriger sa liste au fil de la frappe.
router.post("/preview-list", requireAuth, requireAdmin, (req, res) => {
  const text = String(req.body?.text || "");
  const parsed = parseEpisodeLines(text);
  const hosts = new Map();
  for (const e of parsed) {
    for (const u of [e.url, ...(e.mirrors || []).map((m) => m.url)]) {
      const h = hostLabel(u);
      if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
    }
  }
  res.json({
    count: parsed.length,
    // Une ligne sur deux mal formée se voit tout de suite dans ce compte.
    lines: text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length,
    providers: [...new Set(parsed.map((e) => e.provider))],
    hosts: [...hosts.entries()].map(([host, count]) => ({ host, count })),
    episodes: parsed.slice(0, 8).map((e) => ({
      season: e.season,
      number: e.number,
      title: e.title,
      provider: e.provider,
      host: hostLabel(e.url),
      mirrors: (e.mirrors || []).length,
    })),
  });
});

// GET /api/collection/import/anime-sama?url=&lang= — lit une fiche d'un
// répertoire de liens et REMPLIT LA ZONE DE LISTE. Rien n'est enregistré ici :
// la réponse est du texte et des métadonnées que l'admin relit, corrige, puis
// enregistre par le chemin normal — l'import fait la frappe, pas le choix.
// POST /api/collection/import/paste — le même import, mais à partir d'une
// source que l'admin a copiée lui-même depuis son navigateur. C'est le recours
// quand le site passe derrière un filtre anti-robots : le serveur ne va plus
// rien chercher, il se contente de lire ce qu'on lui donne.
router.post("/import/paste", requireAuth, requireAdmin, (req, res) => {
  try {
    const text = String(req.body?.text || "");
    // La FICHE D'UN FILM se reconnaît à ce qu'elle contient (des adresses
    // d'hébergeurs, pas de listes d'épisodes) : voir looksLikeFilmPage, qui
    // laisse toujours la priorité aux signatures anime-sama.
    if (looksLikeFilmPage(text))
      return res.json(importFilmFromSource(text, { pageUrl: req.body?.url || "" }));
    res.json(
      importFromSource(req.body.text, { season: req.body.season, label: req.body.label })
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/collection/import/link?url=&lang= — UNE seule porte d'entrée pour
// les deux répertoires. Le lien dit ce qu'il est : une fiche anime-sama a ses
// saisons et ses `episodes.js`, tout le reste est lu comme la fiche d'un film,
// c'est-à-dire un programme unique et ses lecteurs (lib/filmIndex.js).
//
// Un seul champ dans le panneau plutôt que deux : au moment de coller une
// adresse, on sait ce qu'on colle — l'application, elle, peut le déduire.
router.get("/import/link", requireAuth, requireAdmin, async (req, res) => {
  const url = String(req.query.url || "").trim();
  try {
    if (parseUrl(url)) {
      const data = await importFromUrl(url, {
        lang: String(req.query.lang || "").toLowerCase() || undefined,
      });
      return res.json({ kind: "series", ...data });
    }
    res.json(await importFilmFromUrl(url));
  } catch (err) {
    console.error("collection import error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/collection/:slug — la fiche complète (épisodes, casting).
// Les routes NOMMÉES passent obligatoirement avant « /:slug » : Express sert
// la première qui correspond, et « /comic-lookup » se ferait sinon lire comme
// le slug d'un média — donc 404, alors que la recherche est bien là.
// GET /api/collection/comic-lookup?q= — cherche dans les quatre bases, les
// françaises d'abord (voir lib/comicMeta.js). Une COMMODITÉ : ces one-shots
// promotionnels sont rarement catalogués, et rien n'oblige à en trouver un pour
// poser le titre.
router.get("/comic-lookup", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await comicLookup(req.query.q));
  } catch (err) {
    // Une base tierce en panne ne doit pas ressembler à une panne de l'app :
    // on renvoie une liste vide, et l'admin saisit à la main. La MÊME forme que
    // le cas nominal, sinon l'écran lit `undefined` là où il attend un nombre.
    console.error("comic lookup error:", err.message);
    res.json({
      results: [],
      comicvine: !!process.env.COMICVINE_API_KEY,
      total: 0,
      french: 0,
      failed: [],
    });
  }
});

router.get("/:slug", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug }).lean();
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const progress = await CollectionProgress.findOne({
      user: req.userId,
      media: media._id,
    }).lean();
    res.json({ media: serializeFull(req, media, progress) });
  } catch (err) {
    console.error("collection detail error:", err.message);
    res.status(500).json({ error: "Impossible de charger ce média." });
  }
});

// PUT /api/collection/:slug/progress — où j'en suis.
// Appelé pendant la lecture (toutes les ~15 s) et à la fermeture de la télé :
// on écrit la position, et l'épisode bascule en « vu » passé le seuil.
router.put("/:slug/progress", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug })
      .select("_id episodes.index")
      .lean();
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    const total = media.episodes?.length || 1;
    const episodeIndex = Math.max(
      0,
      Math.min(Number(req.body.episodeIndex) || 0, total - 1)
    );
    const positionSeconds = Math.max(0, Number(req.body.positionSeconds) || 0);
    const durationSeconds = Math.max(0, Number(req.body.durationSeconds) || 0);

    const doc =
      (await CollectionProgress.findOne({ user: req.userId, media: media._id })) ||
      new CollectionProgress({ user: req.userId, media: media._id });

    doc.episodeIndex = episodeIndex;
    doc.positionSeconds = positionSeconds;
    doc.durationSeconds = durationSeconds;
    doc.lastWatchedAt = new Date();

    const done =
      req.body.watched === true ||
      (durationSeconds > 0 && positionSeconds / durationSeconds >= WATCHED_RATIO);
    if (done && !doc.watched.includes(episodeIndex)) doc.watched.push(episodeIndex);
    doc.completed = doc.watched.length >= total;

    await doc.save();
    res.json({
      progress: {
        episodeIndex: doc.episodeIndex,
        positionSeconds: doc.positionSeconds,
        durationSeconds: doc.durationSeconds,
        watched: doc.watched,
        completed: doc.completed,
        lastWatchedAt: doc.lastWatchedAt,
      },
    });
  } catch (err) {
    console.error("collection progress error:", err.message);
    res.status(500).json({ error: "Progression non enregistrée." });
  }
});

// POST /api/collection/:slug/default-source — pose l'hébergeur qu'on branche
// en premier, POUR TOUT LE MONDE.
//
// Ouvert à n'importe quel spectateur, et c'est le point : sur un titre à quatre
// lecteurs dont un seul tient la route, celui qui vient de le trouver épargne la
// recherche à tous les suivants. Le geste coûte un clic sur une étoile et se
// défait pareil — rien qui mérite un rôle.
//
// On n'accepte qu'un hôte RÉELLEMENT PRÉSENT dans les épisodes : le champ finit
// dans une requête, pas question d'y écrire n'importe quoi.
router.post("/:slug/default-source", requireAuth, async (req, res) => {
  try {
    const host = String(req.body?.host || "")
      .toLowerCase()
      .replace(/^www\./, "")
      .slice(0, 80);
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    if (host) {
      const known = new Set();
      for (const ep of media.episodes || [])
        for (const s of sourcesOf(ep)) known.add(hostLabel(s.url));
      if (!known.has(host))
        return res.status(400).json({ error: "Cet hébergeur ne sert pas ce titre." });
    }

    media.source.defaultHost = host;
    await media.save();
    res.json({ defaultHost: host });
  } catch (err) {
    console.error("collection default source error:", err.message);
    res.status(500).json({ error: "Lecteur par défaut non enregistré." });
  }
});

// DELETE /api/collection/:slug/sources/:host — retire un hébergeur mort.
//
// LE GESTE DE L'ADMIN QUI REGARDE. Le vérificateur de liens (onglet Collection)
// travaille par titre, à froid ; celui-ci se fait EN SÉANCE, au moment où l'on
// constate qu'un lecteur ne donne plus rien. Il retire l'hébergeur de TOUS les
// épisodes d'un coup, parce qu'un hôte ne meurt jamais sur un seul : le miroir
// suivant prend la place, et un épisode qui n'a plus rien quitte la liste (la
// progression des joueurs est recalée derrière, comme à la purge).
router.delete("/:slug/sources/:host", requireAuth, requireAdmin, async (req, res) => {
  try {
    const host = String(req.params.host || "")
      .toLowerCase()
      .replace(/^www\./, "");
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    const kept = [];
    const out = [];
    let removed = 0;

    (media.episodes || []).forEach((ep, at) => {
      const live = sourcesOf(ep).filter((s) => {
        const gone = hostLabel(s.url) === host;
        if (gone) removed++;
        return !gone;
      });
      if (!live.length) return; // plus rien pour le lire : l'épisode s'en va
      const [main, ...mirrors] = live;
      const base = typeof ep.toObject === "function" ? ep.toObject() : { ...ep };
      kept.push(at);
      out.push({
        ...base,
        index: out.length,
        provider: main.provider,
        videoId: main.provider === "youtube" ? main.videoId : null,
        url: main.synthetic ? "" : main.url,
        mirrors: mirrors.map((m) => ({ label: m.label || hostLabel(m.url), url: m.url })),
      });
    });

    if (!removed)
      return res.status(400).json({ error: "Aucun lien de cet hébergeur sur ce titre." });

    const dropped = (media.episodes?.length || 0) - out.length;
    media.episodes = out;
    // La liste rouverte dans le tiroir d'admin porterait sinon encore les liens
    // qu'on vient d'écarter, et le premier enregistrement les ramènerait.
    if ((media.source?.provider || "youtube") !== "youtube")
      media.source.list = episodesToLines(out);
    // L'hébergeur par défaut ne peut pas être celui qu'on vient de retirer.
    if (media.source.defaultHost === host) media.source.defaultHost = "";
    await media.save();

    if (dropped) await shiftProgress(media._id, kept, out.length);

    res.json({
      removed,
      dropped,
      media: serializeFull(req, media.toObject(), null),
    });
  } catch (err) {
    console.error("collection drop source error:", err.message);
    res.status(500).json({ error: "Source non retirée." });
  }
});

// POST /api/collection/:slug/watched — coche/décoche un épisode à la main.
router.post("/:slug/watched", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug })
      .select("_id episodes.index")
      .lean();
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const total = media.episodes?.length || 1;
    const index = Math.max(0, Math.min(Number(req.body.index) || 0, total - 1));

    const doc =
      (await CollectionProgress.findOne({ user: req.userId, media: media._id })) ||
      new CollectionProgress({ user: req.userId, media: media._id });
    const at = doc.watched.indexOf(index);
    if (at >= 0) doc.watched.splice(at, 1);
    else doc.watched.push(index);
    doc.completed = doc.watched.length >= total;
    await doc.save();
    res.json({ watched: doc.watched, completed: doc.completed });
  } catch (err) {
    console.error("collection watched error:", err.message);
    res.status(500).json({ error: "Impossible de cocher cet épisode." });
  }
});

// --------------------------------------------------------------- curation --
// Réservé à l'admin : le catalogue reste curé (contenus regardables
// librement là où ils sont hébergés), on n'ouvre pas l'ajout à tout le monde.

// POST /api/collection — ajoute un média, depuis une URL YouTube ou depuis une
// liste de liens (autres lecteurs : iframe d'un site tiers, fichier vidéo).
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const manual = req.body?.provider && req.body.provider !== "youtube";
    if (!manual && !req.body?.url)
      return res.status(400).json({ error: "URL manquante." });
    if (manual && !String(req.body.episodesText || "").trim())
      return res.status(400).json({ error: "Liste d'épisodes vide." });
    const built = await buildMedia(req.body);
    built.cast = await localizeCast(built);
    const media = await CollectionMedia.findOneAndUpdate(
      { slug: built.slug },
      built,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    res.status(201).json({ media: serializeFull(req, media, null) });
  } catch (err) {
    console.error("collection create error:", err.message);
    res.status(502).json({ error: `Enrichissement impossible : ${err.message}` });
  }
});

// PATCH /api/collection/:slug — corrections à la main (titre, teinte, support,
// franchise…). N'écrase JAMAIS les épisodes ni la progression des joueurs :
// seuls les champs de la liste blanche EDITABLE sont acceptés.
router.patch("/:slug", requireAuth, requireAdmin, async (req, res) => {
  try {
    const patch = {};
    for (const key of EDITABLE) {
      if (req.body[key] === undefined) continue;
      patch[key] = LISTS.includes(key) ? parseList(req.body[key]) : req.body[key];
    }
    // CHANGER DE NATURE, C'EST LAISSER DERRIÈRE SOI CE QUI N'A PLUS COURS. Le
    // sens de lecture n'appartient qu'au papier : sur un film il ne s'affiche
    // plus nulle part, mais il reste écrit dans la fiche — et la scène 3D s'en
    // sert pour décider par quelle face présenter l'objet, si bien qu'un manga
    // rebasculé en film se présentait à l'envers. On le remet donc d'aplomb au
    // moment même où la nature change, plutôt que de le laisser traîner.
    //
    // Les PLANCHES, elles, ne sont pas touchées : ce sont des fichiers extraits
    // sur le disque, et les effacer au détour d'une correction de formulaire
    // serait une perte pour une faute de frappe.
    if (patch.kind && patch.kind !== "comic") patch.readDirection = "ltr";
    // Changer l'URL de streaming est possible, mais les épisodes ne suivent
    // qu'après un « rafraîchir » — on le dit dans la réponse.
    if (req.body.sourceUrl) patch["source.url"] = String(req.body.sourceUrl);
    // La cartouche : deux champs seulement se corrigent à la main. La région
    // quand l'en-tête est muet (un homebrew n'a pas de code de jeu), et le
    // nombre de joueurs, qu'AUCUN fichier ne porte — il est imprimé au dos de
    // la boîte, nulle part ailleurs. Tout le reste vient du fichier et n'a rien
    // à faire dans un formulaire.
    if (req.body.cartridge && typeof req.body.cartridge === "object") {
      const c = req.body.cartridge;
      if (c.region !== undefined)
        patch["cartridge.region"] = String(c.region || "").slice(0, 40);
      if (c.players !== undefined) {
        const n = Number(c.players);
        patch["cartridge.players"] =
          Number.isFinite(n) && n > 0 ? Math.min(16, Math.round(n)) : null;
      }
    }
    // Dimensions du boîtier : `null` explicite = retour au gabarit DVD.
    if (req.body.box !== undefined) {
      const box = req.body.box === null ? {} : cleanBox(req.body.box);
      if (!box) return res.status(400).json({ error: "Dimensions de boîtier invalides." });
      patch.box = box;
    }
    if (!Object.keys(patch).length)
      return res.status(400).json({ error: "Rien à modifier." });

    const media = await CollectionMedia.findOneAndUpdate(
      { slug: req.params.slug },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    res.json({
      media: serializeFull(req, media, null),
      needsRefresh: !!req.body.sourceUrl,
    });
  } catch (err) {
    console.error("collection patch error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/collection/:slug/artwork — remplace un visuel, soit par un fichier
// déposé, soit par une URL distante (rapatriée chez nous comme les autres :
// l'étagère 3D a besoin d'images de notre origine).
router.post(
  "/:slug/artwork",
  requireAuth,
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const which = ["backdrop", "wrap"].includes(req.body.which)
        ? req.body.which
        : "poster";
      const media = await CollectionMedia.findOne({ slug: req.params.slug });
      if (!media) return res.status(404).json({ error: "Média introuvable." });

      let stored = null;
      if (req.file) stored = `/uploads/collection/${req.file.filename}`;
      else if (req.body.url)
        stored = await downloadArtwork(req.body.url, `${media.slug}-${which}`);

      // La jaquette dépliée arrive avec les DIMENSIONS relevées dessus, dans la
      // même requête : l'image et le gabarit qui la découpe forment un tout, et
      // les enregistrer séparément laisserait une fenêtre où le boîtier est
      // taillé selon l'ancienne jaquette.
      if (which === "wrap" && req.body.box !== undefined) {
        const box = cleanBox(req.body.box);
        if (!box) return res.status(400).json({ error: "Dimensions de boîtier invalides." });
        media.box = box;
        // Régler les dimensions sans changer l'image est un geste normal : on
        // repositionne la tranche sur la jaquette déjà en place.
        if (!stored && media.artwork.wrap) {
          await media.save();
          return res.json({ media: serializeFull(req, media.toObject(), null) });
        }
      }

      if (!stored)
        return res.status(400).json({ error: "Aucune image utilisable fournie." });

      media.artwork[which] = stored;
      if (which === "poster") media.artwork.thumb = stored;
      await media.save();
      res.json({ media: serializeFull(req, media.toObject(), null) });
    } catch (err) {
      console.error("collection artwork error:", err.message);
      res.status(500).json({ error: "Visuel non enregistré." });
    }
  }
);

// PUT /api/collection/:slug/episodes — réécrit la liste des épisodes d'un
// titre servi par un lecteur tiers. C'est LE geste d'entretien de ces
// boîtiers : un hébergeur tombe, on remplace la ligne, le reste ne bouge pas.
//
// Ce qui a été trouvé ailleurs (titre français, résumé, vignette, date) est
// reporté sur la nouvelle liste par (saison, numéro) : réécrire trois liens ne
// doit pas coûter tout l'habillage.
// Pose une liste sur un média. Extrait ici parce que DEUX gestes y mènent : la
// liste corrigée à la main, et le scrape qui remplace la source d'un coup — et
// ils doivent poser exactement la même chose.
function applyEpisodeList(media, text) {
  const parsed = parseEpisodeLines(text || "");
  if (!parsed.length) {
    const err = new Error("Aucun épisode lisible dans cette liste.");
    err.status = 400;
    throw err;
  }
  const before = new Map(
    (media.episodes || []).map((e) => [`${e.season || 1}x${e.number}`, e])
  );
  media.episodes = parsed.map((item, i) => {
    const season = item.season || 1;
    const number = item.number ?? i + 1;
    const old = before.get(`${season}x${number}`);
    return {
      index: i,
      season,
      number,
      title: item.title || old?.title || `Épisode ${number}`,
      synopsis: old?.synopsis || "",
      provider: item.provider,
      videoId: item.videoId || null,
      url: item.url,
      mirrors: item.mirrors,
      thumb: old?.thumb || null,
      duration: old?.duration || null,
      airDate: old?.airDate || null,
    };
  });
  media.source.provider = parsed[0].provider;
  media.source.list = String(text || "").trim();
  // La progression des joueurs pointe des POSITIONS : si la liste a changé de
  // longueur, leurs coches ne désignent plus les mêmes épisodes.
  return { shifted: before.size !== media.episodes.length };
}

router.put("/:slug/episodes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    const { shifted } = applyEpisodeList(media, req.body?.text);
    await media.save();

    res.json({ media: serializeFull(req, media.toObject(), null), shifted });
  } catch (err) {
    console.error("collection episodes error:", err.message);
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /api/collection/:slug/source — TOUT CE QUI SERT À CORRIGER LA SOURCE.
//
// Le tiroir d'édition ne reçoit que la carte du rayon (`serializeCard`), et
// celle-ci ne porte pas `source` : elle sert à peindre une étagère, pas à
// réparer un lien. Résultat, le tiroir ne pouvait RIEN montrer de la source en
// place — ni la page d'origine, ni les hébergeurs réellement utilisés — et
// proposait de « changer le lien » sans dire lequel était là.
//
// D'où cette route : la liste telle qu'on la rouvre pour la corriger, et l'état
// de ce qui tourne aujourd'hui. Une seule requête, parce que c'est un seul
// écran.
function sourcePayload(media) {
  // Qui sert vraiment ce titre, et combien de fois. C'est le seul chiffre qui
  // dise l'état réel d'une liste tenue à la main : un hébergeur présent sur
  // trois épisodes sur vingt, c'est une liste à moitié morte.
  const tally = new Map();
  for (const ep of media.episodes || []) {
    const main =
      ep.url || (ep.videoId ? `https://www.youtube.com/watch?v=${ep.videoId}` : "");
    for (const u of [main, ...(ep.mirrors || []).map((m) => m.url)].filter(Boolean)) {
      const h = hostLabel(u);
      if (h) tally.set(h, (tally.get(h) || 0) + 1);
    }
  }
  return {
    provider: media.source?.provider || "youtube",
    url: media.source?.url || "",
    channel: media.source?.channel || "",
    channelUrl: media.source?.channelUrl || "",
    playlistId: media.source?.playlistId || null,
    videoId: media.source?.videoId || null,
    langs: media.source?.langs || [],
    count: media.episodes?.length || 0,
    hosts: [...tally.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count),
    text: media.source?.list || episodesToLines(media.episodes || []),
  };
}

router.get("/:slug/source", requireAuth, requireAdmin, async (req, res) => {
  const media = await CollectionMedia.findOne({ slug: req.params.slug })
    .select("source episodes")
    .lean();
  if (!media) return res.status(404).json({ error: "Média introuvable." });
  res.json(sourcePayload(media));
});

// Les adresses déjà en place sur le premier épisode — c'est-à-dire, pour un
// film, TOUS ses lecteurs. Sert au collage : une fiche qui ne monte ses lecteurs
// qu'au clic ne se laisse lire qu'un lecteur à la fois, et chaque passage doit
// AJOUTER le sien aux autres au lieu de les balayer.
function filmUrlsOf(media) {
  const ep = media.episodes?.[0];
  if (!ep) return [];
  const main =
    ep.url || (ep.videoId ? `https://www.youtube.com/watch?v=${ep.videoId}` : "");
  return [main, ...(ep.mirrors || []).map((m) => m.url)].filter(Boolean);
}

// POST /api/collection/:slug/source/import — SCRAPER ET REMPLACER, en un geste.
//
// C'était le trou du tiroir d'édition : on pouvait changer l'adresse, mais les
// épisodes ne suivaient pas — il fallait ressortir, retrouver la ligne, et
// presser « rafraîchir ». Pour un titre servi par des hébergeurs tiers, ce
// bouton-là ne savait de toute façon rien faire.
//
// Ici, une adresse suffit, quelle qu'elle soit :
//
//   • une fiche anime-sama  → ses saisons et leurs miroirs ;
//   • une fiche de film     → ses lecteurs (lib/filmIndex.js) ;
//   • une URL YouTube       → la playlist re-scrapée, comme « rafraîchir ».
//
// Et la source est REMPLACÉE dans la foulée : nouveaux épisodes, nouveau
// lecteur, ancienne chaîne oubliée. Rien d'autre de la fiche n'est touché — le
// titre, les visuels et le résumé restent ceux qu'on a corrigés à la main.
router.post("/:slug/source/import", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    const url = String(req.body?.url || "").trim();
    const text = String(req.body?.text || "");
    const lang = String(req.body?.lang || "").toLowerCase() || undefined;
    // Le collage COMPLÈTE (il n'apporte qu'un lecteur, ou qu'une saison), le
    // lien REMPLACE (il apporte toute la fiche). C'est le client qui tranche,
    // parce que c'est lui qui sait sur quel bouton on a appuyé.
    const merge = req.body?.merge === true;

    if (!url && !text)
      return res.status(400).json({ error: "Il faut une adresse ou une source collée." });

    // --- 1. Ce que dit la source ------------------------------------------
    let imported;
    if (text) {
      imported = looksLikeFilmPage(text)
        ? importFilmFromSource(text, { pageUrl: url })
        : importFromSource(text, { season: req.body?.season, label: req.body?.label });
    } else if (parseUrl(url)) {
      imported = { kind: "series", ...(await importFromUrl(url, { lang })) };
    } else if (extractVideoId(url) || extractPlaylistId(url)) {
      // YouTube ne passe pas par une liste de liens : ses épisodes se lisent
      // dans la playlist. On les monte ICI plutôt qu'en repassant par
      // l'enrichissement complet — celui-ci rapatrierait au passage affiche et
      // bandeau sous un nom horodaté, pour les jeter aussitôt : deux images
      // orphelines sur le disque à chaque essai, et une fiche qu'on n'a pas
      // demandé de retoucher.
      const playlistId = extractPlaylistId(url);
      const videoId = extractVideoId(url);
      const playlist = playlistId ? await ytPlaylistItems(playlistId) : null;
      const first = videoId ? await ytVideo(videoId) : null;
      const items = playlist?.items?.length
        ? playlist.items
        : first
          ? [{ videoId: first.videoId, title: first.title, duration: null }]
          : [];
      if (!items.length)
        return res.status(502).json({ error: "Aucune vidéo trouvée pour cette adresse." });

      // Ce qui avait été écrit à la main sur un épisode le suit s'il est
      // toujours là : le raccord se fait sur l'identifiant de la vidéo, seule
      // chose qui ne bouge pas d'une playlist à l'autre.
      const before = new Map((media.episodes || []).map((e) => [e.videoId, e]));
      media.episodes = items.map((it, i) => {
        const old = before.get(it.videoId);
        return {
          index: i,
          season: 1,
          number: i + 1,
          title: it.title || old?.title || `Épisode ${i + 1}`,
          synopsis: old?.synopsis || "",
          provider: "youtube",
          videoId: it.videoId,
          url: "",
          mirrors: [],
          thumb: `https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`,
          duration: it.duration || old?.duration || null,
          airDate: old?.airDate || null,
        };
      });
      media.source.provider = "youtube";
      media.source.url = url;
      media.source.playlistId = playlistId || null;
      media.source.videoId = videoId || items[0].videoId;
      // La chaîne suit la nouvelle source, ou disparaît : celle d'avant ne
      // décrit plus ce qu'on regarde.
      media.source.channel = first?.channel || "";
      media.source.channelUrl = first?.channelUrl || "";
      media.source.list = "";
      await media.save();
      return res.json({
        applied: true,
        report: {
          kind: "youtube",
          title: playlist?.title || first?.title || "",
          count: media.episodes.length,
          channel: media.source.channel,
        },
        source: sourcePayload(media.toObject()),
      });
    } else {
      imported = await importFilmFromUrl(url);
    }

    // --- 2. La liste qui en découle ---------------------------------------
    let list;
    if (imported.kind === "film") {
      const found = (imported.players || []).map((p) => p.url);
      const all = merge ? [...new Set([...filmUrlsOf(media), ...found])] : found;
      if (!all.length)
        return res.status(400).json({
          error:
            "Aucun lecteur trouvé sur cette page : le site va les chercher au clic. " +
            "Ouvre la fiche, choisis un lecteur, puis colle la source ici.",
        });
      list = `${media.title} — ${all.join(" | ")}`;
    } else if (imported.kind === "catalogue") {
      return res.status(400).json({
        error:
          "Cette source décrit la fiche mais ne contient aucun épisode : colle le " +
          "fichier episodes.js de chaque saison.",
      });
    } else if (merge && imported.kind === "episodes") {
      const before = media.source?.list || episodesToLines(media.episodes || []);
      list = [before.trim(), imported.list].filter(Boolean).join("\n");
    } else {
      list = imported.list;
    }

    // --- 3. On remplace ----------------------------------------------------
    const { shifted } = applyEpisodeList(media, list);
    // L'ANCIENNE SOURCE NE DÉCRIT PLUS RIEN. Un titre passé d'une playlist
    // YouTube à des hébergeurs tiers gardait sa chaîne et son identifiant de
    // playlist : la fiche continuait d'annoncer « CameraClub » sous un film
    // servi ailleurs, et « rafraîchir » serait allé rechercher l'ancienne.
    media.source.videoId = null;
    media.source.playlistId = null;
    media.source.channel = "";
    media.source.channelUrl = "";
    if (imported.sourceUrl || url) media.source.url = imported.sourceUrl || url;
    if (imported.langs?.length) media.source.langs = imported.langs;
    await media.save();

    res.json({
      applied: true,
      shifted,
      report: imported,
      source: sourcePayload(media.toObject()),
    });
  } catch (err) {
    console.error("collection source import error:", err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
});

// POST /api/collection/:slug/refresh — re-scrape (nouveaux épisodes…).
router.post("/:slug/refresh", requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await CollectionMedia.findOne({ slug: req.params.slug }).lean();
    if (!existing) return res.status(404).json({ error: "Média introuvable." });
    const built = await buildMedia({ ...existing, ...req.body, url: existing.source.url });
    built.cast = await localizeCast(built);
    const media = await CollectionMedia.findOneAndUpdate({ slug: existing.slug }, built, {
      new: true,
    }).lean();
    res.json({ media: serializeFull(req, media, null) });
  } catch (err) {
    console.error("collection refresh error:", err.message);
    res.status(502).json({ error: `Rafraîchissement impossible : ${err.message}` });
  }
});

// ======================================================================
//  Le vérificateur de liens — sonder, puis purger
// ======================================================================
// Deux routes et non une, exprès : le CONTRÔLE ne touche à rien et rend un
// compte rendu, la PURGE applique ce compte rendu. Un admin doit pouvoir lire
// ce qu'il s'apprête à perdre — « 3 miroirs morts » et « 12 épisodes qui
// n'auront plus aucun lecteur » ne se décident pas de la même façon.
//
// Le compte rendu est gardé en mémoire le temps de la décision : sonder deux
// cents liens prend une minute, et la refaire au moment de valider serait une
// minute d'attente pour rien — et le risque de purger sur un verdict qui n'est
// plus celui qu'on a lu à l'écran.
const CHECKS = new Map(); // slug → { at, report }
const CHECK_TTL = 20 * 60 * 1000;

function rememberCheck(slug, report) {
  CHECKS.set(slug, { at: Date.now(), report });
  // Ménage à la volée : ce cache ne doit pas devenir une fuite de mémoire pour
  // un rayon qu'on passe en revue une fois par trimestre.
  for (const [key, entry] of CHECKS)
    if (Date.now() - entry.at > CHECK_TTL) CHECKS.delete(key);
}

// Seuls les titres qui SE REGARDENT ont des liens à contrôler : un comic est un
// dossier de planches chez nous, une cartouche un fichier sur notre disque.
const playable = (m) => m.kind === "series" || m.kind === "film";

// LA PROGRESSION SUIT LA LISTE. Les coches des joueurs désignent des POSITIONS
// (« l'épisode n° 4 de la liste »), pas des épisodes : retirer un épisode du
// milieu décalerait tout ce qui suit, et chacun retrouverait ses épisodes vus
// à côté de la plaque. On les recale donc ici, avec la table des survivants.
async function shiftProgress(mediaId, kept, total) {
  const shift = new Map(kept.map((old, i) => [old, i]));
  const docs = await CollectionProgress.find({ media: mediaId });
  for (const doc of docs) {
    doc.watched = [
      ...new Set((doc.watched || []).map((i) => shift.get(i)).filter((i) => i !== undefined)),
    ].sort((a, b) => a - b);

    let at = shift.get(doc.episodeIndex);
    if (at === undefined) {
      // L'épisode où l'on s'était arrêté n'existe plus : on retombe sur le plus
      // proche encore là AVANT lui. Reprendre un épisode trop tôt se rattrape
      // d'un clic ; en sauter un sans le savoir, non.
      let back = doc.episodeIndex - 1;
      while (back >= 0 && shift.get(back) === undefined) back--;
      at = back >= 0 ? shift.get(back) : 0;
      // Et la position dans l'épisode ne veut plus rien dire : ce n'est plus
      // le même épisode.
      doc.positionSeconds = 0;
      doc.durationSeconds = 0;
    }
    doc.episodeIndex = Math.max(0, Math.min(at, Math.max(0, total - 1)));
    doc.completed = total > 0 && doc.watched.length >= total;
    await doc.save();
  }
}

// POST /api/collection/:slug/sources/check — frappe à toutes les portes.
// Ne modifie rien : rend l'état de chaque source (voir lib/collectionProbe.js).
router.post("/:slug/sources/check", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug })
      .select("slug title kind episodes")
      .lean();
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    if (!playable(media))
      return res.status(400).json({ error: "Ce support n'a pas de lecteur à vérifier." });
    if (!media.episodes?.length)
      return res.status(400).json({ error: "Aucun épisode à vérifier." });

    const report = await checkEpisodes(media.episodes);
    rememberCheck(media.slug, report);
    // La trace du passage part en base tout de suite : même si l'admin referme
    // sans rien purger, il saura la prochaine fois que ce titre a été contrôlé.
    await CollectionMedia.updateOne(
      { slug: media.slug },
      {
        $set: {
          "sourceCheck.at": new Date(),
          "sourceCheck.dead": report.dead,
          "sourceCheck.unknown": report.unknown,
        },
      }
    );
    res.json({ report });
  } catch (err) {
    console.error("collection check error:", err.message);
    res.status(502).json({ error: `Vérification impossible : ${err.message}` });
  }
});

// POST /api/collection/:slug/sources/purge — retire ce qui est mort.
// Seules les sources jugées MORTES SANS AMBIGUÏTÉ partent ; celles que le
// contrôle n'a pas su trancher restent en place (voir l'en-tête du module).
router.post("/:slug/sources/purge", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    if (!playable(media))
      return res.status(400).json({ error: "Ce support n'a pas de lecteur à vérifier." });

    const cached = CHECKS.get(media.slug);
    const report =
      cached && Date.now() - cached.at < CHECK_TTL
        ? cached.report
        : await checkEpisodes(media.episodes || []);

    const { episodes, kept, removedSources, removedEpisodes } = purgeEpisodes(
      media.episodes || [],
      report
    );

    if (removedSources) {
      media.episodes = episodes;
      // LA LISTE COLLÉE SE RÉÉCRIT AUSSI. C'est elle que rouvre le tiroir
      // d'édition (« Épisodes »), et elle porte encore les liens morts : sans
      // ça, le premier « Enregistrer la liste » les ressusciterait tous.
      //
      // Uniquement sur un titre TENU À LA MAIN : un titre YouTube n'a pas de
      // liste collée, et lui en écrire une changerait la façon dont il se
      // rafraîchit (re-scraper la playlist n'est pas relire une liste). Le
      // lecteur du titre ne bouge pas non plus : purger des liens morts ne
      // change pas la nature du boîtier.
      if ((media.source?.provider || "youtube") !== "youtube")
        media.source.list = episodesToLines(episodes);
    }
    media.sourceCheck = {
      at: new Date(),
      dead: report.dead,
      unknown: report.unknown,
      removed: removedSources,
    };
    await media.save();

    if (removedEpisodes) await shiftProgress(media._id, kept, episodes.length);
    CHECKS.delete(media.slug);

    res.json({
      removedSources,
      removedEpisodes,
      left: episodes.length,
      unknown: report.unknown,
      media: serializeFull(req, media.toObject(), null),
    });
  } catch (err) {
    console.error("collection purge error:", err.message);
    res.status(500).json({ error: `Purge impossible : ${err.message}` });
  }
});

// DELETE /api/collection/:slug — retire un média du catalogue.
router.delete("/:slug", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOneAndDelete({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    await CollectionProgress.deleteMany({ media: media._id });
    // Le fil n'a plus rien à commenter, et les cartes qui renvoyaient à ce
    // titre n'ont plus où aller. Le fil social les masquerait de toute façon
    // (il recharge le titre pour les afficher), mais autant ne pas les laisser
    // s'accumuler pour un rayon qu'on ne reverra pas.
    await CollectionThread.deleteOne({ media: media._id });
    await removeActivity({ "meta.slug": media.slug, type: /^collection_/ });
    // Les planches, les cartouches et les parties sauvegardées vivent sur le
    // disque, pas en base : sans ce ménage, elles resteraient à occuper le VPS
    // pour un titre qui n'existe plus — et une ROM, c'est trente mégaoctets.
    //
    // Les sauvegardes se comptent PAR JOUEUR : un jeu que dix personnes ont
    // touché en laisse soixante-dix derrière lui. C'est le poste qui grossit le
    // plus vite de tout le rayon, et le seul qu'on ne verrait pas venir.
    if (media.kind === "comic") await dropComic(media.slug);
    await dropRom(media.cartridge?.file);
    const saves = await CollectionSave.find({ media: media._id }).lean();
    for (const save of saves) await dropSaveFiles(save);
    await CollectionSave.deleteMany({ media: media._id });
    res.json({ ok: true });
  } catch (err) {
    console.error("collection delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

// ======================================================================
//  Papier — comics et mangas
// ======================================================================
// Un titre de papier suit le même cycle que les autres (on le pose, on le
// corrige, on le supprime), à ceci près que sa SOURCE est une archive déposée
// plutôt qu'un lien de streaming. Trois routes suffisent donc à couvrir ce que
// le rayon vidéo demandait en dix.

// POST /api/collection/comic — pose un titre de papier depuis son archive.
//
// Tout arrive dans la MÊME requête (l'archive et la fiche) : extraire d'abord
// puis créer laisserait, en cas d'échec à mi-chemin, soit un dossier de
// planches orphelin, soit un titre sans pages. Ici l'extraction passe en
// premier et le document n'est écrit que si elle a réussi.
router.post("/comic", requireAuth, requireAdmin, archiveOr413, async (req, res) => {
  try {
    {
      const title = String(req.body.title || "").trim();
      if (!title) return res.status(400).json({ error: "Il faut un titre." });
      if (!req.file?.path)
        return res.status(400).json({ error: "Aucune archive reçue." });

      const slug = slugify(title);
      if (await CollectionMedia.exists({ slug }))
        return res.status(409).json({ error: "Un titre porte déjà ce nom." });

      const pages = await extractComic(req.file.path, slug);

      // LA COUVERTURE EST LA PREMIÈRE PLANCHE DE L'ARCHIVE, POINT. Elle est
      // dans la boîte, c'est l'objet qu'on a — une affiche trouvée en ligne
      // (AniList) est une AUTRE image du même titre : une autre édition, une
      // autre langue, un autre cadrage. Elle passait devant, et le volume de
      // l'étagère ne montrait alors pas la couverture qu'on découvre en
      // l'ouvrant. Deux couvertures pour un livre, c'était une de trop.
      //
      // La seule chose qui l'emporte encore est une JAQUETTE COMPLÈTE (`wrap`,
      // posée à part) : celle-là n'est pas une affiche, c'est le tour entier de
      // l'objet, plats et dos compris, et le boîtier s'habille avec telle
      // quelle (cf. paintCase).
      const media = await CollectionMedia.create({
        slug,
        title,
        kind: "comic",
        format: "book",
        licence: req.body.licence || "official",
        readDirection: req.body.readDirection === "rtl" ? "rtl" : "ltr",
        originalTitle: req.body.originalTitle || "",
        synopsis: req.body.synopsis || "",
        franchise: req.body.franchise || "",
        publisher: req.body.publisher || "",
        authors: parseList(req.body.authors),
        genres: parseList(req.body.genres),
        year: numOrNull(req.body.year),
        endYear: numOrNull(req.body.endYear),
        rating: numOrNull(req.body.rating),
        color: req.body.color || "#f2b70b",
        tagline: req.body.tagline || "",
        pages,
        artwork: {
          poster: pages[0].file,
          thumb: pages[0].file,
          backdrop: await downloadArtwork(req.body.backdrop, slug + "-back"),
        },
        sources: ["archive"],
      });

      res.status(201).json({ media: serializeFull(req, media.toObject(), null) });
    }
  } catch (err) {
    console.error("comic create error:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    await dropArchive(req.file);
  }
});

// POST /api/collection/:slug/archive — remplace les planches d'un titre.
// Le geste d'entretien du papier : une meilleure version de la traduction
// paraît, on redépose l'archive et le reste de la fiche ne bouge pas.
router.post(
  "/:slug/archive",
  requireAuth,
  requireAdmin,
  archiveOr413,
  async (req, res) => {
    try {
      const media = await CollectionMedia.findOne({ slug: req.params.slug });
      if (!media) return res.status(404).json({ error: "Média introuvable." });
      if (!req.file?.path)
        return res.status(400).json({ error: "Aucune archive reçue." });

      const before = media.pages.length;
      media.pages = await extractComic(req.file.path, media.slug);
      media.kind = "comic";
      media.format = "book";

      // La vignette pointait sur une planche que l'extraction vient d'effacer :
      // on la refait pointer sur la nouvelle première. Une image venue
      // D'AILLEURS, en revanche, n'est pas touchée — elle a été choisie, et ce
      // n'est pas un changement de scan qui doit la jeter.
      //
      // Ce n'est de toute façon plus elle qui habille le volume : la couverture
      // servie est décidée à la sortie (voir `coverOf`), et c'est toujours la
      // première planche de l'archive. Ce qu'on garde ici n'est qu'un souvenir,
      // utile le jour où la fiche cesserait d'être un titre de papier.
      const fromPages = (p) => !p || p.startsWith("/uploads/comics/");
      if (fromPages(media.artwork.thumb)) media.artwork.thumb = media.pages[0].file;
      if (fromPages(media.artwork.poster)) media.artwork.poster = media.pages[0].file;
      await media.save();

      res.json({
        media: serializeFull(req, media.toObject(), null),
        // Le nombre de planches a changé : les lecteurs en cours ne sont plus
        // au même endroit du volume. On le dit plutôt que de le taire.
        shifted: before > 0 && before !== media.pages.length,
      });
    } catch (err) {
      console.error("comic archive error:", err.message);
      res.status(400).json({ error: err.message });
    } finally {
      await dropArchive(req.file);
    }
  }
);

// POST /api/collection/:slug/page — où en est ce lecteur.
// Appelée à chaque planche tournée : elle doit rester minuscule.
router.post("/:slug/page", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug }).select(
      "_id pages"
    );
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const total = media.pages.length;
    if (!total) return res.status(400).json({ error: "Ce titre n'a pas de planches." });

    const page = Math.max(0, Math.min(total - 1, Number(req.body.page) || 0));
    // Terminé en atteignant la dernière planche : il n'y a pas de générique de
    // fin à tolérer comme sur une vidéo.
    const completed = page >= total - 1;

    const set = { page, lastWatchedAt: new Date() };
    if (completed) set.completed = true;
    await CollectionProgress.findOneAndUpdate(
      // `req.userId` : c'est le seul champ que pose le middleware d'auth. Un
      // `req.user.id` levait ici une TypeError attrapée par le catch, donc un
      // 500 muet à chaque planche tournée — la progression du papier ne
      // s'enregistrait jamais.
      { user: req.userId, media: media._id },
      { $set: set },
      { upsert: true }
    );
    res.json({ ok: true, page, completed });
  } catch (err) {
    console.error("comic page error:", err.message);
    res.status(500).json({ error: "Progression non enregistrée." });
  }
});

// POST /api/collection/:slug/bookmark — pose ou retire un marque-page.
// Une BASCULE, pas un ajout : reposer le marque-page sur une planche qui en a
// déjà un, c'est le retirer — exactement le geste du bout de papier qu'on
// déplace. La liste revient triée, elle est lue telle quelle par la règle du
// lecteur.
router.post("/:slug/bookmark", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug }).select(
      "_id pages"
    );
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const total = media.pages.length;
    if (!total) return res.status(400).json({ error: "Ce titre n'a pas de planches." });

    const page = Math.max(0, Math.min(total - 1, Number(req.body.page) || 0));
    const doc = await CollectionProgress.findOne({
      user: req.userId,
      media: media._id,
    }).select("bookmarks");
    const had = (doc?.bookmarks || []).includes(page);
    const bookmarks = had
      ? doc.bookmarks.filter((p) => p !== page)
      : [...(doc?.bookmarks || []), page].sort((a, b) => a - b);

    // `lastWatchedAt` n'est PAS touché : poser un marque-page n'est pas lire, et
    // ça n'a rien à faire remonter dans la rangée « Reprendre ».
    await CollectionProgress.findOneAndUpdate(
      { user: req.userId, media: media._id },
      { $set: { bookmarks } },
      { upsert: true }
    );
    res.json({ ok: true, bookmarks, marked: !had });
  } catch (err) {
    console.error("comic bookmark error:", err.message);
    res.status(500).json({ error: "Marque-page non enregistré." });
  }
});

// ======================================================================
//  Jeux — les boîtiers de cartouche
// ======================================================================
// Un jeu suit exactement le cycle du papier : un fichier déposé, une fiche
// remplie, un boîtier sur l'étagère.
//
// LA CARTOUCHE NE SE PRÉSENTE QU'À MOITIÉ, et c'est ce qui distingue ce rayon du
// rayon papier. Son en-tête donne un code de jeu, une région, une révision et le
// contrôle d'intégrité du BIOS (voir lib/gbaRom.js) — mais ni titre présentable,
// ni éditeur, ni icône : la GBA n'a pas de menu système, il n'y avait rien à
// décorer. Le formulaire d'admin demande donc VRAIMENT le titre et la jaquette,
// au lieu de faire semblant de les deviner.

// POST /api/collection/game — pose un jeu depuis sa cartouche.
router.post("/game", requireAuth, requireAdmin, romFields, async (req, res) => {
  const rom = req.files?.rom?.[0];
  const coverFile = req.files?.cover?.[0];
  // Multer a DÉJÀ écrit sur le disque quand on arrive ici : tout abandon en
  // cours de route doit reprendre ses fichiers, sinon chaque titre refusé
  // laisse soixante mégaoctets derrière lui.
  const cleanup = async () => {
    await dropRom(rom && `/uploads/roms/${rom.filename}`);
    if (coverFile)
      await fs.promises.rm(coverFile.path, { force: true }).catch(() => {});
  };

  try {
    if (!rom)
      return res.status(400).json({ error: "Aucune cartouche reçue (.gba)." });

    const { gba, cartridge } = await readCartridge(rom);

    // LE TITRE, DANS L'ORDRE DE CONFIANCE : ce que l'admin a écrit, puis le nom
    // du fichier — souvent affublé de balises de groupe, d'où le nettoyage — et
    // en dernier recours le titre interne de la cartouche.
    //
    // L'ORDRE A CHANGÉ AVEC LA MACHINE, et c'est le seul endroit où ça se voit.
    // Une cartouche DS portait son titre dans sept langues, joliment écrit : il
    // valait mieux que n'importe quel nom de fichier. Une cartouche GBA n'a que
    // DOUZE CARACTÈRES EN CAPITALES, tronqués (« ZELDA MC », « POKEMON RUBY ») —
    // « Zelda MC » est un plus mauvais titre que « The Minish Cap » lu sur le
    // nom du fichier. L'en-tête passe donc en dernier.
    const title =
      String(req.body.title || "").trim() ||
      rom.originalname
        .replace(ROM_RE, "")
        .replace(/[[(][^\])]*[\])]/g, " ")
        .replace(/[_.]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim() ||
      gba.title;
    if (!title) {
      await cleanup();
      return res.status(400).json({ error: "Il faut un titre." });
    }

    const slug = slugify(title);
    if (await CollectionMedia.exists({ slug })) {
      await cleanup();
      return res.status(409).json({ error: "Un titre porte déjà ce nom." });
    }

    // PAS D'ICÔNE À ESPÉRER DU FICHIER. Une cartouche GBA n'en porte aucune (il
    // n'y a pas de menu système sur cette console), là où la DS livrait celle de
    // son menu. Sans jaquette déposée, le boîtier est donc peint à partir de sa
    // seule teinte — c'est prévu (voir `paintCase` côté client), mais c'est aussi
    // pourquoi le formulaire insiste sur la jaquette.
    const cover = coverFile
      ? `/uploads/collection/${coverFile.filename}`
      : await downloadArtwork(req.body.coverUrl, `${slug}-cover`);

    const media = await CollectionMedia.create({
      slug,
      title,
      kind: "game",
      format: "gba",
      licence: req.body.licence || "official",
      originalTitle: req.body.originalTitle || "",
      tagline: req.body.tagline || "",
      synopsis: req.body.synopsis || "",
      franchise: req.body.franchise || "",
      publisher: req.body.publisher || "",
      authors: parseList(req.body.authors), // développeurs
      genres: parseList(req.body.genres),
      year: numOrNull(req.body.year),
      rating: numOrNull(req.body.rating),
      color: req.body.color || "#f2b70b",
      cartridge: { ...cartridge, players: numOrNull(req.body.players) },
      artwork: {
        poster: cover,
        thumb: cover,
        backdrop: await downloadArtwork(req.body.backdrop, `${slug}-back`),
      },
      sources: ["cartouche"],
    });

    res.status(201).json({
      media: serializeFull(req, media.toObject(), null),
      // Ce que la cartouche a dit d'elle-même : le panneau d'admin l'affiche
      // pour que l'admin voie ce qui a été rempli tout seul, et d'où ça vient.
      read: {
        recognized: gba.recognized,
        code: gba.code,
        region: gba.regionLabel,
        internalTitle: gba.internalTitle,
        version: gba.version,
        saveType: gba.saveType,
      },
    });
  } catch (err) {
    console.error("game create error:", err.message);
    await cleanup();
    res.status(400).json({ error: err.message });
  }
});

// POST /api/collection/:slug/rom — remplace la cartouche d'un titre.
// L'entretien du rayon jeu : on retrouve un meilleur dump, une version
// française, une traduction de fans — le reste de la fiche ne bouge pas.
router.post(
  "/:slug/rom",
  requireAuth,
  requireAdmin,
  romUpload.single("rom"),
  async (req, res) => {
    const stored = req.file && `/uploads/roms/${req.file.filename}`;
    try {
      if (!req.file)
        return res.status(400).json({ error: "Aucune cartouche reçue (.gba)." });
      const media = await CollectionMedia.findOne({ slug: req.params.slug });
      if (!media) {
        await dropRom(stored);
        return res.status(404).json({ error: "Média introuvable." });
      }

      const previous = media.cartridge?.file;
      const { gba, cartridge } = await readCartridge(req.file);
      // Le nombre de joueurs est le seul champ que le fichier ne porte pas :
      // il a été saisi à la main, il n'a pas à sauter parce qu'on change de dump.
      media.cartridge = { ...cartridge, players: media.cartridge?.players ?? null };
      media.kind = "game";
      media.format = "gba";
      await media.save();
      // L'ancienne APRÈS l'enregistrement, jamais avant : si la base refuse, le
      // titre doit rester jouable avec le fichier qu'il avait.
      await dropRom(previous);

      res.json({
        media: serializeFull(req, media.toObject(), null),
        read: { recognized: gba.recognized, code: gba.code, region: gba.regionLabel },
      });
    } catch (err) {
      console.error("rom replace error:", err.message);
      await dropRom(stored);
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/collection/:slug/played — le temps passé sur la cartouche.
//
// Envoyé par tranches pendant la partie : ce qui a été joué DEPUIS LE DERNIER
// envoi, jamais un total. Un total calculé côté navigateur repartirait de zéro
// à chaque rechargement, et écraserait l'historique à la première seconde.
router.post("/:slug/played", requireAuth, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug }).select("_id");
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    // Borné à l'heure : un onglet laissé ouvert toute la nuit ne doit pas
    // pouvoir déclarer huit heures de jeu d'un coup au moment où il se ferme.
    const add = Math.max(0, Math.min(3600, Math.round(Number(req.body.seconds) || 0)));
    const doc = await CollectionProgress.findOneAndUpdate(
      { user: req.userId, media: media._id },
      { $inc: { playSeconds: add }, $set: { lastWatchedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ playSeconds: doc.playSeconds || 0 });
  } catch (err) {
    console.error("played error:", err.message);
    res.status(500).json({ error: "Temps de jeu non enregistré." });
  }
});

// ----------------------------------------------------------------------
//  Les sauvegardes — la partie du joueur, chez nous
// ----------------------------------------------------------------------
// LA DIFFÉRENCE LA PLUS CONCRÈTE AVEC LE RAYON D'AVANT. La partie ne vit plus
// dans l'IndexedDB du navigateur (perdue au premier nettoyage d'historique,
// jamais partagée entre deux appareils) mais ici, comme la position dans un
// épisode. On se reconnecte du téléphone, on reprend où on en était.
//
// SEPT EMPLACEMENTS : l'automatique (0), où la console écrit toute seule, et six
// manuels que le joueur pose lui-même. Tous portent une vignette — c'est elle qui
// fait un tiroir de sauvegardes utilisable plutôt qu'une liste d'horaires.
//
// TOUT EST NOMINATIF : `req.userId` seul décide de quel fichier on parle. Aucune
// route ne prend un identifiant de joueur en paramètre, et il n'y a donc aucune
// façon d'aller lire la partie de quelqu'un d'autre.

// Le média visé, ou une réponse. Facteur commun des quatre routes qui suivent.
async function mediaForSave(req, res) {
  const media = await CollectionMedia.findOne({ slug: req.params.slug }).select(
    "_id kind"
  );
  if (!media) {
    res.status(404).json({ error: "Média introuvable." });
    return null;
  }
  return media;
}

// GET /api/collection/:slug/saves — mes emplacements sur ce jeu.
router.get("/:slug/saves", requireAuth, async (req, res) => {
  try {
    const media = await mediaForSave(req, res);
    if (!media) return undefined;
    const saves = await CollectionSave.find({
      user: req.userId,
      media: media._id,
    })
      .sort({ slot: 1 })
      .lean();
    return res.json({
      saves: saves.filter((s) => s.file).map((s) => serializeSave(req, s)),
      slots: MANUAL_SLOTS,
    });
  } catch (err) {
    console.error("saves list error:", err.message);
    return res.status(500).json({ error: "Sauvegardes illisibles." });
  }
});

// GET /api/collection/:slug/saves/:slot/state — l'état lui-même, en binaire.
//
// SERVI PAR L'API ET NON PAR /uploads, à la différence de tout le reste du
// dossier. Une jaquette est publique, une partie n'appartient qu'à son joueur :
// laisser deviner une URL de fichier, c'est laisser lire la partie du voisin.
router.get("/:slug/saves/:slot/state", requireAuth, async (req, res) => {
  try {
    const slot = slotOf(req.params.slot);
    if (slot === null) return res.status(400).json({ error: "Emplacement inconnu." });
    const media = await mediaForSave(req, res);
    if (!media) return undefined;

    const save = await CollectionSave.findOne({
      user: req.userId,
      media: media._id,
      slot,
    }).lean();
    if (!save?.file)
      return res.status(404).json({ error: "Emplacement vide." });

    const file = path.join(SAVE_DIR, path.basename(save.file));
    if (!fs.existsSync(file)) {
      // Le document dit qu'il y a une partie, le disque dit non. On le NETTOIE
      // plutôt que de laisser un emplacement fantôme que le tiroir proposerait
      // indéfiniment.
      await CollectionSave.deleteOne({ _id: save._id });
      return res.status(410).json({ error: "Fichier de sauvegarde introuvable." });
    }
    res.type("application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(file);
  } catch (err) {
    console.error("save read error:", err.message);
    return res.status(500).json({ error: "Sauvegarde illisible." });
  }
});

// PUT /api/collection/:slug/saves/:slot — écrire (ou écraser) un emplacement.
//
// Le nom du fichier est DÉTERMINISTE (voir `saveUpload`) : multer écrase donc
// l'ancien état sur le disque, et le document est mis à jour en place. Pas de
// fichier orphelin à ramasser, pas d'emplacement en double.
router.put(
  "/:slug/saves/:slot",
  requireAuth,
  // Le nom du fichier dépend du joueur et du média : il faut donc les avoir
  // résolus AVANT que multer n'écrive. D'où ce petit intercalaire, qui pose
  // `req.saveTag` — c'est lui que lit `filename`.
  async (req, res, next) => {
    try {
      const slot = slotOf(req.params.slot);
      if (slot === null) return res.status(400).json({ error: "Emplacement inconnu." });
      const media = await mediaForSave(req, res);
      if (!media) return undefined;
      req.saveSlot = slot;
      req.saveMedia = media;
      req.saveTag = `${req.userId}-${media._id}-${slot}`;
      return next();
    } catch (err) {
      console.error("save prepare error:", err.message);
      return res.status(500).json({ error: "Sauvegarde impossible." });
    }
  },
  (req, res, next) =>
    saveFields(req, res, (err) => {
      if (!err) return next();
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig
          ? `État trop lourd : ${Math.round(STATE_MAX / 1024 / 1024)} Mo au maximum.`
          : "Envoi invalide.",
      });
    }),
  async (req, res) => {
    const state = req.files?.state?.[0];
    const shot = req.files?.shot?.[0];
    try {
      if (!state) return res.status(400).json({ error: "Aucun état reçu." });

      const doc = await CollectionSave.findOneAndUpdate(
        { user: req.userId, media: req.saveMedia._id, slot: req.saveSlot },
        {
          $set: {
            file: `/uploads/saves/${state.filename}`,
            bytes: state.size || 0,
            // La vignette n'est pas obligatoire (un cœur qui refuse de rendre
            // son image), mais on ne l'EFFACE pas pour autant : mieux vaut la
            // dernière connue qu'un carré vide.
            ...(shot ? { thumb: `/uploads/saves/${shot.filename}` } : {}),
            core: String(req.body.core || "").slice(0, 40),
            playSeconds: Math.max(0, Math.round(Number(req.body.playSeconds) || 0)),
            label: String(req.body.label || "").slice(0, 60),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // La sauvegarde vaut aussi passage sur le titre : sans ça, une partie
      // reprise et sauvegardée ne remonterait pas dans « Reprendre ».
      await CollectionProgress.updateOne(
        { user: req.userId, media: req.saveMedia._id },
        { $set: { lastWatchedAt: new Date() } },
        { upsert: true, setDefaultsOnInsert: true }
      );

      return res.json({ save: serializeSave(req, doc.toObject()) });
    } catch (err) {
      console.error("save write error:", err.message);
      return res.status(500).json({ error: "Sauvegarde non enregistrée." });
    }
  }
);

// DELETE /api/collection/:slug/saves/:slot — vider un emplacement.
router.delete("/:slug/saves/:slot", requireAuth, async (req, res) => {
  try {
    const slot = slotOf(req.params.slot);
    if (slot === null) return res.status(400).json({ error: "Emplacement inconnu." });
    const media = await mediaForSave(req, res);
    if (!media) return undefined;

    const save = await CollectionSave.findOneAndDelete({
      user: req.userId,
      media: media._id,
      slot,
    }).lean();
    await dropSaveFiles(save);
    return res.json({ ok: true, slot });
  } catch (err) {
    console.error("save delete error:", err.message);
    return res.status(500).json({ error: "Emplacement non vidé." });
  }
});

// ======================================================================
//  Le fil d'un titre
// ======================================================================
// UN SEUL FIL POUR LES QUATRE SUPPORTS. Une série, un film, un manga et une
// cartouche n'ont ni la même unité de progression ni le même lecteur — mais on
// en parle exactement de la même manière, et rien ne justifiait quatre fils.
//
// Le mécanisme est celui des listes et des OST de profil (Composer, médias,
// mentions, réponses à un niveau, likes, édition limitée à deux passes) :
// seules changent les routes. La MODÉRATION, elle, diffère — un titre du rayon
// n'appartient à personne, là où une liste a son auteur et une OST son profil.
// C'est donc l'admin qui tient le rayon qui fait le ménage, avec l'auteur du
// message.

// Le titre visé, réduit à ce dont le fil a besoin.
const threadMedia = (slug) =>
  CollectionMedia.findOne({ slug }).select("_id slug title").lean();

// Peut effacer le message d'un autre. Personne ne « possède » un titre du
// catalogue : le rôle revient à celui qui l'a posé sur l'étagère.
async function isModerator(userId) {
  const user = await User.findById(userId).select("isAdmin isSuperAdmin").lean();
  return isUserAdmin(user);
}

// GET /api/collection/:slug/comments — le fil d'un titre.
router.get("/:slug/comments", requireAuth, async (req, res) => {
  try {
    const media = await threadMedia(req.params.slug);
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const [thread, moderator] = await Promise.all([
      CollectionThread.findOne({ media: media._id }).populate(
        "comments.user",
        "username avatar"
      ),
      isModerator(req.userId),
    ]);
    const comments = (thread?.comments || []).map((c) =>
      toComment(c, thread.comments, req.userId)
    );
    res.json({ comments, moderator });
  } catch (err) {
    console.error("collection comments fetch error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des commentaires." });
  }
});

// POST /api/collection/:slug/comments — écrire (ou répondre).
router.post("/:slug/comments", requireAuth, async (req, res) => {
  try {
    const media = await threadMedia(req.params.slug);
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const text = String(req.body?.text || "").trim();
    // `attach` et non `media` : dans ce fichier, `media` est le TITRE.
    const attach = sanitizeMediaList(req.body?.media);
    if (!text && attach.length === 0)
      return res.status(400).json({ error: "Message vide." });

    let thread = await CollectionThread.findOne({ media: media._id });
    if (!thread) thread = new CollectionThread({ media: media._id, comments: [] });

    // Réponse : on rattache toujours à la RACINE du fil (un seul niveau).
    let parent = null;
    let replyTargetUser = null; // auteur du message auquel on répond (pour la notif)
    if (req.body?.parent) {
      const p = thread.comments.id(req.body.parent);
      if (p) {
        parent = p.parent || p._id;
        replyTargetUser = p.user;
      }
    }

    const mentions = await resolveMentions(text);
    thread.comments.push({
      user: req.userId,
      text: text.slice(0, 300),
      media: attach,
      mentions,
      parent,
    });
    await thread.save({ validateModifiedOnly: true });
    await thread.populate("comments.user", "username avatar");
    const c = thread.comments[thread.comments.length - 1];

    // Notifications : un seul message par destinataire, la réponse avant la
    // mention. Personne n'est prévenu « parce que c'est son titre » — il n'a pas
    // de propriétaire, et prévenir l'admin à chaque message du rayon reviendrait
    // à lui notifier la moitié du site.
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
    const snippet = text || (attach.length ? "a envoyé un média" : "");
    for (const [uid, type] of recipients) {
      notify({
        user: uid,
        type,
        actor: req.userId,
        collectionSlug: media.slug,
        gameName: media.title,
        comment: c._id,
        snippet,
      });
    }

    // LE FIL DES ABONNÉS, lui, ne reçoit qu'UNE entrée — pas une par
    // destinataire comme les notifications (cf. models/Activity.js). Parler
    // d'un titre du rayon est une action à raconter au même titre que commenter
    // une liste : c'est ce qui donne une vie à la collection en dehors d'elle.
    recordActivity({
      actor: req.userId,
      type: parent ? "collection_comment_reply" : "collection_comment",
      // Un titre du rayon n'appartient à personne : sur un commentaire racine,
      // il n'y a donc pas de « … de X » à afficher. Sur une réponse, si.
      target: replyTargetUser || null,
      comment: c._id,
      snippet,
      meta: { slug: media.slug },
    });

    res.status(201).json({ comment: toComment(c, thread.comments, req.userId) });
  } catch (err) {
    console.error("collection comment add error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'ajout du commentaire." });
  }
});

// PUT /api/collection/:slug/comments/:commentId — modifier son message (2 fois max).
router.put("/:slug/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const media = await threadMedia(req.params.slug);
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const thread = await CollectionThread.findOne({ media: media._id });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    if (String(c.user) !== String(req.userId))
      return res.status(403).json({ error: "Action non autorisée." });
    if ((c.editCount || 0) >= 2)
      return res.status(403).json({ error: "Limite de modifications atteinte (2)." });

    const text = String(req.body?.text || "").trim();
    const attach = sanitizeMediaList(req.body?.media);
    if (!text && attach.length === 0)
      return res.status(400).json({ error: "Message vide." });

    c.history.push({ text: c.text, media: c.media, at: new Date() });
    c.text = text.slice(0, 300);
    c.media = attach;
    c.mentions = await resolveMentions(text);
    c.editCount = (c.editCount || 0) + 1;
    c.editedAt = new Date();

    await thread.save({ validateModifiedOnly: true });
    await thread.populate("comments.user", "username avatar");
    const updated = thread.comments.id(req.params.commentId);
    res.json({ comment: toComment(updated, thread.comments, req.userId) });
  } catch (err) {
    console.error("collection comment edit error:", err.message);
    res.status(500).json({ error: "Erreur lors de la modification." });
  }
});

// POST /api/collection/:slug/comments/:commentId/like — basculer le like.
router.post("/:slug/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const media = await threadMedia(req.params.slug);
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    const thread = await CollectionThread.findOne({ media: media._id });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.status(404).json({ error: "Commentaire introuvable." });
    const uid = String(req.userId);
    const has = c.likes.some((u) => String(u) === uid);
    if (has) c.likes = c.likes.filter((u) => String(u) !== uid);
    else c.likes.push(req.userId);
    await thread.save({ validateModifiedOnly: true });
    if (!has) {
      notify({
        user: c.user,
        type: "comment_like",
        actor: req.userId,
        collectionSlug: media.slug,
        gameName: media.title,
        comment: c._id,
        snippet: c.text,
      });
      recordActivity({
        actor: req.userId,
        type: "collection_comment_like",
        target: c.user,
        comment: c._id,
        snippet: c.text,
        // `reply` : aimer une RÉPONSE et aimer un message ne se disent pas
        // pareil, et le fil n'a plus le fil sous la main pour le déduire.
        meta: { slug: media.slug, reply: !!c.parent },
      });
    } else {
      // Retirer son like retire la carte : le fil ne garde pas la trace d'un
      // geste annulé.
      removeActivity({
        actor: req.userId,
        type: "collection_comment_like",
        comment: c._id,
      });
    }
    res.json({ liked: !has, likeCount: c.likes.length });
  } catch (err) {
    console.error("collection comment like error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// DELETE /api/collection/:slug/comments/:commentId — retirer son message (ou
// n'importe lequel quand on tient le rayon).
router.delete("/:slug/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const media = await threadMedia(req.params.slug);
    // Le titre a disparu entre-temps : le message avec. Rien à faire, et ce
    // n'est pas une erreur pour celui qui voulait justement l'effacer.
    if (!media) return res.json({ ok: true });
    const thread = await CollectionThread.findOne({ media: media._id });
    const c = thread?.comments.id(req.params.commentId);
    if (!c) return res.json({ ok: true });
    if (String(c.user) !== String(req.userId) && !(await isModerator(req.userId)))
      return res.status(403).json({ error: "Action non autorisée." });
    c.deleteOne();
    await thread.save({ validateModifiedOnly: true });
    // Le message s'en va, ses cartes avec — celle qui l'annonce comme celles
    // des likes qu'il avait reçus. Sans clause de type : tout ce qui pointe ce
    // message n'a plus rien à montrer.
    removeActivity({ comment: c._id });
    res.json({ ok: true });
  } catch (err) {
    console.error("collection comment delete error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Les champs de liste arrivent en JSON (fiche trouvée en ligne) ou en texte
// séparé par des virgules (saisie à la main) : multipart ne transporte que du
// texte, les deux formes se croisent donc sur la même route.
function parseList(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
  } catch {
    /* pas du JSON : c'est une liste écrite à la main */
  }
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const numOrNull = (v) => {
  const n = Number(v);
  return v === "" || v === null || v === undefined || !Number.isFinite(n) ? null : n;
};

export default router;
