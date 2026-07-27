import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import CollectionMedia from "../models/CollectionMedia.js";
import CollectionProgress from "../models/CollectionProgress.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
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
import { importFromUrl } from "../lib/animeSama.js";
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
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
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
  "games",
  "featured",
  "order",
];

const abs = (req, p) =>
  p ? (p.startsWith("/uploads/") ? `${req.protocol}://${req.get("host")}${p}` : p) : null;

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
    licence: m.licence,
    year: m.year,
    endYear: m.endYear,
    synopsis: m.synopsis,
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
    poster: abs(req, m.artwork?.poster),
    backdrop: abs(req, m.artwork?.backdrop),
    wrap: abs(req, m.artwork?.wrap),
    channel: m.source?.channel || "",
    // Le lecteur du titre : la fiche et le panneau d'admin s'en servent pour
    // savoir ce qu'ils peuvent promettre (progression suivie ou non).
    provider: m.source?.provider || "youtube",
    progress: progress
      ? {
          episodeIndex: progress.episodeIndex,
          positionSeconds: progress.positionSeconds,
          durationSeconds: progress.durationSeconds,
          watched: progress.watched,
          completed: progress.completed,
          lastWatchedAt: progress.lastWatchedAt,
        }
      : null,
  };
}

function serializeFull(req, m, progress) {
  return {
    ...serializeCard(req, m, progress),
    tagline: m.tagline,
    studio: m.studio,
    country: m.country,
    language: m.language,
    games: m.games,
    source: m.source,
    links: m.links,
    sources: m.sources,
    cast: (m.cast || []).map((c) => ({ ...c, photo: abs(req, c.photo) })),
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
router.get("/import/anime-sama", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await importFromUrl(String(req.query.url || ""), {
      lang: String(req.query.lang || "").toLowerCase() || undefined,
    });
    res.json(data);
  } catch (err) {
    console.error("collection import error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/collection/:slug — la fiche complète (épisodes, casting).
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
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    // Changer l'URL de streaming est possible, mais les épisodes ne suivent
    // qu'après un « rafraîchir » — on le dit dans la réponse.
    if (req.body.sourceUrl) patch["source.url"] = String(req.body.sourceUrl);
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
router.put("/:slug/episodes", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOne({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });

    const parsed = parseEpisodeLines(req.body?.text || "");
    if (!parsed.length)
      return res.status(400).json({ error: "Aucun épisode lisible dans cette liste." });

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
    media.source.list = String(req.body.text || "").trim();
    await media.save();

    res.json({
      media: serializeFull(req, media.toObject(), null),
      // La progression des joueurs pointe des POSITIONS : si la liste a changé
      // de longueur, leurs coches ne désignent plus les mêmes épisodes.
      shifted: before.size !== media.episodes.length,
    });
  } catch (err) {
    console.error("collection episodes error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/collection/:slug/episodes-text — la liste, telle qu'on la rouvre
// dans le panneau d'admin (celle qui a été collée, ou reconstruite).
router.get("/:slug/episodes-text", requireAuth, requireAdmin, async (req, res) => {
  const media = await CollectionMedia.findOne({ slug: req.params.slug })
    .select("source episodes")
    .lean();
  if (!media) return res.status(404).json({ error: "Média introuvable." });
  res.json({
    provider: media.source?.provider || "youtube",
    text: media.source?.list || episodesToLines(media.episodes || []),
  });
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

// DELETE /api/collection/:slug — retire un média du catalogue.
router.delete("/:slug", requireAuth, requireAdmin, async (req, res) => {
  try {
    const media = await CollectionMedia.findOneAndDelete({ slug: req.params.slug });
    if (!media) return res.status(404).json({ error: "Média introuvable." });
    await CollectionProgress.deleteMany({ media: media._id });
    res.json({ ok: true });
  } catch (err) {
    console.error("collection delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
