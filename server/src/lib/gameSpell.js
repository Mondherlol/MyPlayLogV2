// ======================================================================
//  « Vouliez-vous dire… » — la faute de frappe rattrapée à la main
// ======================================================================
//
// IGDB cherche AU CARACTÈRE PRÈS. Le catalogue interroge `name ~ *"…"*` (une
// sous-chaîne exacte) et sa commande `search` n'est pas plus indulgente : les
// deux rendent zéro résultat pour « minecrft », « zeldda » ou « god of ward »
// — vérifié, une réponse vide dans les deux cas. Rien, côté IGDB, ne permet de
// chercher « à peu près » : ni paramètre de tolérance, ni suggestion.
//
// Alors on garde la liste des titres chez nous (src/data/game-titles.json,
// produite par scripts/buildGameTitles.js) et, quand une recherche ne rend
// rien, on y cherche le titre le plus proche. Ce n'est jamais imposé : c'est
// une proposition, la recherche tapée reste celle qui a été faite.
//
// Deux façons d'être « proche », dans cet ordre :
//   1. LE MÊME MOT, ÉCRIT AUTREMENT — « okami » pour « Ōkami », « pokemon
//      rouge » pour « Pokémon Rouge ». Accents, ponctuation et casse mis à
//      plat, c'est le même texte : correspondance exacte, rien à calculer.
//   2. À QUELQUES LETTRES PRÈS — distance de Damerau-Levenshtein, qui compte
//      l'ajout, la suppression, le remplacement ET l'inversion de deux lettres
//      voisines (« minecarft ») : la faute de frappe la plus courante au
//      clavier, et la seule que Levenshtein tout seul facture double.
//
// Le titre proposé est TOUJOURS un titre principal, même quand c'est une
// variante (VF, acronyme, nom japonais) qui a permis de le reconnaître : c'est
// celui dont on sait qu'il ressortira quelque chose une fois renvoyé à IGDB.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTtlCache } from "./ttlCache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "../data/game-titles.json");

// La longueur en dessous de laquelle on se tait : à trois lettres, tout est à
// distance 1 de tout, et « proposer » reviendrait à tirer au sort.
const MIN_LEN = 4;

/**
 * Le texte réduit à ce qui compte pour comparer deux titres : lettres et
 * chiffres. « Pokémon : Rouge Feu » et « pokemon rouge feu » deviennent le
 * même mot — ce qui règle à lui seul le cas de l'accent oublié, sans avoir
 * besoin de la moindre distance.
 */
export function normalizeTitle(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // les accents, décollés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// --- Le lexique -----------------------------------------------------------
// Chargé à la première recherche infructueuse, pas au démarrage : un serveur
// qui redémarre n'a pas à lire un mégaoctet de titres pour rien.

let lexicon = null; // { names, entries, exact }
let loadFailed = false;

function load() {
  if (lexicon || loadFailed) return lexicon;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const names = raw.names || [];
    // Une entrée = une façon d'écrire un jeu (titre principal ou variante),
    // mise à plat, avec l'index du titre à proposer si on la reconnaît.
    const entries = [];
    // Les correspondances parfaites, à part : c'est une consultation de table,
    // pas un parcours.
    const exact = new Map();

    const add = (text, nameIndex, primary) => {
      const norm = normalizeTitle(text);
      if (norm.length < MIN_LEN) return;
      // `primary` : cette écriture est le titre lui-même, pas une variante. À
      // distance égale, c'est elle qui l'emporte — un jeu dont le TITRE
      // ressemble à ce qui a été tapé est une meilleure proposition qu'un jeu
      // reconnu par un de ses autres noms.
      entries.push({ norm, len: norm.length, i: nameIndex, primary });
      const prev = exact.get(norm);
      // À égalité d'écriture, le jeu le plus connu gagne : « doom » doit
      // proposer Doom, pas le jeu amateur qui porte le même nom.
      if (prev === undefined || (names[nameIndex]?.[1] || 0) > (names[prev]?.[1] || 0)) {
        exact.set(norm, nameIndex);
      }
    };

    names.forEach(([name], i) => add(name, i, true));
    for (const [alt, i] of raw.alts || []) add(alt, i, false);

    lexicon = { names, entries, exact };
    console.log(
      `[gameSpell] lexique chargé : ${names.length} titres, ${entries.length} écritures (${raw.builtAt || "?"})`
    );
  } catch (err) {
    // Pas de fichier = pas de suggestion, et rien d'autre ne change. C'est le
    // cas d'un déploiement où le lexique n'a pas encore été construit : la
    // recherche doit continuer de marcher exactement comme avant.
    loadFailed = true;
    console.warn(
      `[gameSpell] lexique indisponible (${err.code || err.message}) : pas de suggestion.`
    );
  }
  return lexicon;
}

/** Combien de lettres de travers on accepte, selon la longueur tapée. */
function tolerance(len) {
  if (len < 6) return 1;
  if (len < 12) return 2;
  return 3;
}

/**
 * Damerau-Levenshtein, en bande diagonale et avec abandon anticipé.
 *
 * On ne calcule que la bande de largeur `max` autour de la diagonale : au-delà,
 * la distance dépasse forcément le seuil, donc sa valeur exacte ne nous
 * intéresse plus. Et dès qu'une ligne entière dépasse `max`, c'est perdu : on
 * rend `max + 1` sans finir. C'est ce qui rend tenable le parcours de dizaines
 * de milliers de titres à chaque recherche vide.
 */
function distance(a, b, max) {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;

  // Trois lignes qui tournent : i-2 (pour l'inversion), i-1, et celle en cours.
  let prev2 = new Array(m + 1).fill(max + 1);
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const from = Math.max(1, i - max);
    const to = Math.min(m, i + max);
    // Les deux cases qui bordent la bande : mises hors d'atteinte pour que la
    // ligne suivante ne lise pas un reste de calcul.
    if (from > 1) cur[from - 1] = max + 1;
    if (to < m) cur[to + 1] = max + 1;

    let best = max + 1;
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(
        cur[j - 1] + 1, // insertion
        prev[j] + 1, // suppression
        prev[j - 1] + cost // remplacement
      );
      // L'inversion de deux lettres voisines : une faute, pas deux.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      cur[j] = d;
      if (d < best) best = d;
    }
    if (best > max) return max + 1; // la ligne entière a décroché

    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[m];
}

// Une même faute revient : dix personnes tapent « minecrft » dans la même
// heure — et une frappe, c'est une recherche PAR LETTRE, donc « m », « mi »,
// « min »… autant de requêtes vides à corriger. On garde les réponses.
const cache = createTtlCache({ name: "games:spell", max: 500, ttl: 60 * 60 * 1000 });

/**
 * Les titres les plus proches de ce qui a été tapé, du plus proche au moins
 * proche. Tableau vide s'il n'y a rien de crédible : mieux vaut ne rien
 * proposer qu'envoyer quelqu'un vers un jeu qu'il ne cherchait pas.
 */
export function suggestTitles(query, count = 1) {
  const typed = String(query || "").trim();
  const q = normalizeTitle(typed);
  if (q.length < MIN_LEN) return [];

  const hit = cache.get(q);
  if (hit) return hit.slice(0, count);

  const lex = load();
  if (!lex) return [];

  const out = [];
  const push = (name) => {
    // Proposer mot pour mot ce qui vient d'être tapé n'aide personne.
    if (name !== typed && !out.includes(name)) out.push(name);
  };

  const direct = lex.exact.get(q);
  if (direct !== undefined) push(lex.names[direct][0]);

  const max = tolerance(q.length);
  const found = new Map(); // index du titre -> { d, primary } le meilleur trouvé
  for (const e of lex.entries) {
    if (Math.abs(e.len - q.length) > max) continue;
    const d = distance(q, e.norm, max);
    if (d > max) continue;
    const prev = found.get(e.i);
    if (!prev || d < prev.d || (d === prev.d && e.primary)) {
      found.set(e.i, { d, primary: !!e.primary });
    }
  }

  [...found]
    .map(([i, r]) => ({ name: lex.names[i][0], ...r, pop: lex.names[i][1] || 0 }))
    // À distance égale : le titre reconnu directement avant celui reconnu par
    // une variante, puis le jeu que les gens connaissent — une faute de frappe
    // vise presque toujours le titre populaire, pas son homonyme confidentiel.
    .sort(
      (a, b) =>
        a.d - b.d ||
        Number(b.primary) - Number(a.primary) ||
        b.pop - a.pop ||
        a.name.length - b.name.length
    )
    .slice(0, 8)
    .forEach((r) => push(r.name));

  const top = out.slice(0, 3);
  cache.set(q, top);
  return top.slice(0, count);
}

/** Le meilleur candidat, ou null. */
export function suggestTitle(query) {
  return suggestTitles(query, 1)[0] || null;
}
