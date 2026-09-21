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
//  L'image d'une licence : QUEL JEU la represente
// ======================================================================
// Une licence IGDB n'a PAS d'image a elle : c'est une etiquette, un nom et un
// identifiant. Pour en faire une carte qu'on a envie de toucher, elle emprunte
// l'image d'un de ses jeux. Reste a savoir LEQUEL -- et la reponse evidente,
// « le mieux note », donne un resultat absurde.
//
// ATTENTION, LE BUG QUE CE BLOC REGLE, VU SUR MARVEL'S WOLVERINE. La fiche
// affiche quatre licences : Marvel, Wolverine, X-Men, Marvel's Spider-Man. On
// prenait pour chacune la jaquette de son jeu le mieux note -- mais un meme jeu
// appartient a plusieurs de ces licences a la fois : Marvel's Spider-Man est le
// mieux note de « Marvel » ET de « Marvel's Spider-Man », LEGO Marvel Super
// Heroes celui de « X-Men » ET de « Wolverine ». On obtenait donc quatre cartes
// pour deux images, dont aucune ne parlait de sa licence : la carte Wolverine
// montrait du LEGO.
//
// Trois regles, dans cet ordre :
//
//  1. LE NOM DU JEU DOIT PARLER DE LA LICENCE. C'est le meme bareme que celui
//     qui choisit la licence a ecrire sous un titre (`franchiseScore`) :
//     « X-Men Origins: Wolverine » represente Wolverine, « LEGO Marvel Super
//     Heroes » ne represente ni Wolverine ni X-Men, quoi qu'en dise le
//     rangement d'IGDB.
//  2. DEUX CARTES NE PARTAGENT JAMAIS UNE IMAGE. L'attribution est donc faite
//     pour TOUT LE LOT d'un coup, et les licences les plus etroites servent en
//     premier : Wolverine a dix jeux ou puiser, Marvel en a mille -- c'est
//     Wolverine qui doit choisir d'abord, sinon Marvel lui prend le sien.
//  3. UNE IMAGE DE COUVERTURE, PAS UNE JAQUETTE. La carte est un PAYSAGE :
//     une jaquette portrait y etait recadree dans sa largeur, donc reduite a
//     une bande du milieu. On prend l'artwork du jeu, sa capture a defaut, et
//     la jaquette seulement s'il n'a rien d'autre.
//
// ATTENTION, LE CACHE PORTE LES CANDIDATS, PAS LE CHOIX. Le choix depend des
// AUTRES licences presentes sur la fiche (regle 2) : le garder tel quel ferait
// ressortir, sur un autre jeu, l'image attribuee ailleurs -- et les doublons
// avec elle. Ce qui se garde, c'est ce qui coute cher : les listes de candidats
// (24 h) et les images d'un jeu (24 h).

const reps = createTtlCache({ name: "igdb:franchise-reps", max: 800, ttl: 24 * 60 * 60 * 1000 });
const gameArt = createTtlCache({ name: "igdb:game-art", max: 1500, ttl: 24 * 60 * 60 * 1000 });

const REP_FIELDS =
  "fields name,cover.image_id,game_type,total_rating,total_rating_count,franchises,collections";

// Au-dela, on ne pioche plus : les candidats arrivent tries par notoriete, et
// le vingt-cinquieme jeu d'une licence n'a aucune chance d'etre choisi.
const MAX_CANDIDATES = 24;

// A partir de combien de licences un jeu est un crossover -- le meme repere que
// pour les visuels de saga, plus bas.
const CROSSOVER = 5;

const repKey = (f) => `${f.kind}:${f.id}`;

/**
 * Les candidats de chaque licence : ses jeux, du plus connu au moins connu.
 *
 * Une seule question a IGDB par tiroir, quel que soit le nombre de licences.
 */
async function loadCandidates(list) {
  const todo = list.filter((f) => reps.get(repKey(f)) === undefined);
  if (!todo.length) return;

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

    const bucket = new Map(ids.map((id) => [id, { count: 0, games: [] }]));
    for (const row of rows) {
      for (const f of row[field] || []) {
        const id = typeof f === "number" ? f : f?.id;
        const slot = bucket.get(id);
        if (!slot) continue;
        // Le compte, lui, voit TOUS les jeux : c'est le « 42 jeux » de la carte.
        slot.count += 1;
        if (slot.games.length >= MAX_CANDIDATES) continue;
        slot.games.push({
          id: row.id,
          name: row.name || "",
          cover: row.cover?.image_id || null,
          // Combien d'univers ce jeu porte : c'est ce qui distingue un jeu
          // Wolverine d'un crossover ou Wolverine passe faire coucou.
          spread: (row.franchises || []).length + (row.collections || []).length,
          // Un jeu principal, pas un DLC ni une compilation : on prefere
          // « Marvel's Spider-Man » a « Marvel's Spider-Man: Turf Wars ».
          main: row.game_type === 0,
        });
      }
    }
    for (const [id, slot] of bucket) reps.set(`${kind}:${id}`, slot);
  }
}

/**
 * Le jeu qui represente le mieux cette licence, parmi ceux qu'on n'a pas deja
 * donnes a une autre.
 */
function bestFor(f, taken, exclude) {
  const slot = reps.get(repKey(f)) || { count: 0, games: [] };
  const ranked = slot.games
    .map((g, i) => ({ g, i, title: franchiseScore(f.name, g.name) }))
    .sort((a, b) => {
      // 1. Le titre parle-t-il de la licence ?
      if (a.title !== b.title) return b.title - a.title;
      // 2. Un vrai jeu avant un DLC ou une compilation.
      if (a.g.main !== b.g.main) return a.g.main ? -1 : 1;
      // 3. Un jeu centre sur son univers avant un crossover : c'est la
      //    difference entre « un jeu Wolverine » et « un jeu ou il y a
      //    Wolverine ».
      const ca = a.g.spread >= CROSSOVER;
      const cb = b.g.spread >= CROSSOVER;
      if (ca !== cb) return ca ? 1 : -1;
      // 4. A egalite, le plus connu (l'ordre d'IGDB).
      return a.i - b.i;
    });

  // ATTENTION, TROIS PASSES, DE LA PLUS EXIGEANTE A LA PLUS RESIGNEE. Une
  // licence qui n'a qu'un seul jeu ne doit pas se retrouver SANS image parce
  // que sa voisine le lui a pris : mieux vaut un doublon qu'une carte grise.
  return (
    ranked.find((c) => !taken.has(c.g.id) && c.g.id !== exclude)?.g ||
    ranked.find((c) => !taken.has(c.g.id))?.g ||
    ranked[0]?.g ||
    null
  );
}

/**
 * Les images d'un lot de jeux : artwork, capture, jaquette.
 *
 * Une seule requete pour tout le lot, et le resultat se garde par jeu -- deux
 * fiches voisines demandent souvent les memes.
 */
async function loadArt(ids) {
  const todo = ids.filter((id) => gameArt.get(`game:${id}`) === undefined);
  if (!todo.length) return;
  let rows = [];
  try {
    rows =
      (await igdbQuery(
        "games",
        `fields artworks.image_id,screenshots.image_id,cover.image_id;` +
          ` where id = (${todo.join(",")}); limit ${todo.length};`
      )) || [];
  } catch {
    rows = [];
  }
  const found = new Set();
  for (const row of rows) {
    found.add(row.id);
    // L'artwork d'abord : c'est une image DESSINEE pour etre un fond. La
    // capture ensuite. La jaquette en dernier -- sur une carte paysage, elle
    // n'est qu'une bande recadree au milieu d'une affiche.
    const wide = row.artworks?.[0]?.image_id || row.screenshots?.[0]?.image_id || null;
    gameArt.set(`game:${row.id}`, {
      art: wide ? `${IMG_BASE}/t_720p/${wide}.jpg` : null,
      cover: row.cover?.image_id ? `${IMG_BASE}/t_cover_big/${row.cover.image_id}.jpg` : null,
    });
  }
  // Un jeu qui n'a rien rendu ne doit pas etre redemande a chaque ouverture de
  // la fiche : on retient l'absence aussi.
  for (const id of todo) if (!found.has(id)) gameArt.set(`game:${id}`, { art: null, cover: null });
}

/**
 * Pour chaque licence : son image, et combien de jeux elle contient.
 *
 * `list` : ce que rend `franchisesOf`. `exclude` : le jeu d'ou l'on vient -- sa
 * propre fiche affiche deja son decor en grand, le revoir en vignette juste en
 * dessous n'apprend rien. Il reste utilisable en dernier recours.
 */
export async function decorateFranchises(list, { exclude = null } = {}) {
  await loadCandidates(list);

  // ATTENTION, LES LICENCES ETROITES CHOISISSENT EN PREMIER. Sans cet ordre,
  // « Marvel » -- mille jeux, donc mille choix possibles -- raflait le seul jeu
  // que « Wolverine » pouvait montrer.
  const order = [...list].sort(
    (a, b) => (reps.get(repKey(a))?.count || 0) - (reps.get(repKey(b))?.count || 0)
  );

  const taken = new Set();
  const picked = new Map();
  for (const f of order) {
    const game = bestFor(f, taken, exclude);
    if (game) {
      taken.add(game.id);
      picked.set(repKey(f), game);
    }
  }

  await loadArt([...new Set([...picked.values()].map((g) => g.id))]);

  // On rend dans l'ordre recu : c'est celui de la pertinence pour CE jeu-la
  // (cf. `franchisesOf`), et l'attribution ci-dessus n'avait rien a y changer.
  return list.map((f) => {
    const slot = reps.get(repKey(f)) || { count: 0 };
    const game = picked.get(repKey(f));
    const art = game ? gameArt.get(`game:${game.id}`) : null;
    return {
      id: f.id,
      kind: f.kind,
      name: f.name,
      // ATTENTION, DEUX IMAGES, ET ELLES NE SE REMPLACENT PAS. `art` est le
      // paysage de la carte ; `cover` reste la jaquette portrait, parce que la
      // page d'une licence en fait le premier carreau de son mur de jaquettes
      // -- un paysage y serait le seul cadre de travers.
      art: art?.art || null,
      cover:
        art?.cover || (game?.cover ? `${IMG_BASE}/t_cover_big/${game.cover}.jpg` : null),
      count: slot.count || 0,
    };
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
