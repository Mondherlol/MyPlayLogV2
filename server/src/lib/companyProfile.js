// Agrégation du profil d'un studio / éditeur à partir de sources publiques :
//   • IGDB      → id, logo, catalogue de jeux, description de secours
//   • Wikipedia → biographie (FR de préférence), image d'en-tête, id Wikidata
//   • Wikidata  → fondateurs / dirigeants (avec photo), pays, année de création
// Tout est best-effort : si une source tombe, on renvoie ce qu'on a. Le résultat
// est mis en cache en base (CompanyProfile) par la route appelante.

import CompanyProfile from "../models/CompanyProfile.js";
import { igdbQuery } from "./igdb.js";
import { GENRES_FR, frName } from "./translations.js";

const IMG = "https://images.igdb.com/igdb/image/upload";
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours
// Bump à chaque changement de la logique d'agrégation : force la régénération
// des fiches déjà en cache (ex. licences via `collections`, popularité…).
const SCHEMA_V = 3;

const igdbEsc = (s) => String(s).replace(/"/g, '\\"');
const norm = (s) => String(s).trim().toLowerCase();

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

// -- IGDB : fiche entreprise (id, logo, description, statut, date de création) --
async function fetchIgdbCompany(name) {
  try {
    const rows = await igdbQuery(
      "companies",
      `fields name,description,start_date,status,logo.image_id;
       where name = "${igdbEsc(name)}"; limit 1;`
    );
    const c = rows?.[0];
    if (!c) return null;
    return {
      igdbId: c.id,
      name: c.name || name,
      logo: c.logo?.image_id
        ? `${IMG}/t_logo_med/${c.logo.image_id}.png`
        : null,
      description: c.description || null,
      // status IGDB : 0 = Active. Tout autre code = plus en activité.
      statusActive: c.status == null ? null : c.status === 0,
      startDate: c.start_date ? new Date(c.start_date * 1000) : null,
      startYear: c.start_date
        ? new Date(c.start_date * 1000).getFullYear()
        : null,
    };
  } catch (err) {
    console.error("igdb company error:", err.message);
    return null;
  }
}

// -- IGDB : catalogue de jeux du studio (développés ou édités) --
async function fetchIgdbCatalog(companyId) {
  try {
    const rows = await igdbQuery(
      "games",
      // game_type : 0 jeu principal, 8 remake, 9 remaster, 10 édition augmentée,
      // 11 portage. (IGDB a remplacé l'ancien champ `category` par `game_type`.)
      // Tri par `total_rating_count` = nombre d'avis = popularité : ce sont les
      // jeux les plus connus qui remontent (bien meilleurs « jeux phares » que la
      // simple note critique, qui fait remonter des pépites confidentielles).
      // `collections` (pluriel) = la SÉRIE du jeu (Counter-Strike, Left 4 Dead…) :
      // c'est la vraie « licence ». `collection` (singulier) et parfois
      // `franchises` sont incomplets/morts côté IGDB → collections en priorité.
      `fields name,cover.image_id,first_release_date,total_rating,total_rating_count,
         franchises.name,collections.name,genres.name,game_engines.name,
         involved_companies.company,involved_companies.developer,involved_companies.publisher;
       where involved_companies.company = ${companyId} & version_parent = null & game_type = (0,8,9,10,11);
       sort total_rating_count desc; limit 250;`
    );
    return (rows || [])
      .map((g) => {
        const inv = (g.involved_companies || []).filter(
          (c) => c.company === companyId
        );
        const dev = inv.some((c) => c.developer);
        const pub = inv.some((c) => c.publisher);
        return {
          gameId: g.id,
          name: g.name || "",
          cover: g.cover?.image_id
            ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg`
            : null,
          year: g.first_release_date
            ? new Date(g.first_release_date * 1000).getFullYear()
            : null,
          rating: g.total_rating ? Math.round(g.total_rating) : null,
          ratingCount: g.total_rating_count || 0,
          franchise: g.collections?.[0]?.name || g.franchises?.[0]?.name || null,
          role: dev && pub ? "both" : pub ? "publisher" : "developer",
          // transitoires (agrégés puis retirés avant stockage) :
          _genres: (g.genres || []).map((x) => x.name).filter(Boolean),
          _engines: (g.game_engines || []).map((x) => x.name).filter(Boolean),
        };
      })
      .filter((g) => g.name);
  } catch (err) {
    console.error("igdb catalog error:", err.message);
    return [];
  }
}

// -- Wikipedia : résumé (bio + image + id Wikidata) --
// On tente d'abord la page directe (le nom du studio est souvent le titre
// exact), puis une recherche en repli. FR d'abord, EN ensuite.
async function fetchWikiSummary(name) {
  for (const lang of ["fr", "en"]) {
    // 1) page directe
    let sum = await getJson(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        name
      )}`
    );
    // 2) repli recherche si absent ou page d'homonymie
    if (!sum || sum.type === "disambiguation" || !sum.extract) {
      const search = await getJson(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          name + " (jeu vidéo entreprise)"
        )}&srlimit=1&format=json&origin=*`
      );
      const title = search?.query?.search?.[0]?.title;
      if (title) {
        sum = await getJson(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
            title
          )}`
        );
      }
    }
    if (sum && sum.extract && sum.type !== "disambiguation") {
      return {
        extract: sum.extract,
        url: sum.content_urls?.desktop?.page || null,
        image: sum.originalimage?.source || sum.thumbnail?.source || null,
        wikibaseId: sum.wikibase_item || null,
      };
    }
  }
  return null;
}

const commonsFile = (file) =>
  file
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        file
      )}?width=240`
    : null;

// -- Wikidata : fondateurs / dirigeants (photo + lien) + pays + création --
async function fetchWikidata(qid) {
  const root = await getJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  );
  const claims = root?.entities?.[qid]?.claims;
  if (!claims) return null;

  const idsOf = (prop) =>
    (claims[prop] || [])
      .map((c) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);

  // P112 = fondateur, P169 = PDG, P1037 = directeur/gérant
  const founders = idsOf("P112");
  const ceos = idsOf("P169").concat(idsOf("P1037"));
  const roleById = new Map();
  for (const id of founders) roleById.set(id, "Fondateur");
  for (const id of ceos) if (!roleById.has(id)) roleById.set(id, "Dirigeant");
  const countryId = idsOf("P17")[0] || null;

  const inception = claims.P571?.[0]?.mainsnak?.datavalue?.value?.time;
  const startYear = inception
    ? parseInt(String(inception).replace(/^\+/, "").slice(0, 4), 10)
    : null;

  // P1128 = nombre d'employés : on prend la valeur la plus récente (qualifiée
  // par une date P585 quand elle existe), pour un effectif à jour.
  const empClaims = (claims.P1128 || [])
    .map((c) => ({
      amount: parseInt(
        String(c.mainsnak?.datavalue?.value?.amount || "").replace(/^\+/, ""),
        10
      ),
      year: c.qualifiers?.P585?.[0]?.datavalue?.value?.time
        ? parseInt(
            String(c.qualifiers.P585[0].datavalue.value.time)
              .replace(/^\+/, "")
              .slice(0, 4),
            10
          )
        : 0,
    }))
    .filter((e) => Number.isFinite(e.amount));
  empClaims.sort((a, b) => b.year - a.year);
  const employees = empClaims[0]?.amount || null;
  const employeesYear = empClaims[0]?.year || null;

  // Résolution des personnes + pays en un seul appel (label FR + photo + lien).
  const ids = [...roleById.keys()].slice(0, 8);
  const toResolve = [...ids, countryId].filter(Boolean);
  let people = [];
  let country = null;
  if (toResolve.length) {
    const ent = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${toResolve.join(
        "|"
      )}&props=labels|claims|sitelinks&languages=fr|en&format=json&origin=*`
    );
    const entities = ent?.entities || {};
    const label = (e) => e?.labels?.fr?.value || e?.labels?.en?.value || null;
    country = countryId ? label(entities[countryId]) : null;
    people = ids
      .map((id) => {
        const e = entities[id];
        if (!e) return null;
        const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        const frTitle = e.sitelinks?.frwiki?.title;
        const enTitle = e.sitelinks?.enwiki?.title;
        const wikiTitle = frTitle || enTitle;
        const wikiLang = frTitle ? "fr" : "en";
        return {
          name: label(e),
          role: roleById.get(id),
          image: commonsFile(img),
          url: wikiTitle
            ? `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(
                wikiTitle.replace(/ /g, "_")
              )}`
            : null,
        };
      })
      .filter((p) => p?.name);
  }
  return { people, country, startYear, employees, employeesYear };
}

// Construit (ou rafraîchit) le profil complet d'une entreprise et le met en
// cache. Retourne le document Mongo (lean). `mine` est ajouté par la route.
export async function buildCompanyProfile(rawName) {
  const key = norm(rawName);
  const cached = await CompanyProfile.findOne({ key }).lean();
  // On sert le cache s'il est frais, non vide ET au bon format : un catalogue
  // vide trahit un fetch IGDB échoué, et l'absence de `franchises` = ancien
  // schéma (avant popularité/licences) → on régénère dans les deux cas.
  if (
    cached &&
    cached.games?.length &&
    cached.v === SCHEMA_V &&
    Date.now() - new Date(cached.updatedAt).getTime() < STALE_MS
  ) {
    return cached;
  }

  const igdb = await fetchIgdbCompany(rawName);
  const wiki = await fetchWikiSummary(igdb?.name || rawName);
  const wikidata = wiki?.wikibaseId ? await fetchWikidata(wiki.wikibaseId) : null;
  const games = igdb?.igdbId ? await fetchIgdbCatalog(igdb.igdbId) : [];

  // Rien trouvé nulle part : on ne crée pas d'entrée vide (permet un 404 propre)
  if (!igdb && !wiki && !games.length) return cached || null;

  // Licences phares : on regroupe les jeux DÉVELOPPÉS par saga (les jeux
  // seulement édités ne définissent pas l'identité d'un studio). Classées par
  // popularité cumulée, la jaquette = le jeu le plus connu de la saga (les jeux
  // arrivent déjà triés par popularité décroissante).
  const franchiseMap = new Map();
  for (const g of games) {
    if (g.role === "publisher" || !g.franchise) continue;
    if (!franchiseMap.has(g.franchise))
      franchiseMap.set(g.franchise, { name: g.franchise, count: 0, pop: 0, cover: null });
    const f = franchiseMap.get(g.franchise);
    f.count += 1;
    f.pop += g.ratingCount || 0;
    if (!f.cover && g.cover) f.cover = g.cover;
  }
  const franchises = [...franchiseMap.values()]
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 6)
    .map(({ name, count, cover }) => ({ name, count, cover }));

  // Répartition des genres + moteurs employés — calculée sur les jeux DÉVELOPPÉS
  // (l'identité créative du studio), puis on retire les champs transitoires.
  const devGames = games.filter((g) => g.role !== "publisher");
  const genreMap = new Map();
  const engineMap = new Map();
  for (const g of devGames) {
    for (const raw of g._genres || []) {
      const name = frName(GENRES_FR, raw) || raw;
      genreMap.set(name, (genreMap.get(name) || 0) + 1);
    }
    for (const e of g._engines || []) engineMap.set(e, (engineMap.get(e) || 0) + 1);
  }
  const genres = [...genreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
  const engines = [...engineMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  const storedGames = games.map((g) => ({
    gameId: g.gameId,
    name: g.name,
    cover: g.cover,
    year: g.year,
    rating: g.rating,
    ratingCount: g.ratingCount,
    franchise: g.franchise,
    role: g.role,
  }));

  const doc = {
    key,
    v: SCHEMA_V,
    name: igdb?.name || rawName,
    igdbId: igdb?.igdbId || null,
    logo: igdb?.logo || null,
    country: wikidata?.country || null,
    startYear: igdb?.startYear || wikidata?.startYear || null,
    startDate: igdb?.startDate || null,
    statusActive: igdb?.statusActive ?? null,
    employees: wikidata?.employees || null,
    employeesYear: wikidata?.employeesYear || null,
    engines,
    genres,
    description: wiki?.extract || igdb?.description || null,
    descriptionSource: wiki?.extract ? "wikipedia" : igdb?.description ? "igdb" : null,
    wikiUrl: wiki?.url || null,
    image: wiki?.image || null,
    people: wikidata?.people || [],
    franchises,
    games: storedGames,
  };

  const saved = await CompanyProfile.findOneAndUpdate(
    { key },
    { $set: doc },
    { upsert: true, new: true }
  ).lean();
  return saved;
}
