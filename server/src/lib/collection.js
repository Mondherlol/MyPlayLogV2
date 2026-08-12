import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tmdb from "./tmdb.js";

// ======================================================================
//  Collection — enrichissement des médias (séries / films)
// ======================================================================
// On part d'une simple URL YouTube et on habille le média avec ce que les
// bases publiques SANS CLÉ veulent bien donner :
//
//   • YouTube (oEmbed + scraping de ytInitialData, comme lib/ostScrape.js) :
//     titre, chaîne, miniature, et la liste des épisodes d'une playlist ;
//   • TVmaze (API libre, aucune clé) : affiche, résumé, genres, casting et
//     découpage en saisons/épisodes des SÉRIES ;
//   • Wikipédia FR/EN + Wikidata (déjà utilisés par les pages studio et
//     console) : synopsis en français, année, durée, réalisateur — c'est la
//     seule source correcte pour les films, que TVmaze ne connaît pas.
//
// Tout ce qui est repris est crédité : `sources` remonte jusqu'à la fiche, où
// les liens Wikipédia / TVmaze sont affichés en pied de page.
//
// Les VISUELS sont rapatriés chez nous (uploads/collection) plutôt que liés à
// chaud. Deux raisons : ne pas dépendre d'un hébergeur tiers pour l'affichage,
// et surtout permettre à l'étagère 3D de peindre les jaquettes dans un canvas
// WebGL — une image cross-origin « souille » le canvas et fait échouer la
// texture.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/collection");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 12 * 1024 * 1024;
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// ---------------------------------------------------------------- outils --

export function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents détachés par la normalisation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "MyPlayLog/1.0" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Retire le balisage HTML des résumés (TVmaze renvoie du <p>…</p>).
function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Les résumés d'animés de Wikipédia FR s'ouvrent presque toujours sur une
// parenthèse d'état civil (titre japonais, romaji, traduction littérale) qui
// mange trois lignes avant la première information utile. On la retire quand
// elle contient des caractères japonais/chinois — ailleurs, une parenthèse
// porte du sens et on n'y touche pas.
function tidySynopsis(s) {
  return String(s || "")
    .replace(/\s*\([^)]*[　-鿿＀-￯][^)]*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Garde-fou SSRF : http(s) public uniquement, jamais une adresse locale.
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
  if (host.includes(":")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

// Rapatrie un visuel dans uploads/collection et renvoie son chemin relatif
// (`/uploads/collection/…`). Best-effort : null si ça casse, l'appelant
// retombe sur la miniature YouTube.
export async function downloadArtwork(url, name) {
  if (!url || !isSafeImageUrl(url)) return null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_MIME[mime];
    if (!ext) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const filename = `${name}-${Date.now().toString(36)}${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buf);
    return `/uploads/collection/${filename}`;
  } catch {
    return null;
  }
}

// Le même rangement, pour un visuel qu'on n'est pas allé CHERCHER mais qu'on a
// FABRIQUÉ — l'icône extraite d'une cartouche DS, par exemple. Elle ne passe
// par aucune URL : sans ce point d'entrée, il faudrait soit exposer le dossier
// d'uploads à la moitié du serveur, soit réécrire le même writeFile ailleurs.
export async function saveArtwork(buffer, name, ext = ".png") {
  if (!buffer?.length || buffer.length > MAX_BYTES) return null;
  const filename = `${name}-${Date.now().toString(36)}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/collection/${filename}`;
}

// --------------------------------------------------------------- YouTube --

export function extractVideoId(url) {
  const m = String(url).match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}

export function extractPlaylistId(url) {
  const m = String(url).match(/[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

// Durée « 24:31 » / « 1:02:11 » → secondes.
function parseLength(text) {
  if (!text) return null;
  const parts = String(text).split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// La durée d'une vignette de playlist vit dans un badge posé sur la miniature
// (« 21:16 »), pas dans les métadonnées de la carte.
function lockupLength(lm) {
  const overlays = lm.contentImage?.thumbnailViewModel?.overlays || [];
  for (const o of overlays) {
    for (const b of o.thumbnailBottomOverlayViewModel?.badges || []) {
      const text = b.thumbnailBadgeViewModel?.text;
      if (/^\d{1,2}(:\d{2}){1,2}$/.test(text || "")) return parseLength(text);
    }
  }
  return null;
}

async function fetchYtInitialData(url) {
  try {
    const html = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "fr,en" },
    }).then((r) => r.text());
    const raw = html.split("ytInitialData = ")[1]?.split(";</script>")[0];
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Métadonnées d'une vidéo isolée (titre, chaîne, miniature) via oEmbed.
export async function ytVideo(videoId) {
  const d = await getJson(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`
  );
  if (!d) return null;
  return {
    videoId,
    title: d.title || "",
    channel: d.author_name || "",
    channelUrl: d.author_url || "",
    // hqdefault existe toujours ; maxresdefault non (on tente d'abord).
    thumb: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    thumbFallback: d.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

// Les vidéos d'une playlist, dans l'ordre. YouTube sert deux formats de
// carte selon les jours (`playlistVideoRenderer` historique, `lockupViewModel`
// récent) : on lit les deux et on déduplique sur l'id.
export async function ytPlaylistItems(playlistId) {
  const data = await fetchYtInitialData(
    `https://www.youtube.com/playlist?list=${playlistId}`
  );
  if (!data) return { title: "", items: [] };
  const items = [];
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    const p = o.playlistVideoRenderer;
    if (p?.videoId && !seen.has(p.videoId)) {
      seen.add(p.videoId);
      items.push({
        videoId: p.videoId,
        title: p.title?.runs?.[0]?.text || p.title?.simpleText || "",
        duration: parseLength(p.lengthText?.simpleText),
      });
    }
    const lm = o.lockupViewModel;
    if (lm?.contentId?.length === 11 && !seen.has(lm.contentId)) {
      const title = lm.metadata?.lockupMetadataViewModel?.title?.content;
      if (title) {
        seen.add(lm.contentId);
        items.push({ videoId: lm.contentId, title, duration: lockupLength(lm) });
      }
    }
    for (const k in o) walk(o[k]);
  })(data);
  return {
    title:
      data.header?.playlistHeaderRenderer?.title?.simpleText ||
      data.metadata?.playlistMetadataRenderer?.title ||
      "",
    items,
  };
}

// Numéro d'épisode deviné depuis un titre YouTube : « EP01 », « Épisode 12 »,
// « #7 », « - 03 - ». Sert à raccorder la playlist aux données TVmaze.
export function guessEpisodeNumber(title) {
  const t = String(title || "");
  const m =
    t.match(/\b(?:ep|episode|épisode|eps)\s*\.?\s*(\d{1,3})\b/i) ||
    t.match(/\b(?:s\d{1,2}\s*[ex])\s*(\d{1,3})\b/i) ||
    t.match(/#\s*(\d{1,3})\b/);
  return m ? Number(m[1]) : null;
}

// Nettoie un titre d'épisode YouTube de son décorum de chaîne :
// « SONIC X - EP01 Chaos Control Freaks | English Dub | Full Episode ».
export function cleanEpisodeTitle(raw, showTitle) {
  let s = String(raw || "").trim();
  if (showTitle) {
    const loose = showTitle
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[\\s:'-]*");
    s = s.replace(new RegExp(`^\\s*${loose}\\s*[-–—:|]*\\s*`, "i"), "");
  }
  // Segments de queue purement promotionnels.
  s = s.replace(
    /\s*[|·]\s*(english dub|full episode|vf|vostfr|hd|4k|official|sonic|episode complet)[^|]*/gi,
    ""
  );
  s = s.replace(/^\s*(?:ep|episode|épisode)\s*\.?\s*\d{1,3}\s*[-–—:.)|]*\s*/i, "");
  s = s.replace(/^\s*\d{1,3}\s*[-–—:.)|]+\s*/, "");
  return s.replace(/[\s|·-]+$/, "").trim() || String(raw || "").trim();
}

// --------------------------------------------------- lecteurs non-YouTube --
//
// Tout ne vit pas sur YouTube : une série peut être hébergée ailleurs, ou
// exister en fichier vidéo servi tel quel. On accepte donc n'importe quel lien,
// et on décide au vu de l'URL COMMENT il se lira côté client :
//
//   • une URL YouTube reconnue → `youtube` (le seul lecteur qu'on pilote) ;
//   • un fichier vidéo (.mp4/.webm/.m3u8…) → `file`, lu par la balise <video> ;
//   • tout le reste → `embed`, l'iframe du site d'origine.
//
// Rien n'est téléchargé ni rehébergé : on ne stocke qu'une adresse, exactement
// comme un marque-page. La curation reste humaine — c'est l'admin qui colle les
// liens qu'il a le droit d'intégrer, et la pastille `licence` du boîtier dit
// d'où ça vient.

const FILE_RE = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|m3u8|mpd)(?:$|[?#])/i;

export function detectProvider(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (extractVideoId(raw) || extractPlaylistId(raw)) return "youtube";
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return FILE_RE.test(u.pathname) ? "file" : "embed";
}

// Nom d'hôte lisible : c'est ce qui s'affiche sur le bouton SOURCE du poste
// quand un épisode a plusieurs miroirs.
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// « S02E04 », « 2x04 », « Saison 2 épisode 4 », « #12 », « 04. » — le début de
// ligne, quand il en porte un, dit à quelle place va l'épisode.
function parseLabel(label) {
  const s = String(label || "").trim();
  if (!s) return { season: null, number: null, title: "" };
  const pat = [
    /^s(?:aison)?\s*(\d{1,2})\s*[·.\-–]?\s*e(?:p|pisode|pisode)?\s*\.?\s*(\d{1,3})\b/i,
    /^(\d{1,2})\s*x\s*(\d{1,3})\b/i,
  ];
  for (const re of pat) {
    const m = s.match(re);
    if (m)
      return {
        season: Number(m[1]),
        number: Number(m[2]),
        title: cleanLabelTail(s.slice(m[0].length)),
      };
  }
  const solo = s.match(/^(?:ep|episode|épisode|#)\s*\.?\s*(\d{1,3})\b/i) ||
    s.match(/^(\d{1,3})\s*[.)\]-]/);
  if (solo)
    return {
      season: null,
      number: Number(solo[1]),
      title: cleanLabelTail(s.slice(solo[0].length)),
    };
  return { season: null, number: null, title: cleanLabelTail(s) };
}

// Le séparateur entre le repère et le titre est libre (« — », « : », « - »).
function cleanLabelTail(s) {
  return String(s || "")
    .replace(/^\s*[-–—:|.]+\s*/, "")
    .replace(/\s*[-–—:|]+\s*$/, "")
    .trim();
}

// Une LISTE D'ÉPISODES collée à la main, une ligne par épisode :
//
//   S01E01 Le début — https://hote/embed/aaa | https://autre-hote/embed/aaa
//   S01E02 — https://hote/embed/bbb
//   https://hote/embed/ccc
//
// Ce qui précède le premier « http » est l'étiquette (saison, numéro, titre) ;
// les URL suivantes sur la même ligne sont des MIROIRS du même épisode. Tout
// est optionnel : une liste d'URL nues donne des épisodes numérotés dans
// l'ordre. Les lignes vides et les commentaires (#) sont ignorés.
// LA PISTE SE COLLE À L'ADRESSE : « vf@https://… ». Elle ne pouvait pas être
// posée en tête de ligne — depuis qu'on importe TOUTES les versions d'un coup,
// une même ligne porte la VF et la VOSTFR du même épisode — ni déduite du lien,
// qui ne dit rien de ce qu'on va entendre. Elle voyage donc avec chaque adresse,
// et le marqueur survit à l'aller-retour texte → base → texte du panneau
// d'admin (voir `episodesToLines`).
//
// Sans marqueur, la source reste « de langue inconnue » et se montre toujours :
// c'est le cas de toutes les listes écrites à la main, et il ne doit rien
// coûter.
const TAGGED_URL = /(?:[a-z]{2,6}@)?https?:\/\//i;
const SPLIT_URLS = new RegExp(
  `[|;,]\\s*(?=${TAGGED_URL.source})|\\s+(?=${TAGGED_URL.source})`,
  "i"
);

// « vostfr@https://hote/x » → { lang: "vostfr", url: "https://hote/x" }
function untag(raw) {
  const m = String(raw).match(/^([a-z]{2,6})@(?=https?:\/\/)/i);
  return m
    ? { lang: m[1].toLowerCase(), url: raw.slice(m[0].length) }
    : { lang: "", url: raw };
}

export function parseEpisodeLines(text) {
  const out = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.search(TAGGED_URL);
    if (at < 0) continue; // une ligne sans lien n'est pas un épisode
    const { season, number, title } = parseLabel(line.slice(0, at));
    const urls = line
      .slice(at)
      .split(SPLIT_URLS)
      .map((u) => u.trim())
      .filter(Boolean);

    const sources = [];
    for (const raw of urls) {
      const { lang, url } = untag(raw);
      const provider = detectProvider(url);
      if (!provider) continue;
      sources.push({ provider, url, lang, label: hostLabel(url) });
    }
    if (!sources.length) continue;

    const [main, ...mirrors] = sources;
    out.push({
      season,
      number,
      title,
      provider: main.provider,
      url: main.url,
      lang: main.lang,
      videoId: main.provider === "youtube" ? extractVideoId(main.url) : null,
      mirrors: mirrors.map(({ label, url, lang }) => ({ label, url, lang })),
    });
  }
  return out;
}

// Les pistes qu'une liste d'épisodes porte VRAIMENT, dans l'ordre où on les
// rencontre. C'est ce qui s'imprime au dos du boîtier et ce qui remplit le
// sélecteur de la fiche : jamais ce qu'une page promet, toujours ce dont on a
// l'adresse.
export function langsOfEpisodes(episodes = []) {
  const seen = [];
  for (const e of episodes)
    for (const s of [e, ...(e.mirrors || [])])
      if (s?.lang && !seen.includes(s.lang)) seen.push(s.lang);
  return seen;
}

// Le chemin inverse : une liste d'épisodes redevient le texte qui l'a produite.
// Sert au panneau d'admin, qui rouvre la liste pour la corriger — et à qui on
// ne veut pas faire retaper 78 lignes pour changer un lien mort.
export function episodesToLines(episodes = []) {
  const tag = (url, lang) => (url && lang ? `${lang}@${url}` : url);
  return episodes
    .map((e) => {
      const label = `S${String(e.season || 1).padStart(2, "0")}E${String(
        e.number ?? e.index + 1
      ).padStart(2, "0")}`;
      const title = e.title ? ` ${e.title}` : "";
      const urls = [
        tag(
          e.provider === "youtube" && e.videoId
            ? `https://www.youtube.com/watch?v=${e.videoId}`
            : e.url,
          e.lang
        ),
        ...(e.mirrors || []).map((m) => tag(m.url, m.lang)),
      ].filter(Boolean);
      return `${label}${title} — ${urls.join(" | ")}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------- TVmaze --

// Plusieurs candidats pour un titre : sert au panneau d'admin, où l'on choisit
// à QUELLE fiche externe rattacher un boîtier avant de lancer l'enrichissement
// (« Sonic X » ou « Sonic X: The Universe » ? c'est à l'humain de trancher).
export async function tvmazeSearch(query) {
  const found = await getJson(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
  );
  return (found || []).slice(0, 8).map(({ show }) => ({
    source: "tvmaze",
    ref: show.name, // ce qu'on repassera en tvmazeQuery
    id: show.id,
    title: show.name,
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    endYear: show.ended ? Number(show.ended.slice(0, 4)) : null,
    poster: show.image?.medium || show.image?.original || null,
    summary: stripHtml(show.summary).slice(0, 240),
    network: show.network?.name || show.webChannel?.name || "",
    genres: show.genres || [],
    url: show.url || null,
  }));
}

// Idem côté Wikipédia, pour les films (que TVmaze ne connaît pas).
//
// `cut` : la longueur du résumé rendu. 240 signes suffisent à une LIGNE DE
// CHOIX — on lit trois mots et on reconnaît le titre. Le papier, lui, s'en sert
// comme SYNOPSIS (Wikipédia FR est la seule source française d'un comic
// américain) : il lui faut le paragraphe entier, d'où le réglage.
export async function wikiSearch(query, lang = "fr", cut = 240) {
  const search = await getJson(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&srlimit=6&format=json&origin=*`
  );
  const titles = (search?.query?.search || []).map((s) => s.title);
  const pages = await Promise.all(
    titles.map((t) =>
      getJson(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`
      )
    )
  );
  return pages
    .filter((p) => p?.extract && p.type !== "disambiguation")
    .map((p) => ({
      source: `wikipedia-${lang}`,
      ref: p.title, // ce qu'on repassera en wikiTitle
      title: p.title,
      year: null,
      poster: p.originalimage?.source || p.thumbnail?.source || null,
      summary: tidySynopsis(p.extract).slice(0, cut),
      url: p.content_urls?.desktop?.page || null,
      wikibaseId: p.wikibase_item || null,
    }));
}

export async function tvmazeShow(query) {
  const found = await getJson(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
  );
  const show = found?.[0]?.show;
  if (!show) return null;

  const [episodes, cast, images] = await Promise.all([
    getJson(`https://api.tvmaze.com/shows/${show.id}/episodes`),
    getJson(`https://api.tvmaze.com/shows/${show.id}/cast`),
    getJson(`https://api.tvmaze.com/shows/${show.id}/images`),
  ]);

  const backdrop = (images || []).find((i) => i.type === "background");
  return {
    id: show.id,
    name: show.name,
    synopsis: stripHtml(show.summary),
    genres: show.genres || [],
    year: show.premiered ? Number(show.premiered.slice(0, 4)) : null,
    endYear: show.ended ? Number(show.ended.slice(0, 4)) : null,
    runtime: show.averageRuntime || show.runtime || null,
    network: show.network?.name || show.webChannel?.name || "",
    country: show.network?.country?.name || "",
    language: show.language || "",
    rating: show.rating?.average || null,
    poster: show.image?.original || null,
    backdrop: backdrop?.resolutions?.original?.url || null,
    imdb: show.externals?.imdb || null,
    url: show.url || null,
    episodes: (episodes || []).map((e) => ({
      season: e.season,
      number: e.number,
      title: e.name || "",
      synopsis: stripHtml(e.summary),
      thumb: e.image?.original || null,
      airDate: e.airdate ? new Date(e.airdate) : null,
    })),
    cast: (cast || []).slice(0, 14).map((c) => ({
      name: c.person?.name || "",
      character: c.character?.name || "",
      photo: c.character?.image?.medium || c.person?.image?.medium || null,
    })),
  };
}

// ---------------------------------------------------- Wikipédia / Wikidata --

// Résumé Wikipédia : page directe d'abord (le titre exact marche souvent),
// recherche en repli. FR prioritaire — l'app est francophone.
export async function wikiSummary(name, hint = "") {
  for (const lang of ["fr", "en"]) {
    let sum = await getJson(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    if (!sum?.extract || sum.type === "disambiguation") {
      const search = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          `${name} ${hint}`.trim()
        )}&srlimit=1&format=json&origin=*`
      );
      const title = search?.query?.search?.[0]?.title;
      if (title) {
        sum = await getJson(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
        );
      }
    }
    if (sum?.extract && sum.type !== "disambiguation") {
      return {
        lang,
        title: sum.title,
        extract: sum.extract,
        url: sum.content_urls?.desktop?.page || null,
        image: sum.originalimage?.source || sum.thumbnail?.source || null,
        wikibaseId: sum.wikibase_item || null,
      };
    }
  }
  return null;
}

// Fiche technique d'un film depuis Wikidata : date de sortie, durée,
// réalisateur, genres, identifiant IMDb.
export async function wikidataFilm(qid) {
  const root = await getJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  );
  const claims = root?.entities?.[qid]?.claims;
  if (!claims) return null;

  const first = (p) => (claims[p] || [])[0]?.mainsnak?.datavalue?.value;
  const ids = (p) =>
    (claims[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

  const date = first("P577")?.time || null; // date de publication
  const year = date ? Number(date.slice(1, 5)) : null;
  const runtime = Number(first("P2047")?.amount) || null;

  // Réalisateur / genres : Wikidata ne stocke que des identifiants, on les
  // résout en libellés français d'un seul appel.
  const toResolve = [...ids("P57").slice(0, 2), ...ids("P136").slice(0, 4)];
  const labels = new Map();
  if (toResolve.length) {
    const ent = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${toResolve.join(
        "|"
      )}&props=labels&languages=fr|en&format=json&origin=*`
    );
    for (const [id, e] of Object.entries(ent?.entities || {})) {
      const label = e.labels?.fr?.value || e.labels?.en?.value;
      if (label) labels.set(id, label);
    }
  }

  return {
    year,
    releaseDate: date ? new Date(date.slice(1, 11)) : null,
    runtime,
    director: ids("P57").map((id) => labels.get(id)).filter(Boolean)[0] || "",
    genres: ids("P136").map((id) => labels.get(id)).filter(Boolean),
    imdb: first("P345") || null,
  };
}

// Titres d'épisodes en FRANÇAIS depuis la « Liste des épisodes de … » de
// Wikipédia FR. Les modèles d'épisode y suivent tous la même convention
// (`NumeroEpisode` / `TitreFrançais` / `CourtResume`), quel que soit le nom
// exact du modèle : on lit le wikitexte et on en tire une table par numéro.
// Best-effort — une page absente ou exotique renvoie une table vide et on
// garde alors les titres d'origine.
export async function wikiEpisodeTitles(showTitle) {
  const page = `Liste des épisodes de ${showTitle}`;
  const d = await getJson(
    `https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
      page
    )}&prop=wikitext&format=json&origin=*`
  );
  const wikitext = d?.parse?.wikitext?.["*"];
  if (!wikitext) return new Map();

  const out = new Map();
  // Chaque bloc « | Champ = valeur » d'un modèle contenant NumeroEpisode.
  const blocks = wikitext.split(/\{\{\s*(?:É|E)pisode/i).slice(1);
  for (const block of blocks) {
    const field = (name) => {
      const m = block.match(
        new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]*(?:\\n(?![|}])[^\\n|]*)*)`, "i")
      );
      return m ? cleanWikitext(m[1]) : "";
    };
    const num = Number(field("NumeroEpisode"));
    const title = field("TitreFrançais") || field("TitreFrancais");
    if (!num || !title) continue;
    out.set(num, { title, synopsis: field("CourtResume") });
  }
  return out;
}

// Wikitexte → texte lisible : liens [[…|…]], références, gras, modèles.
function cleanWikitext(s) {
  return String(s || "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\{\{date\|([^}]*)\}\}/gi, (_, v) => v.split("|").join(" "))
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ------------------------------------------------------------- assemblage --

// Construit (ou reconstruit) un média de la collection. Deux entrées possibles,
// selon le lecteur :
//
//   • une URL YouTube — les épisodes SONT la playlist, et un « rafraîchir » les
//     recharge (nouvel épisode mis en ligne, titre corrigé) ;
//   • une LISTE de liens collée à la main (`episodesText`) pour tout autre
//     lecteur — là, la liste fait foi : rien ne se re-scrape, on ne la
//     réinvente pas derrière le dos de celui qui l'a écrite.
//
// Dans les deux cas l'habillage (synopsis, casting, visuels, titres français)
// vient des mêmes sources, et chacune est optionnelle : si TVmaze ne connaît
// pas la série on garde les titres d'origine, si Wikipédia ne répond pas le
// synopsis vient de ce qui reste.
//
//   input = { url, provider, episodesText, kind, format, licence, title,
//             franchise, color, games, tvmazeQuery, wikiTitle, animated,
//             order, featured }
export async function buildMedia(input) {
  const url = String(input.url || "");
  const playlistId = extractPlaylistId(url);
  const videoId = extractVideoId(url);

  // Quel lecteur ? Le choix explicite de l'admin d'abord, celui déjà enregistré
  // ensuite (cas du « rafraîchir »), YouTube en dernier recours.
  const wanted = input.provider || input.source?.provider || null;
  const manual = wanted ? wanted !== "youtube" : false;

  const listText =
    input.episodesText != null
      ? String(input.episodesText)
      : String(input.source?.list || "");

  const kind = input.kind || (playlistId || manual ? "series" : "film");
  const sources = new Set(manual ? [] : ["YouTube"]);

  // 1. Ce qui est REGARDABLE : la playlist YouTube, ou la liste posée à la main.
  let first = null;
  let playlist = null;
  let rawItems = [];

  if (manual) {
    const parsed = parseEpisodeLines(listText);
    // Rien de neuf à la relecture : on garde les épisodes déjà enregistrés
    // (un « rafraîchir » ne doit habiller que les métadonnées).
    rawItems = parsed.length
      ? parsed
      : (input.episodes || []).map((e) => ({
          season: e.season || null,
          number: e.number ?? null,
          title: e.title || "",
          provider: e.provider || "embed",
          url: e.url || "",
          lang: e.lang || "",
          videoId: e.videoId || null,
          mirrors: e.mirrors || [],
          duration: e.duration || null,
        }));
    if (!rawItems.length)
      throw new Error("la liste d'épisodes est vide (une ligne = un lien)");
  } else {
    first = await ytVideo(videoId);
    playlist = playlistId ? await ytPlaylistItems(playlistId) : null;
    const items = playlist?.items?.length
      ? playlist.items
      : first
        ? [{ videoId: first.videoId, title: first.title, duration: null }]
        : [];
    if (!items.length) throw new Error("aucune vidéo trouvée pour cette URL");
    rawItems = items.map((i) => ({
      season: null,
      number: null,
      title: i.title,
      provider: "youtube",
      videoId: i.videoId,
      url: `https://www.youtube.com/watch?v=${i.videoId}`,
      mirrors: [],
      duration: i.duration || null,
    }));
  }

  const title = input.title || first?.title || playlist?.title || "Sans titre";
  const slug = input.slug || slugify(title);

  // 2. La fiche de référence : TMDB d'abord (séries ET films, en français, avec
  //    une image et un résumé PAR ÉPISODE), TVmaze en repli — c'est-à-dire
  //    quand aucune clé TMDB n'est configurée, ou qu'elle ne connaît pas ce
  //    titre. La forme des deux objets est la même, la suite ne s'en soucie pas.
  let show = null;
  let tmdbRef = null;
  if (tmdb.enabled()) {
    // La fiche choisie à la main dans le panneau d'admin prime ; sinon on prend
    // la meilleure correspondance sur le titre.
    tmdbRef = input.tmdbRef || (await tmdb.find(input.tmdbQuery || title, kind));
    if (tmdbRef) show = await tmdb.show(tmdbRef);
    if (show) sources.add("TMDB");
    else tmdbRef = null;
  }
  if (!show && kind === "series") {
    show = await tvmazeShow(input.tvmazeQuery || title);
    if (show) sources.add("TVmaze");
  }

  // 3. Wikipédia (+ Wikidata pour les films) : synopsis français et fiche.
  const wiki = await wikiSummary(
    input.wikiTitle || title,
    kind === "film" ? "film" : "série télévisée"
  );
  if (wiki) sources.add(wiki.lang === "fr" ? "Wikipédia (fr)" : "Wikipedia (en)");
  const facts =
    kind === "film" && wiki?.wikibaseId ? await wikidataFilm(wiki.wikibaseId) : null;
  if (facts) sources.add("Wikidata");

  // 4. Titres d'épisodes français, quand la page existe.
  const frTitles =
    kind === "series" ? await wikiEpisodeTitles(input.wikiTitle || title) : new Map();

  // --- Fusion des épisodes -------------------------------------------------
  // La liste commande l'ordre (c'est elle qu'on lit), la fiche externe ne fait
  // qu'habiller. Le raccord se fait :
  //
  //   • par SAISON + NUMÉRO quand la liste les donne (import, liste écrite à la
  //     main) — c'est le seul raccord exact, et il faut qu'il passe devant ;
  //   • sinon par numéro deviné dans le titre YouTube, position dans la
  //     playlist en dernier recours.
  const flat = show?.episodes || [];
  const bySeasonNumber = new Map();
  for (const e of flat) bySeasonNumber.set(`${e.season}x${e.number}`, e);

  const episodes = rawItems.map((item, i) => {
    // Le numéro écrit noir sur blanc dans la liste prime sur tout : c'est un
    // humain qui l'a posé. Sinon on le devine dans le titre, sinon c'est la
    // position dans la playlist.
    const abs = item.number ?? guessEpisodeNumber(item.title) ?? i + 1;
    const meta =
      (item.season != null && bySeasonNumber.get(`${item.season}x${abs}`)) ||
      flat[abs - 1] ||
      null;
    const fr = frTitles.get(abs);
    return {
      index: i,
      season: item.season || meta?.season || 1,
      number: abs,
      // Le titre de la fiche externe passe DEVANT celui de la liste quand
      // celle-ci n'en porte pas de vrai : un import ne donne que « Saison 1 »
      // ou rien, TMDB donne le titre de l'épisode.
      title:
        item.title ||
        meta?.title ||
        fr?.title ||
        cleanEpisodeTitle(item.title, title) ||
        `Épisode ${abs}`,
      synopsis: meta?.synopsis || fr?.synopsis || "",
      provider: item.provider || "youtube",
      videoId: item.videoId || null,
      url: item.url || "",
      lang: item.lang || "",
      mirrors: item.mirrors || [],
      // Pas de vignette servie par un lecteur tiers : on retombe sur celle de
      // l'épisode chez TVmaze, et à défaut la fiche affichera l'affiche.
      thumb: item.videoId
        ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`
        : meta?.thumb || null,
      duration: item.duration || meta?.duration || null,
      airDate: meta?.airDate || null,
    };
  });

  // --- Visuels : rapatriés chez nous --------------------------------------
  const posterSrc = input.poster || show?.poster || wiki?.image || first?.thumb;
  const backdropSrc = input.backdrop || show?.backdrop || first?.thumb;
  const poster =
    (await downloadArtwork(posterSrc, `${slug}-poster`)) ||
    (await downloadArtwork(first?.thumbFallback, `${slug}-poster`));
  const backdrop =
    (await downloadArtwork(backdropSrc, `${slug}-back`)) ||
    (await downloadArtwork(first?.thumbFallback, `${slug}-back`));

  // La fiche de référence passe devant Wikipédia quand elle vient de TMDB :
  // son résumé est celui de l'ŒUVRE, écrit pour être lu, là où l'extrait
  // encyclopédique ouvre souvent sur trois lignes d'état civil. Et une
  // web-série obscure n'est nulle part : le résumé fourni à l'ajout ferme la
  // marche plutôt que de laisser la fiche vide.
  const synopsis = tidySynopsis(
    (tmdbRef && show?.synopsis) || wiki?.extract || show?.synopsis || input.synopsis || ""
  );

  // Un film n'a qu'une « vidéo » : son titre d'affichage est celui de l'œuvre,
  // pas l'intitulé de la mise en ligne (« … FILM VF »).
  if (kind === "film" && episodes.length === 1) {
    episodes[0].title = title;
    episodes[0].synopsis = synopsis;
  }

  return {
    slug,
    title,
    originalTitle: input.originalTitle || show?.name || "",
    kind,
    animated: input.animated ?? true,
    format: input.format || "dvd",
    // La salle où le titre se regarde. « auto » suffit à l'immense majorité
    // (film → cinéma, le reste → poste cathodique) : on ne pose une valeur que
    // pour les exceptions, et un « rafraîchir » ne doit surtout pas l'effacer —
    // d'où la relecture de ce qui est déjà en base.
    theater: input.theater || "auto",
    licence: input.licence || "official",
    year: input.year || show?.year || facts?.year || null,
    endYear: input.endYear || show?.endYear || null,
    synopsis,
    tagline: input.tagline || "",
    genres: input.genres?.length ? input.genres : show?.genres?.length ? show.genres : facts?.genres || [],
    runtime: input.runtime || show?.runtime || facts?.runtime || null,
    studio: input.studio || show?.director || facts?.director || "",
    network: input.network || show?.network || first?.channel || "",
    country: input.country || show?.country || "",
    language: input.language || show?.language || "",
    rating: show?.rating || null,
    certification: input.certification || show?.certification || null,
    franchise: input.franchise || "",
    games: input.games || [],
    color: input.color || "#f2b70b",
    // Fusionné avec ce qui était déjà là, jamais substitué : un rafraîchissement
    // passe par ici, et il ne doit emporter ni le logo, ni les photos, ni la
    // jaquette dépliée. Ce qui est remplacé entre au fonds (voir `mergeArtwork`).
    artwork: mergeArtwork(input.artwork, { poster, backdrop, thumb: poster }),
    source: {
      provider: manual ? episodes[0]?.provider || "embed" : "youtube",
      videoId: videoId || episodes[0]?.videoId || null,
      playlistId: playlistId || null,
      channel: first?.channel || input.channel || "",
      channelUrl: first?.channelUrl || "",
      url,
      // La liste telle qu'elle a été écrite : c'est elle qu'on rouvrira pour
      // corriger un lien mort, pas une version reconstruite par nos soins.
      list: manual ? listText.trim() || episodesToLines(episodes) : "",
      // CE QU'ON A VRAIMENT SOUS LA MAIN passe devant ce que la fiche annonce :
      // les pistes se lisent maintenant sur les adresses elles-mêmes (une par
      // source), et c'est cette liste-là qui remplit le sélecteur de la fiche.
      // Une page qui promet une VOSTFR dont pas un lien n'a été trouvé ne doit
      // pas allumer un bouton qui ne joue rien.
      langs: langsOfEpisodes(episodes).length
        ? langsOfEpisodes(episodes)
        : input.langs?.length
          ? input.langs
          : input.source?.langs || [],
    },
    episodes,
    cast: input.cast?.length ? input.cast : show?.cast || [],
    // La fiche TMDB retenue : gardée pour que « rafraîchir » retombe sur la
    // MÊME, et non sur ce que la recherche renverra ce jour-là.
    tmdbRef,
    links: {
      wikipedia: wiki?.url || null,
      imdb: show?.imdb || facts?.imdb || null,
      tvmaze: tmdbRef ? null : show?.url || null,
      tmdb: tmdbRef ? show?.url || null : null,
    },
    sources: [...sources],
    featured: !!input.featured,
    order: input.order ?? 0,
    enrichedAt: new Date(),
  };
}

// ======================================================================
//  Le fonds d'images — ce qu'on garde, quoi qu'il arrive
// ======================================================================
// Au-delà, on arrête d'empiler : quarante-huit visuels pour un titre, c'est
// déjà six rafraîchissements complets, et le studio n'en montre pas tant. La
// borne mord sur les PLUS ANCIENS, jamais sur ce qui est en place.
const POOL_MAX = 48;

// Ajoute au fonds sans jamais rien retirer ni réordonner. L'ordre est un
// contrat : le studio désigne une image par son rang (« pool:3 »), et un rang
// qui glisse repeint la mauvaise face.
function addToPool(pool, urls) {
  const out = [...(pool || [])];
  for (const url of urls) {
    if (!url || out.includes(url)) continue;
    out.push(url);
  }
  // Si ça déborde, ce sont les plus vieux qui partent — et les rangs des
  // survivants bougeraient. On préfère donc arrêter d'ajouter : une image de
  // trop qui n'entre pas est un moindre mal qu'une jaquette qui change de
  // visuel toute seule.
  return out.slice(0, POOL_MAX);
}

// FUSIONNE L'ANCIEN ET LE NOUVEAU. Appelé partout où des visuels arrivent —
// enrichissement, TMDB, dépôt à la main. Deux règles, et elles ont chacune
// coûté quelque chose :
//
//   1. CE QUI N'EST PAS FOURNI N'EST PAS EFFACÉ. `findOneAndUpdate` avec un
//      objet remplace le sous-document ENTIER : un « rafraîchir » emportait
//      avec lui le logo, les photos, et jusqu'à la jaquette dépliée mesurée à
//      la main dans l'outil d'alignement. Des heures de travail, pour un clic
//      censé mettre à jour un synopsis ;
//   2. TOUT CE QUI PASSE ENTRE DANS LE FONDS, l'ancien comme le nouveau. Une
//      affiche remplacée reste disponible dans le studio, où on peut la
//      remettre sur n'importe quelle face.
export function mergeArtwork(before = {}, next = {}) {
  const keep = (key) => (next[key] === undefined || next[key] === null ? before[key] : next[key]);
  const merged = {
    poster: keep("poster") || null,
    backdrop: keep("backdrop") || null,
    thumb: keep("thumb") || null,
    wrap: keep("wrap") || null,
    logo: keep("logo") || null,
    stills: next.stills?.length ? next.stills : before.stills || [],
  };
  merged.pool = addToPool(before.pool, [
    before.poster,
    before.backdrop,
    ...(before.stills || []),
    merged.poster,
    merged.backdrop,
    ...merged.stills,
  ]);
  merged.logos = addToPool(before.logos, [before.logo, merged.logo]);
  return merged;
}

// ======================================================================
//  Le matériel d'impression d'un boîtier
// ======================================================================
// LE LOGO, LES PHOTOS, LA MARQUE DU STUDIO — ce qu'on imprime vraiment sur une
// jaquette, et que l'enrichissement de fiche n'allait pas chercher. C'est un
// geste À PART, déclenché depuis le mini-studio : trois requêtes TMDB et
// jusqu'à sept images rapatriées, ce serait un luxe à chaque « rafraîchir »
// alors qu'on ne fabrique une jaquette qu'une fois.
//
// TOUT EST FACULTATIF, ET RIEN N'ÉCRASE À L'AVEUGLE : ce qui ne revient pas
// (pas de logo pour cette œuvre, pas de clé TMDB) laisse le champ tel quel, et
// la face retombe sur ce qu'elle sait composer sans lui.
export async function fetchCaseMeta(media) {
  if (!tmdb.enabled()) throw new Error("Aucune clé TMDB configurée.");

  // La fiche déjà retenue d'abord — c'est celle que l'admin a validée. Sinon on
  // cherche sur le titre, et on garde la référence trouvée : le prochain appel
  // retombera sur la même.
  const ref = media.tmdbRef || (await tmdb.find(media.title, media.kind));
  if (!ref) throw new Error("Aucune fiche TMDB pour ce titre.");

  const got = await tmdb.extras(ref);
  if (!got) throw new Error("TMDB n'a rien renvoyé pour cette fiche.");

  const slug = media.slug;
  const logo = got.logo ? await downloadArtwork(got.logo, `${slug}-logo`) : null;

  // Les photos partent ENSEMBLE : quatre allers-retours en série, c'est deux
  // secondes d'attente là où il en faut une demie.
  const stills = (
    await Promise.all(
      got.stills.map((url, i) => downloadArtwork(url, `${slug}-still${i}`))
    )
  ).filter(Boolean);

  const studios = (
    await Promise.all(
      got.studios.map(async (s, i) => ({
        name: s.name,
        logo: await downloadArtwork(s.logo, `${slug}-studio${i}`),
      }))
    )
  ).filter((s) => s.logo || s.name);

  return { ref, logo, stills, studios, seasons: got.seasons };
}

// Rapatrie les photos du casting (les vignettes TVmaze sont distantes) :
// appelé après buildMedia pour ne pas allonger l'enrichissement principal.
export async function localizeCast(media) {
  const out = [];
  for (const [i, c] of (media.cast || []).entries()) {
    const photo = c.photo?.startsWith("/uploads/")
      ? c.photo
      : await downloadArtwork(c.photo, `${media.slug}-cast${i}`);
    out.push({ ...c, photo });
  }
  return out;
}
