// ======================================================================
//  Les notes du reste du monde
// ======================================================================
// La fiche d'un jeu affiche la note IGDB et celle de nos joueurs. Mais quand on
// hésite devant un jeu, on va voir ailleurs : Metacritic, OpenCritic. Ce module
// va les chercher UNE FOIS et les garde en base.
//
// LA RÈGLE DE FRAÎCHEUR EST L'ÂGE DU JEU. Un jeu de 2004 ne changera plus de
// note : relevé une fois, il ne redéclenche plus jamais d'appel extérieur. Un
// jeu sorti le mois dernier reçoit encore des tests : on le revoit chaque
// semaine. Entre les deux, l'écart grandit avec l'âge. C'est ce qui permet
// d'afficher ces notes sur un catalogue entier sans marteler personne.
//
// TOUT EST BEST-EFFORT. Une source qui tombe, qui bloque ou qui ne connaît pas
// le jeu n'empêche jamais la fiche de s'afficher : on retient l'échec (`ok`
// faux) pour ne pas le refaire tout de suite, et on rend ce qu'on a.
//
// ⚠️ AJOUTER UNE SOURCE = AJOUTER UNE ENTRÉE DANS `SOURCES`. Rien d'autre à
// toucher : la fraîcheur, le cache et la route sont génériques. Gamekult et
// SensCritique répondent encore 403 aux serveurs (ils filtrent les IP de
// datacenter) ; jeuxvideo.com aussi, mais on passe par l'API de son application
// mobile plutôt que par ses pages — voir lib/jvcApi.js.
import GameScores from "../models/GameScores.js";
import { jvcGameScore } from "./jvcApi.js";

const DAY = 24 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Le temps qu'on laisse passer avant de redemander à une source.
//   • note trouvée + jeu vieux de 3 ans ou plus  -> plus jamais ;
//   • note trouvée + jeu de l'année              -> une fois par semaine ;
//   • note trouvée + entre les deux              -> une fois par mois ;
//   • rien trouvé                                -> on retente dans 3 semaines
//     (le jeu vient peut-être d'être référencé — mais ça ne presse pas).
function ttlOf(year, ok) {
  if (!ok) return 21 * DAY;
  if (year == null) return 30 * DAY;
  const age = new Date().getFullYear() - year;
  if (age >= 3) return Infinity;
  if (age <= 0) return 7 * DAY;
  return 30 * DAY;
}

// Le nom d'un jeu tel que Metacritic l'écrit dans ses URL.
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return res.text();
}

// ---------------------------------------------------------------------------
//  Les sources
// ---------------------------------------------------------------------------
// Chacune rend `{ score, max, count, url }`, ou null si elle ne sait pas.

/**
 * Metacritic — le metascore de la presse.
 *
 * La page est du Next.js illisible, MAIS elle embarque son résumé structuré
 * (`ratingValue` / `reviewCount`) pointant sur sa propre page de tests. On lit
 * CELUI-LÀ et pas un autre : la page cite aussi les notes des jeux voisins
 * (« vous aimerez aussi »), et prendre le premier nombre venu donnerait la note
 * d'un autre jeu.
 *
 * La note des joueurs n'est pas relevée : elle ne vit que dans la charge
 * différée de Next, derrière deux niveaux d'indirection qui changent à chaque
 * déploiement de leur site. Une note fausse vaut moins que pas de note.
 */
async function metacritic({ name }) {
  const slug = slugify(name);
  if (!slug) return null;
  const url = `https://www.metacritic.com/game/${slug}/`;
  const html = await getText(url);
  if (!html) return null;
  const re = new RegExp(
    `"ratingValue":\\s*([\\d.]+),"reviewCount":\\s*(\\d+),"url":"[^"]*/game/${slug}/critic-reviews`
  );
  const m = html.match(re);
  if (!m) return null;
  return { score: Math.round(Number(m[1])), max: 100, count: Number(m[2]), url };
}

/**
 * OpenCritic — la moyenne des tests, seconde lecture de la presse.
 *
 * Leur API publique est passée derrière RapidAPI : sans clé (OPENCRITIC_KEY
 * dans server/.env), la source se désactive d'elle-même au lieu de rendre des
 * échecs à la chaîne.
 */
async function opencritic({ name }) {
  const key = process.env.OPENCRITIC_KEY;
  if (!key) return null;
  const headers = {
    "x-rapidapi-key": key,
    "x-rapidapi-host": "opencritic-api.p.rapidapi.com",
  };
  const found = await fetch(
    `https://opencritic-api.p.rapidapi.com/game/search?criteria=${encodeURIComponent(name)}`,
    { headers }
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const best = Array.isArray(found) ? found[0] : null;
  if (!best?.id) return null;

  const game = await fetch(`https://opencritic-api.p.rapidapi.com/game/${best.id}`, { headers })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!game || game.topCriticScore == null || game.topCriticScore < 0) return null;
  return {
    score: Math.round(game.topCriticScore),
    max: 100,
    count: game.numReviews || null,
    url: `https://opencritic.com/game/${best.id}/${best.dist || ""}`,
  };
}

/**
 * IGN — la note d'un seul testeur, et c'est justement l'intérêt.
 *
 * Metacritic et OpenCritic moyennent des dizaines de tests : on y perd le
 * jugement au profit du consensus. IGN note en son nom, sur 10, et cette note
 * pèse dans la conversation autour d'un jeu. Les deux lectures se complètent.
 *
 * ⚠️ ON LIT LE RÉSUMÉ STRUCTURÉ (schema.org), PAS LA PAGE. Le corps est du
 * React rendu côté client, illisible et changeant ; le bloc JSON-LD, lui, est
 * stable et posé pour être lu par des machines :
 *
 *   "review":{"@type":"Review","reviewRating":{"@type":"Rating",
 *     "ratingValue":9,"bestRating":10,...},"author":{...,"name":"IGN"...}}
 *
 * L'ancre sur `"author"` … `"name":"IGN"` juste après la note n'est pas une
 * précaution de style : une page IGN cite aussi les tests des jeux voisins, et
 * prendre le premier `ratingValue` venu rendrait la note d'un autre jeu.
 *
 * La note peut avoir une décimale (8,7/10) : on ne l'arrondit PAS. Un 8,7
 * arrondi à 9 est une note qu'IGN n'a pas donnée.
 */
async function ign({ name }) {
  const slug = slugify(name);
  if (!slug) return null;
  const url = `https://www.ign.com/games/${slug}`;
  const html = await getText(url);
  if (!html) return null; // 404 : IGN ne connaît pas ce jeu sous ce nom

  const m = html.match(
    /"review":\{"@type":"Review","reviewRating":\{"@type":"Rating","ratingValue":([\d.]+),"bestRating":([\d.]+)[^}]*\}[^}]*,"author":\{[^}]*"name":"IGN"/
  );
  if (!m) return null; // page sans test signé IGN

  const score = Number(m[1]);
  const max = Number(m[2]) || 10;
  if (!Number.isFinite(score) || score <= 0) return null;
  // Une seule décimale : IGN n'en donne jamais deux, et le reste serait du
  // bruit de virgule flottante.
  return { score: Math.round(score * 10) / 10, max, count: 1, url };
}

export const SOURCES = {
  metacritic: { label: "Metacritic", fetch: metacritic },
  opencritic: { label: "OpenCritic", fetch: opencritic },
  ign: { label: "IGN", fetch: ign },
  // jeuxvideo.com : la note des LECTEURS, sur 20 (cf. lib/jvcApi.js). Pas de
  // scraping — le site bloque les serveurs — mais l'API de leur application.
  jvc: { label: "JVC lecteurs", fetch: jvcGameScore },
};

/**
 * Les notes extérieures d'un jeu, du cache quand il est bon, du web sinon.
 *
 * Rend toujours un tableau (vide au pire) : l'appelant n'a pas à gérer l'échec.
 * Les sources sont interrogées EN PARALLÈLE — une seule qui rame ne doit pas
 * retarder les autres — et une seule écriture range le tout.
 */
export async function ensureGameScores(gameId, { name, year } = {}) {
  const id = Number(gameId);
  if (!id) return [];

  const doc = await GameScores.findOne({ gameId: id }).lean();
  const known = new Map((doc?.sources || []).map((s) => [s.key, s]));
  const now = Date.now();

  const stale = Object.keys(SOURCES).filter((key) => {
    const hit = known.get(key);
    if (!hit) return true;
    const ttl = ttlOf(year ?? doc?.year ?? null, hit.ok);
    if (ttl === Infinity) return false;
    return now - new Date(hit.checkedAt).getTime() > ttl;
  });

  // Sans nom, aucune source ne peut chercher : on rend ce qu'on a en base.
  if (!name || !stale.length) return serialize(known);

  const fetched = await Promise.all(
    stale.map(async (key) => {
      try {
        const out = await SOURCES[key].fetch({ name, year, gameId: id });
        return { key, ...(out || {}), ok: !!out, checkedAt: new Date() };
      } catch {
        return { key, score: null, ok: false, checkedAt: new Date() };
      }
    })
  );
  for (const s of fetched) known.set(s.key, { max: 100, count: null, url: null, ...s });

  try {
    await GameScores.updateOne(
      { gameId: id },
      { $set: { name, year: year ?? null, sources: [...known.values()] } },
      { upsert: true }
    );
  } catch {
    /* le cache n'a pas pris : on rend quand même les notes trouvées */
  }
  return serialize(known);
}

// Ce qui part au client : les sources qui ONT une note, avec leur libellé.
// Les échecs restent en base (ils servent à ne pas retenter) mais n'ont rien à
// faire dans une rangée de pastilles.
function serialize(known) {
  return [...known.values()]
    .filter((s) => s.ok && s.score != null)
    .map((s) => ({
      key: s.key,
      label: SOURCES[s.key]?.label || s.key,
      score: s.score,
      max: s.max || 100,
      count: s.count ?? null,
      url: s.url || null,
    }));
}
