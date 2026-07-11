// Agrégation du profil d'un studio / éditeur à partir de sources publiques :
//   • IGDB      → id, logo, catalogue de jeux, description de secours
//   • Wikipedia → biographie (FR de préférence), image d'en-tête, id Wikidata
//   • Wikidata  → fondateurs / dirigeants (avec photo), pays, année de création
// Tout est best-effort : si une source tombe, on renvoie ce qu'on a. Le résultat
// est mis en cache en base (CompanyProfile) par la route appelante.

import CompanyProfile from "../models/CompanyProfile.js";
import { igdbQuery } from "./igdb.js";

const IMG = "https://images.igdb.com/igdb/image/upload";
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours

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

// -- IGDB : fiche entreprise (id, logo, description) --
async function fetchIgdbCompany(name) {
  try {
    const rows = await igdbQuery(
      "companies",
      `fields name,description,start_date,logo.image_id;
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
      `fields name,cover.image_id,first_release_date,total_rating,
         involved_companies.company,involved_companies.developer,involved_companies.publisher;
       where involved_companies.company = ${companyId} & version_parent = null & category = (0,8,9);
       sort total_rating desc; limit 200;`
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
          role: dev && pub ? "both" : pub ? "publisher" : "developer",
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
  return { people, country, startYear };
}

// Construit (ou rafraîchit) le profil complet d'une entreprise et le met en
// cache. Retourne le document Mongo (lean). `mine` est ajouté par la route.
export async function buildCompanyProfile(rawName) {
  const key = norm(rawName);
  const cached = await CompanyProfile.findOne({ key }).lean();
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < STALE_MS) {
    return cached;
  }

  const igdb = await fetchIgdbCompany(rawName);
  const wiki = await fetchWikiSummary(igdb?.name || rawName);
  const wikidata = wiki?.wikibaseId ? await fetchWikidata(wiki.wikibaseId) : null;
  const games = igdb?.igdbId ? await fetchIgdbCatalog(igdb.igdbId) : [];

  // Rien trouvé nulle part : on ne crée pas d'entrée vide (permet un 404 propre)
  if (!igdb && !wiki && !games.length) return cached || null;

  const doc = {
    key,
    name: igdb?.name || rawName,
    igdbId: igdb?.igdbId || null,
    logo: igdb?.logo || null,
    country: wikidata?.country || null,
    startYear: igdb?.startYear || wikidata?.startYear || null,
    description: wiki?.extract || igdb?.description || null,
    descriptionSource: wiki?.extract ? "wikipedia" : igdb?.description ? "igdb" : null,
    wikiUrl: wiki?.url || null,
    image: wiki?.image || null,
    people: wikidata?.people || [],
    games,
  };

  const saved = await CompanyProfile.findOneAndUpdate(
    { key },
    { $set: doc },
    { upsert: true, new: true }
  ).lean();
  return saved;
}
