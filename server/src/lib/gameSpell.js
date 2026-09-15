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

    // Le VOCABULAIRE : chaque mot des titres et de leurs variantes, avec la
    // popularité du jeu le plus connu qui le porte. C'est lui qui corrige mot
    // par mot (cf. `correctQuery`) — et qui sait dire qu'un mot tapé EXISTE.
    const words = new Map();
    const addWords = (text, nameIndex) => {
      const pop = names[nameIndex]?.[1] || 0;
      for (const w of normalizeTitle(text).split(" ")) {
        if (w && (words.get(w) ?? -1) < pop) words.set(w, pop);
      }
    };
    names.forEach(([name], i) => addWords(name, i));
    for (const [alt, i] of raw.alts || []) addWords(alt, i);
    // Rangés par longueur : une faute ne déplace la longueur que de une ou deux
    // lettres, inutile de comparer le reste du vocabulaire.
    const wordsByLen = new Map();
    for (const [w, pop] of words) {
      if (!wordsByLen.has(w.length)) wordsByLen.set(w.length, []);
      wordsByLen.get(w.length).push([w, pop]);
    }

    // Les ACCENTS des titres, retrouvés depuis le mot écrit à plat : « okami »
    // → « ōkami », « pokemon » → « pokémon ». IGDB compare les lettres telles
    // quelles (vérifié : `name ~ *"okami"*` ne trouve pas « Ōkami ») — il faut
    // donc lui envoyer le mot avec les accents que les titres lui donnent.
    const accents = new Map();
    const addAccents = (text) => {
      for (const piece of String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (!piece) continue;
        const flat = normalizeTitle(piece);
        if (!flat || flat === piece || flat.includes(" ")) continue;
        if (!accents.has(flat)) accents.set(flat, new Set());
        const forms = accents.get(flat);
        if (forms.size < 3) forms.add(piece);
      }
    };
    names.forEach(([name]) => addAccents(name));
    for (const [alt] of raw.alts || []) addAccents(alt);

    lexicon = { names, entries, exact, words, wordsByLen, accents };
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

/** Les écritures accentuées qu'ont les titres pour ce mot (« okami » → ["ōkami"]). */
export function accentVariants(word) {
  const lex = load();
  if (!lex) return [];
  return [...(lex.accents.get(normalizeTitle(word)) || [])];
}

/** Le meilleur candidat, ou null. */
export function suggestTitle(query) {
  return suggestTitles(query, 1)[0] || null;
}

// ======================================================================
//  La correction MOT PAR MOT
// ======================================================================
//
// ⚠️ `suggestTitles` COMPARE À DES TITRES ENTIERS, ET ÇA NE SUFFIT PAS. Il
// rattrape « mincrft » parce que « Minecraft » est un titre à lui seul. Mais
// « higurshi » ne ressemble à AUCUN titre : ils s'appellent tous « Higurashi
// When They Cry… », à quinze lettres de là. Personne ne tape un titre entier —
// on tape un mot, et c'est ce mot qu'il faut corriger.
//
// On corrige donc chaque mot inconnu vers le mot le plus proche du vocabulaire
// des titres (à distance égale, celui du jeu le plus connu). Les mots CONNUS
// ne sont jamais touchés : « mario » reste « mario », même si la recherche ne
// rend rien — c'est alors un filtre qui vide la liste, pas une faute.

const WORD_MIN = 4;
const wordTolerance = (len) => (len < 7 ? 1 : 2);
const isNumber = (w) => /^\d+$/.test(w);
const wordCache = createTtlCache({ name: "games:spell-words", max: 2000, ttl: 60 * 60 * 1000 });

function closestWord(lex, w) {
  const hit = wordCache.get(w);
  if (hit !== undefined) return hit;
  const max = wordTolerance(w.length);
  let best = null;
  for (let len = w.length - max; len <= w.length + max; len++) {
    for (const [cand, pop] of lex.wordsByLen.get(len) || []) {
      const d = distance(w, cand, max);
      if (d > max) continue;
      if (!best || d < best.d || (d === best.d && pop > best.pop)) best = { w: cand, d, pop };
    }
  }
  const out = best?.w || "";
  wordCache.set(w, out);
  return out;
}

/**
 * La recherche tapée, corrigée mot par mot — ou null si rien n'a changé.
 * « higurshi » → « higurashi », « zeldda breth » → « zelda breath ».
 */
export function correctQuery(query) {
  const lex = load();
  if (!lex) return null;
  let changed = false;
  const out = normalizeTitle(query)
    .split(" ")
    .filter(Boolean)
    .map((w) => {
      if (w.length < WORD_MIN || isNumber(w) || lex.words.has(w)) return w;
      const fix = closestWord(lex, w);
      if (!fix) return w;
      changed = true;
      return fix;
    });
  return changed ? out.join(" ") : null;
}

/**
 * Un des mots tapés est-il inconnu de tous les titres ?
 *
 * C'est la condition pour proposer quoi que ce soit. « mario » sur une console
 * où Mario n'a jamais mis les pieds rend zéro jeu — et proposait « Mari0 »,
 * alors que le mot était juste : c'était le filtre, pas la frappe.
 */
export function hasUnknownWords(query) {
  const lex = load();
  if (!lex) return false;
  return normalizeTitle(query)
    .split(" ")
    .some((w) => w.length >= WORD_MIN && !isNumber(w) && !lex.words.has(w));
}
