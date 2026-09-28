import CardBattle from "../models/CardBattle.js";
import CardBattleStat from "../models/CardBattleStat.js";
import CardOwn from "../models/CardOwn.js";
import { getCatalog, RARITY_ORDER, drawPack, storeCards, EDITION_KEYS } from "./cards.js";
import { cardStats } from "./cardStats.js";
import { FAMILY_LABELS, THEMES, MODES, PERSP, TAG_LABEL } from "./cardFacts.js";
import { grantPoints } from "./points.js";
import { recordActivity } from "./activity.js";

// ======================================================================
//  Les combats de cartes (contre le bot)
// ======================================================================
// Une manche = un OBJECTIF tiré au sort (« Sorti en 2008 », « #Zombies »,
// « Sur PlayStation »). Chacun pose une carte face cachée, on retourne :
//   - la plus proche / la seule valable gagne, l'autre est détruite ;
//   - une carte hors sujet est balayée d'office ;
//   - égalité parfaite (deux cartes valables, même année) : elles se battent
//     avec leurs types et leurs attaques, jusqu'au K.O.
// Le vainqueur marque un point ; le premier à 3 gagne la partie.
//
// Une bonne carte (rare ou mieux) qui tombe peut être SAUVÉE : un tag
// s'affiche, il faut vite montrer une carte de sa main qui le porte.
//
// Tout se décide ici — le client ne voit ni l'année ni les tags de ses cartes
// avant qu'elles ne soient retournées, et ne fait que la mise en scène.

export const DECK_SIZE = 15;
// Il faut au moins un deck complet de SES cartes pour combattre.
export const MIN_CARDS = DECK_SIZE;
export const HAND_SIZE = 5;
export const TO_WIN = 3;
const MAX_ROUNDS = 9;
export const PICK_MS = 15000;
export const RESCUE_MS = 6000;
// Le chrono s'affiche chez le client APRÈS ses animations : le serveur ne
// le tient pas à la seconde. Au-delà de cette marge, on joue à sa place.
const LATE_MS = 60000;
const MAX_LEVEL = 10;
const FIGHT_EXCHANGES = 3;
// Au-delà de ces parties dans la journée, les gains fondent (×0,25).
const FULL_GAMES_PER_DAY = 12;

export class BattleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- le hasard --------------------------------------------------------------
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function gauss() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function weighted(list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const x of list) {
    r -= x.w;
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}
const maxBy = (a, f) => a.reduce((best, x) => (f(x) > f(best) ? x : best), a[0]);
const minBy = (a, f) => a.reduce((best, x) => (f(x) < f(best) ? x : best), a[0]);
const other = (side) => (side === "you" ? "bot" : "you");
const rank = (r) => Math.max(0, RARITY_ORDER.indexOf(r));
const thisYear = () => new Date().getUTCFullYear();

// ----------------------------------------------------------------------
//  Les types : chacun en bat deux et en craint deux (Indé à part)
// ----------------------------------------------------------------------
// Si A bat B : A fait ×2 à B, et B ne fait que ×0,5 à A.
export const BEATS = {
  combat: ["sport", "tir"], // le ring bat le terrain ; au corps à corps, pas le temps de viser
  tir: ["course", "rpg"], // on vise les pneus ; une balle contre une épée
  plateforme: ["tir", "sport"], // on saute par-dessus les balles ; Mario fait déjà tous les sports
  course: ["aventure", "strategie"], // speedrun ; le rush avant que le plan soit prêt
  strategie: ["combat", "rythme"], // la tactique bat la force brute ; on impose son tempo
  simulation: ["course", "strategie"], // le vrai pilote bat le kart ; les pros parlent logistique
  aventure: ["reflexion", "plateforme"], // les énigmes du temple ; le grappin se rit des précipices
  rpg: ["arcade", "aventure"], // le grind bat le high score ; l'équipe de quatre contre le héros solo
  reflexion: ["arcade", "rythme"], // Tetris, roi de l'arcade ; rien ne presse
  sport: ["simulation", "reflexion"], // la sueur bat le tableur ; pas le temps de réfléchir
  rythme: ["plateforme", "recit"], // le tempo porte les sauts ; la musique émeut plus que les mots
  arcade: ["recit", "simulation"], // on skip les cinématiques ; le fun d'abord
  recit: ["combat", "rpg"], // la route pacifiste ; moins de stats, plus d'émotion
};

const TYPE_LABELS = {
  combat: "Combat",
  tir: "Tir",
  plateforme: "Plateforme",
  aventure: "Aventure",
  rpg: "RPG",
  strategie: "Stratégie",
  reflexion: "Réflexion",
  course: "Course",
  sport: "Sport",
  simulation: "Simulation",
  rythme: "Rythme",
  arcade: "Arcade",
  inde: "Indé",
  recit: "Récit",
};

/**
 * Le multiplicateur d'une attaque. Double type : les effets se cumulent,
 * bornés entre ×0,5 et ×2. Indé ne bat ni ne craint personne, mais frappe
 * ×1,5 une carte plus rare que lui (David contre Goliath).
 */
export function typeMult(moveType, defTypes, attRarity, defRarity) {
  if (moveType === "inde") return rank(attRarity) < rank(defRarity) ? 1.5 : 1;
  let m = 1;
  for (const d of defTypes) {
    if (d === "inde") continue;
    if (BEATS[moveType]?.includes(d)) m *= 2;
    else if (BEATS[d]?.includes(moveType)) m *= 0.5;
  }
  return Math.min(2, Math.max(0.5, m));
}

// ----------------------------------------------------------------------
//  Les objectifs
// ----------------------------------------------------------------------
// « Oui / non » : la carte colle ou elle est hors sujet.
const BINARY = ["type", "era", "platform", "exclu", "theme", "mode", "persp", "tag"];
// Le poids de chaque SORTE d'objectif (réparti ensuite entre ses valeurs) :
// sans ça, les tags — il y en a des dizaines — prendraient toute la place.
const KIND_W = {
  type: 1.3,
  year: 2.2,
  era: 1,
  record: 1.1,
  platform: 1.8,
  exclu: 0.5,
  theme: 1.6,
  mode: 0.8,
  persp: 0.8,
  tag: 2.6,
};

// Une carte, avec ses chiffres et ce qu'elle cache.
function unit(cat, id) {
  const card = cat.byId.get(id);
  const f = cat.facts.get(id) || { year: null, fam: [], themes: [], modes: [], persp: [], tags: [] };
  return { id, card, f, s: cardStats(card) };
}

function keysOf(kind, c) {
  switch (kind) {
    case "type":
      return c.s.types;
    case "era":
      return c.f.year ? [Math.floor(c.f.year / 10) * 10] : [];
    case "platform":
      return c.f.fam;
    case "exclu":
      return c.f.fam.length === 1 ? ["x"] : [];
    case "theme":
      return c.f.themes;
    case "mode":
      return c.f.modes;
    case "persp":
      return c.f.persp;
    case "tag":
      return c.f.tags;
    default:
      return [];
  }
}

function makeObj(kind, k) {
  switch (kind) {
    case "type":
      return { kind, type: k };
    case "era":
      return { kind, from: k, to: k + 9 };
    case "platform":
      return { kind, fam: k };
    case "exclu":
      return { kind };
    case "tag":
      return { kind, tag: k };
    default:
      return { kind, id: k }; // theme, mode, persp
  }
}

const objKey = (o) => `${o.kind}:${o.type ?? o.from ?? o.fam ?? o.id ?? o.tag ?? o.year ?? ""}`;
const kindGroup = (kind) => (kind === "oldest" || kind === "newest" ? "record" : kind);

export function check(o, c) {
  switch (o.kind) {
    case "type":
      return c.s.types.includes(o.type);
    case "era":
      return c.f.year != null && c.f.year >= o.from && c.f.year <= o.to;
    case "platform":
      return c.f.fam.includes(o.fam);
    case "exclu":
      return c.f.fam.length === 1;
    case "theme":
      return c.f.themes.includes(o.id);
    case "mode":
      return c.f.modes.includes(o.id);
    case "persp":
      return c.f.persp.includes(o.id);
    case "tag":
      return c.f.tags.includes(o.tag);
    default:
      return false;
  }
}

function objLabel(o) {
  switch (o.kind) {
    case "type":
      return TYPE_LABELS[o.type] || o.type;
    case "year":
      return `Sorti en ${o.year}`;
    case "era":
      return `Années ${o.from < 2000 ? String(o.from).slice(2) : o.from}`;
    case "oldest":
      return "Le plus ancien";
    case "newest":
      return "Le plus récent";
    case "platform":
      return `Sur ${FAMILY_LABELS[o.fam] || o.fam}`;
    case "exclu":
      return "Une exclu";
    case "theme":
      return THEMES[o.id];
    case "mode":
      return MODES[o.id];
    case "persp":
      return PERSP[o.id];
    case "tag":
      return TAG_LABEL[o.tag] || o.tag;
    default:
      return "";
  }
}
const objView = (o) => ({ ...o, key: objKey(o), label: objLabel(o) });

// Le prochain objectif : jouable par les DEUX mains (au moins une carte
// valable de chaque côté pour un « oui / non »), jamais déjà tombé, et pas
// deux fois de suite la même sorte.
function nextObjective(st, cat) {
  const mine = st.you.hand.map((id) => unit(cat, id));
  const his = st.bot.hand.map((id) => unit(cat, id));
  const used = new Set(st.used);
  const groups = [];

  const count = (kind, hand) => {
    const m = new Map();
    for (const c of hand) for (const k of new Set(keysOf(kind, c))) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  for (const kind of BINARY) {
    const a = count(kind, mine);
    const b = count(kind, his);
    const items = [];
    for (const [k, na] of a) {
      if (!b.has(k)) continue;
      const obj = makeObj(kind, k);
      if (used.has(objKey(obj))) continue;
      // Toute ma main colle : ce n'est plus un défi (sauf les types, visibles :
      // là, la question est QUELLE carte envoyer au combat).
      const w = na === mine.length && kind !== "type" ? 0.12 : 1;
      items.push({ obj, w });
    }
    if (items.length) groups.push({ kind, w: KIND_W[kind], items });
  }

  // « Sorti en … » : une année proche de celles des mains.
  const years = [...mine, ...his].map((c) => c.f.year).filter(Boolean);
  if (years.length) {
    const lo = 1980;
    const hi = thisYear();
    const items = [];
    for (let i = 0; i < 4; i++) {
      const y = Math.min(Math.max(pick(years) + rnd(7) - 3, lo), hi);
      const obj = { kind: "year", year: y };
      if (!used.has(objKey(obj)) && !items.some((x) => x.obj.year === y)) items.push({ obj, w: 1 });
    }
    if (items.length) groups.push({ kind: "year", w: KIND_W.year, items });
  }

  // Le plus ancien / le plus récent.
  const rec = ["oldest", "newest"].map((kind) => ({ obj: { kind }, w: 1 })).filter((x) => !used.has(objKey(x.obj)));
  if (rec.length) groups.push({ kind: "record", w: KIND_W.record, items: rec });

  const pool = groups.filter((g) => g.kind !== st.lastKind);
  const g = weighted(pool.length ? pool : groups.length ? groups : [{ w: 1, items: [{ obj: { kind: "oldest" }, w: 1 }] }]);
  return weighted(g.items).obj;
}

// ----------------------------------------------------------------------
//  Le bot
// ----------------------------------------------------------------------
// Il connaît les jeux… à peu près : plus son niveau monte, plus il sait
// (chance de connaître un tag, une console) et plus il date juste.
function botChoice(st, cat, o) {
  const L = st.level;
  const pKnow = Math.min(0.9, 0.4 + 0.05 * L);
  const noise = Math.max(1.2, 7.5 - 0.65 * L);
  const hand = st.bot.hand.map((id) => unit(cat, id));
  const power = (c) => c.s.hp + Math.max(...c.s.moves.map((m) => m.dmg)) * 1.5;
  const guess = (c) => (c.f.year ?? 2005) + gauss() * noise;
  if (o.kind === "year") return minBy(hand.map((c) => ({ c, d: Math.abs(guess(c) - o.year) })), (x) => x.d).c.id;
  if (o.kind === "oldest") return minBy(hand.map((c) => ({ c, y: guess(c) })), (x) => x.y).c.id;
  if (o.kind === "newest") return maxBy(hand.map((c) => ({ c, y: guess(c) })), (x) => x.y).c.id;
  const valid = hand.filter((c) => check(o, c));
  const knows = Math.random() < (o.kind === "type" ? 0.95 : pKnow);
  if (valid.length && knows) return (Math.random() < 0.55 ? maxBy(valid, power) : pick(valid)).id;
  return pick(hand).id;
}

// ----------------------------------------------------------------------
//  Le verdict d'une manche
// ----------------------------------------------------------------------
function judge(o, a, b) {
  if (o.kind === "year") {
    const da = Math.abs((a.f.year ?? 0) - o.year);
    const db = Math.abs((b.f.year ?? 0) - o.year);
    if (da !== db) return { winner: da < db ? "you" : "bot", reason: "closer" };
    return { fight: true, reason: "tie" };
  }
  if (o.kind === "oldest" || o.kind === "newest") {
    if (a.f.year !== b.f.year) {
      const older = (a.f.year ?? 9999) < (b.f.year ?? 9999) ? "you" : "bot";
      return { winner: o.kind === "oldest" ? older : other(older), reason: "record" };
    }
    return { fight: true, reason: "tie" };
  }
  const va = check(o, a);
  const vb = check(o, b);
  if (va && vb) return { fight: true, reason: "both" };
  if (va) return { winner: "you", reason: "offtopic", wiped: { bot: true } };
  if (vb) return { winner: "bot", reason: "offtopic", wiped: { you: true } };
  return { winner: null, reason: "offtopic2", wiped: { you: true, bot: true } };
}

// Le combat : chaque carte frappe avec sa meilleure attaque (type compris), à
// tour de rôle, trois échanges au plus. Personne à terre au bout ? La moins
// en forme (en proportion de ses PV) tombe : K.O. technique.
// Frappe en premier : l'avantage de type, sinon la plus fragile (le petit a
// l'initiative), sinon le joueur.
function fight(a, b) {
  const best = (att, def) =>
    att.s.moves
      .map((m, i) => {
        const mult = typeMult(m.type, def.s.types, att.card.rarity, def.card.rarity);
        return { i, type: m.type, mult, dmg: Math.round(m.dmg * mult) };
      })
      .reduce((p, q) => (q.dmg > p.dmg ? q : p));
  const mv = { you: best(a, b), bot: best(b, a) };
  let first;
  if (mv.you.mult !== mv.bot.mult) first = mv.you.mult > mv.bot.mult ? "you" : "bot";
  else if (a.s.hp !== b.s.hp) first = a.s.hp < b.s.hp ? "you" : "bot";
  else first = "you";

  const hp0 = { you: a.s.hp, bot: b.s.hp };
  const hp = { ...hp0 };
  const order = first === "you" ? ["you", "bot"] : ["bot", "you"];
  const log = [];
  let ko = null;
  outer: for (let ex = 0; ex < FIGHT_EXCHANGES; ex++) {
    for (const side of order) {
      const foe = other(side);
      hp[foe] = Math.max(0, hp[foe] - mv[side].dmg);
      log.push({
        by: side,
        move: mv[side].i,
        type: mv[side].type,
        dmg: mv[side].dmg,
        mult: mv[side].mult,
        hp: { ...hp },
      });
      if (!hp[foe]) {
        ko = foe;
        break outer;
      }
    }
  }
  let tech = false;
  if (!ko) {
    tech = true;
    const ra = hp.you / hp0.you;
    const rb = hp.bot / hp0.bot;
    ko = ra < rb ? "you" : rb < ra ? "bot" : order[1];
  }
  return { first, hp0, log, ko, tech };
}

// Le sauvetage : une question sur la main du perdant, à laquelle AU MOINS
// une carte répond — et pas toutes. Les tags d'abord (c'est leur rôle), puis
// les thèmes, consoles, modes, vues. La valeur la plus rare de la main.
const ASK_KINDS = ["tag", "theme", "platform", "mode", "persp"];
function rescueAsk(cat, handIds) {
  const hand = handIds.map((id) => unit(cat, id));
  if (!hand.length) return null;
  for (const kind of ASK_KINDS) {
    const m = new Map();
    for (const c of hand) for (const k of new Set(keysOf(kind, c))) m.set(k, (m.get(k) || 0) + 1);
    const ok = [...m].filter(([, n]) => n < hand.length || hand.length === 1);
    if (!ok.length) continue;
    const minN = Math.min(...ok.map(([, n]) => n));
    const [k] = pick(ok.filter(([, n]) => n === minN));
    return makeObj(kind, k);
  }
  return null;
}

// ----------------------------------------------------------------------
//  Le déroulé
// ----------------------------------------------------------------------
function refill(st) {
  for (const side of ["you", "bot"]) {
    const p = st[side];
    while (p.hand.length < HAND_SIZE && p.deck.length) p.hand.push(p.deck.pop());
  }
}

function startRound(st, cat) {
  st.n++;
  const obj = nextObjective(st, cat);
  st.used.push(objKey(obj));
  st.lastKind = kindGroup(obj.kind);
  st.cur = { obj, at: Date.now(), bot: botChoice(st, cat, obj) };
}

// Fin de manche : on complète les mains, puis manche suivante ou fin.
function advance(st, cat) {
  refill(st);
  const done =
    st.score.you >= TO_WIN ||
    st.score.bot >= TO_WIN ||
    st.n >= MAX_ROUNDS ||
    !st.you.hand.length ||
    !st.bot.hand.length;
  if (done) {
    const w = st.score.you > st.score.bot ? "you" : st.score.bot > st.score.you ? "bot" : "draw";
    st.end = { winner: w, score: { ...st.score } };
  } else startRound(st, cat);
}

const hideCard = (cat, id, st) => ({ ...cat.byId.get(id), year: null, loan: st.loan.includes(id) });

function view(id, st, cat) {
  return {
    id: String(id),
    level: st.level,
    n: st.n,
    toWin: TO_WIN,
    score: { ...st.score },
    hand: st.you.hand.map((c) => hideCard(cat, c, st)),
    deck: st.you.deck.length,
    bot: { hand: st.bot.hand.length, deck: st.bot.deck.length },
    round: st.cur && !st.end ? { n: st.n, objective: objView(st.cur.obj), ms: PICK_MS } : null,
    pending: st.pending
      ? { card: hideCard(cat, st.pending.card, st), ask: objView(st.pending.ask), ms: RESCUE_MS }
      : null,
    end: st.end || null,
  };
}

// ----------------------------------------------------------------------
//  Palmarès et récompenses
// ----------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);

async function getStat(userId) {
  return (
    (await CardBattleStat.findOne({ user: userId }).lean()) || {
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      best: 0,
      level: 1,
      day: "",
      dayGames: 0,
    }
  );
}

function statView(s) {
  return {
    wins: s.wins || 0,
    losses: s.losses || 0,
    draws: s.draws || 0,
    streak: s.streak || 0,
    best: s.best || 0,
    level: s.level || 1,
    maxLevel: MAX_LEVEL,
    today: s.day === today() ? s.dayGames || 0 : 0,
    fullGames: FULL_GAMES_PER_DAY,
    claimable: passView(s).claimable,
  };
}

// ----------------------------------------------------------------------
//  La passe : des étoiles, dix paliers, un booster par palier
// ----------------------------------------------------------------------
// Une victoire donne 2 étoiles (3 si elle est parfaite), une défaite 1 si on a
// gagné au moins une manche. Chaque palier débloque un booster — les éditions
// tournent (Origines, Néon, Braise…) — et le dernier un booster DORÉ. Pas de
// date limite : une fois tous les boosters récupérés, la saison suivante
// repart de zéro.
export const PASS_TIERS = [3, 3, 4, 4, 5, 5, 6, 6, 7, 8];
const PASS_NEED = PASS_TIERS.reduce((acc, n) => [...acc, (acc.at(-1) || 0) + n], []);
const PASS_TOTAL = PASS_NEED.at(-1);
// Les éditions tournent dans l'ordre de la boutique : Origines, Néon, Braise.
const PASS_EDITIONS = ["origines", "neon", "braise"].filter((k) => EDITION_KEYS.includes(k));
const tierEdition = (t) => PASS_EDITIONS[(t - 1) % PASS_EDITIONS.length];

function passView(s) {
  const stars = Math.min(PASS_TOTAL, s?.passStars || 0);
  const claimed = s?.passClaimed || [];
  const tiers = PASS_NEED.map((need, i) => ({
    n: i + 1,
    need,
    from: i ? PASS_NEED[i - 1] : 0,
    edition: tierEdition(i + 1),
    golden: i === PASS_NEED.length - 1,
    done: stars >= need,
    claimed: claimed.includes(i + 1),
  }));
  return {
    season: s?.passSeason || 1,
    stars,
    total: PASS_TOTAL,
    tiers,
    claimable: tiers.filter((t) => t.done && !t.claimed).length,
  };
}

// Le gain : moins de points qu'avant (un booster coûte 500) — c'est la passe
// qui récompense vraiment. 40 + 10 par manche d'avance (3-0 → 70), ×(1 + 5 %
// par niveau du bot), +5 % par victoire d'affilée (jusqu'à +25 %). Une
// défaite rapporte 10 + 5 par manche gagnée. Arrondi à 5.
function rewardFor(st, stat) {
  const w = st.end.winner;
  const dayGames = stat.day === today() ? stat.dayGames || 0 : 0;
  const streak = w === "you" ? (stat.streak || 0) + 1 : 0;
  const base = w === "you" ? 40 + 10 * (TO_WIN - st.score.bot) : w === "draw" ? 30 : 10 + 5 * st.score.you;
  const levelMul = 1 + 0.05 * (st.level - 1);
  const streakMul = w === "you" ? 1 + Math.min(0.25, 0.05 * (streak - 1)) : 1;
  const tired = dayGames >= FULL_GAMES_PER_DAY;
  const perfect = w === "you" && st.score.bot === 0;
  // Un abandon ne rapporte rien : sinon, quitter dès la 2ᵉ manche paierait
  // plus vite que jouer. Même règle pour les étoiles. Après la douzaine de
  // parties du jour, la passe avance au ralenti : une étoile par victoire,
  // rien sur une défaite (la couper net donnait l'impression d'une passe en
  // panne — plus rien ne bougeait, sans qu'on comprenne pourquoi).
  const quit = !!st.end.quit;
  const points = quit ? 0 : Math.max(5, Math.round((base * levelMul * streakMul * (tired ? 0.25 : 1)) / 5) * 5);
  const stars = quit ? 0 : tired ? (w === "you" ? 1 : 0) : w === "you" ? (perfect ? 3 : 2) : st.score.you > 0 ? 1 : 0;
  const to = w === "you" ? Math.min(MAX_LEVEL, st.level + 1) : w === "bot" ? Math.max(1, st.level - 1) : st.level;
  return {
    points,
    stars,
    base,
    levelMul,
    streakMul,
    tired,
    perfect,
    streak,
    best: Math.max(stat.best || 0, streak),
    level: { from: st.level, to },
    dayGames: dayGames + 1,
  };
}

// Écrit le palmarès et verse les points (une seule fois : appelé après
// l'écriture de l'état final, protégée par `rev`).
async function payOut(userId, st) {
  const r = st.end.reward;
  const w = st.end.winner;
  const inc = w === "you" ? { wins: 1 } : w === "bot" ? { losses: 1 } : { draws: 1 };
  const before = passView(await getStat(userId));
  const s = await CardBattleStat.findOneAndUpdate(
    { user: userId },
    {
      $inc: inc,
      $set: {
        streak: r.streak,
        best: r.best,
        level: r.level.to,
        day: today(),
        dayGames: r.dayGames,
        passStars: Math.min(PASS_TOTAL, before.stars + (r.stars || 0)),
      },
    },
    { upsert: true, new: true }
  ).lean();
  const after = passView(s);
  const balance = r.points
    ? await grantPoints(userId, r.points, "cardbattle", { score: st.end.score, level: st.level })
    : null;
  // Pour l'écran de fin : la barre avant / après, et les paliers franchis.
  const pass = {
    ...after,
    before: before.stars,
    gained: after.stars - before.stars,
    unlocked: after.tiers.filter((t) => t.done && before.stars < t.need).map((t) => t.n),
  };
  return { stats: statView(s), balance, pass };
}

// ----------------------------------------------------------------------
//  Lecture / écriture d'une partie
// ----------------------------------------------------------------------
async function loadLive(userId, id) {
  const doc = await CardBattle.findOne({ _id: id, user: userId, live: true }).lean().catch(() => null);
  if (!doc) throw new BattleError(404, "Partie introuvable.");
  return doc;
}

async function save(doc, st) {
  const r = await CardBattle.updateOne(
    { _id: doc._id, rev: doc.rev },
    { $set: { state: st, live: !st.end, updatedAt: new Date() }, $inc: { rev: 1 } }
  );
  if (!r.modifiedCount) throw new BattleError(409, "La manche a déjà été jouée.");
}

async function catalogReady() {
  const cat = await getCatalog();
  if (!cat?.facts || cat.size < 100) throw new BattleError(503, "Les cartes se préparent, reviens dans un instant.");
  return cat;
}

// ----------------------------------------------------------------------
//  L'API
// ----------------------------------------------------------------------

/** Le palmarès, et la partie en cours s'il y en a une. */
export async function battleHome(userId) {
  const [stat, doc, cards] = await Promise.all([
    getStat(userId),
    CardBattle.findOne({ user: userId, live: true }).sort({ updatedAt: -1 }).lean(),
    CardOwn.countDocuments({ user: userId }),
  ]);
  let live = null;
  if (doc) {
    const cat = await catalogReady();
    live = view(doc._id, doc.state, cat);
  }
  return { stats: statView(stat), pass: passView(stat), live, cards, minCards: MIN_CARDS };
}

/**
 * Récupérer le booster d'un palier : tiré comme un booster acheté (le
 * dernier palier donne un booster doré), rangé dans le classeur. Le palier
 * est marqué AVANT le tirage (une seule requête passe) et rendu si le
 * rangement échoue.
 */
export async function claimPassTier(userId, tierRaw) {
  const cat = await catalogReady();
  const tier = Number(tierRaw);
  if (!Number.isInteger(tier) || tier < 1 || tier > PASS_TIERS.length) throw new BattleError(400, "Palier inconnu.");
  const stat = await getStat(userId);
  const need = PASS_NEED[tier - 1];
  const s = await CardBattleStat.findOneAndUpdate(
    {
      user: userId,
      passSeason: stat.passSeason || 1,
      passStars: { $gte: need },
      passClaimed: { $ne: tier },
    },
    { $push: { passClaimed: tier } },
    { new: true }
  ).lean();
  if (!s) throw new BattleError(409, "Ce booster n'est pas (ou plus) à récupérer.");

  const edition = tierEdition(tier);
  const golden = tier === PASS_TIERS.length;
  let ids;
  let isGold;
  let counts;
  try {
    ({ ids, golden: isGold } = drawPack(cat, edition, golden || undefined));
    counts = await storeCards(userId, ids);
  } catch (e) {
    await CardBattleStat.updateOne({ user: userId }, { $pull: { passClaimed: tier } });
    throw e;
  }

  // Tout est récupéré : la saison suivante repart de zéro.
  let fresh = s;
  if ((s.passClaimed || []).length >= PASS_TIERS.length) {
    fresh =
      (await CardBattleStat.findOneAndUpdate(
        { user: userId, passSeason: s.passSeason || 1 },
        { $set: { passSeason: (s.passSeason || 1) + 1, passStars: 0, passClaimed: [] } },
        { new: true }
      ).lean()) || s;
  }

  recordActivity({
    actor: userId,
    type: "card_pack",
    meta: { cards: ids, news: ids.filter((id) => counts.get(id) === 1), golden: isGold, edition, pass: tier },
  });

  return {
    golden: isGold,
    edition,
    tier,
    cards: ids.map((id) => ({ ...cat.byId.get(id), count: counts.get(id), isNew: counts.get(id) === 1 })),
    pass: passView(fresh),
  };
}

/** Nouvelle partie : 15 cartes au hasard de son classeur, le bot en face. */
export async function startBattle(userId) {
  const cat = await catalogReady();
  const stat = await getStat(userId);
  const level = stat.level || 1;

  const owned = await CardOwn.find({ user: userId }).select("card").lean();
  const pool = owned.map((o) => o.card).filter((id) => cat.byId.has(id));
  if (pool.length < MIN_CARDS)
    throw new BattleError(403, `Il te faut ${MIN_CARDS} cartes pour combattre (tu en as ${pool.length}).`);
  const mine = shuffle(pool).slice(0, DECK_SIZE);
  const loan = [];
  // Le bot joue à armes égales : autant de cartes de chaque rareté que nous.
  const bot = [];
  for (const id of mine) {
    const list = cat.byRarity[cat.byId.get(id).rarity] || cat.byRarity.common;
    let x;
    let tries = 0;
    do x = pick(list);
    while ((bot.includes(x) || mine.includes(x)) && ++tries < 30);
    bot.push(x);
  }

  const st = {
    v: 2,
    level,
    n: 0,
    score: { you: 0, bot: 0 },
    you: { deck: shuffle(mine), hand: [], out: [] },
    bot: { deck: shuffle(bot), hand: [], out: [] },
    loan,
    used: [],
    lastKind: null,
    cur: null,
    pending: null,
    end: null,
  };
  refill(st);
  startRound(st, cat);

  // Une seule partie à la fois. L'ancienne, si elle était entamée, compte
  // comme un abandon (défaite, sans gain) : sinon « Nouvelle partie »
  // effacerait toute partie mal engagée et garderait la série intacte.
  const old = await CardBattle.find({ user: userId, live: true }).lean();
  for (const d of old) {
    const played = d.state.n > 1 || d.state.score.you + d.state.score.bot > 0;
    const r = await CardBattle.updateOne({ _id: d._id, rev: d.rev }, { $set: { live: false } });
    if (played && r.modifiedCount) {
      d.state.end = { winner: "bot", score: { ...d.state.score }, quit: true };
      d.state.end.reward = rewardFor(d.state, await getStat(userId));
      await payOut(userId, d.state);
    }
  }
  const doc = await CardBattle.create({ user: userId, state: st });
  return view(doc._id, st, cat);
}

/** Je pose une carte : le verdict de la manche, puis la suite. */
export async function playRound(userId, id, cardId) {
  const cat = await catalogReady();
  const doc = await loadLive(userId, id);
  const st = doc.state;
  if (st.end || st.pending || !st.cur) throw new BattleError(409, "Rien à jouer.");
  let mine = Number(cardId);
  if (!st.you.hand.includes(mine)) throw new BattleError(400, "Cette carte n'est pas dans ta main.");
  if (Date.now() - st.cur.at > PICK_MS + LATE_MS) mine = pick(st.you.hand);

  const o = st.cur.obj;
  const his = st.cur.bot;
  st.you.hand = st.you.hand.filter((x) => x !== mine);
  st.bot.hand = st.bot.hand.filter((x) => x !== his);
  const a = unit(cat, mine);
  const b = unit(cat, his);

  const j = judge(o, a, b);
  let winner = j.winner ?? null;
  let fightRes = null;
  if (j.fight) {
    fightRes = fight(a, b);
    winner = other(fightRes.ko);
  }
  const wiped = { you: !!j.wiped?.you, bot: !!j.wiped?.bot };
  const loser = winner ? other(winner) : null;

  // Le sort des deux cartes : la gagnante revient en main, la perdante part…
  // sauf sauvetage (seulement une carte rare ou mieux, battue à la loyale).
  // Pas de sauvetage quand cette manche termine la partie : sauver une carte
  // pour une partie déjà perdue ne sert à rien.
  const back = { you: winner === "you", bot: winner === "bot" };
  let botRescue = null;
  let pending = null;
  const decisive = (winner && st.score[winner] + 1 >= TO_WIN) || st.n >= MAX_ROUNDS;
  if (loser && !decisive && !wiped[loser] && rank((loser === "you" ? a : b).card.rarity) >= 2) {
    if (loser === "bot") {
      const ask = rescueAsk(cat, st.bot.hand);
      if (ask) {
        const can = st.bot.hand.some((x) => check(ask, unit(cat, x)));
        const saved = can && Math.random() < 0.3 + 0.04 * st.level;
        botRescue = { ask: objView(ask), saved };
        if (saved) back.bot = true;
      }
    } else {
      const ask = rescueAsk(cat, st.you.hand);
      if (ask) pending = { card: mine, ask, at: Date.now() };
    }
  }
  if (winner) st.score[winner]++;
  if (back.you) st.you.hand.push(mine);
  else if (!pending) st.you.out.push(mine);
  if (back.bot) st.bot.hand.push(his);
  else st.bot.out.push(his);

  const reveal = (u, side) => ({
    card: { ...u.card, loan: side === "you" && st.loan.includes(u.id) },
    year: u.f.year,
    valid: BINARY.includes(o.kind) ? check(o, u) : null,
  });
  const result = {
    n: st.n,
    objective: objView(o),
    you: reveal(a, "you"),
    bot: reveal(b, "bot"),
    winner,
    reason: j.reason,
    wiped,
    fight: fightRes,
    botRescue,
    score: { ...st.score },
  };

  st.cur = null;
  if (pending) st.pending = pending;
  else advance(st, cat);
  return finishTurn(userId, doc, st, cat, { result });
}

/** Le sauvetage : la carte montrée porte-t-elle le tag ? */
export async function rescueRound(userId, id, cardId) {
  const cat = await catalogReady();
  const doc = await loadLive(userId, id);
  const st = doc.state;
  const p = st.pending;
  if (!p) throw new BattleError(409, "Rien à sauver.");
  const chosen = cardId == null ? null : Number(cardId);
  const late = Date.now() - p.at > RESCUE_MS + LATE_MS;
  const saved = !late && chosen != null && st.you.hand.includes(chosen) && check(p.ask, unit(cat, chosen));
  // Les bonnes réponses, pour les montrer en cas d'échec.
  const answers = st.you.hand.filter((x) => check(p.ask, unit(cat, x)));
  if (saved) st.you.hand.push(p.card);
  else st.you.out.push(p.card);
  st.pending = null;
  advance(st, cat);
  return finishTurn(userId, doc, st, cat, { rescue: { saved, card: p.card, pick: chosen, answers } });
}

/** Quitter : une défaite, si au moins une manche a été jouée. */
export async function quitBattle(userId, id) {
  const cat = await catalogReady();
  const doc = await loadLive(userId, id);
  const st = doc.state;
  const played = st.n > 1 || st.score.you + st.score.bot > 0;
  if (!played) {
    await CardBattle.updateOne({ _id: doc._id }, { $set: { live: false } });
    return { stats: statView(await getStat(userId)) };
  }
  st.cur = null;
  st.pending = null;
  st.end = { winner: "bot", score: { ...st.score }, quit: true };
  const out = await finishTurn(userId, doc, st, cat, {});
  return { stats: out.state.end?.stats || statView(await getStat(userId)) };
}

// L'état est écrit (une seule requête passe grâce à `rev`), puis, si la
// partie vient de finir, on verse les gains.
async function finishTurn(userId, doc, st, cat, extra) {
  const ended = !!st.end && !st.end.reward;
  if (ended) st.end.reward = rewardFor(st, await getStat(userId));
  await save(doc, st);
  if (ended) {
    const { stats, balance, pass } = await payOut(userId, st);
    st.end.stats = stats;
    st.end.balance = balance;
    st.end.pass = pass;
    CardBattle.updateOne({ _id: doc._id }, { $set: { "state.end": st.end } }).catch(() => {});
  }
  return { ...extra, state: view(doc._id, st, cat) };
}

// ----------------------------------------------------------------------
//  Pour les duels entre joueurs (lib/cardDuel.js)
// ----------------------------------------------------------------------
// Les mêmes règles, à la lettre : objectifs, verdict, combat, sauvetage,
// passe. Seuls changent le rythme (deux humains) et le palmarès.
export const engine = {
  MAX_ROUNDS,
  LATE_MS,
  FULL_GAMES_PER_DAY,
  PASS_TOTAL,
  BINARY,
  rnd,
  pick,
  shuffle,
  rank,
  unit,
  check,
  objKey,
  objView,
  kindGroup,
  nextObjective,
  judge,
  fight,
  rescueAsk,
  refill,
  hideCard,
  getStat,
  statView,
  passView,
  today,
  catalogReady,
};
