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

// ======================================================================
//  CHERCHER UNE SAGA, ET LUI PRENDRE SES IMAGES
// ======================================================================
// Sert au composeur de grilles de bingo (cf. routes/bingo.js) : on tape
// « Metroid », on obtient la licence, et de la licence ses visuels — Samus en
// armure pour la case « quelque chose Metroid ».
//
// ⚠️ ON CHERCHE DANS LES DEUX TIROIRS D'IGDB, franchises ET collections, pour
// la raison expliquée en tête de ce fichier : la même idée y est rangée tantôt
// dans l'un tantôt dans l'autre, et quelqu'un qui tape « Zelda » ne sait pas —
// n'a pas à savoir — dans lequel Zelda est tombé.
//
// Et surtout PAS `search "…"` : l'endpoint `search` d'IGDB ne couvre pas les
// franchises, et sur les collections il classe par pertinence globale plutôt
// que par nom. Un `where name ~ *"…"*` fait exactement ce qu'on demande.

const escapeQuotes = (s) => String(s).replace(/["\\]/g, "");

/** Les sagas dont le nom contient `q` — franchises et collections mêlées. */
/**
 * Les licences déduites des JEUX qui portent ce mot.
 *
 * Le filet des accents (cf. `searchSagas`). Deux requêtes : les jeux, puis les
 * licences les mieux élues — on a besoin de leur nom et de leur nombre de jeux
 * pour afficher la même ligne que la recherche directe.
 */
async function sagasFromGames(needle, limit) {
  const games =
    (await igdbQuery(
      "games",
      `search "${needle}"; fields name,franchises,collections,total_rating_count;` +
        ` where version_parent = null & game_type = 0; limit 40;`
    ).catch(() => [])) || [];
  if (!games.length) return [];

  // Le poids est plafonné : un seul jeu très noté ne doit pas élire à lui seul
  // une licence que personne d'autre ne porte.
  const score = new Map();
  for (const g of games) {
    const weight = 1 + Math.min(50, g.total_rating_count || 0);
    for (const id of g.franchises || [])
      score.set(`franchise:${id}`, (score.get(`franchise:${id}`) || 0) + weight);
    for (const id of g.collections || [])
      score.set(`collection:${id}`, (score.get(`collection:${id}`) || 0) + weight);
  }
  if (!score.size) return [];

  const top = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(limit, 8))
    .map(([key]) => key.split(":"));

  const byKind = { franchise: [], collection: [] };
  for (const [kind, id] of top) byKind[kind].push(Number(id));

  const ask = (endpoint, ids) =>
    ids.length
      ? igdbQuery(endpoint, `fields name,games; where id = (${ids.join(",")}); limit 10;`).catch(
          () => []
        )
      : Promise.resolve([]);

  const [franchises, collections] = await Promise.all([
    ask("franchises", byKind.franchise),
    ask("collections", byKind.collection),
  ]);

  const named = new Map();
  for (const [rows, kind] of [
    [franchises, "franchise"],
    [collections, "collection"],
  ]) {
    for (const r of rows || []) named.set(`${kind}:${r.id}`, { row: r, kind });
  }

  // On rend dans l'ordre des votes, pas dans celui d'IGDB : c'est le classement
  // qui fait tout l'intérêt de ce détour.
  return top
    .map(([kind, id]) => named.get(`${kind}:${id}`))
    .filter(Boolean)
    .map(({ row, kind }) => ({
      id: row.id,
      kind,
      name: row.name,
      gameCount: (row.games || []).length,
    }))
    .filter((s) => s.gameCount > 0);
}

export async function searchSagas(q, limit = 20) {
  const needle = escapeQuotes(String(q || "").trim());
  if (needle.length < 2) return [];

  const ask = (endpoint) =>
    igdbQuery(
      endpoint,
      `fields name,games; where name ~ *"${needle}"*; limit ${limit * 2};`
    ).catch(() => []);

  const [franchises, collections] = await Promise.all([ask("franchises"), ask("collections")]);

  const rows = [
    ...(franchises || []).map((f) => ({ ...f, kind: "franchise" })),
    ...(collections || []).map((c) => ({ ...c, kind: "collection" })),
  ];

  // Dédoublonnage par NOM : « Metroid » existe des deux côtés, et deux lignes
  // identiques dans une liste de résultats donnent l'impression d'un bug. On
  // garde celle qui porte le plus de jeux — c'est la mieux remplie, donc celle
  // qui donnera des images.
  const best = new Map();
  for (const r of rows) {
    const key = norm(r.name);
    if (!key) continue;
    const count = (r.games || []).length;
    const kept = best.get(key);
    if (!kept || count > kept.count) best.set(key, { row: r, count });
  }

  const needleNorm = norm(needle);
  const sagas = [...best.values()]
    // ⚠️ UNE SAGA SANS JEU N'EST PAS UNE SAGA, C'EST UNE LIGNE QUI DÉÇOIT.
    // IGDB est un catalogue contributif : il porte des collections vides créées
    // par erreur ou en double. Taper « pokemon » sans accent tombait pile
    // dessus — deux collections « pokemon » et « pokemon rom hack », zéro jeu
    // chacune — et la vraie licence « Pokémon », elle, ne sortait pas. On
    // ouvrait donc une saga vide en croyant ouvrir Pokémon.
    .filter(({ count }) => count > 0)
    .map(({ row, count }) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      gameCount: count,
    }))
    // Ce qu'on a tapé EN ENTIER d'abord, puis ce qui commence par, puis les
    // sagas les plus fournies. Taper « mario » doit rendre « Mario » avant
    // « Mario & Sonic aux Jeux olympiques ».
    .sort((a, b) => {
      const na = norm(a.name);
      const nb = norm(b.name);
      const score = (n) => (n === needleNorm ? 2 : n.startsWith(needleNorm) ? 1 : 0);
      const d = score(nb) - score(na);
      if (d) return d;
      return b.gameCount - a.gameCount;
    })
    .slice(0, limit);

  // ⚠️ LE REPLI SUR LES JEUX, ET SEULEMENT EN REPLI. « Ace Attorney » rend
  // trois licences — c'est la bonne réponse, et y ajouter les vingt jeux de la
  // série noierait exactement ce qu'on cherchait. Mais « Katana Zero » n'est la
  // licence de rien du tout : sans ce repli, la recherche répond « aucun
  // résultat » sur un jeu qui existe, et on croit l'application cassée.
  //
  // On ne mélange donc pas les deux : on descend d'un cran quand l'étage du
  // dessus est vide.
  if (sagas.length) return sagas;

  // ⚠️ AVANT DE DESCENDRE, UN DÉTOUR PAR LES ACCENTS. La recherche par nom
  // d'IGDB (`name ~ *"..."*`) est un « contient » brut : « pokemon » n'y
  // rencontre jamais « Pokémon », et l'utilisateur qui tape sans accent —
  // c'est-à-dire à peu près tout le monde sur un clavier de téléphone —
  // n'obtenait rien de la plus grosse licence du catalogue.
  //
  // La recherche de JEUX, elle, est floue et se moque des accents. On lui
  // demande donc les jeux qui portent ce mot, et on remonte à leurs licences.
  // Chaque jeu vote pour les siennes, pondéré par sa notoriété : sans ce poids,
  // vingt ROM hacks amateurs pèseraient plus lourd que Pokémon Rouge.
  const derived = await sagasFromGames(needle, limit);
  if (derived.length) return derived;

  const games =
    (await igdbQuery(
      "games",
      `search "${needle}"; fields name,first_release_date,total_rating_count;` +
        ` where version_parent = null & game_type = 0; limit ${limit};`
    ).catch(() => [])) || [];

  return games.map((g) => ({
    id: g.id,
    kind: "game",
    name: g.name,
    // Un jeu n'a pas de « nombre de jeux » : la liste n'affiche donc rien à
    // droite de son nom, et c'est ce qui le distingue d'une licence.
    gameCount: 0,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : null,
  }));
}

/**
 * Les visuels d'une saga, prêts à devenir des fonds de case.
 *
 * ⚠️ LES ARTWORKS AVANT LES CAPTURES, ET LES JAQUETTES EN DERNIER. Une case de
 * bingo est un carré de 90 pixels de côté sur lequel on pose du texte : il lui
 * faut une image DESSINÉE pour être un fond — un artwork, justement — pas une
 * capture d'écran d'inventaire ni une jaquette dont les trois quarts sont le
 * titre du jeu. Les jaquettes restent en dernier recours parce que certains
 * jeux n'ont que ça.
 */
// ⚠️ POURQUOI LA SAGA POKÉMON ÉTAIT PLEINE DE SUPER SMASH BROS.
//
// Ce n'est pas une erreur d'IGDB : Smash Bros porte VRAIMENT la licence
// Pokémon, puisque Pikachu y joue. Il porte aussi Mario, Zelda, Metroid, Fire
// Emblem, Street Fighter… Super Smash Bros. Ultimate est rattaché à 27
// licences. Et comme le tri se fait par notoriété et que Smash est un des jeux
// les mieux notés du catalogue, il raflait les premières places de CHACUNE de
// ces vingt-sept sagas.
//
// Le repère est donc le nombre de licences que porte le jeu : les vrais jeux
// Pokémon en portent UNE, les crossovers en portent douze à vingt-sept.
//
// ⚠️ MAIS ON NE LES JETTE PAS AVEUGLÉMENT. Quelqu'un qui ouvre la saga « Super
// Smash Bros. » veut précisément ces jeux-là — et ils sont crossovers par
// nature. On ne retire donc les crossovers QUE s'il reste de quoi remplir la
// grille sans eux ; sinon c'est qu'on est justement dans leur saga.
const CROSSOVER_FRANCHISES = 5;
const ENOUGH_WITHOUT = 6;

function withoutCrossovers(rows, kind) {
  if (kind === "game") return rows;
  const core = rows.filter((g) => (g.franchises || []).length < CROSSOVER_FRANCHISES);
  return core.length >= ENOUGH_WITHOUT ? core : rows;
}

/** Le nom de la saga, qu'on ne reçoit pas : la route ne connaît que son id. */
async function sagaTitle(kind, id) {
  const endpoint = kind === "collection" ? "collections" : "franchises";
  const rows = await igdbQuery(endpoint, `fields name; where id = ${id}; limit 1;`).catch(() => []);
  return rows?.[0]?.name || null;
}

// ⚠️ « COMMENCE PAR », PAS « CONTIENT ». « Mario » contenu attraperait « Dr.
// Robotnik contre Mario » ; « Mario »* attrape les jeux Mario. Et pas en
// dessous de quatre lettres : un préfixe de trois caractères ramasse la moitié
// du catalogue.
const MIN_TITLE = 4;

async function gamesNamedLike(name, FIELDS) {
  const clean = escapeQuotes(String(name || "").trim());
  if (clean.length < MIN_TITLE) return [];
  return (
    (await igdbQuery(
      "games",
      `${FIELDS} where name ~ "${clean}"* & version_parent = null;` +
        ` sort total_rating_count desc; limit 20;`
    ).catch(() => [])) || []
  );
}

export async function sagaImages(kind, id, limit = 60) {
  const FIELDS =
    "fields name,first_release_date,total_rating_count,franchises,collections," +
    "cover.image_id,artworks.image_id,screenshots.image_id;";
  // ⚠️ « game » N'EST PAS UNE LICENCE D'UN SEUL JEU, C'EST UN AUTRE `where`.
  // Le repli de `searchSagas` peut rendre un jeu isolé (« Katana Zero ») ; on
  // interroge alors ce jeu-là, pas une franchise qui n'existe pas — sans ce
  // branchement, `franchises = (427520)` cherche la franchise numéro 427520 et
  // rend une liste vide, sans erreur, ce qui est le pire des deux mondes.
  const where =
    kind === "game"
      ? `where id = ${id};`
      : `where ${kind === "collection" ? "collections" : "franchises"} = (${id}) & version_parent = null;`;

  // ⚠️ ET LE JEU QUI DONNE SON NOM À LA SAGA N'EST SOUVENT PAS DEDANS.
  // Constaté sur Marvel Rivals : la collection « Marvel Rivals » d'IGDB ne
  // contient QUE les trois fiches de saison (cinq artworks à elles toutes), et
  // pas le jeu lui-même — qui est rangé sous la franchise « Marvel » et porte,
  // lui, vingt-et-un artworks et sa jaquette. On ouvrait donc la saga sur cinq
  // visuels de bandeaux de saison, sans une seule image du jeu.
  //
  // On complète donc par le NOM : les jeux dont le titre commence par celui de
  // la saga en font partie, quoi qu'en dise le rangement d'IGDB. C'est aussi la
  // convention de nommage du catalogue (« Marvel Rivals: Season 2 »), donc
  // c'est sans surprise.
  const [rows, byName] = await Promise.all([
    igdbQuery("games", `${FIELDS} ${where} sort total_rating_count desc; limit 60;`).catch(() => []),
    gamesNamedLike(kind === "game" ? null : await sagaTitle(kind, id), FIELDS),
  ]);

  const merged = [...(rows || [])];
  const known = new Set(merged.map((g) => g.id));
  for (const g of byName) if (!known.has(g.id)) merged.push(g);

  const out = [];
  const games = withoutCrossovers(merged, kind);
  const seen = new Set();
  const push = (imageId, game, size, thumbSize, cap) => {
    if (!imageId || seen.has(imageId) || out.length >= cap) return;
    seen.add(imageId);
    out.push({
      id: imageId,
      url: `${IMG_BASE}/t_${size}/${imageId}.jpg`,
      thumb: `${IMG_BASE}/t_${thumbSize}/${imageId}.jpg`,
      gameId: game.id,
      gameName: game.name || "",
    });
  };

  // Trois paniers plutôt qu'un tri : on veut TOUS les artworks de la saga avant
  // la première capture, pas les artworks de chaque jeu à la suite.
  const art = [];
  const shots = [];
  const covers = [];
  for (const g of games) {
    for (const a of g.artworks || []) art.push([a.image_id, g, "720p", "screenshot_med"]);
    for (const sc of g.screenshots || []) shots.push([sc.image_id, g, "720p", "screenshot_med"]);
    if (g.cover?.image_id) covers.push([g.cover.image_id, g, "cover_big", "cover_small"]);
  }

  // ⚠️ ON RÉSERVE DE LA PLACE AUX JAQUETTES, SINON ELLES N'ARRIVENT JAMAIS.
  // Les jaquettes passent en dernier — un carré de 90 pixels dont les trois
  // quarts sont le titre du jeu fait un mauvais fond de case — mais « en
  // dernier » voulait dire « jamais » : une saga un peu fournie remplit les
  // soixante places en artworks et captures avant d'y arriver, et on se
  // retrouvait sans une seule jaquette dans la grille alors que c'est parfois
  // exactement l'image qu'on cherche.
  //
  // La réserve ne coûte rien quand il n'y a pas de jaquette à mettre dedans :
  // elle est plafonnée par leur nombre réel.
  const COVER_RESERVE = 14;
  const reserve = Math.min(COVER_RESERVE, covers.length);
  const bulkCap = Math.max(0, limit - reserve);

  for (const e of art) push(e[0], e[1], e[2], e[3], bulkCap);
  for (const e of shots) push(e[0], e[1], e[2], e[3], bulkCap);
  for (const e of covers) push(e[0], e[1], e[2], e[3], limit);

  return out.slice(0, limit);
}
