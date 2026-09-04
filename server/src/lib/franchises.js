// ======================================================================
//  Les licences d'un jeu — au pluriel, et dans le bon ordre
// ======================================================================
//
// LE BUG QUE CE FICHIER RÈGLE. La fiche annonçait « Saga <nom> » en prenant
// `franchises[0]`, c'est-à-dire le PREMIER de la liste qu'IGDB renvoie — un
// ordre d'identifiants, qui ne veut rien dire. Super Smash Bros. Ultimate est
// rangé chez IGDB dans Metroid, Zelda, Kirby, Fire Emblem… autant que dans la
// sienne : la fiche affichait « Saga Metroid » sous Smash Bros.
//
// Un jeu de crossover appartient VRAIMENT à toutes ces licences. On arrête
// donc d'en choisir une au hasard : on les rend toutes, la plus probable en
// tête — celle dont le nom se retrouve dans le titre du jeu.

import { igdbQuery } from "./igdb.js";
import { createTtlCache } from "./ttlCache.js";

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

// « Super Smash Bros. Ultimate » et « Super Smash Bros. » doivent se
// reconnaître : on met à plat la ponctuation, les accents et la casse.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * À quel point cette licence explique CE titre-là.
 *
 * 5 : le titre EST la licence ; 4 : il commence par elle (« Zelda: … ») ;
 * 3 : elle y apparaît en entier ; 2 : tous ses mots y sont, dispersés ;
 * 0 : rien — le jeu y est rangé, mais son nom n'en dit rien (les crossovers).
 */
export function franchiseScore(franchiseName, gameName) {
  const n = norm(franchiseName);
  const t = norm(gameName);
  if (!n || !t) return 0;
  if (t === n) return 5;
  if (t.startsWith(`${n} `)) return 4;
  if (t.includes(` ${n} `) || t.endsWith(` ${n}`)) return 3;
  const words = n.split(" ").filter(Boolean);
  if (words.length && words.every((w) => t.includes(w))) return 2;
  return 0;
}

/**
 * Toutes les licences d'un jeu, dédoublonnées, la plus pertinente d'abord.
 *
 * IGDB range la même idée dans deux tiroirs : `franchises` (la licence) et
 * `collections` (la série). On les fond ici — l'un comme l'autre répond à
 * « de quoi ce jeu fait-il partie ? » —, mais on garde le tiroir d'origine
 * dans `kind` : c'est lui qui dira plus tard comment interroger IGDB.
 */
export function franchisesOf(g) {
  const out = [];
  const seen = new Set();
  for (const [kind, arr] of [
    ["franchise", g?.franchises],
    ["collection", g?.collections],
  ]) {
    for (const f of arr || []) {
      const name = String(f?.name || "").trim();
      if (!name || !f?.id) continue;
      const key = norm(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: f.id, kind, name, score: franchiseScore(name, g?.name) });
    }
  }
  // Tri STABLE : à score égal, l'ordre d'IGDB est conservé (`franchises`
  // avant `collections`, ce qui est le bon ordre par défaut).
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.score - a.f.score || a.i - b.i)
    .map(({ f }) => f);
}

/** Le nom à écrire sous le titre : la licence la plus probable, ou null. */
export function mainFranchise(g) {
  return franchisesOf(g)[0]?.name || null;
}

// ======================================================================
//  Les jaquettes des licences
// ======================================================================
// Une licence IGDB n'a PAS d'image à elle : c'est une étiquette, un nom et un
// identifiant. Pour en faire une carte qu'on a envie de toucher, on lui
// emprunte la jaquette de son jeu le mieux noté — celui auquel on pense quand
// on entend le nom de la série.
//
// Une licence ne change pas d'un jour à l'autre : 24 h de cache, et une seule
// requête IGDB pour toutes les licences d'un même tiroir.

const covers = createTtlCache({ name: "igdb:franchise-covers", max: 800, ttl: 24 * 60 * 60 * 1000 });

const REP_FIELDS = "fields name,cover.image_id,total_rating,total_rating_count,franchises,collections";

/**
 * Pour chaque licence : sa jaquette de tête et combien de jeux elle contient.
 *
 * `list` : ce que rend `franchisesOf`. On regroupe par tiroir pour ne poser
 * que deux questions à IGDB — une pour les franchises, une pour les séries —
 * quel que soit le nombre de licences.
 */
export async function decorateFranchises(list) {
  const todo = list.filter((f) => covers.get(`${f.kind}:${f.id}`) === undefined);

  for (const kind of ["franchise", "collection"]) {
    const ids = todo.filter((f) => f.kind === kind).map((f) => f.id);
    if (!ids.length) continue;
    const field = kind === "franchise" ? "franchises" : "collections";
    let rows = [];
    try {
      rows =
        (await igdbQuery(
          "games",
          `${REP_FIELDS}; where ${field} = (${ids.join(",")}) & cover != null & version_parent = null;` +
            ` sort total_rating_count desc; limit 500;`
        )) || [];
    } catch {
      rows = [];
    }
    // Un jeu peut appartenir à plusieurs des licences demandées : il compte
    // pour chacune. La première ligne rencontrée est la mieux notée (le tri
    // vient d'IGDB), donc la première jaquette est la bonne.
    const bucket = new Map(ids.map((id) => [id, { cover: null, count: 0 }]));
    for (const row of rows) {
      for (const f of row[field] || []) {
        const id = typeof f === "number" ? f : f?.id;
        const slot = bucket.get(id);
        if (!slot) continue;
        slot.count += 1;
        if (!slot.cover && row.cover?.image_id) {
          slot.cover = `${IMG_BASE}/t_cover_big/${row.cover.image_id}.jpg`;
        }
      }
    }
    for (const [id, slot] of bucket) covers.set(`${kind}:${id}`, slot);
  }

  return list.map((f) => {
    const slot = covers.get(`${f.kind}:${f.id}`) || { cover: null, count: 0 };
    return { id: f.id, kind: f.kind, name: f.name, cover: slot.cover, count: slot.count };
  });
}

/**
 * Tous les jeux d'une licence, pour sa page.
 *
 * Mêmes garde-fous que la saga de la fiche (cf. lib/gameIgdb.js) : on écarte
 * les « versions de » (éditions, rééditions) qui feraient dix fois le même jeu
 * dans la grille, et on exige une jaquette — une case grise dans une grille de
 * jaquettes n'aide personne à retrouver un jeu.
 */
export async function franchiseGames(kind, id) {
  const field = kind === "collection" ? "collections" : "franchises";
  const rows =
    (await igdbQuery(
      "games",
      `fields name,cover.image_id,total_rating,first_release_date,game_type,platforms.name,platforms.abbreviation;` +
        ` where ${field} = (${id}) & version_parent = null & cover != null;` +
        ` sort first_release_date desc; limit 500;`
    )) || [];
  return rows;
}

/** Le nom d'une licence, depuis son identifiant. */
export async function franchiseName(kind, id) {
  const endpoint = kind === "collection" ? "collections" : "franchises";
  const rows = await igdbQuery(endpoint, `fields name; where id = ${id};`).catch(() => []);
  return rows?.[0]?.name || null;
}
