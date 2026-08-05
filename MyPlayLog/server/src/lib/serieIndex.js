import { countHosts, toList } from "./animeSama.js";
import {
  BLOCKED_MSG,
  assertPublicUrl,
  fetchIndexPage,
  harvestPlayers,
  importFilmFromUrl,
  parseFilmPage,
} from "./filmIndex.js";

// ======================================================================
//  Lecture d'une fiche de SÉRIE sur un site de streaming
// ======================================================================
// Mêmes sites que l'import de films (lib/filmIndex.js), même principe : ils
// n'hébergent rien, ils ALIGNENT DES LECTEURS TIERS. Mais une fiche de série ne
// se lit pas comme une fiche de film, et c'est là que ça coinçait : la page
// servie à un serveur est un SQUELETTE. Pas un lecteur, pas une ligne
// d'épisode — les listes d'épisodes y sont des div vides. Lue avec le lecteur
// de films, une saison de vingt-trois épisodes donnait donc « 0 lecteur » : le
// titre, la durée, le réalisateur, et rien à regarder.
//
// TOUT ARRIVE JUSTE APRÈS, EN UN SEUL BLOC, que la page va chercher à côté
// d'elle avec l'identifiant d'article qu'elle porte. Ce bloc range ses adresses
// par version (vf, vostfr, vo), puis par numéro d'épisode, puis par lecteur —
// c'est-à-dire exactement ce dont on a besoin, déjà trié et déjà étiqueté.
//
// ON DEMANDE CE QUE LE NAVIGATEUR DEMANDE. Rien de secret, rien qui réclame un
// compte : le même appel que fait la page en s'ouvrant. Et comme pour les deux
// autres imports, RIEN N'EST TÉLÉCHARGÉ NI REHÉBERGÉ — il en sort du texte, que
// l'admin relit et corrige avant d'enregistrer.

// Les versions du bloc, dans l'ordre où on les préfère : l'app est francophone,
// la VF passe devant.
const VERSIONS = ["vf", "vostfr", "vo"];

// Où dort le bloc d'épisodes, dans l'ordre où la page les essaie elle-même (le
// site le déguise en fichier statique pour échapper aux bloqueurs de pub, d'où
// les alias). `{id}` est l'identifiant d'article porté par la page, `{v}` le
// jeton anti-cache qu'elle recalcule toutes les trente secondes.
const DATA_PATHS = [
  "/static/series/{id}.js?v={v}",
  "/data/eps_{id}.txt?v={v}",
  "/ep-data.php?id={id}&format=js&v={v}",
];

// Une saison peut être longue (les feuilletons quotidiens le sont), pas
// infinie : au-delà, c'est qu'on lit autre chose qu'un numéro d'épisode.
const MAX_EPISODES = 400;

const strip = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

// --------------------------------------------------- reconnaître la page --

// L'identifiant d'article : c'est LUI qu'on repasse au site pour obtenir les
// épisodes. Sans lui, il n'y a rien à demander.
const newsIdOf = (html) =>
  String(html || "").match(/data-news-?id\s*=\s*["'](\d{1,12})["']/i)?.[1] || null;

// Ce à quoi se reconnaît une fiche de série : le bloc de données de la page,
// ses colonnes d'épisodes par version, ou son lecteur maison.
const SERIE_MARKERS = [
  /id=["']serie-(?:data|config)["']/i,
  /id=["'](?:vf|vostfr|vo)-episodes["']/i,
  /class=["'][^"']*episodes-(?:list|wrapper)[^"']*["']/i,
  /serie-player\d*\.js/i,
];

// Reconnue à ce que la source CONTIENT, jamais à ce qu'on déclare — même règle
// que pour les films : personne ne sait dire s'il vient de copier « une fiche
// de série », mais tout le monde sait faire Ctrl+A.
export function looksLikeSeriePage(html) {
  const raw = String(html || "");
  // Les signatures anime-sama passent devant : elles ont leur propre lecture.
  if (/var\s+eps[A-Za-z0-9_]*\s*=\s*\[|panneauAnime\s*\(/.test(raw)) return false;
  if (!newsIdOf(raw)) return false;
  return SERIE_MARKERS.some((re) => re.test(raw));
}

// Le site d'où vient la page. Donné par l'adresse quand on l'a ; sinon la page
// le dit elle-même (c'est le cas d'une source collée sans son adresse).
function originOf(html, pageUrl) {
  const candidates = [
    pageUrl,
    String(html || "").match(
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i
    )?.[1],
    String(html || "").match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    )?.[1],
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      return assertPublicUrl(raw).origin;
    } catch {
      /* l'adresse suivante */
    }
  }
  return null;
}

// « Person Of Interest - Saison 1 » → 1. Une page = une saison sur ces sites,
// et son rang n'est écrit que dans le titre ou dans l'adresse.
function seasonOf(...hints) {
  for (const hint of hints) {
    const m = String(hint || "").match(/saison[\s._-]*(\d{1,2})\b/i);
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }
  return 1;
}

// Et on le RETIRE du titre. Le rang ne se perd pas — il part dans les repères
// S01E01 de la liste, là où l'app le lit. Le laisser dans le nom du boîtier
// condamnait la fiche externe (« Person Of Interest - Saison 1 » ne trouve rien
// chez TVmaze) et interdisait d'ajouter la saison 2 au même boîtier.
const stripSeason = (title) => {
  const s = String(title || "").trim();
  return s.replace(/\s*[-–—:·|]?\s*saison\s*\d{1,2}\s*$/i, "").trim() || s;
};

// ------------------------------------------------------- le bloc de données --

// On ne re-devine pas ce que le site vient de nommer. Le tamis sévère de
// l'import de films existe parce que là-bas on RAMASSE des adresses au milieu
// d'une page ; ici chacune arrive rangée sous le nom de son lecteur. On vérifie
// donc le strict nécessaire : une vraie adresse http(s), et pas un fichier
// d'habillage.
const ASSET_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|css|js|json|xml|txt|woff2?)(?:$|[?#])/i;

function playable(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return false;
  }
  return (
    /^https?:$/.test(u.protocol) && u.hostname.includes(".") && !ASSET_RE.test(u.pathname)
  );
}

// Les adresses d'UN épisode, dans l'ordre du site : la première est celle qu'il
// branche par défaut, les suivantes ses secours — c'est mot pour mot ce que
// notre poste appelle des miroirs, on garde donc cet ordre.
//
// Sauf « premium » : le lecteur maison du site, réservé à ses abonnés. On le
// garde (un miroir de plus ne coûte rien) mais en dernier, pour qu'il ne soit
// jamais celui qu'on branche en premier.
function episodeUrls(entry) {
  const found = [];
  for (const [name, value] of Object.entries(entry || {})) {
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (!playable(url) || found.some((f) => f.url === url)) continue;
    found.push({ name, url });
  }
  return found
    .sort((a, b) => Number(/premium/i.test(a.name)) - Number(/premium/i.test(b.name)))
    .map((f) => f.url);
}

// Le titre d'épisode part dans une LIGNE DE TEXTE relue par l'admin puis par le
// serveur (« S01E01 La machine — lien | miroir ») : une adresse ou un retour à
// la ligne au milieu y ferait dérailler la lecture.
const episodeTitle = (info) =>
  strip(String(info?.title || "").replace(/https?:\/\/\S+/g, " ").replace(/[|\r\n]+/g, " "))
    .slice(0, 120);

function episodesOf(byNumber, info, season) {
  const out = [];
  for (const key of Object.keys(byNumber || {})) {
    const number = Number(key);
    if (!Number.isInteger(number) || number < 1 || number > MAX_EPISODES) continue;
    const urls = episodeUrls(byNumber[key]);
    if (!urls.length) continue;
    out.push({ season, number, title: episodeTitle(info?.[key]), urls });
  }
  return out.sort((a, b) => a.number - b.number);
}

// La réponse est du JSON, servie sous une extension qui prétend le contraire
// (.js, .txt) : on la lit pour ce qu'elle est, et on refuse tout ce qui n'a pas
// la forme attendue plutôt que d'essayer d'en tirer quelque chose.
function parseEpisodesData(text) {
  if (!text) return null;
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.error) return null;
  return VERSIONS.some((v) => data[v] && typeof data[v] === "object") ? data : null;
}

async function fetchEpisodesData(origin, id) {
  const v = Math.floor(Date.now() / 30000);
  for (const path of DATA_PATHS) {
    const url = `${origin}${path.replace("{id}", id).replace("{v}", v)}`;
    // Un alias qui ne répond pas ne coûte que l'essai suivant — et si c'est le
    // mur anti-robots qui répond, la page, elle, a déjà été lue : on préfère
    // rendre ce qu'on a plutôt que de tout perdre ici.
    const data = parseEpisodesData(await fetchIndexPage(url).catch(() => null));
    if (data) return data;
  }
  return null;
}

// ---------------------------------------------------------------- l'import --

// Renvoie la forme commune à tous les imports d'épisodes (celle que le panneau
// d'admin affiche sans savoir d'où vient le résultat), ou `null` si la page est
// bien une fiche de série mais que le bloc n'a rien donné.
async function readSerie(html, { pageUrl = "", origin = "", lang } = {}) {
  const id = newsIdOf(html);
  const data = id && origin ? await fetchEpisodesData(origin, id) : null;
  if (!data) return null;

  const page = parseFilmPage(html, { pageUrl });
  const season = seasonOf(page.title, pageUrl);

  // Toutes les versions que la page porte, dans l'ordre naturel.
  const tracks = VERSIONS.map((version) => ({
    lang: version,
    episodes: episodesOf(data[version], data.info, season),
  })).filter((t) => t.episodes.length);
  if (!tracks.length) return null;

  // ON LES PREND TOUTES. Le bloc de données porte les trois versions côte à
  // côte — on en choisissait une et on jetait les autres, si bien qu'obtenir la
  // VOSTFR d'une série déjà importée en VF demandait de tout réimporter... pour
  // perdre la VF. Elles sont maintenant fusionnées PAR ÉPISODE, chaque adresse
  // étiquetée de sa piste, et c'est le spectateur qui choisit sur la fiche.
  //
  // `lang` ne filtre plus, il ORDONNE : la version demandée (VF par défaut)
  // passe en tête de chaque ligne, donc c'est elle qui se branche toute seule.
  const wanted = [...new Set([String(lang || "").toLowerCase(), ...VERSIONS])];
  const ordered = wanted.map((v) => tracks.find((t) => t.lang === v)).filter(Boolean);
  const picked = ordered[0];

  const byNumber = new Map();
  for (const track of ordered) {
    for (const ep of track.episodes) {
      const at = byNumber.get(ep.number) || { ...ep, urls: [] };
      // Le titre vient de la première piste qui en porte un : `data.info` est
      // commun aux versions, mais rien ne l'impose.
      if (!at.title && ep.title) at.title = ep.title;
      for (const url of ep.urls)
        if (!at.urls.some((s) => s.url === url)) at.urls.push({ url, lang: track.lang });
      byNumber.set(ep.number, at);
    }
  }
  const episodes = [...byNumber.values()].sort((a, b) => a.number - b.number);

  return {
    kind: "series",
    sourceUrl: pageUrl,
    title: stripSeason(page.title),
    year: page.year,
    synopsis: page.synopsis,
    genres: page.genres,
    cover: page.cover,
    backdrop: page.backdrop,
    runtime: page.runtime,
    director: page.director,
    // Ce qui s'imprimera au dos du boîtier — et ce que proposera le sélecteur
    // de la fiche : toutes les pistes dont on rapporte au moins une adresse.
    langs: ordered.map((t) => t.lang),
    seasons: [
      {
        label: `Saison ${season}`,
        path: `saison-${season}`,
        rank: season,
        lang: picked.lang,
        langs: ordered.map((t) => t.lang),
        count: episodes.length,
        url: pageUrl,
      },
    ],
    // Le détail par piste, pour le rapport d'import : « VF 24 ép. · VOSTFR 24 ».
    tracks: ordered.map((t) => ({ lang: t.lang, count: t.episodes.length })),
    hosts: countHosts(episodes),
    count: episodes.length,
    list: toList(episodes),
  };
}

// UNE SEULE PORTE POUR LES DEUX NATURES DE FICHE. La page est lue une fois, et
// c'est elle qui dit ce qu'elle est : une série (ses épisodes) ou un film (ses
// lecteurs). L'admin, lui, colle une adresse — il n'a pas à choisir un mode
// avant de savoir ce que le site va rendre.
export async function importIndexFromUrl(rawUrl, { lang } = {}) {
  const u = assertPublicUrl(rawUrl);

  let html;
  try {
    html = await fetchIndexPage(u.href);
  } catch (err) {
    if (!err?.blocked) throw err;
    throw new Error(BLOCKED_MSG);
  }
  if (!html) throw new Error("Page inaccessible (le site n'a rien renvoyé de lisible).");

  if (looksLikeSeriePage(html)) {
    const serie = await readSerie(html, { pageUrl: u.href, origin: u.origin, lang });
    if (serie) return serie;
    // Les marques d'une série, mais pas un épisode : ces sites partagent leurs
    // gabarits entre séries et films, et une fiche vide reste peut-être lisible
    // comme un film. On laisse l'autre lecture essayer, page déjà en main.
  }
  return importFilmFromUrl(u.href, { html });
}

// La même lecture, sur une source COLLÉE — le recours quand le site refuse les
// robots. On garde le bloc d'épisodes en ligne de mire : il se sert sous une
// adresse de fichier statique, que le mur laisse souvent passer alors qu'il
// bloque les pages. Si même lui est hors d'atteinte, il reste ce que la source
// porte déjà, c'est-à-dire l'épisode qui était à l'écran au moment de la copie.
export async function importSerieFromSource(text, { pageUrl = "", lang } = {}) {
  const raw = String(text || "");
  const origin = originOf(raw, pageUrl);
  const serie = origin
    ? await readSerie(raw, { pageUrl: pageUrl || origin, origin, lang })
    : null;
  return serie || currentEpisodeFromSource(raw, { pageUrl });
}

// L'épisode à l'écran, et lui seul : ses lecteurs sont montés dans la page, donc
// visibles dans la source. Un épisode à la fois, comme pour un film dont la
// fiche ne monte ses lecteurs qu'au clic — ce qui arrive S'AJOUTE à la liste.
function currentEpisodeFromSource(html, { pageUrl = "" } = {}) {
  const { players } = harvestPlayers(html, { pageUrl });
  if (!players.length)
    throw new Error(
      "Cette source ne porte aucun lecteur : les épisodes de cette fiche sont " +
        "chargés à côté de la page, et le serveur n'a pas pu les demander. " +
        "Ouvre l'épisode voulu, recopie la page, et recommence pour chacun."
    );

  const row =
    html.match(/<div[^>]*class=["'][^"']*episode-row[^"']*\bactive\b[^"']*["'][^>]*>/i)?.[0] ||
    "";
  const number = Number(row.match(/data-num\s*=\s*["'](\d{1,3})["']/i)?.[1]) || 1;
  const version = row.match(/data-type\s*=\s*["'](vf|vostfr|vo)["']/i)?.[1] || null;
  const page = parseFilmPage(html, { pageUrl });
  const season = seasonOf(page.title, pageUrl);
  // Les lecteurs montés dans la page sont ceux de la version affichée : elle est
  // écrite sur la ligne active (`data-type`), et c'est la seule chose qui dise
  // ce qu'on va entendre. Sans elle, l'adresse reste sans piste — donc visible
  // quelle que soit la langue choisie, ce qui est le comportement d'avant.
  const episodes = [
    {
      season,
      number,
      title: "",
      urls: players.map((p) => ({ url: p.url, lang: version || "" })),
    },
  ];

  return {
    // « episodes » et non « series » : ce collage n'apporte qu'une ligne, il
    // doit donc S'AJOUTER à la liste au lieu de la remplacer.
    kind: "episodes",
    title: stripSeason(page.title),
    cover: page.cover,
    langs: version ? [version] : [],
    seasons: [
      {
        label: `Saison ${season} · épisode ${number}`,
        path: `saison-${season}`,
        rank: season,
        lang: version,
        count: 1,
      },
    ],
    hosts: countHosts(episodes),
    count: 1,
    list: toList(episodes),
  };
}
