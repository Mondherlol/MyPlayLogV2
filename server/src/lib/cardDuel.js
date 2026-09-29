import CardDuel from "../models/CardDuel.js";
import CardBattleStat from "../models/CardBattleStat.js";
import CardOwn from "../models/CardOwn.js";
import User from "../models/User.js";
import { emitTo, onlineAmong } from "./realtime.js";
import { grantPoints } from "./points.js";
import { recordActivity } from "./activity.js";
import { makeCode, makeRoomQueue, makeClock } from "./versusRoom.js";
import { engine as E, bestCards, DECK_SIZE, MIN_CARDS, TO_WIN, PICK_MS, RESCUE_MS, BattleError } from "./cardBattle.js";

// ======================================================================
//  Les duels de cartes : 1 contre 1, en temps réel
// ======================================================================
// Les règles sont celles du combat contre le bot (lib/cardBattle.js), à la
// lettre : même objectif pour les deux, cartes posées face cachée, verdict,
// combat de types, sauvetage. Ce qui change, c'est qu'en face il y a quelqu'un
// — donc un RYTHME à tenir à deux :
//
//   1. Une manche s'ouvre (objectif tiré). Chaque client joue ses animations
//      (distribution, « Manche 2 », la case qui s'allume), puis dit « prêt ».
//   2. Les deux prêts : « go », le chrono de 15 s part chez les deux.
//   3. Chacun pose sa carte ; l'autre voit une carte face cachée arriver.
//   4. Les deux cartes posées : verdict, diffusé aux deux.
//   5. La carte perdante (rare ou mieux) peut être sauvée : seul son
//      propriétaire répond, l'autre regarde.
//
// Personne ne peut bloquer la partie : le serveur tient le chrono. Un joueur
// qui ne dit jamais « prêt » est attendu quelques secondes, une carte qu'on ne
// pose pas part au hasard, un sauvetage sans réponse échoue. Absent deux
// manches de suite : il a abandonné.
//
// Dans l'état, l'hôte est « you » et l'invité « bot » (les noms du moteur) ;
// chaque joueur reçoit une vue remise à l'endroit, où « you » c'est lui.

const EVENT = "cardduel";
// Le chrono du client part à la réception du « go » : on lui laisse cette
// marge avant de jouer à sa place.
const GRACE_MS = 3000;
// Un joueur prêt attend l'autre au plus ce temps-là (moins s'il est
// déconnecté : il ne reviendra sans doute pas dans la seconde).
const READY_WAIT_MS = 10000;
const OFFLINE_WAIT_MS = 4000;
// Personne n'a dit « prêt » (deux onglets fermés ?) : on force au bout de…
const ROUND_WAIT_MS = 45000;
// Le sauvetage s'affiche après le verdict (animations comprises) : au-delà,
// la carte tombe.
const RESCUE_WAIT_MS = 30000;
// Deux manches d'affilée sans donner signe de vie : abandon.
const MAX_ABSENT = 2;

const sw = (x) => (x === "you" ? "bot" : x === "bot" ? "you" : x);
const idOf = (u) => String(u?._id || u || "");
const person = (u) => (u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null);

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "guest", select: "username avatar" },
  { path: "rival", select: "username avatar" },
];

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return CardDuel.findOne({ code: String(code) }).populate(POPULATE).lean();
}
const withRoom = makeRoomQueue(loadRoom);
const clock = makeClock(EVENT);

// Le côté d'un joueur dans le salon (« you » = l'hôte, « bot » = l'invité).
function sideOf(room, userId) {
  if (idOf(room.host) === String(userId)) return "you";
  if (room.guest && idOf(room.guest) === String(userId)) return "bot";
  return null;
}
const userOf = (room, side) => (side === "you" ? room.host : room.guest);
const members = (room) =>
  [
    ["you", idOf(room.host)],
    ["bot", room.guest ? idOf(room.guest) : null],
  ].filter(([, id]) => id);

async function save(room, patch) {
  const r = await CardDuel.updateOne(
    { _id: room._id, rev: room.rev },
    { $set: { ...patch, updatedAt: new Date() }, $inc: { rev: 1 } }
  );
  if (!r.modifiedCount) throw new BattleError(409, "La partie a bougé entre-temps, réessaie.");
  room.rev += 1;
  Object.assign(room, patch);
}

// ----------------------------------------------------------------------
//  Les vues : chacun de son côté
// ----------------------------------------------------------------------
const sides = (o, side) => (side === "you" ? { ...o } : { you: o.bot, bot: o.you });

function flipResult(r, side) {
  if (side === "you" || !r) return r;
  const f = r.fight;
  return {
    ...r,
    you: r.bot,
    bot: r.you,
    winner: sw(r.winner),
    wiped: sides(r.wiped, side),
    score: sides(r.score, side),
    fight: f && {
      ...f,
      first: sw(f.first),
      ko: sw(f.ko),
      hp0: sides(f.hp0, side),
      log: f.log.map((h) => ({ ...h, by: sw(h.by), hp: sides(h.hp, side) })),
    },
  };
}

// Le sauvetage vu par l'autre : réussi ou non, sans la main de celui qui sauve.
function rescueFor(rs, side) {
  if (!rs) return null;
  const mine = rs.side === side;
  return {
    side: mine ? "you" : "bot",
    saved: rs.saved,
    card: rs.card,
    ask: rs.ask,
    ...(mine ? { pick: rs.pick, answers: rs.answers } : {}),
  };
}

function endFor(end, side) {
  if (!end) return null;
  const pay = end.pay?.[side] || {};
  return {
    winner: end.winner === "draw" ? "draw" : end.winner === side ? "you" : "bot",
    score: sides(end.score, side),
    forfeit: end.forfeit ? (end.forfeit === side ? "you" : "bot") : null,
    quit: end.forfeit === side,
    cancelled: !!end.cancelled,
    reward: end.rewards?.[side] || null,
    stats: pay.stats || null,
    balance: pay.balance ?? null,
    pass: pay.pass || null,
  };
}

function viewFor(room, st, side, cat) {
  const me = st[side];
  const opp = st[sw(side)];
  const cur = st.cur && !st.end ? st.cur : null;
  const now = Date.now();
  return {
    id: room.code,
    mode: "pvp",
    n: st.n,
    toWin: TO_WIN,
    score: sides(st.score, side),
    hand: me.hand.map((id) => E.hideCard(cat, id, { loan: [] })),
    deck: me.deck.length,
    bot: { hand: opp.hand.length, deck: opp.deck.length },
    round: cur
      ? {
          n: cur.n,
          objective: E.objView(cur.obj),
          ms: PICK_MS,
          go: !!cur.go,
          left: cur.go ? Math.max(0, cur.go + PICK_MS - now) : PICK_MS,
          mine: cur.picks[side] ?? null,
          his: cur.picks[sw(side)] != null,
        }
      : null,
    pending:
      st.pending && st.pending.side === side
        ? { card: E.hideCard(cat, st.pending.card, { loan: [] }), ask: E.objView(st.pending.ask), ms: RESCUE_MS }
        : null,
    // La carte de l'adversaire en danger : il cherche à la sauver.
    danger: st.pending && st.pending.side !== side ? { ask: E.objView(st.pending.ask) } : null,
    last: st.last
      ? { n: st.last.n, result: flipResult(st.last.result, side), rescue: rescueFor(st.last.rescue, side) }
      : null,
    end: endFor(st.end, side),
    opponent: person(userOf(room, sw(side))),
  };
}

function roomView(room, userId) {
  const side = sideOf(room, userId);
  const ids = members(room).map(([, id]) => id);
  const online = onlineAmong(ids);
  const head = (u) => (u ? { ...person(u), online: online.has(idOf(u)) } : null);
  return {
    code: room.code,
    status: room.status,
    host: head(room.host),
    guest: head(room.guest),
    rival: room.rival ? { ...person(room.rival), online: onlineAmong([idOf(room.rival)]).size > 0 } : null,
    member: !!side,
    isHost: side === "you",
    next: room.next || null,
    minCards: MIN_CARDS,
    toWin: TO_WIN,
  };
}

// La même annonce aux deux, chacun avec sa vue.
function emitEach(room, kind, build = () => ({})) {
  for (const [side, id] of members(room)) emitTo([id], EVENT, { code: room.code, kind, ...build(side) });
}

// ----------------------------------------------------------------------
//  Le déroulé
// ----------------------------------------------------------------------
async function deckOf(userId, cat) {
  const owned = await CardOwn.find({ user: userId }).select("card").lean();
  const pool = owned.map((o) => o.card).filter((id) => cat.byId.has(id));
  if (pool.length < MIN_CARDS)
    throw new BattleError(403, `Il te faut ${MIN_CARDS} cartes pour combattre (tu en as ${pool.length}).`);
  return E.shuffle(pool).slice(0, DECK_SIZE);
}

function openRound(st, cat) {
  st.n++;
  const obj = E.nextObjective(st, cat);
  st.used.push(E.objKey(obj));
  st.lastKind = E.kindGroup(obj.kind);
  st.cur = {
    n: st.n,
    obj,
    open: Date.now(),
    go: null,
    picks: { you: null, bot: null },
    ready: { you: false, bot: false },
  };
}

// Fin de manche : on complète les mains, puis manche suivante ou fin.
function advance(st, cat) {
  E.refill(st);
  const done =
    st.score.you >= TO_WIN ||
    st.score.bot >= TO_WIN ||
    st.n >= E.MAX_ROUNDS ||
    !st.you.hand.length ||
    !st.bot.hand.length;
  if (done) {
    const w = st.score.you > st.score.bot ? "you" : st.score.bot > st.score.you ? "bot" : "draw";
    st.end = { winner: w, score: { ...st.score } };
  } else openRound(st, cat);
}

// Le verdict, une fois les deux cartes posées (même logique que playRound).
function resolve(st, cat) {
  const cur = st.cur;
  const o = cur.obj;
  const ids = { you: cur.picks.you, bot: cur.picks.bot };
  st.you.hand = st.you.hand.filter((x) => x !== ids.you);
  st.bot.hand = st.bot.hand.filter((x) => x !== ids.bot);
  const u = { you: E.unit(cat, ids.you), bot: E.unit(cat, ids.bot) };

  const j = E.judge(o, u.you, u.bot);
  let winner = j.winner ?? null;
  let fightRes = null;
  if (j.fight) {
    fightRes = E.fight(u.you, u.bot);
    winner = sw(fightRes.ko);
  }
  const wiped = { you: !!j.wiped?.you, bot: !!j.wiped?.bot };
  const loser = winner ? sw(winner) : null;

  // Pas de sauvetage quand la manche termine la partie.
  let pending = null;
  const decisive = (winner && st.score[winner] + 1 >= TO_WIN) || st.n >= E.MAX_ROUNDS;
  if (loser && !decisive && !wiped[loser] && E.rank(u[loser].card.rarity) >= 2) {
    const ask = E.rescueAsk(cat, st[loser].hand);
    if (ask) pending = { side: loser, card: ids[loser], ask, at: Date.now(), n: st.n };
  }
  if (winner) {
    st.score[winner]++;
    (st.won ||= { you: [], bot: [] })[winner].push(ids[winner]);
  }
  for (const side of ["you", "bot"]) {
    if (winner === side) st[side].hand.push(ids[side]);
    else if (pending?.side !== side) st[side].out.push(ids[side]);
  }

  const reveal = (x) => ({
    card: { ...x.card, loan: false },
    year: x.f.year,
    valid: E.BINARY.includes(o.kind) ? E.check(o, x) : null,
  });
  st.last = {
    n: st.n,
    result: {
      n: st.n,
      objective: E.objView(o),
      you: reveal(u.you),
      bot: reveal(u.bot),
      winner,
      reason: j.reason,
      wiped,
      fight: fightRes,
      score: { ...st.score },
    },
    rescue: null,
  };
  st.cur = null;
  if (pending) st.pending = pending;
  else advance(st, cat);
}

// ----------------------------------------------------------------------
//  Gains et palmarès
// ----------------------------------------------------------------------
// Un peu moins que contre le bot (pas de bonus de niveau ni de série) : on
// joue ici pour la gloire — et pour la passe, qui avance pareil.
function rewardFor(st, side, stat) {
  const end = st.end;
  const me = st.score[side];
  const him = st.score[sw(side)];
  const win = end.winner === side;
  const draw = end.winner === "draw";
  const dayGames = stat.day === E.today() ? stat.dayGames || 0 : 0;
  const tired = dayGames >= E.FULL_GAMES_PER_DAY;
  const quit = end.forfeit === side;
  // Gagner par abandon : un forfait, pas un triomphe (sinon deux comptes
  // s'offriraient des victoires en quittant à tour de rôle).
  const byForfeit = win && !!end.forfeit;
  const base = byForfeit ? 30 : win ? 40 + 10 * (TO_WIN - him) : draw ? 30 : 10 + 5 * me;
  const perfect = win && !byForfeit && him === 0;
  const points = quit ? 0 : Math.max(5, Math.round((base * (tired ? 0.25 : 1)) / 5) * 5);
  // Après la douzaine de parties du jour : une étoile par victoire (comme
  // contre le bot).
  const stars = quit ? 0 : byForfeit || (tired && win) ? 1 : tired ? 0 : win ? (perfect ? 3 : 2) : me > 0 ? 1 : 0;
  return { points, stars, base, tired, perfect, byForfeit, dayGames: dayGames + 1 };
}

async function payOne(userId, st, side) {
  const r = st.end.rewards[side];
  const w = st.end.winner;
  const inc = w === "draw" ? { pvpDraws: 1 } : w === side ? { pvpWins: 1 } : { pvpLosses: 1 };
  const before = E.passView(await E.getStat(userId));
  const s = await CardBattleStat.findOneAndUpdate(
    { user: userId },
    {
      $inc: inc,
      $set: {
        day: E.today(),
        dayGames: r.dayGames,
        passStars: Math.min(E.PASS_TOTAL, before.stars + (r.stars || 0)),
      },
    },
    { upsert: true, new: true }
  ).lean();
  const after = E.passView(s);
  const balance = r.points
    ? await grantPoints(userId, r.points, "cardduel", { score: sides(st.end.score, side) })
    : null;
  return {
    stats: { ...E.statView(s), duels: duelStats(s) },
    balance,
    pass: {
      ...after,
      before: before.stars,
      gained: after.stars - before.stars,
      unlocked: after.tiers.filter((t) => t.done && before.stars < t.need).map((t) => t.n),
    },
  };
}

// La partie vient de finir : l'état final d'abord (une seule écriture passe),
// les gains ensuite. Une partie annulée (personne n'a joué) ne paie rien.
async function closeGame(room, st) {
  clock.stop(room.code);
  if (!st.end.cancelled) {
    st.end.rewards = {};
    for (const [side, id] of members(room)) st.end.rewards[side] = rewardFor(st, side, await E.getStat(id));
  }
  await save(room, { state: st, status: "done" });
  if (!st.end.cancelled) {
    st.end.pay = {};
    for (const [side, id] of members(room)) st.end.pay[side] = await payOne(id, st, side);
    await CardDuel.updateOne({ _id: room._id }, { $set: { "state.end": st.end } }).catch(() => {});
    // Le fil : une ligne par joueur (chacun son résultat), que routes/feed.js
    // fusionne en UNE carte par duel (meta.duelId), comme les versus.
    const cat = await E.catalogReady().catch(() => null);
    const ms = members(room);
    for (const [side, id] of ms) {
      const foe = ms.find(([s2]) => s2 !== side);
      recordActivity({
        actor: id,
        type: "card_battle",
        target: foe?.[1] || null,
        meta: {
          mode: "duel",
          duelId: String(room._id),
          result: st.end.winner === "draw" ? "draw" : st.end.winner === side ? "win" : "loss",
          score: [st.score[side], st.score[sw(side)]],
          forfeit: !!st.end.forfeit,
          cards: cat ? bestCards(cat, st.won?.[side]) : [],
        },
      });
    }
  }
}

// Ce qui suit une écriture de l'état : fin de partie, ou le chrono de l'étape
// suivante.
async function afterStep(room, st) {
  // Une carte à sauver chez un absent : il ne répondra pas, elle tombe.
  if (st.pending && isAway(room, st.pending.side)) settleRescue(st, await E.catalogReady(), null);
  if (st.end) return closeGame(room, st);
  await save(room, { state: st });
  schedule(room, st);
}

function schedule(room, st) {
  const code = room.code;
  if (st.end) return clock.stop(code);
  if (st.pending) {
    const n = st.pending.n;
    return clock.at(code, st.pending.at + RESCUE_WAIT_MS, () => timeoutRescue(code, n));
  }
  const cur = st.cur;
  if (!cur) return clock.stop(code);
  if (cur.go) return clock.at(code, cur.go + PICK_MS + GRACE_MS, () => timeoutPick(code, cur.n));
  const oneReady = cur.ready.you || cur.ready.bot;
  if (!oneReady) return clock.at(code, cur.open + ROUND_WAIT_MS, () => forceGo(code, cur.n));
  const late = cur.ready.you ? "bot" : "you";
  const wait = isAway(room, late) ? OFFLINE_WAIT_MS : READY_WAIT_MS;
  return clock.at(code, Date.now() + wait, () => forceGo(code, cur.n));
}

// Plus connecté au direct (onglet fermé, réseau perdu).
function isAway(room, side) {
  const id = members(room).find(([s]) => s === side)?.[1];
  return !id || !onlineAmong([id]).size;
}

// ----------------------------------------------------------------------
//  Les minuteurs
// ----------------------------------------------------------------------
async function forceGo(code, n) {
  await withRoom(code, async (room) => {
    const st = room.state;
    if (room.status !== "live" || !st?.cur || st.cur.n !== n || st.cur.go) return;
    // Plus personne en ligne : la partie s'arrête là, sans vainqueur.
    const online = onlineAmong(members(room).map(([, id]) => id));
    if (!online.size) {
      st.cur = null;
      st.end = { winner: "draw", score: { ...st.score }, cancelled: true };
      return closeGame(room, st);
    }
    st.cur.go = Date.now();
    await afterStep(room, st);
    emitEach(room, "go", () => ({ n, left: PICK_MS }));
  });
}

async function timeoutPick(code, n) {
  const cat = await E.catalogReady();
  await withRoom(code, async (room) => {
    const st = room.state;
    if (room.status !== "live" || !st?.cur || st.cur.n !== n) return;
    st.absent = st.absent || { you: 0, bot: 0 };
    for (const side of ["you", "bot"]) {
      if (st.cur.picks[side] != null) continue;
      if (!st.cur.ready[side]) st.absent[side] = (st.absent[side] || 0) + 1;
      st.cur.picks[side] = E.pick(st[side].hand);
    }
    // Absent trop longtemps : c'est un abandon.
    const gone = ["you", "bot"].find((s) => st.absent[s] >= MAX_ABSENT);
    if (gone) return forfeit(room, st, gone);
    resolve(st, cat);
    await afterStep(room, st);
    emitEach(room, "round", (side) => ({ n, state: viewFor(room, st, side, cat) }));
  });
}

async function timeoutRescue(code, n) {
  const cat = await E.catalogReady();
  await withRoom(code, async (room) => {
    const st = room.state;
    if (room.status !== "live" || !st?.pending || st.pending.n !== n) return;
    settleRescue(st, cat, null);
    await afterStep(room, st);
    emitEach(room, "rescue", (side) => ({ n, state: viewFor(room, st, side, cat) }));
  });
}

function settleRescue(st, cat, chosen) {
  const p = st.pending;
  const side = p.side;
  const late = Date.now() - p.at > RESCUE_WAIT_MS;
  const saved = !late && chosen != null && st[side].hand.includes(chosen) && E.check(p.ask, E.unit(cat, chosen));
  const answers = st[side].hand.filter((x) => E.check(p.ask, E.unit(cat, x)));
  if (saved) st[side].hand.push(p.card);
  else st[side].out.push(p.card);
  if (st.last && st.last.n === p.n)
    st.last.rescue = { side, saved, card: p.card, pick: chosen, answers, ask: E.objView(p.ask) };
  st.pending = null;
  advance(st, cat);
}

async function forfeit(room, st, side) {
  const cat = await E.catalogReady();
  st.cur = null;
  st.pending = null;
  const played = !!st.last || st.score.you + st.score.bot > 0;
  st.end = played
    ? { winner: sw(side), score: { ...st.score }, forfeit: side }
    : { winner: "draw", score: { ...st.score }, cancelled: true, forfeit: side };
  await closeGame(room, st);
  emitEach(room, "end", (s) => ({ state: viewFor(room, st, s, cat) }));
  return room;
}

// ----------------------------------------------------------------------
//  L'API
// ----------------------------------------------------------------------
async function mustRoom(code) {
  const room = await loadRoom(code);
  if (!room) throw new BattleError(404, "Ce duel n'existe plus.");
  return room;
}
function mustSide(room, userId) {
  const side = sideOf(room, userId);
  if (!side) throw new BattleError(403, "Tu ne joues pas ce duel.");
  return side;
}
async function inRoom(code, fn) {
  const out = await withRoom(String(code), fn);
  if (out === null) throw new BattleError(404, "Ce duel n'existe plus.");
  return out;
}

/** Ouvrir un salon (il faut un deck complet). */
export async function createDuel(userId) {
  const cat = await E.catalogReady();
  await deckOf(userId, cat);
  // Un seul salon en attente à la fois : les anciens se ferment.
  await CardDuel.updateMany({ host: userId, status: "lobby" }, { $set: { status: "done" } });
  let room = null;
  for (let i = 0; i < 4 && !room; i++) {
    const code = makeCode();
    if (await CardDuel.exists({ code })) continue;
    room = await CardDuel.create({ code, host: userId });
  }
  if (!room) throw new BattleError(500, "Salon non créé, réessaie.");
  return { room: roomView(await loadRoom(room.code), userId) };
}

/** Le salon, et ma partie si j'en suis. */
export async function getDuel(userId, code) {
  const room = await mustRoom(code);
  const side = sideOf(room, userId);
  let state = null;
  if (side && room.state) state = viewFor(room, room.state, side, await E.catalogReady());
  return { room: roomView(room, userId), state };
}

/** Rejoindre : la partie part aussitôt. */
export async function joinDuel(userId, code) {
  const cat = await E.catalogReady();
  return inRoom(code, async (room) => {
    const side = sideOf(room, userId);
    if (side) return { room: roomView(room, userId), state: room.state ? viewFor(room, room.state, side, cat) : null };
    if (room.status === "done") throw new BattleError(410, "Ce duel est terminé.");
    if (room.guest || room.status !== "lobby") throw new BattleError(409, "Ce duel a déjà ses deux joueurs.");
    const [a, b] = [await deckOf(idOf(room.host), cat), await deckOf(userId, cat)];
    const st = {
      v: 1,
      n: 0,
      score: { you: 0, bot: 0 },
      you: { deck: E.shuffle(a), hand: [], out: [] },
      bot: { deck: E.shuffle(b), hand: [], out: [] },
      used: [],
      lastKind: null,
      cur: null,
      pending: null,
      last: null,
      absent: { you: 0, bot: 0 },
      end: null,
    };
    E.refill(st);
    openRound(st, cat);
    if (room.rival && idOf(room.rival) !== String(userId)) withdraw(room, room.rival);
    await save(room, { guest: userId, status: "live", state: st });
    const full = await loadRoom(room.code);
    full.state = st;
    schedule(full, st);
    emitEach(full, "start", (s) => ({ room: roomView(full, s === "you" ? idOf(full.host) : userId), state: viewFor(full, st, s, cat) }));
    return { room: roomView(full, userId), state: viewFor(full, st, "bot", cat) };
  });
}

/** Mes animations sont finies : je suis prêt à choisir. */
export async function readyDuel(userId, code, nRaw) {
  const n = Number(nRaw);
  return inRoom(code, async (room) => {
    const side = mustSide(room, userId);
    const st = room.state;
    const cur = st?.cur;
    if (room.status !== "live" || !cur || cur.n !== n) return { go: !!cur?.go, n: cur?.n ?? null };
    if (st.absent) st.absent[side] = 0;
    // Le chrono est déjà parti (l'autre m'a attendu, puis on a forcé) : je
    // reçois ce qu'il en reste, pas 15 s neuves.
    if (cur.go) return { go: true, n, left: Math.max(0, cur.go + PICK_MS - Date.now()) };
    cur.ready[side] = true;
    const both = cur.ready.you && cur.ready.bot;
    if (both) cur.go = Date.now();
    await save(room, { state: st });
    schedule(room, st);
    if (both) emitEach(room, "go", () => ({ n, left: PICK_MS }));
    return { go: both, n, left: both ? PICK_MS : null };
  });
}

/** Je pose ma carte. Les deux posées : le verdict, pour les deux. */
export async function pickDuel(userId, code, nRaw, cardRaw) {
  const cat = await E.catalogReady();
  const n = Number(nRaw);
  const card = Number(cardRaw);
  return inRoom(code, async (room) => {
    const side = mustSide(room, userId);
    const st = room.state;
    if (room.status !== "live" || !st?.cur || st.cur.n !== n) throw new BattleError(409, "Cette manche est déjà jouée.");
    if (st.cur.picks[side] != null) throw new BattleError(409, "Ta carte est déjà posée.");
    if (!st[side].hand.includes(card)) throw new BattleError(400, "Cette carte n'est pas dans ta main.");
    st.cur.picks[side] = card;
    st.absent = st.absent || { you: 0, bot: 0 };
    st.absent[side] = 0;
    if (!st.cur.go) st.cur.go = Date.now();
    // En face, personne : pas la peine de faire attendre le chrono, sa carte
    // part au hasard tout de suite.
    const opp = sw(side);
    if (st.cur.picks[opp] == null && !st.cur.ready[opp] && isAway(room, opp)) {
      st.absent[opp] = (st.absent[opp] || 0) + 1;
      if (st.absent[opp] >= MAX_ABSENT) {
        await forfeit(room, st, opp);
        return { state: viewFor(room, st, side, cat) };
      }
      st.cur.picks[opp] = E.pick(st[opp].hand);
    }
    const both = st.cur.picks[opp] != null;
    if (!both) {
      await save(room, { state: st });
      schedule(room, st);
      const [, oppId] = members(room).find(([s]) => s !== side) || [];
      if (oppId) emitTo([oppId], EVENT, { code: room.code, kind: "picked", n });
      return { waiting: true };
    }
    resolve(st, cat);
    await afterStep(room, st);
    emitEach(room, "round", (s) => ({ n, state: viewFor(room, st, s, cat) }));
    return { state: viewFor(room, st, side, cat) };
  });
}

/** Le sauvetage : la carte montrée porte-t-elle le tag ? */
export async function rescueDuel(userId, code, cardRaw) {
  const cat = await E.catalogReady();
  const chosen = cardRaw == null ? null : Number(cardRaw);
  return inRoom(code, async (room) => {
    const side = mustSide(room, userId);
    const st = room.state;
    if (room.status !== "live" || !st?.pending || st.pending.side !== side) throw new BattleError(409, "Rien à sauver.");
    const n = st.pending.n;
    settleRescue(st, cat, chosen);
    await afterStep(room, st);
    emitEach(room, "rescue", (s) => ({ n, state: viewFor(room, st, s, cat) }));
    return { state: viewFor(room, st, side, cat) };
  });
}

/** Quitter : en salon, on le ferme ; en partie, c'est un abandon. */
export async function quitDuel(userId, code) {
  return inRoom(code, async (room) => {
    const side = mustSide(room, userId);
    if (room.status === "lobby") {
      clock.stop(room.code);
      await save(room, { status: "done" });
      withdraw(room, room.rival);
      return { ok: true };
    }
    if (room.status !== "live") return { ok: true };
    await forfeit(room, room.state, side);
    return { ok: true };
  });
}

/** La revanche : un nouveau salon, l'autre est prévenu. */
export async function rematchDuel(userId, code) {
  return inRoom(code, async (room) => {
    const side = mustSide(room, userId);
    if (room.status !== "done") throw new BattleError(409, "La partie n'est pas finie.");
    if (room.next) return { next: room.next, mine: false };
    const cat = await E.catalogReady();
    await deckOf(userId, cat);
    let next = null;
    for (let i = 0; i < 4 && !next; i++) {
      const c = makeCode();
      if (await CardDuel.exists({ code: c })) continue;
      const [, rivalId] = members(room).find(([s]) => s !== side) || [];
      next = await CardDuel.create({ code: c, host: userId, rival: rivalId || null });
    }
    if (!next) throw new BattleError(500, "Salon non créé, réessaie.");
    await save(room, { next: next.code });
    const [, oppId] = members(room).find(([s]) => s !== side) || [];
    if (oppId)
      emitTo([oppId], EVENT, { code: room.code, kind: "rematch", next: next.code, by: person(userOf(room, side)) });
    return { next: next.code, mine: true };
  });
}

export const duelStats = (s) => ({ wins: s?.pvpWins || 0, losses: s?.pvpLosses || 0, draws: s?.pvpDraws || 0 });

// ----------------------------------------------------------------------
//  Défier un pote
// ----------------------------------------------------------------------
// On ne défie que ceux qui nous suivent — la règle de la messagerie : on ne
// sonne pas chez un inconnu. Pour les autres, il y a le lien du salon.

/** Les potes à défier : en ligne d'abord, puis ceux qui ont de quoi jouer. */
export async function duelFriends(userId) {
  const followers = await User.find({ following: userId }).select("username avatar").lean();
  const ids = followers.map((f) => f._id);
  const [counts, live] = await Promise.all([
    CardOwn.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: "$user", n: { $sum: 1 } } }]),
    CardDuel.find({ status: "live", $or: [{ host: { $in: ids } }, { guest: { $in: ids } }] })
      .select("host guest")
      .lean(),
  ]);
  const cards = new Map(counts.map((x) => [String(x._id), x.n]));
  const busy = new Set(live.flatMap((r) => [String(r.host), String(r.guest)]));
  const online = onlineAmong(ids);
  const friends = followers.map((f) => {
    const id = String(f._id);
    return { ...person(f), online: online.has(id), ready: (cards.get(id) || 0) >= MIN_CARDS, busy: busy.has(id) };
  });
  friends.sort(
    (a, b) =>
      Number(b.online && b.ready && !b.busy) - Number(a.online && a.ready && !a.busy) ||
      Number(b.online) - Number(a.online) ||
      Number(b.ready) - Number(a.ready) ||
      a.username.localeCompare(b.username)
  );
  return { friends, minCards: MIN_CARDS };
}

/**
 * Défier quelqu'un depuis mon salon : il devient « celui qu'on attend », et
 * s'il est en ligne une fenêtre s'ouvre chez lui, où qu'il soit sur le site.
 * Renvoie `online` : hors ligne, c'est la messagerie qui prend le relais.
 */
export async function challengeDuel(userId, code, targetRaw) {
  return inRoom(code, async (room) => {
    mustSide(room, userId);
    if (room.status !== "lobby") throw new BattleError(409, "Le duel a déjà commencé.");
    const targetId = String(targetRaw || "");
    if (!targetId || targetId === String(userId)) throw new BattleError(400, "Choisis un pote.");
    const target = await User.findById(targetId).select("username avatar following").lean().catch(() => null);
    if (!target) throw new BattleError(404, "Joueur introuvable.");
    if (!(target.following || []).some((id) => String(id) === String(userId)))
      throw new BattleError(403, `${target.username} ne te suit pas : envoie-lui le lien.`);
    if (room.rival && idOf(room.rival) !== targetId) withdraw(room, room.rival);
    await save(room, { rival: target._id });
    room.rival = target;
    const online = onlineAmong([targetId]).size > 0;
    if (online) emitTo([targetId], EVENT, { code: room.code, kind: "invite", by: person(room.host) });
    return { room: roomView(room, userId), target: person(target), online };
  });
}

// Le défi ne tient plus (salon fermé, quelqu'un d'autre défié ou arrivé) :
// sa fenêtre s'efface chez celui qu'on attendait.
function withdraw(room, rival) {
  if (rival) emitTo([idOf(rival)], EVENT, { code: room.code, kind: "withdrawn" });
}

/** Le défi ne me dit rien : l'hôte est prévenu, sa place se libère. */
export async function declineDuel(userId, code) {
  return inRoom(code, async (room) => {
    if (room.status !== "lobby" || idOf(room.rival) !== String(userId)) return { ok: true };
    const by = person(room.rival);
    await save(room, { rival: null });
    emitTo([idOf(room.host)], EVENT, { code: room.code, kind: "declined", by });
    return { ok: true };
  });
}

/** Mon duel en cours, pour la page Combat. */
export async function liveDuelOf(userId) {
  const room = await CardDuel.findOne({ status: "live", $or: [{ host: userId }, { guest: userId }] })
    .sort({ updatedAt: -1 })
    .populate(POPULATE)
    .lean();
  if (!room) return null;
  const side = sideOf(room, userId);
  return { code: room.code, opponent: person(userOf(room, sw(side))), score: sides(room.state?.score || { you: 0, bot: 0 }, side) };
}

/** L'état du salon pour la carte d'invitation de la messagerie. */
export async function duelCard(userId, code) {
  const room = await loadRoom(code);
  if (!room) return { state: "gone" };
  const players = [room.host, room.guest].filter(Boolean).map(person);
  const end = room.state?.end;
  const winner =
    end && !end.cancelled && end.winner !== "draw" ? person(userOf(room, end.winner))?.username || null : null;
  return {
    state: room.status === "done" ? "done" : room.status === "live" ? "live" : "lobby",
    players,
    count: players.length,
    max: 2,
    rounds: TO_WIN,
    index: Math.max(0, (room.state?.n || 1) - 1),
    mine: !!sideOf(room, userId),
    winner,
  };
}

export { MIN_CARDS as DUEL_MIN_CARDS };
