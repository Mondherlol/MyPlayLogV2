import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOTS_POOL } from "../data/motsPool.js";

// ======================================================================
//  Moteur du « Mot du jour » : proximité de sens entre deux mots français.
// ======================================================================
// Aucun appel réseau, aucun LLM, aucune base : un fichier de 14,5 Mo chargé une
// fois en mémoire, et un produit scalaire par essai.
//
// Le dictionnaire est construit hors-ligne par scripts/buildMotsDict.js (voir
// l'en-tête de ce fichier pour la provenance et le format). Les vecteurs y sont
// déjà L2-normalisés et quantifiés en int8, donc :
//
//     cos(a, b) = (Σ qa_i · qb_i) × échelle_a × échelle_b
//
// C'est CE choix qui rend le jeu classable : « zombie » vaut exactement la même
// chose pour tous les joueurs, aujourd'hui et dans six mois. Un LLM, lui, aurait
// répondu un nombre légèrement différent à chaque appel.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const VEC_FILE = path.join(DATA_DIR, "mots-fr.vec.bin");
const WORDS_FILE = path.join(DATA_DIR, "mots-fr.words.json");
const MAGIC = "MPLMOT01";

// Nombre de voisins mémorisés pour le mot du jour. C'est la donnée qui rend le
// jeu addictif : savoir qu'on est « le 342e mot le plus proche » en dit
// infiniment plus qu'un degré isolé.
export const NEIGHBOURS = 1000;

let dict = null; // { words, index, data, scales, dim, count }
let plainIndex = null; // forme sans accent → mot du dictionnaire (construit à la demande)

export function isReady() {
  return fs.existsSync(VEC_FILE) && fs.existsSync(WORDS_FILE);
}

// Chargement paresseux : au PREMIER essai d'un joueur, pas au démarrage du
// serveur. Une instance qui ne voit jamais le jeu ne paie pas les 20 Mo.
export function load() {
  if (dict) return dict;
  if (!isReady()) {
    const err = new Error(
      "Dictionnaire des mots absent. Construis-le avec : npm run build:mots -- --src <cc.fr.300.vec.gz>"
    );
    err.status = 503;
    throw err;
  }

  const buf = fs.readFileSync(VEC_FILE);
  if (buf.slice(0, 8).toString("ascii") !== MAGIC) {
    const err = new Error("Dictionnaire des mots corrompu (en-tête inattendu).");
    err.status = 500;
    throw err;
  }
  const count = buf.readUInt32LE(8);
  const dim = buf.readUInt32LE(12);
  const dataStart = 16;
  const dataLen = count * dim;
  const scalesStart = dataStart + dataLen;

  // Vues SANS COPIE sur le Buffer : les 14,5 Mo ne sont en mémoire qu'une fois.
  const data = new Int8Array(buf.buffer, buf.byteOffset + dataStart, dataLen);
  // `scales` doit être copié : l'offset d'un Float32Array doit être un multiple
  // de 4, ce que rien ne garantit ici.
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    scales[i] = buf.readFloatLE(scalesStart + i * 4);
  }

  const { words } = JSON.parse(fs.readFileSync(WORDS_FILE, "utf8"));
  if (words.length !== count) {
    const err = new Error(
      `Dictionnaire incohérent : ${words.length} mots pour ${count} vecteurs.`
    );
    err.status = 500;
    throw err;
  }

  const index = new Map();
  for (let i = 0; i < words.length; i += 1) index.set(words[i], i);

  dict = { words, index, data, scales, dim, count };
  console.log(`mots: dictionnaire chargé (${count} mots, ${dim} dimensions)`);
  return dict;
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ----------------------------------------------------------------------
//  Résolution d'une saisie
// ----------------------------------------------------------------------
// Le joueur tape à la main : il faut être tolérant sans être laxiste. Trois
// tentatives, de la plus stricte à la plus permissive :
//
//   1. le mot tel quel ;
//   2. le même mot sans tenir compte des accents (« epee » → « épée »), parce
//      que personne ne devrait perdre un essai sur un accent circonflexe ;
//   3. une dé-flexion sommaire du français (pluriels et féminins courants),
//      pour que « voitures » ou « grande » trouvent leur forme de base.
//
// On renvoie TOUJOURS la forme canonique du dictionnaire : c'est elle qui est
// affichée et enregistrée, donc deux joueurs qui tapent « epee » et « épée »
// voient la même ligne avec le même score.
export function resolve(input) {
  const d = load();
  let w = String(input || "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    // Espaces internes et ponctuation : on ne garde que le premier mot.
    .replace(/[\s.,;:!?"'()[\]]+.*$/, "");

  if (!w || w.length < 2 || w.length > 24) return null;
  if (d.index.has(w)) return { word: w, index: d.index.get(w) };

  if (!plainIndex) {
    plainIndex = new Map();
    // Le dictionnaire est trié par fréquence : le premier arrivé pour une forme
    // sans accent donnée est donc le plus courant, celui qu'attend le joueur.
    for (const word of d.words) {
      const k = stripAccents(word);
      if (!plainIndex.has(k)) plainIndex.set(k, word);
    }
  }

  const plain = stripAccents(w);
  const hit = plainIndex.get(plain);
  if (hit) return { word: hit, index: d.index.get(hit) };

  // Dé-flexion : pluriels (-s, -x, -aux), féminins (-e), formes verbales
  // simples. On s'arrête au premier candidat connu.
  const stems = [];
  if (plain.length > 3) {
    if (plain.endsWith("aux")) stems.push(`${plain.slice(0, -3)}al`);
    if (plain.endsWith("eaux")) stems.push(`${plain.slice(0, -1)}`);
    if (/[sx]$/.test(plain)) stems.push(plain.slice(0, -1));
    if (plain.endsWith("es")) stems.push(plain.slice(0, -2));
    if (plain.endsWith("e")) stems.push(plain.slice(0, -1));
    if (plain.endsWith("ent")) stems.push(plain.slice(0, -3));
  }
  for (const s of stems) {
    if (s.length < 3) continue;
    const m = plainIndex.get(s);
    if (m) return { word: m, index: d.index.get(m) };
  }
  return null;
}

// Similarité cosinus entre deux mots, par leurs indices. Deux vues int8 et 300
// multiplications entières : quelques microsecondes.
export function cos(ia, ib) {
  const { data, scales, dim } = load();
  const oa = ia * dim;
  const ob = ib * dim;
  let dot = 0;
  for (let i = 0; i < dim; i += 1) dot += data[oa + i] * data[ob + i];
  const v = dot * scales[ia] * scales[ib];
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

// ----------------------------------------------------------------------
//  Calibrage d'un mot du jour
// ----------------------------------------------------------------------
// Un balayage complet du dictionnaire (50 000 × 300 ≈ 15 M opérations, ~40 ms),
// fait UNE FOIS à la création du jour et stocké en base.
//
// On en tire deux choses :
//
//   - les NEIGHBOURS mots les plus proches, pour afficher le rang ;
//   - trois repères de la distribution (médiane, seuil du 1000e, maximum) qui
//     servent à calibrer l'échelle de température.
//
// Ce calibrage n'est pas cosmétique. Les similarités brutes varient énormément
// d'un mot à l'autre : un mot très « entouré » comme « chien » a des voisins à
// 0,75, un mot isolé comme « verglas » plafonne à 0,55. Sans calibrage, le
// second donnerait l'impression de ne jamais chauffer, et deux jours de suite
// n'auraient pas la même difficulté ressentie.
export function calibrate(targetIndex) {
  const { count, words } = load();
  const target = words[targetIndex];
  const sims = new Float32Array(count);
  for (let i = 0; i < count; i += 1) sims[i] = i === targetIndex ? -2 : cos(targetIndex, i);

  // Indices triés par similarité décroissante. Un tri de 50 000 entiers coûte
  // quelques millisecondes — inutile de se compliquer avec une sélection
  // partielle.
  const order = new Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  order.sort((a, b) => sims[b] - sims[a]);

  // LES VARIANTES DU MOT LUI-MÊME SONT ÉCARTÉES du voisinage.
  //
  // Le mot le plus proche d'un mot est presque toujours son propre pluriel :
  // pour « tribune », c'est « tribunes » à 0,708 de cosinus, loin devant le
  // premier vrai voisin (« estrade », 0,542). Deux dégâts :
  //   - il occupait le rang 1, décalant tout le classement affiché ;
  //   - il ancrait le haut de l'échelle de température, écrasant 20 degrés
  //     entre lui et le premier mot réellement proposable.
  // Et il ne pouvait de toute façon jamais être proposé : le pluriel FAIT
  // GAGNER (cf. sameWord). Le haut du classement était donc occupé par un mot
  // que personne ne pouvait atteindre.
  const neighbours = [];
  for (let r = 0; r < count && neighbours.length < NEIGHBOURS; r += 1) {
    const i = order[r];
    if (i === targetIndex || sameWord(words[i], target)) continue;
    neighbours.push({ w: words[i], s: Math.round(sims[i] * 10000) / 10000 });
  }

  // La médiane se lit directement dans l'ordre trié (on saute la cible, en fin
  // de tableau avec sa valeur sentinelle -2).
  const median = sims[order[Math.floor((count - 1) / 2)]];
  // Le mot le PLUS ÉLOIGNÉ (dernier de l'ordre, la cible mise à part). Il sert
  // de plancher à l'échelle : sans lui, tout ce qui est sous la médiane
  // s'écraserait à 0,0 ° et le joueur qui tâtonne n'aurait aucun signal.
  const simMin = sims[order[count - 2]];

  return {
    neighbours,
    simMax: neighbours.length ? neighbours[0].s : 1,
    simEdge: neighbours.length ? neighbours[neighbours.length - 1].s : 0.5,
    median: Math.round(median * 10000) / 10000,
    simMin: Math.round(simMin * 10000) / 10000,
  };
}

// ----------------------------------------------------------------------
//  Température
// ----------------------------------------------------------------------
// L'échelle se lit en deux moitiés, et c'est délibéré :
//
//   AU-DESSUS DE 50 ° — dans les 1000 mots les plus proches — la température
//   suit le RANG, pas le cosinus :
//
//        rang 1    →  99 °        rang 100  →  66 °
//        rang 3    →  91 °        rang 500  →  55 °
//        rang 10   →  83 °        rang 1000 →  50 °
//
//   EN DESSOUS DE 50 ° — hors du voisinage — il n'y a plus de rang à donner,
//   la température interpole alors le cosinus entre trois ancres :
//        mot le plus éloigné → 0 °, médiane → 10 °, seuil du 1000e → 50 °.
//
// POURQUOI LE RANG ET PAS LE COSINUS EN HAUT. Parce que les similarités du
// haut de classement ne sont pas réparties : elles s'effondrent d'un coup après
// les toutes premières. Pour « tribune », le 2e voisin est à 0,542 et le 126e
// encore à 0,45 — en interpolant le cosinus, 124 places d'écart tenaient dans
// 20 degrés, et être 2e n'affichait que 79 °. Or c'est le RANG que le joueur
// lit et sur lequel il raisonne : les deux doivent raconter la même histoire.
// Une échelle logarithmique sur le rang donne enfin sa place au sommet, là où
// se joue la fin de partie.
export function temperature(sim, calib, rank = null) {
  // --- Dans le voisinage : le rang commande ---
  if (rank != null && rank >= 1) {
    const r = Math.min(rank, NEIGHBOURS);
    const t = 50 + 49 * (1 - Math.log(r) / Math.log(NEIGHBOURS));
    return Math.round(t * 10) / 10;
  }

  // --- Hors voisinage : le cosinus, borné sous la barre des 50 ° ---
  const min = calib?.simMin ?? -0.2;
  const median = calib?.median ?? 0.1;
  const edge = calib?.simEdge ?? 0.4;

  // Distribution dégénérée (ne devrait pas arriver) : on retombe sur le cosinus
  // brut plutôt que de diviser par zéro.
  if (!(median > min) || !(edge > median)) {
    return Math.round(Math.min(49.9, Math.max(0, sim) * 100) * 10) / 10;
  }

  let t;
  if (sim <= min) t = 0;
  else if (sim <= median) t = (10 * (sim - min)) / (median - min);
  else t = 10 + (40 * (sim - median)) / (edge - median);
  // Un mot hors des 1000 ne doit jamais atteindre la barre des 50 °, qui est
  // la promesse faite au joueur : « 50 °, c'est que tu es entré dans le
  // voisinage ».
  return Math.round(Math.min(49.9, Math.max(0, t)) * 10) / 10;
}

// Deux saisies désignent-elles LE MÊME mot ? Sans ça, le mot du jour « donjon »
// tapé « donjons » afficherait 99 ° et le rang 1 sans faire gagner — le pluriel
// est une entrée distincte du dictionnaire, avec son propre vecteur, situé juste
// à côté. Frustration garantie pour une faute qui n'en est pas une.
//
// On compare donc les formes dépouillées : sans accent, sans marque de pluriel.
export function sameWord(a, b) {
  const norm = (s) =>
    stripAccents(String(s || "").toLowerCase().trim()).replace(/[sx]$/, "");
  const na = norm(a);
  return Boolean(na) && na === norm(b);
}

// Palier d'ambiance, pour que le client colore la jauge sans dupliquer les
// seuils. L'ordre suit la montée en chaleur.
//
// « bouillant » (90 °) existe pour une raison d'affichage : c'est LUI qui
// déclenche les flammes sur la page. Sans ce palier, la zone 75-99 était un
// seul bloc « chaud » et les dix derniers degrés — les plus tendus de la
// partie — ne se distinguaient de rien.
export function heatBand(temp) {
  if (temp >= 90) return "bouillant";
  if (temp >= 75) return "chaud";
  if (temp >= 50) return "tiede";
  if (temp >= 25) return "frais";
  return "glacial";
}

// ----------------------------------------------------------------------
//  Tirage du mot du jour
// ----------------------------------------------------------------------
// Déterministe à partir de la date : deux serveurs (ou deux redémarrages) qui
// calculent le même jour tombent sur le même mot, sans se coordonner. Les mots
// déjà sortis sont sautés — d'où le paramètre `used`.
// Grain de sel du tirage. La date seule suffirait à être déterministe, mais
// elle rendrait la séquence FIGÉE : impossible de rebattre les cartes sans
// changer de calendrier. En préfixant la date, on obtient une suite entièrement
// différente — utile quand un mot a été grillé (tests, capture d'écran, ami
// bavard) et qu'on veut repartir sur du neuf.
//
// CHANGER CETTE VALEUR REBAT TOUS LES JOURS À VENIR. Les jours déjà créés ne
// bougent pas : leur mot est enregistré dans MotDuJour, le tirage ne sert qu'à
// la première ouverture d'une journée. Pour rebattre à nouveau plus tard,
// incrémenter le suffixe (`-v3`…) plutôt que d'inventer une autre chaîne, pour
// garder trace de l'ordre des remaniements.
const SALT = process.env.MOT_SALT || "myplaylog-v2";

function hashDate(dateStr) {
  const seed = `${SALT}:${dateStr}`;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickWord(dateStr, used = new Set()) {
  const d = load();
  // Seuls les mots réellement présents dans le dictionnaire sont tirables.
  const pool = MOTS_POOL.filter((w) => d.index.has(w));
  if (!pool.length) {
    const err = new Error("Aucun mot du vivier n'est présent dans le dictionnaire.");
    err.status = 500;
    throw err;
  }
  const start = hashDate(dateStr) % pool.length;
  for (let k = 0; k < pool.length; k += 1) {
    const w = pool[(start + k) % pool.length];
    if (!used.has(w)) return { word: w, index: d.index.get(w) };
  }
  // Vivier épuisé (plus de trois ans de parties) : on recommence, le plus
  // ancien mot est de toute façon oublié.
  const w = pool[start];
  return { word: w, index: d.index.get(w) };
}

// ----------------------------------------------------------------------
//  Le fuseau du jeu
// ----------------------------------------------------------------------
// Un mot partagé impose UN SEUL instant de bascule pour tout le monde : si
// chacun changeait de mot à son minuit local, deux joueurs joueraient des mots
// différents au même moment et le classement du jour comparerait des parties
// incomparables. Il faut donc un fuseau de référence, et un seul.
//
// Europe/Paris par défaut, surchargeable par MOT_TZ dans server/.env — utile si
// le public du site vit ailleurs (MOT_TZ=Africa/Tunis fait basculer le mot à
// minuit heure de Tunis). Changer cette valeur décale le jour de TOUS les
// joueurs : à faire une fois, pas au fil de l'eau.
export const MOT_TZ = process.env.MOT_TZ || "Europe/Paris";

// Date du jour au format YYYY-MM-DD dans le fuseau du jeu, quel que soit celui
// du serveur.
export function gameDay(at = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: MOT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

// Millisecondes restantes avant le prochain mot (compte à rebours du client).
export function msUntilNextDay(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MOT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  // « 24 » à minuit pile selon la version d'ICU (cycle h24) : ramené à 0, sinon
  // le compte à rebours afficherait zéro toute la première seconde du jour.
  const hour = get("hour") % 24;
  const elapsed = hour * 3600 + get("minute") * 60 + get("second");
  return (86400 - elapsed) * 1000;
}
