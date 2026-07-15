// Agrégation du profil d'une console / plateforme à partir de sources publiques :
//   • IGDB      → nom, logo, résumé, génération, famille, révisions matérielles,
//                 consoles sœurs, catalogue de jeux (pour genres / éditeurs / top)
//   • Wikipedia → description (FR de préférence), image d'en-tête, id Wikidata
//   • Wikidata  → constructeur, date de sortie, arrêt de production, ventes
// Tout est best-effort : si une source tombe, on renvoie ce qu'on a. Le résultat
// est mis en cache en base (PlatformProfile) par la route appelante.

import PlatformProfile from "../models/PlatformProfile.js";
import { igdbQuery } from "./igdb.js";
import { ensureEntityLogos } from "./entityLogos.js";
import { GENRES_FR, frName } from "./translations.js";

const IMG = "https://images.igdb.com/igdb/image/upload";
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours
// Bump à chaque changement de la logique d'agrégation → régénère les fiches en cache.
const SCHEMA_V = 9;

const yearOf = (ts) => (ts ? new Date(ts * 1000).getFullYear() : null);

// Petit fetch JSON avec timeout, sans jamais throw (retourne null en cas d'échec).
async function getJson(url, { timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MyPlayLog/1.0 (contact: myplaylog.cc)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Titres d'images clairement hors-sujet pour une photo de console (à écarter).
const BAD_IMG = /(teardown|internal|innenleben|motherboard|pcb|circuit|logo|icon|diagram|schematic|chart|\bmap\b|advert|font|box art|packaging|sticker)/i;

// Construit une requête propre en dédupliquant les mots (nom plateforme + nom
// modèle) : « Nintendo Switch » + « Switch Lite » → « Nintendo Switch Lite ».
function dedupeQuery(a, b) {
  const seen = new Set();
  const out = [];
  for (const w of `${a} ${b}`.split(/\s+/)) {
    const k = w.toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(w);
    }
  }
  return out.join(" ");
}

// -- Wikimedia Commons : meilleure photo d'un modèle de console (transparent
// PNG privilégié), via l'API de recherche. Best-effort, retourne une URL ou null.
async function commonsImage(query, tokens) {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=10` +
    `&prop=imageinfo&iiprop=url|mime&iiurlwidth=560&format=json&origin=*`;
  const s = await getJson(url);
  const pages = s?.query?.pages;
  if (!pages) return null;
  const items = Object.values(pages)
    .map((p) => ({
      title: (p.title || "").replace(/^File:/, ""),
      mime: p.imageinfo?.[0]?.mime,
      img: p.imageinfo?.[0]?.thumburl,
      order: p.index ?? 999,
    }))
    .filter((x) => x.img && /^image\/(png|jpe?g)$/.test(x.mime || ""));
  if (!items.length) return null;
  const score = (x) => {
    const t = x.title.toLowerCase();
    let sc = 0;
    if (x.mime === "image/png") sc += 3; // souvent détouré / fond transparent
    for (const tok of tokens) if (tok.length > 2 && t.includes(tok.toLowerCase())) sc += 2;
    if (BAD_IMG.test(t)) sc -= 8;
    return sc;
  };
  items.sort((a, b) => score(b) - score(a) || a.order - b.order);
  return score(items[0]) < 0 ? null : items[0].img;
}

// Résout, en parallèle, une photo Commons pour chaque révision NON standard.
// Le modèle de base garde la photo canonique de Wikipedia (via le front) —
// une recherche Commons « X console » attrape parfois le mauvais modèle (ex. la
// génération suivante), alors que Wikipedia pointe la bonne console de base.
async function fillVersionImages(platformName, versions) {
  await Promise.all(
    versions
      .filter((v) => !v.base)
      .map(async (v) => {
        v.image = await commonsImage(
          dedupeQuery(platformName, v.name),
          v.name.split(/\s+/)
        );
      })
  );
}

// -- IGDB : fiche plateforme (logo, résumé, génération, famille, révisions) --
// La date de sortie des révisions vit dans un champ imbriqué à 3 niveaux
// (versions → platform_version_release_dates → date). Si IGDB rejette cette
// profondeur, on retente sans (versions sans année) pour ne pas casser la page.
async function fetchIgdbPlatform(id) {
  const base = `name,abbreviation,generation,summary,platform_logo.image_id,
    platform_family.name,
    versions.name,versions.summary,versions.platform_logo.image_id,
    versions.cpu,versions.memory,versions.storage,versions.os`;
  try {
    let rows;
    try {
      rows = await igdbQuery(
        "platforms",
        `fields ${base},versions.platform_version_release_dates.date;
         where id = ${id}; limit 1;`
      );
    } catch {
      rows = await igdbQuery("platforms", `fields ${base}; where id = ${id}; limit 1;`);
    }
    const p = rows?.[0];
    if (!p) return null;
    const versions = (p.versions || [])
      .map((v) => {
        const dates = (v.platform_version_release_dates || [])
          .map((d) => d.date)
          .filter(Boolean);
        // Le modèle « Initial version » / « Original » = la console de base :
        // on lui donne le nom de la plateforme pour ne pas afficher un libellé
        // technique moche, et on le marque comme modèle par défaut.
        const base = /initial|original|standard/i.test(v.name || "");
        return {
          name: base ? p.name : v.name || null,
          base,
          image: null, // photo Commons du modèle (remplie ensuite)
          logo: v.platform_logo?.image_id
            ? `${IMG}/t_logo_med/${v.platform_logo.image_id}.png`
            : null,
          summary: v.summary || null,
          year: dates.length ? yearOf(Math.min(...dates)) : null,
          cpu: v.cpu || null,
          memory: v.memory || null,
          storage: v.storage || null,
          os: v.os || null,
        };
      })
      .filter((v) => v.name);
    // Dédup par nom : IGDB liste souvent l'« Initial version » (renommée au nom
    // de la plateforme) ET un modèle nommé à l'identique → doublon. On fusionne
    // (on garde le drapeau « base » et on complète les champs manquants).
    const byName = new Map();
    for (const v of versions) {
      const k = v.name.toLowerCase().replace(/\s+/g, " ").trim();
      const prev = byName.get(k);
      if (!prev) {
        byName.set(k, v);
        continue;
      }
      if (v.base) prev.base = true;
      for (const f of ["image", "logo", "summary", "year", "cpu", "memory", "storage", "os"])
        if (prev[f] == null && v[f] != null) prev[f] = v[f];
    }
    const deduped = [...byName.values()]
      // Modèle par défaut d'abord, puis par année croissante.
      .sort((a, b) => b.base - a.base || (a.year || 9999) - (b.year || 9999));
    return {
      igdbId: p.id,
      name: p.name,
      abbr: p.abbreviation || null,
      generation: p.generation || null,
      summary: p.summary || null,
      logo: p.platform_logo?.image_id
        ? `${IMG}/t_logo_med/${p.platform_logo.image_id}.png`
        : null,
      familyId: p.platform_family?.id || null,
      family: p.platform_family?.name || null,
      versions: deduped,
    };
  } catch (err) {
    console.error("igdb platform error:", err.message);
    return null;
  }
}

// -- IGDB : consoles sœurs (même famille) --
async function fetchRelated(familyId, selfId) {
  if (!familyId) return [];
  try {
    const rows = await igdbQuery(
      "platforms",
      `fields name,abbreviation,generation,platform_logo.image_id;
       where platform_family = ${familyId} & id != ${selfId};
       sort generation desc; limit 20;`
    );
    return (rows || [])
      .map((p) => ({
        platformId: p.id,
        name: p.name,
        abbr: p.abbreviation || null,
        generation: p.generation || null,
        logo: p.platform_logo?.image_id
          ? `${IMG}/t_logo_med/${p.platform_logo.image_id}.png`
          : null,
      }))
      .filter((p) => p.name);
  } catch (err) {
    console.error("igdb related platforms error:", err.message);
    return [];
  }
}

// Clause de filtrage commune au catalogue et au comptage (mêmes jeux).
const catalogWhere = (id) =>
  `where platforms = (${id}) & version_parent = null & game_type = (0,8,9,10,11);`;

// -- IGDB : nombre total de jeux du catalogue (endpoint /count, non plafonné) --
async function fetchCatalogCount(platformId) {
  try {
    const r = await igdbQuery("games/count", catalogWhere(platformId));
    return r?.count || 0;
  } catch {
    return 0;
  }
}

// Clause d'exclusivité : le jeu n'existe QUE sur cette plateforme. L'opérateur
// `= {…}` d'IGDB impose une correspondance EXACTE de l'array platforms (≠ `(…)`
// qui teste seulement l'appartenance) → array platforms = exactement [id].
const exclusiveWhere = (id) =>
  `where platforms = {${id}} & version_parent = null & game_type = (0,8,9,10,11);`;

// -- IGDB : nombre de jeux exclusifs (endpoint /count, non plafonné) --
async function fetchExclusiveCount(platformId) {
  try {
    const r = await igdbQuery("games/count", exclusiveWhere(platformId));
    return r?.count || 0;
  } catch {
    return 0;
  }
}

// --- Onglet « Jeux » : recherche + tri + pagination server-side ------------
// Sert la grille complète (bien au-delà des 500 du profil) : le front pagine au
// scroll et cherche directement dans IGDB (filtré sur la plateforme).
const GAME_FIELDS =
  "name,cover.image_id,first_release_date,total_rating,total_rating_count," +
  "involved_companies.company.name,involved_companies.publisher";

const GAME_SORT = {
  popularity: "total_rating_count desc",
  rating: "total_rating desc",
  year: "first_release_date desc",
  name: "name asc",
};

// Échappe une saisie pour un littéral Apicalypse entre guillemets.
const escQ = (s) => String(s).replace(/["\\]/g, " ").trim();

function mapGameRow(g) {
  const pub = (g.involved_companies || []).find((c) => c.publisher);
  return {
    gameId: g.id,
    name: g.name || "",
    cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    year: yearOf(g.first_release_date),
    rating: g.total_rating ? Math.round(g.total_rating) : null,
    ratingCount: g.total_rating_count || 0,
    publisher: pub?.company?.name || null,
  };
}

// Une page de jeux de la plateforme. Deux modes :
//   • navigation/recherche : pagination (offset/limit) + filtre nom optionnel ;
//   • « Ma biblio » (mineIds) : intersection avec les jeux possédés, sans pagination.
export async function fetchPlatformGamesPage(
  id,
  { q = "", sort = "popularity", offset = 0, limit = 48, mineIds } = {}
) {
  const sortClause = GAME_SORT[sort] || GAME_SORT.popularity;
  const base = `platforms = (${id}) & version_parent = null & game_type = (0,8,9,10,11)`;

  if (Array.isArray(mineIds)) {
    const ids = mineIds.filter((n) => Number.isFinite(n)).slice(0, 500);
    if (!ids.length) return { games: [], hasMore: false };
    const rows = await igdbQuery(
      "games",
      `fields ${GAME_FIELDS}; where ${base} & id = (${ids.join(",")});
       sort ${sortClause}; limit 500;`
    );
    let games = (rows || []).map(mapGameRow).filter((g) => g.name);
    if (q) {
      const needle = q.toLowerCase();
      games = games.filter((g) => g.name.toLowerCase().includes(needle));
    }
    return { games, hasMore: false };
  }

  // `~ *"…"*` = correspondance nom insensible à la casse (contient), compatible
  // avec `sort` (contrairement au préfixe `search`).
  const where = q ? `${base} & name ~ *"${escQ(q)}"*` : base;
  const rows = await igdbQuery(
    "games",
    `fields ${GAME_FIELDS}; where ${where}; sort ${sortClause}; limit ${limit}; offset ${offset};`
  );
  const games = (rows || []).map(mapGameRow).filter((g) => g.name);
  return { games, hasMore: games.length === limit };
}

// -- IGDB : catalogue des jeux sortis sur la plateforme (populaires d'abord) --
// Plafonné à 500 (max IGDB) : suffisant pour les stats + une liste riche. Le
// vrai total vient de fetchCatalogCount.
async function fetchCatalog(platformId) {
  try {
    const rows = await igdbQuery(
      "games",
      `fields name,cover.image_id,first_release_date,total_rating,total_rating_count,
         platforms,genres.name,collections.name,franchises.name,
         release_dates.platform,release_dates.date,
         involved_companies.company.name,involved_companies.publisher,involved_companies.developer;
       ${catalogWhere(platformId)}
       sort total_rating_count desc; limit 500;`
    );
    return (rows || [])
      .map((g) => {
        const pub = (g.involved_companies || []).find((c) => c.publisher);
        // « Débuté ici » : la sortie du jeu SUR cette console est (quasi) sa toute
        // première sortie → c'est un jeu qui définit la console (exclu / lead
        // platform), pas un simple portage tardif. Tolérance ~45 jours pour les
        // sorties multi-plateformes simultanées.
        const here = (g.release_dates || [])
          .filter((r) => r.platform === platformId && r.date)
          .map((r) => r.date);
        const firstHere = here.length ? Math.min(...here) : null;
        const firstAny = g.first_release_date || null;
        const debut =
          firstHere != null &&
          firstAny != null &&
          firstHere - firstAny <= 45 * 86400;
        // Exclusivité : le jeu n'est sorti QUE sur cette console (une seule
        // plateforme dans son array IGDB).
        const plats = g.platforms || [];
        const exclusive = plats.length === 1 && plats[0] === platformId;
        return {
          gameId: g.id,
          name: g.name || "",
          cover: g.cover?.image_id
            ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg`
            : null,
          year: yearOf(g.first_release_date),
          rating: g.total_rating ? Math.round(g.total_rating) : null,
          ratingCount: g.total_rating_count || 0,
          publisher: pub?.company?.name || null,
          franchise: g.collections?.[0]?.name || g.franchises?.[0]?.name || null,
          debut,
          exclusive,
          _genres: (g.genres || []).map((x) => x.name).filter(Boolean),
        };
      })
      .filter((g) => g.name);
  } catch (err) {
    console.error("igdb platform catalog error:", err.message);
    return [];
  }
}

// -- Wikipedia : résumé (bio + image + id Wikidata) --
export async function fetchWikiSummary(name) {
  for (const lang of ["fr", "en"]) {
    let sum = await getJson(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`
    );
    if (!sum || sum.type === "disambiguation" || !sum.extract) {
      const search = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          name + " (console de jeux vidéo)"
        )}&srlimit=1&format=json&origin=*`
      );
      const title = search?.query?.search?.[0]?.title;
      if (title) {
        sum = await getJson(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
        );
      }
    }
    if (sum && sum.extract && sum.type !== "disambiguation") {
      return {
        extract: sum.extract,
        url: sum.content_urls?.desktop?.page || null,
        image: sum.originalimage?.source || sum.thumbnail?.source || null,
        // Vignette redimensionnée (petite, rapide, fiable à télécharger) — utile
        // quand on rapatrie l'image plutôt que de dépendre du plein format.
        thumbnail: sum.thumbnail?.source || null,
        wikibaseId: sum.wikibase_item || null,
      };
    }
  }
  return null;
}

// -- Wikidata : constructeur, sortie, arrêt de production, unités vendues --
async function fetchWikidata(qid) {
  const root = await getJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  );
  const claims = root?.entities?.[qid]?.claims;
  if (!claims) return null;

  const timeYear = (t) =>
    t ? parseInt(String(t).replace(/^\+/, "").slice(0, 4), 10) : null;
  const dateOf = (prop) => {
    const t = claims[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
    if (!t) return null;
    const y = timeYear(t);
    return y ? { date: new Date(Date.UTC(y, 0, 1)), year: y } : null;
  };

  // P577 date de publication, repli P571 création. P2669 arrêt de production.
  const released = dateOf("P577") || dateOf("P571");
  const discontinued = dateOf("P2669");

  // P2664 unités vendues (repli P1092 nb produit) : on prend la valeur la plus
  // grande (la plus récente cumulée), avec l'année du point dans le temps P585.
  const salesClaims = [...(claims.P2664 || []), ...(claims.P1092 || [])]
    .map((c) => ({
      amount: parseInt(
        String(c.mainsnak?.datavalue?.value?.amount || "").replace(/^\+/, ""),
        10
      ),
      year: timeYear(c.qualifiers?.P585?.[0]?.datavalue?.value?.time) || 0,
    }))
    .filter((s) => Number.isFinite(s.amount) && s.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const unitsSold = salesClaims[0]?.amount || null;
  const unitsSoldYear = salesClaims[0]?.year || null;

  // P176 constructeur : on résout le label FR.
  const makerId = claims.P176?.[0]?.mainsnak?.datavalue?.value?.id || null;
  let manufacturer = null;
  if (makerId) {
    const ent = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${makerId}&props=labels&languages=fr|en&format=json&origin=*`
    );
    const e = ent?.entities?.[makerId];
    manufacturer = e?.labels?.fr?.value || e?.labels?.en?.value || null;
  }

  return {
    manufacturer,
    releaseDate: released?.date || null,
    releaseYear: released?.year || null,
    discontinuedDate: discontinued?.date || null,
    unitsSold,
    unitsSoldYear,
  };
}

// Construit (ou rafraîchit) le profil complet d'une plateforme et le met en
// cache. Retourne le document Mongo (lean). La partie biblio est ajoutée par la route.
export async function buildPlatformProfile(id) {
  const key = String(id);
  const cached = await PlatformProfile.findOne({ key }).lean();
  if (
    cached &&
    cached.v === SCHEMA_V &&
    Date.now() - new Date(cached.updatedAt).getTime() < STALE_MS
  ) {
    return cached;
  }

  const igdb = await fetchIgdbPlatform(id);
  if (!igdb) return cached || null;

  const [related, games, totalCount, exclusiveCount, wiki] = await Promise.all([
    fetchRelated(igdb.familyId, igdb.igdbId),
    fetchCatalog(igdb.igdbId),
    fetchCatalogCount(igdb.igdbId),
    fetchExclusiveCount(igdb.igdbId),
    fetchWikiSummary(igdb.name),
    fillVersionImages(igdb.name, igdb.versions), // remplit versions[].image
  ]);
  const wikidata = wiki?.wikibaseId ? await fetchWikidata(wiki.wikibaseId) : null;

  // Répartition des genres des jeux sortis dessus (pour le donut).
  const genreMap = new Map();
  for (const g of games) {
    for (const raw of g._genres || []) {
      const name = frName(GENRES_FR, raw) || raw;
      genreMap.set(name, (genreMap.get(name) || 0) + 1);
    }
  }
  const genres = [...genreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Top éditeurs : nb de jeux + popularité cumulée sur la console.
  const pubMap = new Map();
  for (const g of games) {
    if (!g.publisher) continue;
    if (!pubMap.has(g.publisher))
      pubMap.set(g.publisher, { name: g.publisher, count: 0, pop: 0 });
    const p = pubMap.get(g.publisher);
    p.count += 1;
    p.pop += g.ratingCount || 0;
  }
  const publishers = [...pubMap.values()]
    .sort((a, b) => b.pop - a.pop || b.count - a.count)
    .slice(0, 8);
  // Logos IGDB des éditeurs (cache partagé EntityLogo), best-effort.
  const pubLogos = await ensureEntityLogos(
    "company",
    publishers.map((p) => p.name)
  );
  for (const p of publishers) p.logo = pubLogos.get(p.name) || null;

  const storedGames = games.map((g) => ({
    gameId: g.gameId,
    name: g.name,
    cover: g.cover,
    year: g.year,
    rating: g.rating,
    ratingCount: g.ratingCount,
    publisher: g.publisher,
    franchise: g.franchise,
    debut: g.debut,
    exclusive: g.exclusive,
  }));

  // Première sortie : la plus ancienne des révisions IGDB, sinon Wikidata.
  const versionYears = igdb.versions.map((v) => v.year).filter(Boolean);
  const releaseYear = versionYears.length
    ? Math.min(...versionYears)
    : wikidata?.releaseYear || null;
  const releaseDate =
    wikidata?.releaseDate ||
    (releaseYear ? new Date(Date.UTC(releaseYear, 0, 1)) : null);

  const doc = {
    key,
    v: SCHEMA_V,
    igdbId: igdb.igdbId,
    name: igdb.name,
    abbr: igdb.abbr,
    generation: igdb.generation,
    family: igdb.family,
    logo: igdb.logo,
    image: wiki?.image || null,
    manufacturer: wikidata?.manufacturer || null,
    releaseDate,
    releaseYear,
    discontinuedDate: wikidata?.discontinuedDate || null,
    unitsSold: wikidata?.unitsSold || null,
    unitsSoldYear: wikidata?.unitsSoldYear || null,
    summary: igdb.summary,
    description: wiki?.extract || igdb.summary || null,
    descriptionSource: wiki?.extract ? "wikipedia" : igdb.summary ? "igdb" : null,
    wikiUrl: wiki?.url || null,
    versions: igdb.versions,
    related,
    genres,
    publishers,
    total: totalCount || games.length, // vrai total IGDB (peut dépasser 500)
    exclusiveCount, // nb réel d'exclus (count IGDB, non plafonné)
    games: storedGames,
  };

  const saved = await PlatformProfile.findOneAndUpdate(
    { key },
    { $set: doc },
    { upsert: true, new: true }
  ).lean();
  return saved;
}
