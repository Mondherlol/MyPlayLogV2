// ======================================================================
//  TMDB — la base de fiches des séries et des films
// ======================================================================
// TVmaze rendait service, mais il ne connaît ni les films, ni les web-séries,
// ni le français. TMDB est à l'audiovisuel ce qu'IGDB est au jeu : fiches
// traduites, découpage réel en saisons, IMAGE ET RÉSUMÉ PAR ÉPISODE, casting
// avec photos, affiches et bandeaux. C'est ce qui manquait à la Collection.
//
// Une clé (gratuite, immédiate) est nécessaire : `TMDB_API_KEY` dans le .env —
// éditable depuis l'onglet Secrets du panneau d'admin. SANS ELLE, RIEN NE
// CASSE : `enabled()` répond faux et l'enrichissement retombe sur TVmaze comme
// avant.
//
// Tout est en best-effort et normalisé À LA FORME DE tvmazeShow() : les deux
// sources sortent le même objet, donc l'assemblage d'un boîtier
// (lib/collection.js) n'a pas à savoir d'où viennent les données.

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

// Au-delà, on ne va pas chercher les épisodes : une série-fleuve coûterait
// autant d'appels que de saisons, pour un boîtier qu'on ne lira pas en entier.
const MAX_SEASONS = 14;

const key = () => (process.env.TMDB_API_KEY || "").trim();

export function enabled() {
  return !!key();
}

// TMDB délivre DEUX identifiants sur la même page de réglages, et rien ne dit
// lequel prendre : la « clé d'API » (v3, 32 caractères) se passe en paramètre
// d'URL, le « jeton d'accès en lecture » (v4) est un JWT qui se passe en
// en-tête. On reconnaît le second à sa forme et on s'adapte — l'un ou l'autre
// convient, personne n'a à retenir la différence.
function auth(url) {
  const k = key();
  if (/^eyJ/.test(k) || k.length > 40) return { Authorization: `Bearer ${k}` };
  url.searchParams.set("api_key", k);
  return {};
}

async function get(path, params = {}) {
  if (!enabled()) return null;
  const url = new URL(BASE + path);
  const headers = auth(url);
  url.searchParams.set("language", "fr-FR");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", ...headers } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const img = (path, size = "original") => (path ? `${IMG}/${size}${path}` : null);
const year = (date) => (date ? Number(String(date).slice(0, 4)) || null : null);

// Une fiche TMDB se désigne par son type ET son identifiant : « tv:1399 ».
// C'est ce qu'on garde en base pour retrouver la même au rafraîchissement.
export function makeRef(type, id) {
  return `${type === "movie" ? "movie" : "tv"}:${id}`;
}

export function parseRef(ref) {
  const m = /^(tv|movie):(\d+)$/.exec(String(ref || ""));
  return m ? { type: m[1], id: Number(m[2]) } : null;
}

const isMovieRef = (type) => type === "movie";

// Le VISA D'EXPLOITATION français — l'équivalent du PEGI pour l'image, celui
// qui s'imprime en pastille au dos d'un boîtier. TMDB le range à deux endroits
// selon qu'on regarde une série ou un film, et sous des libellés locaux qu'il
// faut normaliser : « U », « TP », « Tous publics » disent la même chose.
function frenchRating(d, type) {
  let raw = "";
  if (isMovieRef(type)) {
    const fr = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === "FR");
    raw = (fr?.release_dates || []).map((r) => r.certification).find(Boolean) || "";
  } else {
    raw =
      (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === "FR")?.rating || "";
  }
  raw = String(raw).trim();
  if (!raw) return null;
  const age = raw.match(/\d{1,2}/);
  if (age) return `-${age[0]}`;
  return /^(u|tp|tous)/i.test(raw) ? "Tous publics" : raw.toUpperCase();
}

// ---------------------------------------------------------- recherche --

// Candidats pour un titre, séries et films mêlés — c'est l'admin qui tranche
// dans le panneau (« Sonic X » ou « Sonic X: Shadow Generations » ?).
// Le résumé et l'affiche sont là pour qu'il puisse reconnaître la bonne fiche
// sans quitter la page.
export async function search(query, kind) {
  if (!enabled() || !query) return [];
  const want = kind === "film" ? ["movie"] : kind === "series" ? ["tv"] : ["tv", "movie"];
  const lists = await Promise.all(
    want.map((type) =>
      get(`/search/${type}`, { query, include_adult: "false" }).then((d) =>
        (d?.results || []).slice(0, 6).map((r) => ({ ...r, _type: type }))
      )
    )
  );

  return lists
    .flat()
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 8)
    .map((r) => ({
      source: "tmdb",
      ref: makeRef(r._type, r.id),
      id: r.id,
      kind: r._type === "movie" ? "film" : "series",
      title: r.name || r.title || "",
      year: year(r.first_air_date || r.release_date),
      poster: img(r.poster_path, "w342"),
      summary: (r.overview || "").slice(0, 240),
      network: r.origin_country?.join(", ") || "",
      genres: [],
      url: `https://www.themoviedb.org/${r._type}/${r.id}`,
    }));
}

// La fiche que TMDB tient pour la meilleure correspondance. Sert quand l'admin
// n'a rien choisi à la main : on prend le premier résultat, comme le faisait
// TVmaze — et le titre de la playlist est en général sans ambiguïté.
export async function find(query, kind) {
  const [first] = await search(query, kind);
  return first?.ref || null;
}

// ------------------------------------------------------------- la fiche --

function mapCast(credits) {
  return (credits?.cast || []).slice(0, 14).map((c) => ({
    name: c.name || "",
    character: c.character || "",
    photo: img(c.profile_path, "w185"),
  }));
}

// Les épisodes d'une saison, avec CE QU'ON VENAIT CHERCHER : le titre français,
// le résumé, et l'image de l'épisode.
async function seasonEpisodes(id, seasonNumber) {
  const d = await get(`/tv/${id}/season/${seasonNumber}`);
  return (d?.episodes || []).map((e) => ({
    season: e.season_number,
    number: e.episode_number,
    title: e.name || "",
    synopsis: e.overview || "",
    thumb: img(e.still_path, "w300"),
    airDate: e.air_date ? new Date(e.air_date) : null,
    // TMDB compte en minutes, nous en secondes (comme YouTube).
    duration: e.runtime ? e.runtime * 60 : null,
  }));
}

// La fiche complète, au FORMAT DE tvmazeShow() : l'appelant ne fait pas la
// différence, il enrichit pareil. `episodes` est vide pour un film — c'est la
// vidéo elle-même qui en tient lieu.
export async function show(ref) {
  const parsed = parseRef(ref);
  if (!parsed || !enabled()) return null;
  const { type, id } = parsed;

  const d = await get(`/${type}/${id}`, {
    append_to_response: `credits,external_ids,${
      isMovieRef(type) ? "release_dates" : "content_ratings"
    }`,
  });
  if (!d) return null;

  const isMovie = type === "movie";
  let episodes = [];
  if (!isMovie) {
    // La saison 0 (les « spéciaux ») passe avec les autres : sur une web-série,
    // c'est souvent là que vivent les épisodes.
    const seasons = (d.seasons || [])
      .filter((s) => (s.episode_count || 0) > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .slice(0, MAX_SEASONS);
    for (const s of seasons) {
      episodes = episodes.concat(await seasonEpisodes(id, s.season_number));
    }
  }

  return {
    id,
    ref: makeRef(type, id),
    name: d.name || d.title || "",
    originalName: d.original_name || d.original_title || "",
    synopsis: d.overview || "",
    genres: (d.genres || []).map((g) => g.name).filter(Boolean),
    year: year(d.first_air_date || d.release_date),
    endYear:
      !isMovie && d.status && /ended|canceled|terminé/i.test(d.status)
        ? year(d.last_air_date)
        : null,
    runtime: isMovie ? d.runtime || null : d.episode_run_time?.[0] || null,
    network: d.networks?.[0]?.name || d.production_companies?.[0]?.name || "",
    country: d.production_countries?.[0]?.name || d.origin_country?.[0] || "",
    language: d.original_language || "",
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    certification: frenchRating(d, type),
    poster: img(d.poster_path),
    backdrop: img(d.backdrop_path),
    imdb: d.external_ids?.imdb_id || null,
    url: `https://www.themoviedb.org/${type}/${id}`,
    // Le réalisateur / créateur, pour la ligne « Réalisation » de la fiche.
    director:
      d.created_by?.[0]?.name ||
      (d.credits?.crew || []).find((c) => c.job === "Director")?.name ||
      "",
    episodes,
    cast: mapCast(d.credits),
  };
}

// -------------------------------------------------- matériel d'impression --
//
// CE QUI FAIT UN BOÎTIER, ET QUE `show()` NE RAMÈNE PAS. La fiche sert la page
// (résumé, casting, épisodes) ; le boîtier, lui, s'imprime — et une jaquette
// s'imprime avec des choses qui n'intéressent aucune fiche : le logo du titre
// détouré, deux ou trois photos d'exploitation, la marque du studio, le
// découpage en saisons.
//
// C'est un appel À PART, et pas un `append_to_response` de plus sur `show()` :
// on ne le passe qu'au moment où quelqu'un fabrique une jaquette, alors que
// `show()` tourne à chaque enrichissement de fiche.
//
// LES LANGUES DES LOGOS, dans l'ordre où on les veut : le français d'abord
// (c'est un rayon français), l'anglais ensuite, et enfin les logos SANS langue
// — ce sont les typographies internationales, souvent les plus belles, et TMDB
// les range à part plutôt que de les rattacher à une locale.
const LOGO_LANGS = ["fr", "en", null];

function pickLogo(logos = []) {
  const png = logos.filter((l) => l.file_path && !/\.svg$/i.test(l.file_path));
  // Un SVG ne se dessine pas de façon fiable dans un canvas WebGL (dimensions
  // intrinsèques absentes, polices non embarquées) : on ne le retient qu'à
  // défaut de tout PNG.
  const pool = png.length ? png : logos;
  for (const lang of LOGO_LANGS) {
    const found = pool
      .filter((l) => (l.iso_639_1 || null) === lang)
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
    if (found) return img(found.file_path, "w500");
  }
  return null;
}

export async function extras(ref) {
  const parsed = parseRef(ref);
  if (!parsed || !enabled()) return null;
  const { type, id } = parsed;

  const [d, images] = await Promise.all([
    get(`/${type}/${id}`),
    get(`/${type}/${id}/images`, {
      // Sans ça, `language=fr-FR` filtrerait les images sur le seul français —
      // c'est-à-dire, neuf fois sur dix, aucune image du tout.
      language: "fr",
      include_image_language: "fr,en,null",
    }),
  ]);
  if (!d && !images) return null;

  return {
    logo: pickLogo(images?.logos || []),
    // Les photos du dos : les meilleurs bandeaux SANS texte incrusté (TMDB
    // range ceux-là sous « pas de langue »), du mieux noté au moins bien.
    stills: (images?.backdrops || [])
      .filter((b) => !b.iso_639_1)
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 4)
      .map((b) => img(b.file_path, "w780"))
      .filter(Boolean),
    studios: (d?.production_companies || [])
      .filter((c) => c.logo_path)
      .slice(0, 2)
      .map((c) => ({ name: c.name || "", logo: img(c.logo_path, "w300") })),
    seasons: (d?.seasons || [])
      .filter((s) => (s.episode_count || 0) > 0 && s.season_number > 0)
      .sort((a, b) => a.season_number - b.season_number)
      .slice(0, MAX_SEASONS)
      .map((s) => ({
        number: s.season_number,
        name: s.name || "",
        episodeCount: s.episode_count || 0,
        year: year(s.air_date),
      })),
  };
}

export default { enabled, search, find, show, extras, makeRef, parseRef };
