import CardTeam from "../models/CardTeam.js";
import CardBattleStat from "../models/CardBattleStat.js";
import CardOwn from "../models/CardOwn.js";
import User from "../models/User.js";
import { emitTo, onlineAmong } from "./realtime.js";
import { grantPoints } from "./points.js";
import { makeCode, makeRoomQueue, makeClock } from "./versusRoom.js";
import { engine as E, DECK_SIZE, MIN_CARDS, HAND_SIZE, PICK_MS, BattleError } from "./cardBattle.js";

// ======================================================================
//  Les combats de cartes en 2 contre 2, en temps réel
// ======================================================================
// Deux équipes de deux : l'or (places 0 et 1) contre le rose (places 2 et 3).
// Il manque du monde ? Au lancement, un bot prend chaque place vide.
//
// Une manche = DEUX objectifs, un par voie (gauche et droite). Chaque joueur
// pose UNE carte, face cachée, sur la voie de son choix — mais une équipe doit
// couvrir les deux voies : le premier à poser prend sa voie, son coéquipier a
// l'autre. Tout l'enjeu est là : qui, de nous deux, a la bonne carte pour
// « Sorti en 2008 », et qui pour « #Zombies » ?
//
// Chaque voie se juge comme une manche du 1 contre 1 (lib/cardBattle.js, à la
// lettre) : la plus proche / la seule valable gagne, hors sujet balayé,
// égalité = combat de types. Une voie gagnée = un point pour l'équipe ; la
// première à 5 l'emporte. Pas de sauvetage ici : à quatre, il casserait le
// rythme.
//
// Les bots : un bot dont le coéquipier est humain lui laisse choisir sa voie
// (il pose juste après lui, sur l'autre) et ne prend les devants que si
// l'humain tarde. Deux bots ensemble se répartissent les voies au mieux.
//
// Personne ne bloque la partie : le serveur tient le chrono comme au duel.
// Un joueur qui quitte (ou absent deux manches) est remplacé par un bot — les
// trois autres continuent ; lui a perdu, sans gain.

const EVENT = "cardteam";
export const TEAM_TO_WIN = 5;
const MAX_ROUNDS = 7;
const GRACE_MS = 3000;
// Plus large qu'au duel : deux voies à dérouler, les animations durent.
const READY_WAIT_MS = 15000;
const OFFLINE_WAIT_MS = 4000;
const ROUND_WAIT_MS = 45000;
const MAX_ABSENT = 2;
// Un bot laisse son coéquipier humain choisir sa voie… jusqu'à ce délai.
const BOT_WAIT_MS = 9000;

const SEATS = [0, 1, 2, 3];
const LANES = [0, 1];
const teamOf = (s) => (s < 2 ? "a" : "b");
const otherTeam = (t) => (t === "a" ? "b" : "a");
const mateOf = (s) => s ^ 1;
// Les noms du moteur (« you » / « bot ») vers les équipes.
const T = (x) => (x === "you" ? "a" : x === "bot" ? "b" : x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const idOf = (u) => String(u?._id || u || "");
const person = (u) => (u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null);

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "seats.user", select: "username avatar" },
];

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return CardTeam.findOne({ code: String(code) }).populate(POPULATE).lean();
}
const withRoom = makeRoomQueue(loadRoom);
const clock = makeClock(EVENT);

// Les humains encore à la table : [place, id]. Un joueur remplacé par un bot
// n'en fait plus partie (il ne reçoit plus rien).
function humans(room) {
  const st = room.state;
  return SEATS.map((s) => [s, idOf(room.seats?.[s]?.user)]).filter(([s, id]) => id && !st?.p?.[s]?.left);
}
function seatOf(room, userId) {
  const hit = humans(room).find(([, id]) => id === String(userId));
  return hit ? hit[0] : null;
}
const seatIds = (room) => room.seats.map((x) => (x?.user ? x.user._id || x.user : null));

async function save(room, patch) {
  const r = await CardTeam.updateOne(
    { _id: room._id, rev: room.rev },
    { $set: { ...patch, updatedAt: new Date() }, $inc: { rev: 1 } }
  );
  if (!r.modifiedCount) throw new BattleError(409, "La partie a bougé entre-temps, réessaie.");
  room.rev += 1;
  Object.assign(room, patch);
}

function isAway(room, s) {
  const id = idOf(room.seats?.[s]?.user);
  return !id || !onlineAmong([id]).size;
}

// ----------------------------------------------------------------------
//  Les vues
// ----------------------------------------------------------------------
function playersView(room, st) {
  const ids = SEATS.map((s) => idOf(room.seats?.[s]?.user)).filter(Boolean);
  const online = onlineAmong(ids);
  return SEATS.map((s) => {
    const u = room.seats?.[s]?.user || null;
    const p = st?.p?.[s];
    const bot = p ? !!p.bot : !u;
    return {
      seat: s,
      team: teamOf(s),
      user: bot ? null : person(u),
      bot,
      online: !bot && !!u && online.has(idOf(u)),
      hand: p ? p.hand.length : 0,
      deck: p ? p.deck.length : 0,
    };
  });
}

function endFor(end, s) {
  if (!end) return null;
  const t = teamOf(s);
  const pay = end.pay?.[s] || {};
  return {
    winner: end.winner === "draw" ? "draw" : end.winner === t ? "you" : "bot",
    score: { you: end.score[t], bot: end.score[otherTeam(t)] },
    quit: false,
    cancelled: !!end.cancelled,
    reward: end.rewards?.[s] || null,
    stats: pay.stats || null,
    balance: pay.balance ?? null,
    pass: pay.pass || null,
  };
}

function viewFor(room, st, s, cat) {
  const cur = st.cur && !st.end ? st.cur : null;
  const now = Date.now();
  return {
    id: room.code,
    mode: "team",
    n: st.n,
    toWin: TEAM_TO_WIN,
    seat: s,
    team: teamOf(s),
    level: st.level,
    score: { ...st.score },
    players: playersView(room, st),
    hand: st.p[s].hand.map((id) => E.hideCard(cat, id, { loan: [] })),
    deck: st.p[s].deck.length,
    round: cur
      ? {
          n: cur.n,
          objectives: cur.objs.map(E.objView),
          ms: PICK_MS,
          go: !!cur.go,
          left: cur.go ? Math.max(0, cur.go + PICK_MS - now) : PICK_MS,
          // Qui a posé, et où (la carte reste cachée) ; la mienne en entier.
          picks: cur.picks.map((p) => (p ? { lane: p.lane } : null)),
          mine: cur.picks[s] ? { card: cur.picks[s].card, lane: cur.picks[s].lane } : null,
        }
      : null,
    last: st.last || null,
    end: endFor(st.end, s),
  };
}

function roomView(room, userId) {
  const seat = room.status === "lobby" ? room.seats.findIndex((x) => idOf(x?.user) === String(userId)) : seatOf(room, userId);
  const mine = seat != null && seat >= 0 ? seat : null;
  const ids = room.seats.map((x) => idOf(x?.user)).filter(Boolean);
  const online = onlineAmong(ids);
  return {
    code: room.code,
    status: room.status,
    host: person(room.host),
    isHost: idOf(room.host) === String(userId),
    seat: mine,
    member: mine != null,
    seats: SEATS.map((s) => {
      const u = room.seats?.[s]?.user;
      return { seat: s, team: teamOf(s), user: u ? { ...person(u), online: online.has(idOf(u)) } : null };
    }),
    next: room.next || null,
    minCards: MIN_CARDS,
    toWin: TEAM_TO_WIN,
  };
}

// La même annonce à chaque humain de la table, chacun avec sa vue.
function emitAll(room, kind, build = () => ({})) {
  for (const [s, id] of humans(room)) emitTo([id], EVENT, { code: room.code, kind, ...build(s, id) });
}
// Le salon a bougé (quelqu'un s'assoit, se lève) : tout le monde le revoit.
function emitRoom(room, extra = []) {
  const ids = new Set([...room.seats.map((x) => idOf(x?.user)).filter(Boolean), ...extra.map(String)]);
  for (const id of ids) emitTo([id], EVENT, { code: room.code, kind: "room", room: roomView(room, id) });
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

// Le deck d'un bot : autant de cartes de chaque rareté que le joueur qu'il
// imite (à armes égales), sans doublon avec les autres decks.
function botDeck(cat, model, taken) {
  const out = [];
  for (const id of model) {
    const list = cat.byRarity[cat.byId.get(id).rarity] || cat.byRarity.common;
    let x;
    let tries = 0;
    do x = E.pick(list);
    while (taken.has(x) && ++tries < 30);
    taken.add(x);
    out.push(x);
  }
  return out;
}

function refill(st) {
  for (const p of st.p) while (p.hand.length < HAND_SIZE && p.deck.length) p.hand.push(p.deck.pop());
}

// Les deux objectifs de la manche : jouables par les deux ÉQUIPES (au moins
// une carte valable dans les deux mains réunies), jamais déjà tombés, et de
// deux sortes différentes. Le moteur du 1 contre 1 fait le tri : on lui
// présente chaque équipe comme une seule grande main.
function nextObjectives(st, cat) {
  const hands = (t) => SEATS.filter((s) => teamOf(s) === t).flatMap((s) => st.p[s].hand);
  const probe = { you: { hand: hands("a") }, bot: { hand: hands("b") }, used: [...st.used], lastKind: st.lastKind };
  const objs = [];
  for (let i = 0; i < 2; i++) {
    let o = E.nextObjective(probe, cat);
    if (i && E.objKey(o) === E.objKey(objs[0])) o = { kind: objs[0].kind === "oldest" ? "newest" : "oldest" };
    objs.push(o);
    probe.used.push(E.objKey(o));
    probe.lastKind = E.kindGroup(o.kind);
  }
  return objs;
}

function openRound(st, cat) {
  st.n++;
  const objs = nextObjectives(st, cat);
  for (const o of objs) st.used.push(E.objKey(o));
  st.lastKind = E.kindGroup(objs[1].kind);
  st.cur = {
    n: st.n,
    objs,
    open: Date.now(),
    go: null,
    picks: [null, null, null, null],
    ready: SEATS.map((s) => !!st.p[s].bot),
    botAt: [null, null, null, null],
  };
}

// Le « go » : l'heure de chaque bot est fixée.
function startGo(st) {
  const cur = st.cur;
  cur.go = Date.now();
  for (const t of ["a", "b"]) {
    const [s1, s2] = t === "a" ? [0, 1] : [2, 3];
    const b1 = st.p[s1].bot;
    const b2 = st.p[s2].bot;
    if (b1 && b2) {
      // Deux bots : le premier pose quand il a « réfléchi », l'autre suit.
      const first = cur.go + 1800 + E.rnd(4200);
      const [x, y] = E.rnd(2) ? [s1, s2] : [s2, s1];
      cur.botAt[x] = first;
      cur.botAt[y] = first + 900 + E.rnd(1800);
    } else if (b1 || b2) {
      cur.botAt[b1 ? s1 : s2] = cur.go + BOT_WAIT_MS + E.rnd(1500);
    }
  }
}

// Les voies encore libres pour une place (son coéquipier a peut-être posé).
function freeLanes(cur, s) {
  const mate = cur.picks[mateOf(s)];
  return mate ? [1 - mate.lane] : LANES;
}

// Le coup d'un bot : la carte ET la voie où il se sent le plus sûr. Il connaît
// les jeux… à peu près, comme au 1 contre 1 (plus son niveau monte, mieux il
// sait).
function botMove(st, cat, s) {
  const cur = st.cur;
  const lanes = freeLanes(cur, s);
  const L = st.level;
  const pKnow = Math.min(0.9, 0.4 + 0.05 * L);
  const noise = Math.max(1.2, 7.5 - 0.65 * L);
  const now = new Date().getUTCFullYear();
  const power = (c) => c.s.hp + Math.max(...c.s.moves.map((m) => m.dmg)) * 1.5;
  let best = null;
  for (const id of st.p[s].hand) {
    const c = E.unit(cat, id);
    const gy = (c.f.year ?? 2005) + E.gauss() * noise;
    for (const lane of lanes) {
      const o = cur.objs[lane];
      let conf;
      if (o.kind === "year") conf = Math.max(0, 1 - Math.abs(gy - o.year) / 10);
      else if (o.kind === "oldest") conf = clamp01((now - gy) / 40);
      else if (o.kind === "newest") conf = clamp01((gy - 1985) / 40);
      else {
        const knows = Math.random() < (o.kind === "type" ? 0.95 : pKnow);
        conf = knows ? (E.check(o, c) ? 0.85 : 0.05) : 0.4;
      }
      const score = conf + power(c) / 4000 + Math.random() * 0.05;
      if (!best || score > best.score) best = { card: id, lane, score };
    }
  }
  return best && { card: best.card, lane: best.lane };
}

function randomMove(st, s) {
  const lanes = freeLanes(st.cur, s);
  return { card: E.pick(st.p[s].hand), lane: E.pick(lanes) };
}

const allPicked = (cur) => cur.picks.every(Boolean);

// Un joueur s'en va (abandon, ou absent trop longtemps) : un bot prend sa
// place, et joue pour lui la manche en cours s'il n'a pas posé.
function bench(st, s) {
  const p = st.p[s];
  if (p.bot) return;
  p.bot = true;
  p.left = true;
  const cur = st.cur;
  if (cur) {
    cur.ready[s] = true;
    if (!cur.picks[s] && cur.go) cur.botAt[s] = Date.now() + 1200 + E.rnd(1500);
  }
}

// Le verdict des deux voies, une fois les quatre cartes posées.
function resolve(st, cat) {
  const cur = st.cur;
  const results = [];
  const back = new Set();
  for (const lane of LANES) {
    const o = cur.objs[lane];
    const sa = SEATS.find((s) => teamOf(s) === "a" && cur.picks[s]?.lane === lane);
    const sb = SEATS.find((s) => teamOf(s) === "b" && cur.picks[s]?.lane === lane);
    const ua = E.unit(cat, cur.picks[sa].card);
    const ub = E.unit(cat, cur.picks[sb].card);
    const j = E.judge(o, ua, ub);
    let w = j.winner ?? null;
    let f = null;
    if (j.fight) {
      f = E.fight(ua, ub);
      w = f.ko === "you" ? "bot" : "you";
    }
    const winner = T(w);
    if (winner) {
      const ws = winner === "a" ? sa : sb;
      st.score[winner]++;
      st.won[ws].push(cur.picks[ws].card);
      back.add(ws);
    }
    const reveal = (u, seat) => ({
      seat,
      card: { ...u.card, loan: false },
      year: u.f.year,
      valid: E.BINARY.includes(o.kind) ? E.check(o, u) : null,
    });
    results.push({
      lane,
      objective: E.objView(o),
      a: reveal(ua, sa),
      b: reveal(ub, sb),
      winner,
      reason: j.reason,
      wiped: { a: !!j.wiped?.you, b: !!j.wiped?.bot },
      fight: f && {
        first: T(f.first),
        ko: T(f.ko),
        tech: f.tech,
        hp0: { a: f.hp0.you, b: f.hp0.bot },
        log: f.log.map((h) => ({ ...h, by: T(h.by), hp: { a: h.hp.you, b: h.hp.bot } })),
      },
      score: { ...st.score },
    });
  }
  for (const s of SEATS) {
    const id = cur.picks[s].card;
    const p = st.p[s];
    p.hand = p.hand.filter((x) => x !== id);
    if (back.has(s)) p.hand.push(id);
    else p.out.push(id);
  }
  st.last = { n: st.n, results, score: { ...st.score } };
  st.cur = null;
  advance(st, cat);
}

function advance(st, cat) {
  refill(st);
  const done =
    st.score.a >= TEAM_TO_WIN ||
    st.score.b >= TEAM_TO_WIN ||
    st.n >= MAX_ROUNDS ||
    st.p.some((p) => !p.hand.length);
  if (done) {
    const w = st.score.a > st.score.b ? "a" : st.score.b > st.score.a ? "b" : "draw";
    st.end = { winner: w, score: { ...st.score } };
  } else openRound(st, cat);
}

// ----------------------------------------------------------------------
//  Gains et palmarès (comme le duel : pour la gloire, et la passe)
// ----------------------------------------------------------------------
function rewardFor(st, s, stat) {
  const t = teamOf(s);
  const me = st.score[t];
  const him = st.score[otherTeam(t)];
  const win = st.end.winner === t;
  const draw = st.end.winner === "draw";
  const dayGames = stat.day === E.today() ? stat.dayGames || 0 : 0;
  const tired = dayGames >= E.FULL_GAMES_PER_DAY;
  // Parti en cours de route : une défaite, sans gain — même si les autres
  // ont gagné sans lui.
  const quit = !!st.p[s].left;
  const base = win ? 40 + 5 * Math.max(0, TEAM_TO_WIN - him) : draw ? 30 : 10 + 3 * me;
  const perfect = win && !quit && him === 0;
  const points = quit ? 0 : Math.max(5, Math.round((base * (tired ? 0.25 : 1)) / 5) * 5);
  const stars = quit ? 0 : tired ? (win ? 1 : 0) : win ? (perfect ? 3 : 2) : me > 0 ? 1 : 0;
  return { points, stars, base, tired, perfect, quit, dayGames: dayGames + 1 };
}

async function payOne(userId, st, s) {
  const r = st.end.rewards[s];
  const t = teamOf(s);
  const w = st.end.winner;
  const inc = r.quit ? { teamLosses: 1 } : w === "draw" ? { teamDraws: 1 } : w === t ? { teamWins: 1 } : { teamLosses: 1 };
  const before = E.passView(await E.getStat(userId));
  const doc = await CardBattleStat.findOneAndUpdate(
    { user: userId },
    {
      $inc: inc,
      $set: {
        day: E.today(),
        dayGames: r.dayGames,
        passStars: E.passStarsAfter(before, r.stars),
      },
    },
    { upsert: true, new: true }
  ).lean();
  const after = E.passView(doc);
  const balance = r.points
    ? await grantPoints(userId, r.points, "cardteam", { score: [st.end.score[t], st.end.score[otherTeam(t)]] })
    : null;
  return {
    stats: E.statView(doc),
    balance,
    pass: {
      ...after,
      before: before.stars,
      gained: after.stars - before.stars,
      unlocked: after.tiers.filter((x) => x.done && before.stars < x.need).map((x) => x.n),
    },
  };
}

// Les humains du début (y compris ceux partis en route) sont payés.
const paidSeats = (st) => SEATS.filter((s) => st.p[s].user);

async function closeGame(room, st) {
  clock.stop(room.code);
  if (!st.end.cancelled) {
    st.end.rewards = {};
    for (const s of paidSeats(st)) st.end.rewards[s] = rewardFor(st, s, await E.getStat(st.p[s].user));
  }
  await save(room, { state: st, status: "done" });
  if (!st.end.cancelled) {
    st.end.pay = {};
    for (const s of paidSeats(st)) st.end.pay[s] = await payOne(st.p[s].user, st, s);
    await CardTeam.updateOne({ _id: room._id }, { $set: { "state.end": st.end } }).catch(() => {});
  }
}

function cancel(st) {
  st.cur = null;
  st.end = { winner: "draw", score: { ...st.score }, cancelled: true };
}

async function afterStep(room, st) {
  if (st.end) return closeGame(room, st);
  await save(room, { state: st });
  schedule(room, st);
}

// Un seul minuteur par salon : la prochaine chose à faire (forcer le « go »,
// faire poser un bot, jouer à la place d'un retardataire).
function schedule(room, st) {
  const code = room.code;
  const cur = st.cur;
  if (st.end || !cur) return clock.stop(code);
  const n = cur.n;
  if (!cur.go) {
    const people = SEATS.filter((s) => !st.p[s].bot);
    if (!people.some((s) => cur.ready[s])) return clock.at(code, cur.open + ROUND_WAIT_MS, () => wake(code, n));
    const late = people.filter((s) => !cur.ready[s]);
    const wait = late.every((s) => isAway(room, s)) ? OFFLINE_WAIT_MS : READY_WAIT_MS;
    return clock.at(code, Date.now() + wait, () => wake(code, n));
  }
  const times = [cur.go + PICK_MS + GRACE_MS];
  for (const s of SEATS) if (!cur.picks[s] && st.p[s].bot && cur.botAt[s] != null) times.push(cur.botAt[s]);
  return clock.at(code, Math.min(...times), () => wake(code, n));
}

async function wake(code, n) {
  const cat = await E.catalogReady();
  await withRoom(code, async (room) => {
    const st = room.state;
    if (room.status !== "live" || !st?.cur || st.cur.n !== n) return;
    const cur = st.cur;
    // Personne n'est prêt (ou quelqu'un traîne) : on force le départ.
    if (!cur.go) {
      if (!onlineAmong(humans(room).map(([, id]) => id)).size) {
        cancel(st);
        await closeGame(room, st);
        return emitAll(room, "end", (s) => ({ state: viewFor(room, st, s, cat) }));
      }
      startGo(st);
      await afterStep(room, st);
      return emitAll(room, "go", () => ({ n, left: PICK_MS }));
    }
    const now = Date.now();
    const placed = [];
    for (const s of SEATS) {
      if (cur.picks[s] || !st.p[s].bot || cur.botAt[s] == null || cur.botAt[s] > now) continue;
      cur.picks[s] = botMove(st, cat, s);
      placed.push(s);
    }
    // Le temps est écoulé : les retardataires jouent au hasard (un bot, lui,
    // joue comme d'habitude).
    if (now >= cur.go + PICK_MS + GRACE_MS) {
      for (const s of SEATS) {
        if (cur.picks[s]) continue;
        if (st.p[s].bot) cur.picks[s] = botMove(st, cat, s);
        else {
          if (!cur.ready[s]) st.absent[s] = (st.absent[s] || 0) + 1;
          cur.picks[s] = randomMove(st, s);
        }
        placed.push(s);
      }
      // Absent deux manches d'affilée : un bot prend sa place.
      for (const s of SEATS) if (!st.p[s].bot && st.absent[s] >= MAX_ABSENT) bench(st, s);
      if (!humans(room).length) {
        cancel(st);
        await closeGame(room, st);
        return;
      }
    }
    await step(room, st, cat, n, placed);
  });
}

// Après des cartes posées : le verdict si tout le monde a posé, sinon on
// annonce les nouvelles cartes et on attend la suite.
async function step(room, st, cat, n, placed) {
  const cur = st.cur;
  if (allPicked(cur)) {
    resolve(st, cat);
    await afterStep(room, st);
    emitAll(room, "round", (s) => ({ n, state: viewFor(room, st, s, cat) }));
    return true;
  }
  await save(room, { state: st });
  schedule(room, st);
  for (const s of placed) emitAll(room, "picked", () => ({ n, seat: s, lane: cur.picks[s].lane }));
  return false;
}

// ----------------------------------------------------------------------
//  L'API
// ----------------------------------------------------------------------
async function mustRoom(code) {
  const room = await loadRoom(code);
  if (!room) throw new BattleError(404, "Cette partie n'existe plus.");
  return room;
}
function mustSeat(room, userId) {
  const s = seatOf(room, userId);
  if (s == null) throw new BattleError(403, "Tu ne joues pas cette partie.");
  return s;
}
async function inRoom(code, fn) {
  const out = await withRoom(String(code), fn);
  if (out === null) throw new BattleError(404, "Cette partie n'existe plus.");
  return out;
}

/** Ouvrir un salon : je m'assois à la première place de l'équipe or. */
export async function createTeam(userId) {
  const cat = await E.catalogReady();
  await deckOf(userId, cat);
  await CardTeam.updateMany({ host: userId, status: "lobby" }, { $set: { status: "done" } });
  let room = null;
  for (let i = 0; i < 4 && !room; i++) {
    const code = makeCode();
    if (await CardTeam.exists({ code })) continue;
    room = await CardTeam.create({ code, host: userId, seats: [{ user: userId }, {}, {}, {}] });
  }
  if (!room) throw new BattleError(500, "Salon non créé, réessaie.");
  return { room: roomView(await loadRoom(room.code), userId) };
}

/** Le salon, et ma partie si j'en suis. */
export async function getTeam(userId, code) {
  const room = await mustRoom(code);
  const s = seatOf(room, userId);
  let state = null;
  if (s != null && room.state) state = viewFor(room, room.state, s, await E.catalogReady());
  return { room: roomView(room, userId), state };
}

/** M'asseoir à une place libre (ou changer de place) avant le lancement. */
export async function sitTeam(userId, code, seatRaw) {
  const cat = await E.catalogReady();
  return inRoom(code, async (room) => {
    if (room.status !== "lobby") throw new BattleError(409, "La partie a déjà commencé.");
    const ids = seatIds(room);
    let s = Number(seatRaw);
    // Pas de place demandée (ou prise entre-temps) : la première libre.
    if (!SEATS.includes(s) || (ids[s] && idOf(ids[s]) !== String(userId))) s = SEATS.find((x) => !ids[x]);
    if (s == null) throw new BattleError(409, "La table est complète.");
    const was = ids.findIndex((x) => idOf(x) === String(userId));
    if (was === s) return { room: roomView(room, userId) };
    if (was < 0) await deckOf(userId, cat);
    const next = ids.map((x, i) => (i === was ? null : x));
    next[s] = userId;
    await save(room, { seats: next.map((user) => ({ user })) });
    const full = await loadRoom(room.code);
    emitRoom(full);
    return { room: roomView(full, userId) };
  });
}

/** Inviter un pote (il doit me suivre) : une fenêtre s'ouvre chez lui. */
export async function inviteTeam(userId, code, targetRaw, seatRaw) {
  return inRoom(code, async (room) => {
    if (room.status !== "lobby") throw new BattleError(409, "La partie a déjà commencé.");
    const me = room.seats.find((x) => idOf(x?.user) === String(userId))?.user;
    if (!me) throw new BattleError(403, "Assieds-toi d'abord.");
    const targetId = String(targetRaw || "");
    if (!targetId || targetId === String(userId)) throw new BattleError(400, "Choisis un pote.");
    const target = await User.findById(targetId).select("username avatar following").lean().catch(() => null);
    if (!target) throw new BattleError(404, "Joueur introuvable.");
    if (!(target.following || []).some((id) => String(id) === String(userId)))
      throw new BattleError(403, `${target.username} ne te suit pas : envoie-lui le lien.`);
    const online = onlineAmong([targetId]).size > 0;
    const seat = SEATS.includes(Number(seatRaw)) ? Number(seatRaw) : null;
    if (online) emitTo([targetId], EVENT, { code: room.code, kind: "invite", by: person(me), seat });
    return { target: person(target), online };
  });
}

/** Lancer (l'hôte) : les places vides sont prises par des bots. */
export async function startTeam(userId, code) {
  const cat = await E.catalogReady();
  return inRoom(code, async (room) => {
    if (idOf(room.host) !== String(userId)) throw new BattleError(403, "Seul l'hôte lance la partie.");
    if (room.status !== "lobby") throw new BattleError(409, "La partie a déjà commencé.");
    const ids = seatIds(room).map((x) => (x ? idOf(x) : null));
    const people = SEATS.filter((s) => ids[s]);
    if (!people.length) throw new BattleError(409, "Personne à la table.");
    const decks = [];
    for (const s of people) decks[s] = await deckOf(ids[s], cat);
    // Le niveau des bots : celui des humains contre le bot, en moyenne.
    const levels = await Promise.all(people.map(async (s) => (await E.getStat(ids[s])).level || 1));
    const level = Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / levels.length));
    const taken = new Set(people.flatMap((s) => decks[s]));
    let k = 0;
    for (const s of SEATS) if (!ids[s]) decks[s] = botDeck(cat, decks[people[k++ % people.length]], taken);

    const st = {
      v: 1,
      n: 0,
      level,
      score: { a: 0, b: 0 },
      p: SEATS.map((s) => ({ user: ids[s], bot: !ids[s], left: false, deck: E.shuffle(decks[s]), hand: [], out: [] })),
      used: [],
      lastKind: null,
      cur: null,
      last: null,
      absent: [0, 0, 0, 0],
      won: [[], [], [], []],
      end: null,
    };
    refill(st);
    openRound(st, cat);
    await save(room, { status: "live", state: st });
    schedule(room, st);
    emitAll(room, "start", (s, id) => ({ room: roomView(room, id), state: viewFor(room, st, s, cat) }));
    return { room: roomView(room, userId), state: viewFor(room, st, seatOf(room, userId), cat) };
  });
}

/** Mes animations sont finies : je suis prêt à choisir. */
export async function readyTeam(userId, code, nRaw) {
  const n = Number(nRaw);
  return inRoom(code, async (room) => {
    const s = mustSeat(room, userId);
    const st = room.state;
    const cur = st?.cur;
    if (room.status !== "live" || !cur || cur.n !== n) return { go: !!cur?.go, n: cur?.n ?? null };
    st.absent[s] = 0;
    if (cur.go) return { go: true, n, left: Math.max(0, cur.go + PICK_MS - Date.now()) };
    cur.ready[s] = true;
    const all = cur.ready.every(Boolean);
    if (all) startGo(st);
    await save(room, { state: st });
    schedule(room, st);
    if (all) emitAll(room, "go", () => ({ n, left: PICK_MS }));
    return { go: all, n, left: all ? PICK_MS : null };
  });
}

/**
 * Je pose ma carte sur une voie. Si mon coéquipier vient de prendre cette
 * voie-là (on a cliqué en même temps), la mienne part sur l'autre.
 */
export async function pickTeam(userId, code, nRaw, cardRaw, laneRaw) {
  const cat = await E.catalogReady();
  const n = Number(nRaw);
  const card = Number(cardRaw);
  return inRoom(code, async (room) => {
    const s = mustSeat(room, userId);
    const st = room.state;
    const cur = st?.cur;
    if (room.status !== "live" || !cur || cur.n !== n) throw new BattleError(409, "Cette manche est déjà jouée.");
    if (cur.picks[s]) throw new BattleError(409, "Ta carte est déjà posée.");
    if (!st.p[s].hand.includes(card)) throw new BattleError(400, "Cette carte n'est pas dans ta main.");
    const lanes = freeLanes(cur, s);
    const lane = lanes.includes(Number(laneRaw)) ? Number(laneRaw) : lanes[0];
    cur.picks[s] = { card, lane };
    st.absent[s] = 0;
    if (!cur.go) startGo(st);
    const placed = [s];
    // Mon coéquipier est un bot : il pose juste après moi, sur l'autre voie.
    const m = mateOf(s);
    if (st.p[m].bot && !cur.picks[m]) cur.botAt[m] = Math.min(cur.botAt[m] ?? Infinity, Date.now() + 900 + E.rnd(1500));
    // Un humain déconnecté qui n'a pas dit « prêt » : sa carte part au hasard
    // tout de suite (pas la peine de faire attendre le chrono).
    for (const x of SEATS) {
      if (cur.picks[x] || st.p[x].bot || cur.ready[x] || !isAway(room, x)) continue;
      st.absent[x] = (st.absent[x] || 0) + 1;
      if (st.absent[x] >= MAX_ABSENT) bench(st, x);
      else {
        cur.picks[x] = randomMove(st, x);
        placed.push(x);
      }
    }
    const done = await step(room, st, cat, n, placed);
    return done ? { state: viewFor(room, st, s, cat) } : { waiting: true, lane };
  });
}

/** Quitter : en salon, je me lève (l'hôte ferme) ; en partie, un bot me remplace. */
export async function quitTeam(userId, code) {
  const cat = await E.catalogReady();
  return inRoom(code, async (room) => {
    if (room.status === "lobby") {
      const ids = seatIds(room);
      if (idOf(room.host) === String(userId)) {
        await save(room, { status: "done" });
        for (const x of ids.filter(Boolean)) emitTo([idOf(x)], EVENT, { code: room.code, kind: "closed" });
        return { ok: true };
      }
      const was = ids.findIndex((x) => idOf(x) === String(userId));
      if (was < 0) return { ok: true };
      await save(room, { seats: ids.map((user, i) => ({ user: i === was ? null : user })) });
      emitRoom(await loadRoom(room.code));
      return { ok: true };
    }
    if (room.status !== "live") return { ok: true };
    const s = seatOf(room, userId);
    if (s == null) return { ok: true };
    const st = room.state;
    bench(st, s);
    if (!humans(room).length) {
      cancel(st);
      await closeGame(room, st);
      return { ok: true };
    }
    await save(room, { state: st });
    schedule(room, st);
    emitAll(room, "left", (x) => ({ seat: s, state: viewFor(room, st, x, cat) }));
    return { ok: true };
  });
}

/** La revanche : un nouveau salon, les autres sont prévenus. */
export async function rematchTeam(userId, code) {
  return inRoom(code, async (room) => {
    if (room.status !== "done") throw new BattleError(409, "La partie n'est pas finie.");
    const st = room.state;
    const s = SEATS.find((x) => st?.p?.[x]?.user === String(userId));
    if (s == null) throw new BattleError(403, "Tu ne jouais pas cette partie.");
    if (room.next) return { next: room.next, mine: false, seat: s };
    const cat = await E.catalogReady();
    await deckOf(userId, cat);
    let next = null;
    for (let i = 0; i < 4 && !next; i++) {
      const c = makeCode();
      if (await CardTeam.exists({ code: c })) continue;
      const seats = [{}, {}, {}, {}];
      seats[s] = { user: userId };
      next = await CardTeam.create({ code: c, host: userId, seats });
    }
    if (!next) throw new BattleError(500, "Salon non créé, réessaie.");
    await save(room, { next: next.code });
    const me = room.seats[s]?.user;
    for (const x of SEATS) {
      const id = st.p[x].user;
      if (!id || x === s || st.p[x].left) continue;
      emitTo([id], EVENT, { code: room.code, kind: "rematch", next: next.code, by: person(me), seat: x });
    }
    return { next: next.code, mine: true, seat: s };
  });
}

export const teamStats = (s) => ({ wins: s?.teamWins || 0, losses: s?.teamLosses || 0, draws: s?.teamDraws || 0 });

/** Ma partie à quatre en cours, pour la page Combat. */
export async function liveTeamOf(userId) {
  const rooms = await CardTeam.find({ status: "live", "seats.user": userId })
    .sort({ updatedAt: -1 })
    .limit(3)
    .populate(POPULATE)
    .lean();
  for (const room of rooms) {
    const s = seatOf(room, userId);
    if (s == null) continue;
    const t = teamOf(s);
    const sc = room.state?.score || { a: 0, b: 0 };
    return { code: room.code, score: { you: sc[t], bot: sc[otherTeam(t)] } };
  }
  return null;
}
