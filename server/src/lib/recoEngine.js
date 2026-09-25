// ======================================================================
//  Le moteur de recommandations — « parce que tu as adoré X »
// ======================================================================
//
// Ce qui est comparé : le catalogue local (models/GameFeatures.js, synchro
// dans lib/recoCatalog.js). Rien ici ne parle à IGDB, sauf pour rattraper un
// jeu de bibliothèque que le catalogue n'a pas encore.
//
// ------------------------------------------------ 1. à quoi ressemble un jeu
// Un jeu = un vecteur de traits : mots-clés, thèmes, genres, perspective,
// modes, série, franchise, studio, éditeur. Chaque trait pèse son TF-IDF : un
// trait rare (« metroidvania », 300 jeux) dit beaucoup plus qu'un trait banal
// (« Adventure », 20 000 jeux).
//
// ⚠️ CHAQUE FAMILLE EST NORMALISÉE À PART, PUIS PONDÉRÉE (FAMILIES). Sans ça,
// un jeu à 60 mots-clés ne ressemblerait qu'à d'autres jeux à 60 mots-clés,
// et deux jeux sans mots-clés ne se ressembleraient que par leurs genres. Ici
// chaque famille apporte sa part, quelle que soit la longueur de sa liste.
//
// ------------------------------------------------ 1 bis. qui joue à quoi
// Le contenu ne voit pas tout : Portal 2 et The Stanley Parable ne partagent
// presque aucun trait, mais ceux qui aiment l'un aiment l'autre. Quand on sait
// ce qu'aiment les joueurs d'un jeu (models/GameNeighbors.js : des millions
// d'avis publics, plus les bibliothèques de MyPlayLog), ses voisins mêlent les
// deux — le co-jeu pèse jusqu'à CF_ALPHA. Sans données, on reste sur le contenu.
//
// ------------------------------------------------ 2. ce que tu aimes
// Chaque jeu de ta bibliothèque reçoit un poids (seedWeight) : coup de cœur,
// note RELATIVE à ta moyenne (quelqu'un qui met toujours 80 n'adore pas un jeu
// à 80), statut, temps de jeu, platine. Un jeu lâché ou mal noté pèse négatif.
//
// ------------------------------------------------ 3. le score d'un candidat
// ⚠️ ON N'EN FAIT PAS UN « VECTEUR MOYEN » DE TOI. Quelqu'un qui adore FIFA et
// Hollow Knight ne veut pas la moyenne des deux. On part de chaque jeu aimé,
// on prend ses voisins, et un candidat cumule ce que lui apportent ses
// meilleurs parrains (avec des rendements décroissants : trois parrains moyens
// ne valent pas un excellent). L'explication tombe du même calcul : « parce que
// tu as adoré X ».
// Le tout est ensuite multiplié par la qualité (moyenne bayésienne, pour qu'un
// 95 sur 3 votes ne passe pas devant un 88 sur 2 000), ton affinité pour
// l'époque et tes habitudes (solo / en ligne, mobile, free-to-play), et abaissé
// par la ressemblance aux jeux que tu as lâchés.
//
// ------------------------------------------------ 4. la liste finale
// Diversité (MMR) : chaque pioche pénalise ce qui ressemble trop à ce qui est
// déjà pris, deux jeux d'une même série au plus, jamais un jeu et son
// remaster. Sans ça : dix roguelites.
//
// Les coûts, mesurés sur 44 000 jeux : index construit en ~2 s au démarrage
// (~75 Mo en mémoire avec le co-jeu), 300 à 600 ms de calcul à froid pour
// une bibliothèque de 400 jeux (par tranches, cf. warmNeighbors), quelques ms
// ensuite (cache).

import GameFeatures from "../models/GameFeatures.js";
import GameNeighbors from "../models/GameNeighbors.js";
import IgdbTerm from "../models/IgdbTerm.js";
import UserGame from "../models/UserGame.js";
import GemSkip from "../models/GemSkip.js";
import { ensureGameFeatures, onRecoCatalogSynced } from "./recoCatalog.js";
import { GENRES_FR, MODES_FR, THEMES_FR, frName } from "./translations.js";
import { createTtlCache } from "./ttlCache.js";

const IMG = "https://images.igdb.com/igdb/image/upload";

// Les familles de traits et leur poids dans la ressemblance. `minDf` : un trait
// porté par moins de jeux ne relie rien d'utile (un mot-clé présent sur deux
// jeux est le plus souvent le nom d'un personnage).
const FAMILIES = [
  { key: "keywords", kind: "keyword", w: 1.0, minDf: 3 },
  { key: "themes", kind: "theme", w: 0.9, minDf: 1 },
  { key: "genres", kind: "genre", w: 0.75, minDf: 1 },
  { key: "collections", kind: "collection", w: 0.7, minDf: 2 },
  { key: "devs", kind: "company", w: 0.65, minDf: 2 },
  { key: "persp", kind: "persp", w: 0.5, minDf: 1 },
  { key: "franchises", kind: "franchise", w: 0.45, minDf: 2 },
  { key: "modes", kind: "mode", w: 0.3, minDf: 1 },
  { key: "pubs", kind: "company", w: 0.2, minDf: 2 },
];
// Un trait présent sur plus de 60 % du catalogue (« Single player ») n'aide
// à distinguer personne.
const MAX_DF_RATIO = 0.6;
const MIN_SIM = 0.1; // en dessous, deux jeux ne se « ressemblent » pas
// Un jeu décrit par ses seuls genres (« Action, Fantasy, RPG ») ressemblerait
// à tout : la norme de son vecteur est comptée au moins comme celle d'un jeu
// qui a mots-clés, thèmes, genres et perspective. Ce qu'on ne sait pas d'un
// jeu compte comme « pas en commun », pas comme « sans importance ».
const NORM_FLOOR = Math.sqrt(1.0 ** 2 + 0.9 ** 2 + 0.75 ** 2 + 0.5 ** 2);
// Recherche des voisins : on n'accumule d'abord que les traits SÉLECTIFS
// (≤ 2 000 jeux), puis on calcule la ressemblance exacte sur les meilleurs.
// Parcourir « Action » (23 000 jeux) pour chaque jeu de départ coûtait à lui
// seul la moitié du temps de calcul, pour des traits qui ne départagent rien.
const SELECTIVE_DF = 2000;
const PREFILTER = 1500;
const NEIGHBORS = 120; // voisins gardés par jeu de départ
// Le co-jeu : sa part dans la ressemblance quand un jeu a au moins
// CF_MIN_LINKS voisins co-joués (moins quand il en a peu). Ses forces arrivent
// déjà entre 0 et 1, chaque source calibrée à part (cf. calibrate, lib/coPlay).
const CF_ALPHA = 0.55;
const CF_MIN_LINKS = 8;
const PORT = 11; // game_type « portage » : doublon d'un jeu qui existe déjà
const SINGLE_PLAYER = 1;
const MMO = 5;
const BATTLE_ROYALE = 6;
// Android, iOS, vieux mobiles, Windows Phone, navigateur : un jeu qui ne sort
// QUE là est presque toujours un free-to-play mobile.
const MOBILE_PLATFORMS = new Set([34, 39, 55, 74, 82]);
// Les fan-games, rom hacks et mods : IGDB les catalogue, et leurs notes sont
// excellentes (leurs fans votent) — mais ce ne sont pas des jeux qu'on
// recommande à côté des vrais.
const UNOFFICIAL = /(fan ?game|rom hack|^unofficial|\bmod$|^gmod$|sourcemod)/i;
// Free-to-play, gacha, microtransactions : un modèle à part, qu'on ne
// propose qu'à ceux qui en jouent déjà.
const F2P = /^(free-to-play|gacha|gacha system|loot boxes|microtransaction)$/i;
// Les mots-clés qu'on ne montre pas dans une explication (cf. sharedTraits).
const TECHNICAL_KEYWORD =
  /awards|nominee|winner|previously on|steam|achievements|controller|dualshock|dualsense|xbox|cloud save|trading cards|remote play|family sharing|\bhdr\b|\bpc\b/i;

// ----------------------------------------------------------------------
//  L'index en mémoire
// ----------------------------------------------------------------------
// ~45 000 jeux × ~14 traits + 220 000 liens de co-jeu : ~75 Mo en tout.
// Reconstruit après chaque synchro du catalogue ; les requêtes en cours
// finissent sur l'ancien.
let index = null;
let building = null;
let version = 0;

const neighborCache = createTtlCache({ name: "reco:neighbors", max: 8000, ttl: 24 * 60 * 60 * 1000 });
const userCache = createTtlCache({ name: "reco:user", max: 3000, ttl: 15 * 60 * 1000 });

const FEATURE_FIELDS =
  "name fr cover date type parent genres themes keywords modes persp franchises collections devs pubs platforms rating ratingCount hypes pool";

async function build() {
  const t0 = Date.now();
  const [rows, termRows] = await Promise.all([
    GameFeatures.find({}).select(FEATURE_FIELDS).lean(),
    IgdbTerm.find({}).select("kind id name abbr").lean(),
  ]);
  const poolRows = rows.filter((r) => r.pool);
  if (poolRows.length < 1000) return null; // catalogue pas encore synchronisé

  // Rien que le nom (l'abréviation pour une plateforme) : 35 000 libellés,
  // autant ne pas garder 35 000 objets complets.
  const terms = new Map(
    termRows.map((t) => [`${t.kind}:${t.id}`, (t.kind === "platform" && t.abbr) || t.name])
  );
  const keywordIds = (re) =>
    new Set(termRows.filter((t) => t.kind === "keyword" && re.test(t.name)).map((t) => t.id));
  const unofficial = keywordIds(UNOFFICIAL);
  const f2p = keywordIds(F2P);

  // Fréquence de chaque trait dans le pool (le corpus de référence).
  const df = new Map();
  for (const r of poolRows)
    for (const fam of FAMILIES)
      for (const id of r[fam.key] || []) {
        const k = `${fam.key}:${id}`;
        df.set(k, (df.get(k) || 0) + 1);
      }

  const N = poolRows.length;
  const tokenId = new Map(); // "keywords:123" -> index
  const tokens = []; // index -> { fam, id, idf }
  for (const fam of FAMILIES)
    for (const [k, n] of df) {
      if (!k.startsWith(`${fam.key}:`)) continue;
      if (n < fam.minDf || n > N * MAX_DF_RATIO) continue;
      tokenId.set(k, tokens.length);
      tokens.push({ fam, id: Number(k.slice(fam.key.length + 1)), idf: Math.log(N / n) });
    }

  const idx = {
    n: 0,
    byId: new Map(),
    docs: [], // métadonnées pour l'affichage et les filtres
    // ⚠️ LES VECTEURS SONT À PLAT, DANS DEUX GRANDS TABLEAUX : le jeu i occupe
    // T/W[off[i] … off[i+1]]. Un tableau typé par jeu (88 000 petits objets)
    // coûtait plus en en-têtes qu'en données.
    T: new Int32Array(rows.length * 16 + 1024), // traits, triés par jeu
    W: new Float32Array(rows.length * 16 + 1024), // leur poids
    off: new Int32Array(rows.length + 1025),
    len: 0,
    tokens,
    tokenId,
    terms,
    postings: null,
    unofficial,
    f2p,
    tried: new Set(), // ids de bibliothèque déjà cherchés chez IGDB
    builtAt: new Date(),
  };
  for (const r of rows) addDoc(idx, r);

  // Listes inversées : trait -> jeux RECOMMANDABLES qui le portent.
  const counts = new Int32Array(tokens.length);
  for (let i = 0; i < idx.n; i++)
    if (idx.docs[i].pool) for (let k = idx.off[i]; k < idx.off[i + 1]; k++) counts[idx.T[k]]++;
  const pDocs = tokens.map((_, t) => new Int32Array(counts[t]));
  const pW = tokens.map((_, t) => new Float32Array(counts[t]));
  const fill = new Int32Array(tokens.length);
  for (let i = 0; i < idx.n; i++) {
    if (!idx.docs[i].pool) continue;
    for (let k = idx.off[i]; k < idx.off[i + 1]; k++) {
      const t = idx.T[k];
      pDocs[t][fill[t]] = i;
      pW[t][fill[t]] = idx.W[k];
      fill[t]++;
    }
  }
  idx.postings = { docs: pDocs, w: pW };
  idx.acc = new Float64Array(idx.n + 5000); // accumulateur réutilisé (marge pour les ajouts)
  const links = await loadCoPlay(idx);

  console.log(
    `🧭 reco : index prêt — ${N} jeux recommandables, ${idx.n} au total, ${tokens.length} traits, ${idx.cf.size} jeux avec co-jeu (${links} liens) (${Date.now() - t0} ms)`
  );
  return idx;
}

// Les voisins co-joués (GameNeighbors) → idx.cf : jeu -> [[j, force 0-1], …],
// les deux sources (avis publics, MyPlayLog) fondues en « ou » probabiliste.
async function loadCoPlay(idx) {
  const rows = await GameNeighbors.find({}).lean();
  const cf = new Map();
  let links = 0;
  for (const r of rows) {
    const i = idx.byId.get(r._id);
    if (i === undefined) continue;
    const acc = new Map();
    for (const flat of [r.ext || [], r.local || []])
      for (let k = 0; k + 1 < flat.length; k += 2) {
        const j = idx.byId.get(flat[k]);
        if (j === undefined || j === i || !idx.docs[j].pool) continue;
        const f = flat[k + 1] / 1000;
        acc.set(j, 1 - (1 - (acc.get(j) || 0)) * (1 - f));
      }
    if (!acc.size) continue;
    cf.set(i, [...acc].sort((a, b) => b[1] - a[1]));
    links += acc.size;
  }
  idx.cf = cf;
  return links;
}

/** Recharge le co-jeu seul (après un import ou le calcul de la nuit). */
export async function reloadCoPlay() {
  if (!index) return;
  await loadCoPlay(index);
  version++;
  neighborCache.clear();
  userCache.clear();
}

// Ajoute un jeu à l'index (vecteur seulement : un jeu ajouté après coup sert de
// point de départ, jamais de candidat — les listes inversées ne bougent pas).
function addDoc(idx, r) {
  const parts = [];
  for (const fam of FAMILIES) {
    const list = [];
    let norm = 0;
    for (const id of r[fam.key] || []) {
      const t = idx.tokenId.get(`${fam.key}:${id}`);
      if (t === undefined) continue;
      const w = idx.tokens[t].idf;
      list.push([t, w]);
      norm += w * w;
    }
    if (!list.length) continue;
    norm = Math.sqrt(norm);
    for (const [t, w] of list) parts.push([t, (fam.w * w) / norm]);
  }
  let total = 0;
  for (const [, w] of parts) total += w * w;
  total = Math.max(Math.sqrt(total), NORM_FLOOR);
  parts.sort((a, b) => a[0] - b[0]);

  const i = idx.n++;
  idx.byId.set(r._id, i);
  if (idx.len + parts.length > idx.T.length) {
    const T = new Int32Array(Math.ceil((idx.len + parts.length) * 1.5));
    const W = new Float32Array(T.length);
    T.set(idx.T);
    W.set(idx.W);
    idx.T = T;
    idx.W = W;
  }
  if (i + 2 > idx.off.length) {
    const off = new Int32Array(Math.ceil((i + 2) * 1.5));
    off.set(idx.off);
    idx.off = off;
  }
  for (const [t, w] of parts) {
    idx.T[idx.len] = t;
    idx.W[idx.len] = w / total;
    idx.len++;
  }
  idx.off[i + 1] = idx.len;
  idx.docs.push({
    id: r._id,
    name: r.name,
    fr: r.fr || null,
    cover: r.cover || null,
    date: r.date || null,
    type: r.type ?? 0,
    parent: r.parent || null,
    rating: r.rating ?? null,
    ratingCount: r.ratingCount || 0,
    hypes: r.hypes || 0,
    pool: Boolean(r.pool),
    genres: r.genres || [],
    platforms: r.platforms || [],
    collections: r.collections || [],
    // Séries et franchises dans une même liste : les franchises en négatif.
    series: [...(r.collections || []), ...(r.franchises || []).map((f) => -f)],
    norm: normName(r.name),
    // En ligne avant tout : pas de solo déclaré, ou MMO / battle royale.
    online:
      Boolean(r.modes?.length) &&
      (!r.modes.includes(SINGLE_PLAYER) || r.modes.includes(MMO) || r.modes.includes(BATTLE_ROYALE)),
    mobileOnly: Boolean(r.platforms?.length) && r.platforms.every((p) => MOBILE_PLATFORMS.has(p)),
    unofficial: (r.keywords || []).some((k) => idx.unofficial.has(k)),
    f2p: (r.keywords || []).some((k) => idx.f2p.has(k)),
  });
  if (idx.acc && idx.acc.length < idx.n) {
    const bigger = new Float64Array(idx.n + 5000);
    idx.acc = bigger;
  }
  return i;
}

/** L'index, construit au premier appel. `null` tant que le catalogue est vide. */
export async function getRecoIndex() {
  if (index) return index;
  if (!building) {
    building = build()
      .then((idx) => {
        if (idx) {
          index = idx;
          version++;
        }
        return idx;
      })
      .catch((err) => {
        console.error("reco build:", err.message);
        return null;
      })
      .finally(() => {
        building = null;
      });
  }
  return building;
}

export function isRecoReady() {
  return Boolean(index);
}

// Après une synchro : on reconstruit à côté, puis on bascule.
onRecoCatalogSynced(() => {
  build()
    .then((idx) => {
      if (!idx) return;
      index = idx;
      version++;
      neighborCache.clear();
      userCache.clear();
    })
    .catch((err) => console.error("reco rebuild:", err.message));
});

// ----------------------------------------------------------------------
//  Ressemblances
// ----------------------------------------------------------------------
function dot(idx, a, b) {
  const { T, W, off } = idx;
  const xe = off[a + 1];
  const ye = off[b + 1];
  let s = 0;
  for (let x = off[a], y = off[b]; x < xe && y < ye; ) {
    if (T[x] === T[y]) s += W[x++] * W[y++];
    else if (T[x] < T[y]) x++;
    else y++;
  }
  return s;
}

// Accumule dans idx.acc les produits partiels du jeu `i` sur les traits dont
// la liste inversée ne dépasse pas `maxDf`. Rend les jeux touchés.
function accumulate(idx, i, maxDf) {
  const acc = idx.acc;
  const touched = [];
  for (let k = idx.off[i]; k < idx.off[i + 1]; k++) {
    const docs = idx.postings.docs[idx.T[k]];
    if (docs.length > maxDf) continue;
    const ws = idx.postings.w[idx.T[k]];
    const q = idx.W[k];
    for (let p = 0; p < docs.length; p++) {
      const j = docs[p];
      if (acc[j] === 0) touched.push(j);
      acc[j] += q * ws[p];
    }
  }
  return touched;
}

/** Les jeux recommandables qui ressemblent le plus au jeu `i` : [[j, sim], …]. */
function neighbors(idx, i) {
  const key = `${version}:${i}`;
  const hit = neighborCache.get(key);
  if (hit) return hit;

  const acc = idx.acc;
  let touched = accumulate(idx, i, SELECTIVE_DF);
  // Un jeu sans trait sélectif (rien que des genres courants) : on parcourt
  // tout, faute de mieux.
  if (touched.length < 300) {
    for (const j of touched) acc[j] = 0;
    touched = accumulate(idx, i, Infinity);
  }
  if (touched.length > PREFILTER) touched.sort((a, b) => acc[b] - acc[a]);
  const shortlist = touched.slice(0, PREFILTER);
  for (const j of touched) acc[j] = 0;

  const content = [];
  for (const j of shortlist) {
    if (j === i) continue;
    const sim = dot(idx, i, j);
    if (sim >= MIN_SIM) content.push([j, sim]);
  }
  content.sort((a, b) => b[1] - a[1]);

  // Le co-jeu, s'il y en a : chaque voisin reçoit (1 − α)·contenu + α·co-jeu,
  // et garde en 3ᵉ case la part du co-jeu dans sa note (pour l'explication).
  const cf = idx.cf?.get(i);
  let top;
  if (!cf || cf.length < 3) {
    top = content.slice(0, NEIGHBORS).map(([j, sim]) => [j, sim, 0]);
  } else {
    const alpha = CF_ALPHA * Math.min(1, cf.length / CF_MIN_LINKS);
    const both = new Map(content.slice(0, 200).map(([j, sim]) => [j, [sim, 0]]));
    for (const [j, f] of cf) {
      const e = both.get(j);
      if (e) e[1] = f;
      else both.set(j, [dot(idx, i, j), f]);
    }
    top = [];
    for (const [j, [c, f]] of both) {
      const sim = (1 - alpha) * c + alpha * f;
      if (sim >= MIN_SIM) top.push([j, sim, (alpha * f) / sim]);
    }
    top.sort((a, b) => b[1] - a[1]);
    top = top.slice(0, NEIGHBORS);
  }
  neighborCache.set(key, top);
  return top;
}

// L'explication d'un voisin : « aimé par les fans de X » quand c'est surtout
// le co-jeu qui le rapproche, puis les traits communs.
function explainPair(idx, seed, cand, cfShare, seedName) {
  const traits = sharedTraits(idx, seed, cand, cfShare >= 0.5 ? 2 : 3);
  if (cfShare >= 0.5) traits.unshift({ kind: "coplay", name: `Adoré par les fans de ${seedName}` });
  return traits;
}

// ----------------------------------------------------------------------
//  Petits calculs
// ----------------------------------------------------------------------
const NAME_NOISE =
  /\b(the|remastered|remaster|remake|definitive|edition|hd|deluxe|complete|goty|game of the year|director'?s cut|enhanced|anniversary|reloaded|redux|royal|ultimate|legendary|special|version)\b/g;

// Le nom « nu » d'un jeu : sert à ne pas te proposer le remaster d'un jeu que
// tu as déjà (IGDB ne relie pas toujours les deux par `parent_game`).
export function normName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// Les ancêtres d'un jeu (parent, grand-parent…) : l'original d'un remaster,
// le jeu d'une extension autonome. Trois crans suffisent.
function ancestors(idx, d) {
  const out = [];
  let p = d.parent;
  for (let k = 0; p && k < 3; k++) {
    out.push(p);
    const i = idx.byId.get(p);
    p = i === undefined ? null : idx.docs[i].parent;
  }
  return out;
}

// Moyenne bayésienne ramenée entre 0 et 1 : un 95 sur 5 votes pèse comme un
// ~75, un 88 sur 2 000 votes reste un 88.
function quality(d) {
  if (d.rating == null) return 0.35;
  const m = 20;
  const bayes = (70 * m + d.rating * d.ratingCount) / (m + d.ratingCount);
  return Math.min(1, Math.max(0, (bayes - 55) / 35));
}

function popularity(d) {
  return Math.min(1, Math.log10(1 + d.ratingCount) / Math.log10(1 + 1500));
}

const yearOf = (d) => (d.date ? new Date(d.date * 1000).getUTCFullYear() : null);

/** Le poids d'un jeu de bibliothèque dans ton profil. Négatif = repoussoir. */
export function seedWeight(e, stats) {
  let w = 0;
  switch (e.status) {
    case "finished":
    case "endless":
      w += 0.8;
      break;
    case "playing":
      w += 0.5;
      break;
    case "paused":
      w += 0.1;
      break;
    case "dropped":
      w -= 1.5;
      break;
    case "wishlist":
      w += 0.25; // de l'intérêt, pas une preuve
      break;
  }
  if (e.rating != null) {
    w += (1.1 * (e.rating - stats.mean)) / stats.sd;
    if (e.rating >= 90) w += 0.5;
    if (e.rating <= 40) w -= 0.8;
  }
  if (e.favorite) w += 2.5;
  const h = Number(e.playtimeHours) || 0;
  if (h > 0 && e.status !== "dropped") w += Math.min(1, 0.35 * Math.log2(1 + h / 4));
  if (e.platinum) w += 0.5;
  return Math.max(-3, Math.min(5, w));
}

export function ratingStats(lib) {
  const r = lib.map((e) => e.rating).filter((x) => typeof x === "number");
  if (r.length < 5) return { mean: 70, sd: 15 };
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
  return { mean, sd: Math.max(8, sd) };
}

// Tes années de prédilection : une densité lissée (±5 ans) des jeux aimés.
function yearAffinity(idx, seeds) {
  const pts = [];
  for (const s of seeds) {
    const y = yearOf(idx.docs[s.i]);
    if (y) pts.push([y, s.w]);
  }
  if (pts.length < 3) return () => 1;
  const dens = (y) => pts.reduce((a, [py, w]) => a + w * Math.exp(-((y - py) ** 2) / 50), 0);
  let max = 0;
  for (let y = 1975; y <= new Date().getUTCFullYear() + 3; y++) max = Math.max(max, dens(y));
  return (d) => {
    const y = yearOf(d);
    if (!y || !max) return 0.9;
    return 0.8 + 0.2 * (dens(y) / max);
  };
}

// ----------------------------------------------------------------------
//  Affichage
// ----------------------------------------------------------------------
const FR = { genre: GENRES_FR, theme: THEMES_FR, mode: MODES_FR };

function termName(idx, kind, id) {
  const name = idx.terms.get(`${kind}:${id}`);
  if (!name) return null;
  return FR[kind] ? frName(FR[kind], name) : name;
}

// Les traits que deux jeux ont en commun, du plus parlant au moins parlant.
function sharedTraits(idx, a, b, max = 3) {
  const { T, W, off } = idx;
  const out = [];
  for (let x = off[a], y = off[b]; x < off[a + 1] && y < off[b + 1]; ) {
    if (T[x] === T[y]) {
      out.push([T[x], W[x] * W[y]]);
      x++;
      y++;
    } else if (T[x] < T[y]) x++;
    else y++;
  }
  out.sort((p, q) => q[1] - p[1]);
  const traits = [];
  for (const [t] of out) {
    const tok = idx.tokens[t];
    if (tok.fam.key === "modes" || tok.fam.key === "pubs") continue;
    const name = termName(idx, tok.fam.kind, tok.id);
    if (!name) continue;
    // Des mots-clés IGDB qui rapprochent bien deux jeux mais ne s'affichent
    // pas : « the game awards - best studio - nominee », « steam cloud »…
    if (tok.fam.key === "keywords" && TECHNICAL_KEYWORD.test(name)) continue;
    traits.push({ kind: tok.fam.key === "devs" ? "studio" : tok.fam.kind, name });
    if (traits.length >= max) break;
  }
  return traits;
}

const nameOf = (idx, i) => idx.docs[i].fr || idx.docs[i].name;

function card(idx, i, extra = {}) {
  const d = idx.docs[i];
  return {
    id: d.id,
    name: d.fr || d.name,
    cover: d.cover ? `${IMG}/t_cover_big/${d.cover}.jpg` : null,
    rating: d.rating != null ? Math.round(d.rating) : null,
    year: yearOf(d),
    releaseDate: d.date,
    hypes: d.hypes,
    genres: d.genres.map((g) => idx.terms.get(`genre:${g}`)).filter(Boolean),
    platforms: d.platforms.map((p) => idx.terms.get(`platform:${p}`)).filter(Boolean),
    ...extra,
  };
}

// ----------------------------------------------------------------------
//  Diversité
// ----------------------------------------------------------------------
// Pioche gloutonne : à chaque tour, le meilleur score une fois pénalisé par sa
// ressemblance au plus proche déjà pris. Au plus deux jeux par série ou
// franchise, et jamais deux fois le même jeu sous deux noms (God of War III et
// son remaster, un original et son portage).
function diversify(idx, ranked, n, { lambda = 0.45, perSeries = 2 } = {}) {
  const pool = ranked.slice(0, Math.max(n * 6, 60));
  const picked = [];
  const series = new Map();
  const seen = new Set(); // ids, parents et noms nus déjà pris
  const maxSim = new Float64Array(pool.length);
  const used = new Uint8Array(pool.length);
  while (picked.length < n) {
    let best = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (used[k]) continue;
      const s = pool[k].score * (1 - lambda * Math.min(1, maxSim[k]));
      if (s > bestScore) {
        bestScore = s;
        best = k;
      }
    }
    if (best < 0) break;
    used[best] = 1;
    const c = pool[best];
    const d = idx.docs[c.i];
    if (seen.has(d.id) || (d.parent && seen.has(d.parent)) || (d.norm && seen.has(d.norm))) continue;
    if (d.series.some((k) => (series.get(k) || 0) >= perSeries)) continue;
    for (const k of d.series) series.set(k, (series.get(k) || 0) + 1);
    seen.add(d.id);
    if (d.parent) seen.add(d.parent);
    if (d.norm) seen.add(d.norm);
    picked.push(c);
    for (let k = 0; k < pool.length; k++)
      if (!used[k]) maxSim[k] = Math.max(maxSim[k], dot(idx, c.i, pool[k].i));
  }
  return picked;
}

// ----------------------------------------------------------------------
//  Le profil d'un joueur
// ----------------------------------------------------------------------
async function loadProfile(idx, userId) {
  const [lib, skips] = await Promise.all([
    UserGame.find({ user: userId })
      .select("gameId name status rating favorite playtimeHours platinum")
      .lean(),
    GemSkip.find({ user: userId }).select("gameId").lean(),
  ]);

  // Les jeux de bibliothèque que l'index ne connaît pas encore (ajoutés depuis
  // la dernière synchro) : on les rattrape tout de suite, c'est une requête
  // IGDB pour 500 jeux — et c'est souvent le jeu qu'on vient d'adorer.
  // ⚠️ Un id qu'IGDB ne renvoie pas (fiche supprimée, fusionnée) resterait
  // « manquant » pour toujours : sans la mémoire `tried`, chaque ouverture de
  // la page reposerait la question à IGDB.
  const missing = lib
    .map((e) => e.gameId)
    .filter((id) => id > 0 && !idx.byId.has(id) && !idx.tried.has(id));
  if (missing.length) {
    for (const id of missing) idx.tried.add(id);
    try {
      await ensureGameFeatures(missing.slice(0, 500));
      const rows = await GameFeatures.find({ _id: { $in: missing } }).select(FEATURE_FIELDS).lean();
      for (const r of rows) if (!idx.byId.has(r._id)) addDoc(idx, { ...r, pool: false });
    } catch (err) {
      console.error("reco ensure:", err.message);
    }
  }

  const stats = ratingStats(lib);
  const seeds = [];
  const exclude = new Set(skips.map((s) => s.gameId));
  const names = new Set();
  for (const e of lib) {
    exclude.add(e.gameId);
    const i = idx.byId.get(e.gameId);
    if (i === undefined) continue;
    const d = idx.docs[i];
    // Toute la lignée : le remaster d'un portage d'un original.
    for (const a of ancestors(idx, d)) exclude.add(a);
    if (d.norm) names.add(d.norm);
    seeds.push({ i, w: seedWeight(e, stats), entry: e });
  }
  const pos = seeds.filter((s) => s.w >= 0.4).sort((a, b) => b.w - a.w).slice(0, 60);
  const neg = seeds.filter((s) => s.w <= -0.6).sort((a, b) => a.w - b.w).slice(0, 25);

  // Déjà vu, sous une forme ou une autre : le jeu lui-même, son remaster, son
  // original, un portage, une extension autonome, un homonyme « Definitive ».
  const known = (d) =>
    exclude.has(d.id) ||
    (d.norm && names.has(d.norm)) ||
    ancestors(idx, d).some((a) => exclude.has(a));

  // Tes habitudes : la part (pondérée) de jeux en ligne et de jeux mobiles
  // dans ce que tu aimes. Un joueur 100 % solo sur console ne veut pas de
  // free-to-play mobile, même « Survie, Tir, Third person » comme The Last of Us.
  let total = 0;
  let online = 0;
  let mobile = 0;
  let f2p = 0;
  for (const s of pos) {
    const d = idx.docs[s.i];
    total += s.w;
    if (d.online) online += s.w;
    if (d.mobileOnly) mobile += s.w;
    if (d.f2p) f2p += s.w;
  }
  const share = (x) => (total ? x / total : 0);
  const taste = { online: share(online), mobile: share(mobile), f2p: share(f2p) };

  return { lib, pos, neg, known, taste, signature: signature(lib, skips.length) };
}

// Une empreinte de la bibliothèque : le cache par joueur se périme tout seul
// dès qu'une note, un statut ou un coup de cœur change.
function signature(lib, skips) {
  let h = 2166136261;
  const s = lib
    .map((e) => `${e.gameId}|${e.status}|${e.rating ?? ""}|${e.favorite ? 1 : 0}|${e.playtimeHours ?? ""}`)
    .sort()
    .join(";");
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(36)}:${lib.length}:${skips}`;
}

// ----------------------------------------------------------------------
//  Les recommandations d'un joueur
// ----------------------------------------------------------------------
const nowSec = () => Math.floor(Date.now() / 1000);
const isReleased = (d, now) => d.date && d.date <= now;

/**
 * Tout ce qu'on sait recommander à un joueur :
 *   - forYou   : le mélange, diversifié ;
 *   - because  : quelques rangées « Parce que tu as adoré X » ;
 *   - gems     : bien notés mais peu connus ;
 *   - upcoming : les sorties à venir qui te ressemblent.
 * `null` si le catalogue n'est pas prêt (l'appelant garde son ancien moteur).
 */
export async function recommendForUser(userId) {
  const idx = await getRecoIndex();
  if (!idx) return null;
  const profile = await loadProfile(idx, userId);
  const key = `${version}:${userId}:${profile.signature}`;
  return userCache.remember(key, async () => {
    await warmNeighbors(idx, [...profile.pos, ...profile.neg]);
    return compute(idx, profile);
  });
}

// Calcule d'avance les voisins des jeux de départ, en rendant la main entre
// deux paquets : une grosse bibliothèque à froid, c'est quelques centaines de
// millisecondes de calcul, qui ne doivent pas geler les autres requêtes du
// serveur pendant ce temps. `compute` retrouve ensuite tout dans le cache.
async function warmNeighbors(idx, seeds) {
  for (let k = 0; k < seeds.length; k++) {
    neighbors(idx, seeds[k].i);
    if (k % 6 === 5) await new Promise((r) => setImmediate(r));
  }
}

// Ce qui ne ressemble pas à tes habitudes : un jeu surtout en ligne quand tu
// joues solo, un jeu uniquement mobile quand tu n'en as pas. Ramené à 1 dès que
// ce genre de jeu fait une part suffisante de ce que tu aimes.
function habitFactor(d, taste) {
  let f = 1;
  if (d.online) f *= 0.3 + 0.7 * Math.min(1, 2 * taste.online);
  if (d.mobileOnly) f *= 0.3 + 0.7 * Math.min(1, 3 * taste.mobile);
  if (d.f2p) f *= 0.35 + 0.65 * Math.min(1, 3 * taste.f2p);
  return f;
}

// Un jeu qu'on ne propose jamais, quel que soit le profil.
const unfit = (d) => d.type === PORT || !d.cover || d.unofficial;

function compute(idx, { pos, neg, known, taste }) {
  const empty = { forYou: [], because: [], gems: [], upcoming: [], seeds: 0 };
  if (!pos.length) return empty;
  const now = nowSec();
  const maxW = pos[0].w;

  // Parrains de chaque candidat.
  const cands = new Map(); // i -> [{ s, c }]
  for (const s of pos)
    for (const [j, sim, cf] of neighbors(idx, s.i)) {
      const d = idx.docs[j];
      if (unfit(d) || known(d)) continue;
      let list = cands.get(j);
      if (!list) cands.set(j, (list = []));
      list.push({ s, c: s.w * sim, cf });
    }

  // Ce qui ressemble à ce que tu as lâché.
  const penalty = new Map();
  for (const s of neg)
    for (const [j, sim] of neighbors(idx, s.i).slice(0, 60))
      if (cands.has(j)) penalty.set(j, (penalty.get(j) || 0) + -s.w * sim);

  const year = yearAffinity(idx, pos);
  const released = [];
  const upcoming = [];
  for (const [j, list] of cands) {
    const d = idx.docs[j];
    list.sort((a, b) => b.c - a.c);
    let rel = 0;
    for (let k = 0; k < Math.min(list.length, 8); k++) rel += list[k].c * 0.55 ** k;
    rel /= maxW;
    rel *= Math.exp(-0.8 * (penalty.get(j) || 0));
    rel *= habitFactor(d, taste);
    const base = { i: j, rel, list };
    if (isReleased(d, now)) {
      if (d.ratingCount < 3) continue;
      const q = quality(d);
      const y = year(d);
      released.push({
        ...base,
        q,
        score: rel * (0.45 + 0.55 * q) * y * (0.75 + 0.25 * popularity(d)),
        gemScore: rel * (0.45 + 0.55 * q) * y,
      });
    } else if (d.hypes >= 2) {
      const hype = Math.min(1, Math.log10(1 + d.hypes) / 2);
      upcoming.push({ ...base, score: rel * (0.75 + 0.25 * hype) });
    }
  }

  const explain = (c) => {
    const top = [];
    for (const { s } of c.list) {
      if (top.some((t) => t.i === s.i)) continue;
      top.push(s);
      if (top.length >= 2) break;
    }
    return {
      score: Math.round(c.score * 1000) / 1000,
      because: top.map((s) => ({ id: idx.docs[s.i].id, name: idx.docs[s.i].fr || idx.docs[s.i].name })),
      traits: top[0] ? explainPair(idx, top[0].i, c.i, c.list[0].cf, nameOf(idx, top[0].i)) : [],
    };
  };
  const out = (list) => list.map((c) => card(idx, c.i, explain(c)));

  released.sort((a, b) => b.score - a.score);
  const forYou = diversify(idx, released, 30);

  // Les pépites : bien notées par assez de monde pour qu'on y croie (8 votes),
  // assez peu pour que tu ne les connaisses probablement pas (80), et parmi
  // les 500 jeux qui te correspondent le mieux — pas une rareté hors sujet.
  const gems = diversify(
    idx,
    released
      .slice(0, 500)
      .filter((c) => {
        const d = idx.docs[c.i];
        return d.ratingCount >= 8 && d.ratingCount <= 80 && c.q >= 0.55;
      })
      .map((c) => ({ ...c, score: c.gemScore }))
      .sort((a, b) => b.score - a.score),
    20,
    { lambda: 0.3 }
  );

  upcoming.sort((a, b) => b.score - a.score);
  const soon = diversify(idx, upcoming, 20, { lambda: 0.3 });

  // « Parce que tu as adoré X » : tes jeux les plus aimés, en évitant deux
  // rangées pour deux jeux jumeaux (Dark Souls II et III).
  const because = [];
  const railSeeds = [];
  for (const s of pos) {
    if (because.length >= 5) break;
    if (s.w < 1.2) break;
    if (railSeeds.some((r) => dot(idx, r.i, s.i) > 0.55)) continue;
    const games = neighbors(idx, s.i)
      // Une rangée nommée d'après un jeu doit tenir sa promesse : des jeux
      // qui lui ressemblent VRAIMENT (0,2), et que d'autres ont assez joués
      // pour qu'on ne tombe pas sur un inconnu à 5 votes.
      .filter(([j, sim]) => {
        const d = idx.docs[j];
        return sim >= 0.2 && !unfit(d) && !known(d) && isReleased(d, now) && d.ratingCount >= 10;
      })
      .map(([j, sim, cf]) => {
        const d = idx.docs[j];
        const score = sim * (0.5 + 0.5 * quality(d)) * (0.5 + 0.5 * popularity(d)) * habitFactor(d, taste);
        return { i: j, score, sim, cf };
      })
      .sort((a, b) => b.score - a.score);
    const picked = diversify(idx, games, 12, { lambda: 0.25 });
    if (picked.length < 6) continue;
    railSeeds.push(s);
    because.push({
      seed: { id: idx.docs[s.i].id, name: idx.docs[s.i].fr || idx.docs[s.i].name },
      games: picked.map((c) =>
        card(idx, c.i, {
          score: Math.round(c.score * 1000) / 1000,
          traits: explainPair(idx, s.i, c.i, c.cf, nameOf(idx, s.i)),
        })
      ),
    });
  }

  return {
    forYou: out(forYou),
    because,
    gems: out(gems),
    upcoming: out(soon),
    seeds: pos.length,
  };
}

/**
 * Les jeux qui ressemblent à `gameId` — le remplaçant des `similar_games`
 * d'IGDB sur une fiche. Si `userId` est fourni, sa bibliothèque est écartée.
 */
export async function similarGames(gameId, { userId = null, limit = 20 } = {}) {
  const idx = await getRecoIndex();
  if (!idx) return null;
  let i = idx.byId.get(gameId);
  if (i === undefined) {
    await ensureGameFeatures([gameId]).catch(() => 0);
    const row = await GameFeatures.findById(gameId).select(FEATURE_FIELDS).lean();
    if (!row) return [];
    i = addDoc(idx, { ...row, pool: false });
  }
  const self = idx.docs[i];
  let known = () => false;
  if (userId) {
    const lib = await UserGame.find({ user: userId }).select("gameId").lean();
    const ids = new Set(lib.map((e) => e.gameId));
    known = (d) => ids.has(d.id);
  }
  const now = nowSec();
  const ranked = neighbors(idx, i)
    .filter(([j]) => {
      const d = idx.docs[j];
      if (unfit(d) || known(d)) return false;
      // Pas le même jeu sous un autre nom (remaster, édition, original).
      if (d.parent === self.id || self.parent === d.id || (d.norm && d.norm === self.norm)) return false;
      return isReleased(d, now) ? d.ratingCount >= 3 : d.hypes >= 2;
    })
    .map(([j, sim, cf]) => {
      const d = idx.docs[j];
      // Sur une fiche, les habitudes sont celles du jeu regardé : on ne propose
      // pas un free-to-play mobile à côté d'un jeu solo sur console.
      const f =
        (d.online && !self.online ? 0.4 : 1) *
        (d.mobileOnly && !self.mobileOnly ? 0.4 : 1) *
        (d.f2p && !self.f2p ? 0.5 : 1);
      return { i: j, sim, cf, score: sim * (0.5 + 0.5 * quality(d)) * (0.75 + 0.25 * popularity(d)) * f };
    })
    .sort((a, b) => b.score - a.score);
  return diversify(idx, ranked, limit, { lambda: 0.25 }).map((c) =>
    card(idx, c.i, {
      score: Math.round(c.score * 1000) / 1000,
      traits: explainPair(idx, i, c.i, c.cf, nameOf(idx, i)),
    })
  );
}
