import express from "express";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong, isOnline } from "../lib/realtime.js";
import { grantPoints, arcadePoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard } from "./chat.js";
import { makeCode } from "../lib/versusRoom.js";
import { mountGameChat, gameChatSystem, gameChatReset } from "../lib/gameChat.js";
import { getBombCatalog } from "../lib/bombCatalog.js";
import {
  BOARD,
  BOARD_SIZE,
  BOARD_W,
  BOARD_H,
  MINI,
  MINI_KEYS,
  MINI_PRIZES,
  drawChance,
  nextTrophySpace,
  prepareMini,
  sameGame,
} from "../lib/partyGames.js";

// ======================================================================
//  La Party — un jeu de plateau à la Mario Party
// ======================================================================
// 2 à 4 joueurs autour d'une boucle de cases (lib/partyGames.js). À son tour,
// chacun lance le dé (1-10) et avance case par case ; en chemin, il peut
// acheter le Trophée (20 pièces) ; à l'arrivée, la case agit (bleue +3, rouge
// −3, « ? » un évènement). Quand tout le monde a joué, un mini-jeu pour toute
// la table rapporte des pièces. Après N manches : le plus de Trophées gagne
// (les pièces départagent).
//
// Tout vit en mémoire, comme La Bombe (routes/bomb.js) : une partie dure vingt
// minutes, rien à garder au-delà, et tout ce qui touche à une table s'exécute
// d'un bloc. Le serveur décide de tout (le dé, les cases, les réponses) ; le
// client ne fait qu'animer ce qu'on lui annonce.
const router = express.Router();
router.use(requireAuth);

const EVENT = "party";
export const MAX_SEATS = 4;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const START_COINS = 10;
const TROPHY_PRICE = 20;
const ROLL_TIMEOUT = 20000; // au-delà, le dé se lance tout seul
const BUY_TIMEOUT = 12000;
const STEP_MS = 330; // le temps d'un saut de case, côté client
const LAND_MS = 2000; // le temps de lire ce que fait la case
const INTRO_MS = 4500; // la présentation du mini-jeu
const RESULT_MS = 5500;
const COLORS = ["#f2b70b", "#ff5470", "#3ddc97", "#2f7de1"];
const TURN_CHOICES = [5, 10, 15];

const rooms = new Map();
const now = () => Date.now();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) if (t - room.lastActiveAt > ROOM_IDLE_MS) destroy(room);
}, 10 * 60 * 1000).unref?.();

function destroy(room) {
  clearTimeout(room.timer);
  for (const t of room.botTimers || []) clearTimeout(t);
  rooms.delete(room.code);
}

// ============================================================
//  Sièges, membres, sérialisation
// ============================================================
const humans = (room) => room.seats.filter((s) => !s.bot && !s.left);
const active = (room) => room.seats.filter((s) => !s.left);
const seatOf = (room, id) => room.seats.find((s) => s.id === String(id)) || null;
const memberIds = (room) => [...humans(room).map((s) => s.id), ...room.watchers.keys()];
const touch = (room) => {
  room.lastActiveAt = now();
};

function findMember(room, userId) {
  const id = String(userId);
  const seat = room.seats.find((s) => s.id === id && !s.bot && !s.left);
  if (seat) return { user: { username: seat.username, avatar: seat.avatar } };
  const w = room.watchers.get(id);
  return w ? { user: w } : null;
}

function newSeat(id, profile, bot = null) {
  return {
    id: String(id),
    bot,
    username: profile.username,
    avatar: profile.avatar || null,
    color: COLORS[0],
    pos: 0,
    coins: START_COINS,
    trophies: 0,
    wins: 0,
    left: false,
  };
}

// Ce que le client voit d'un mini-jeu : la partie publique, et selon la phase
// ce que chacun a fait (sans jamais la réponse avant la fin).
function miniView(room, meId) {
  const m = room.mini;
  if (!m) return null;
  const done = room.phase === "mini-result";
  const out = {
    kind: m.kind,
    name: MINI[m.kind].name,
    rules: MINI[m.kind].rules,
    durationMs: MINI[m.kind].durationMs,
    startsAt: m.startsAt || 0,
    ...(room.phase === "mini" || done ? m.public : {}),
    found: m.found.map((f) => ({ seatId: f.seatId, order: f.order })),
    tries: m.tries[String(meId)] || 0,
    guessed: !!m.guesses?.[String(meId)],
    answered: Object.keys(m.guesses || {}),
  };
  if (done) {
    out.answer = m.secret;
    out.results = m.results;
  }
  return out;
}

function serialize(room, meId) {
  const online = onlineAmong(room.seats.filter((s) => !s.bot).map((s) => s.id));
  return {
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === String(meId),
    settings: room.settings,
    phase: room.phase,
    phaseEndsAt: room.phaseEndsAt,
    now: now(),
    maxSeats: MAX_SEATS,
    trophyPrice: TROPHY_PRICE,
    board: { w: BOARD_W, h: BOARD_H, spaces: BOARD },
    trophyAt: room.trophyAt,
    round: room.round,
    turnSeat: room.order[room.turnIdx] || null,
    roll: room.roll || null,
    landing: room.landing || null,
    seats: room.seats
      .filter((s) => !s.left || room.phase !== "lobby")
      .map((s) => ({
        id: s.id,
        bot: s.bot || null,
        username: s.username,
        avatar: s.avatar,
        color: s.color,
        pos: s.pos,
        coins: s.coins,
        trophies: s.trophies,
        wins: s.wins,
        left: !!s.left,
        online: s.bot ? true : online.has(s.id),
        isMe: s.id === String(meId),
        isHost: s.id === room.hostId,
      })),
    watchers: [...room.watchers].map(([id, w]) => ({ id, ...w })),
    mini: miniView(room, meId),
    ranking: room.ranking || null,
  };
}

function toEach(room, kind, payload = {}) {
  for (const id of memberIds(room)) emitTo([id], EVENT, { code: room.code, kind, room: serialize(room, id), ...payload });
}
function toAll(room, kind, payload = {}) {
  emitTo(memberIds(room), EVENT, { code: room.code, kind, ...payload });
}

function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return rooms.get(String(code)) || null;
}

async function userCard(id) {
  const u = await User.findById(id).select("username avatar").lean();
  return u ? { username: u.username, avatar: u.avatar || null } : null;
}

function schedule(room, at, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error("party clock error:", err.message);
    }
  }, Math.max(0, at - now()));
  room.timer.unref?.();
}
function later(room, ms, fn) {
  const t = setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error("party timer error:", err.message);
    }
  }, ms);
  t.unref?.();
  room.botTimers.push(t);
}
function clearLater(room) {
  for (const t of room.botTimers) clearTimeout(t);
  room.botTimers = [];
}

// ============================================================
//  Le déroulé
// ============================================================
function startGame(room) {
  const seats = active(room);
  seats.forEach((s, i) => {
    s.color = COLORS[i % COLORS.length];
    s.pos = 0;
    s.coins = START_COINS;
    s.trophies = 0;
    s.wins = 0;
  });
  // L'ordre de jeu : tiré au sort une fois pour toute la partie.
  room.order = seats.map((s) => s.id).sort(() => Math.random() - 0.5);
  room.round = 1;
  room.turnIdx = 0;
  room.trophyAt = nextTrophySpace(0);
  room.recentGames = new Set();
  room.miniBag = [];
  room.ranking = null;
  room.mini = null;
  room.landing = null;
  room.roll = null;
  touch(room);
  beginTurn(room);
}

const current = (room) => seatOf(room, room.order[room.turnIdx]);

function beginTurn(room) {
  const seat = current(room);
  if (!seat || seat.left) return nextTurn(room);
  room.phase = "roll";
  room.roll = null;
  room.landing = null;
  room.phaseEndsAt = now() + ROLL_TIMEOUT;
  room.seq = (room.seq || 0) + 1;
  clearLater(room);
  touch(room);
  toEach(room, "turn");
  schedule(room, room.phaseEndsAt, () => doRoll(room, seat.id));
  if (seat.bot) later(room, 1200 + Math.random() * 900, () => doRoll(room, seat.id));
  // Un joueur hors ligne ne fait pas attendre la table.
  else if (!isOnline(seat.id)) later(room, 1500, () => doRoll(room, seat.id));
}

function doRoll(room, seatId) {
  if (room.phase !== "roll" || current(room)?.id !== seatId) return;
  const value = 1 + Math.floor(Math.random() * 10);
  room.roll = { seatId, value, steps: value };
  room.phase = "rolled";
  touch(room);
  toEach(room, "roll", { value });
  // Le temps de voir le dé s'arrêter, puis on avance.
  schedule(room, now() + 1100, () => move(room));
}

// Avance de case en case. On s'arrête net en passant le Trophée (pour proposer
// l'achat), puis on repart avec les pas qui restent.
function move(room) {
  const seat = current(room);
  if (!seat) return nextTurn(room);
  const left = room.roll.steps;
  const path = [];
  let pos = seat.pos;
  let stop = false;
  for (let k = 0; k < left; k += 1) {
    pos = (pos + 1) % BOARD_SIZE;
    path.push(pos);
    if (pos === room.trophyAt) {
      stop = true;
      break;
    }
  }
  seat.pos = pos;
  room.roll.steps = left - path.length;
  room.phase = "moving";
  touch(room);
  toEach(room, "move", { seatId: seat.id, path });
  const arrive = now() + path.length * STEP_MS + 250;
  schedule(room, arrive, () => {
    if (stop) return offerTrophy(room);
    land(room);
  });
}

function offerTrophy(room) {
  const seat = current(room);
  if (seat.coins < TROPHY_PRICE) {
    toAll(room, "nobuy", { seatId: seat.id });
    return continueMove(room);
  }
  room.phase = "buy";
  room.phaseEndsAt = now() + BUY_TIMEOUT;
  touch(room);
  toEach(room, "buy");
  schedule(room, room.phaseEndsAt, () => decide(room, seat.id, false));
  if (seat.bot) later(room, 1100, () => decide(room, seat.id, true));
  else if (!isOnline(seat.id)) later(room, 1000, () => decide(room, seat.id, true));
}

function decide(room, seatId, buy) {
  if (room.phase !== "buy" || current(room)?.id !== seatId) return;
  const seat = current(room);
  if (buy && seat.coins >= TROPHY_PRICE) {
    seat.coins -= TROPHY_PRICE;
    seat.trophies += 1;
    const from = room.trophyAt;
    room.trophyAt = nextTrophySpace(from);
    touch(room);
    toEach(room, "trophy", { seatId, from });
    gameChatSystem(EVENT, room, "win", seat, `${seat.username} achète un Trophée`);
    schedule(room, now() + 2200, () => continueMove(room));
  } else continueMove(room);
}

function continueMove(room) {
  if (room.roll?.steps > 0) return move(room);
  land(room);
}

// La case d'arrivée.
function land(room) {
  const seat = current(room);
  const space = BOARD[seat.pos];
  let landing = { seatId: seat.id, space: space.type, text: "", coins: 0 };
  if (space.type === "blue" || space.type === "start") {
    seat.coins += 3;
    landing = { ...landing, text: "+3 pièces", coins: 3 };
  } else if (space.type === "red") {
    const n = Math.min(3, seat.coins);
    seat.coins -= n;
    landing = { ...landing, text: "−3 pièces", coins: -n };
  } else if (space.type === "chance") {
    const ev = drawChance();
    const extra = ev.run(room, seat) || {};
    landing = { ...landing, text: ev.text, event: ev.key, ...extra };
  }
  room.landing = landing;
  room.phase = "landed";
  touch(room);
  toEach(room, "landed", { landing });
  schedule(room, now() + LAND_MS, () => nextTurn(room));
}

function nextTurn(room) {
  room.turnIdx += 1;
  if (room.turnIdx < room.order.length) return beginTurn(room);
  room.turnIdx = 0;
  startMini(room);
}

// ------------------------------------------------------------ les mini-jeux
async function startMini(room) {
  // Un sac mélangé : les trois mini-jeux tournent avant de revenir.
  if (!room.miniBag.length) room.miniBag = [...MINI_KEYS].sort(() => Math.random() - 0.5);
  let kind = room.miniBag.shift();
  room.phase = "mini-intro";
  room.mini = { kind, found: [], tries: {}, guesses: {}, startsAt: 0 };
  room.phaseEndsAt = now() + INTRO_MS;
  room.landing = null;
  room.roll = null;
  touch(room);
  toEach(room, "mini-intro");
  const seq = (room.seq = (room.seq || 0) + 1);
  // La préparation (prix Steam, trailer IGDB) se fait pendant la présentation.
  let prepared = null;
  try {
    prepared = await prepareMini(kind, room.cat, room.recentGames);
    if (!prepared) {
      kind = "blur";
      prepared = await prepareMini("blur", room.cat, room.recentGames);
    }
  } catch (err) {
    console.error("party mini prepare error:", err.message);
    prepared = await prepareMini("blur", room.cat, room.recentGames).catch(() => null);
    kind = "blur";
  }
  if (room.seq !== seq || room.phase !== "mini-intro" || !rooms.has(room.code)) return;
  if (!prepared) return afterMini(room);
  room.recentGames.add(prepared.secret.id);
  room.mini = { kind, public: prepared.public, secret: prepared.secret, found: [], tries: {}, guesses: {} };
  schedule(room, Math.max(now() + 300, room.phaseEndsAt), () => playMini(room));
}

function playMini(room) {
  const m = room.mini;
  room.phase = "mini";
  m.startsAt = now();
  room.phaseEndsAt = m.startsAt + MINI[m.kind].durationMs;
  touch(room);
  toEach(room, "mini");
  schedule(room, room.phaseEndsAt, () => endMini(room));
  // Les bots jouent aussi.
  for (const s of active(room).filter((x) => x.bot)) botMini(room, s);
}

function botMini(room, seat) {
  const m = room.mini;
  if (m.kind === "price") {
    const real = m.secret.price;
    const guess = Math.max(1, Math.round(real * (0.55 + Math.random() * 0.9)));
    later(room, 2500 + Math.random() * 6000, () => guessPrice(room, seat.id, guess));
    return;
  }
  // Un bot trouve une fois sur deux, plus ou moins tard.
  if (Math.random() < 0.5) {
    const at = MINI[m.kind].durationMs * (0.35 + Math.random() * 0.5);
    later(room, at, () => answerMini(room, seat.id, m.secret.name));
  }
}

const allDone = (room) => {
  const m = room.mini;
  const players = active(room);
  if (m.kind === "price") return players.every((s) => m.guesses[s.id] != null);
  return players.every((s) => m.found.some((f) => f.seatId === s.id) || (m.tries[s.id] || 0) >= 3);
};

function answerMini(room, seatId, text) {
  const m = room.mini;
  if (room.phase !== "mini" || !m || m.kind === "price") return { ok: false };
  if (m.found.some((f) => f.seatId === seatId)) return { ok: true, already: true };
  if ((m.tries[seatId] || 0) >= 3) return { ok: false, out: true };
  const ok = sameGame(room.cat, text, m.secret.id);
  if (!ok) {
    m.tries[seatId] = (m.tries[seatId] || 0) + 1;
    toAll(room, "mini-miss", { seatId, tries: m.tries[seatId] });
  } else {
    m.found.push({ seatId, order: m.found.length + 1, at: now() - m.startsAt });
    toAll(room, "mini-found", { seatId, order: m.found.length });
  }
  touch(room);
  if (allDone(room)) schedule(room, now() + 600, () => endMini(room));
  return { ok, tries: m.tries[seatId] || 0 };
}

function guessPrice(room, seatId, value) {
  const m = room.mini;
  if (room.phase !== "mini" || !m || m.kind !== "price") return false;
  if (m.guesses[seatId] != null) return false;
  m.guesses[seatId] = Math.max(0, Math.min(500, Number(value) || 0));
  touch(room);
  toAll(room, "mini-guess", { seatId });
  if (allDone(room)) schedule(room, now() + 500, () => endMini(room));
  return true;
}

function endMini(room) {
  if (room.phase !== "mini") return;
  clearLater(room);
  const m = room.mini;
  let ranked = [];
  if (m.kind === "price") {
    ranked = Object.entries(m.guesses)
      .map(([seatId, value]) => ({ seatId, value, diff: Math.abs(value - m.secret.price) }))
      .sort((a, b) => a.diff - b.diff);
  } else {
    ranked = m.found.map((f) => ({ seatId: f.seatId, at: f.at }));
  }
  m.results = ranked.map((r, i) => {
    const prize = MINI_PRIZES[i] || 0;
    const seat = seatOf(room, r.seatId);
    if (seat && prize) seat.coins += prize;
    if (seat && i === 0) seat.wins += 1;
    return { ...r, rank: i + 1, prize };
  });
  room.phase = "mini-result";
  room.phaseEndsAt = now() + RESULT_MS;
  touch(room);
  toEach(room, "mini-result");
  schedule(room, room.phaseEndsAt, () => afterMini(room));
}

function afterMini(room) {
  room.mini = null;
  if (room.round >= room.settings.turns) return finish(room);
  room.round += 1;
  room.turnIdx = 0;
  beginTurn(room);
}

function finish(room) {
  clearTimeout(room.timer);
  clearLater(room);
  // Le bonus de fin : un Trophée au meilleur des mini-jeux.
  const best = [...active(room)].sort((a, b) => b.wins - a.wins)[0];
  let bonus = null;
  if (best && best.wins > 0 && active(room).filter((s) => s.wins === best.wins).length === 1) {
    best.trophies += 1;
    bonus = { seatId: best.id, label: "Roi des mini-jeux" };
  }
  const ranking = [...active(room)]
    .sort((a, b) => b.trophies - a.trophies || b.coins - a.coins)
    .map((s, i) => ({
      id: s.id,
      bot: s.bot || null,
      username: s.username,
      avatar: s.avatar,
      color: s.color,
      place: i + 1,
      trophies: s.trophies,
      coins: s.coins,
      wins: s.wins,
      points: 0,
    }));
  const vsHumans = room.seats.filter((s) => !s.bot).length >= 2;
  for (const r of ranking) {
    if (r.bot) continue;
    const raw = 30 + r.trophies * 40 + r.wins * 10 + (r.place === 1 ? 80 : 0);
    r.points = arcadePoints("party", Math.round(raw * (vsHumans ? 1 : 0.5)));
    grantPoints(r.id, r.points, "party", { code: room.code, place: r.place }).catch(() => {});
    triggerMissionCheck(r.id);
  }
  room.ranking = ranking;
  room.bonus = bonus;
  room.phase = "done";
  room.phaseEndsAt = 0;
  touch(room);
  toEach(room, "done", { ranking, bonus });
  if (ranking[0]) gameChatSystem(EVENT, room, "win", ranking[0], `${ranking[0].username} remporte la partie`);
}

// ============================================================
//  Les routes
// ============================================================
function fail(res, status, error) {
  return res.status(status).json({ error });
}

router.post("/", async (req, res) => {
  try {
    const [profile, cat] = await Promise.all([userCard(req.userId), getBombCatalog()]);
    if (!profile) return fail(res, 401, "Compte introuvable.");
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = {
      code,
      hostId: String(req.userId),
      settings: { turns: 10 },
      seats: [newSeat(req.userId, profile)],
      watchers: new Map(),
      phase: "lobby",
      phaseEndsAt: 0,
      order: [],
      turnIdx: 0,
      round: 0,
      trophyAt: 14,
      cat,
      timer: null,
      botTimers: [],
      lastActiveAt: now(),
    };
    rooms.set(code, room);
    res.status(201).json({ room: serialize(room, req.userId) });
  } catch (err) {
    console.error("party create error:", err.message);
    fail(res, 500, "Impossible d'ouvrir la partie.");
  }
});

// Avant « /:code » : sinon « friends » serait pris pour un code.
router.get("/friends", async (req, res) => {
  try {
    const followers = await User.find({ following: req.userId }).select("username avatar").lean();
    const online = onlineAmong(followers.map((f) => f._id));
    const busy = new Set();
    for (const room of rooms.values())
      if (room.phase !== "lobby" && room.phase !== "done") for (const s of room.seats) if (!s.bot && !s.left) busy.add(s.id);
    const friends = followers.map((f) => {
      const id = String(f._id);
      return { id, username: f.username, avatar: f.avatar || null, online: online.has(id), ready: true, busy: busy.has(id) };
    });
    friends.sort(
      (a, b) =>
        Number(b.online && !b.busy) - Number(a.online && !a.busy) ||
        Number(b.online) - Number(a.online) ||
        a.username.localeCompare(b.username)
    );
    res.json({ friends });
  } catch {
    fail(res, 500, "Liste indisponible.");
  }
});

router.get("/:code", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Cette partie n'existe plus.");
  res.json({ room: serialize(room, req.userId), member: memberIds(room).includes(String(req.userId)) });
});

router.post("/:code/join", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!room) return fail(res, 404, "Cette partie n'existe plus.");
    const id = String(req.userId);
    const profile = await userCard(id);
    if (!profile) return fail(res, 401, "Compte introuvable.");
    const seat = seatOf(room, id);
    if (seat && !seat.left) return res.json({ room: serialize(room, id), member: true });
    if (room.phase === "lobby" && active(room).length < MAX_SEATS) {
      if (seat) {
        seat.left = false;
        Object.assign(seat, profile);
      } else room.seats.push(newSeat(id, profile));
      room.watchers.delete(id);
    } else room.watchers.set(id, profile);
    touch(room);
    toEach(room, "state");
    gameChatSystem(EVENT, room, "join", profile);
    res.json({ room: serialize(room, id), member: true });
  } catch (err) {
    console.error("party join error:", err.message);
    fail(res, 500, "Impossible de rejoindre.");
  }
});

router.post("/:code/leave", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return res.json({ ok: true });
  const id = String(req.userId);
  const seat = seatOf(room, id);
  const profile = seat ? { username: seat.username } : room.watchers.get(id);
  room.watchers.delete(id);
  if (seat && !seat.left) {
    if (room.phase === "lobby" || room.phase === "done") room.seats = room.seats.filter((s) => s !== seat);
    else seat.left = true;
  }
  if (!humans(room).length && !room.watchers.size) {
    destroy(room);
    return res.json({ ok: true });
  }
  if (room.hostId === id) {
    const heir = humans(room)[0];
    room.hostId = heir ? heir.id : [...room.watchers.keys()][0];
  }
  touch(room);
  if (profile) gameChatSystem(EVENT, room, "leave", profile);
  const playing = room.phase !== "lobby" && room.phase !== "done";
  if (playing && active(room).length < 2) finish(room);
  else if (playing && current(room)?.id === id && ["roll", "buy"].includes(room.phase)) nextTurn(room);
  else toEach(room, "state");
  res.json({ ok: true });
});

function hostOnly(req, res, room) {
  if (!room) return fail(res, 404, "Cette partie n'existe plus."), false;
  if (room.hostId !== String(req.userId)) return fail(res, 403, "L'hôte règle la partie."), false;
  if (room.phase !== "lobby" && room.phase !== "done") return fail(res, 409, "La partie a déjà commencé."), false;
  return true;
}

router.post("/:code/settings", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  const turns = Number(req.body?.turns);
  if (TURN_CHOICES.includes(turns)) room.settings.turns = turns;
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

// Les bots : pour tester, réservés aux admins.
const BOT_NAMES = ["Pixel", "Bitou", "Sprite", "Turbo"];
router.post("/:code/bot", async (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  const me = await User.findById(req.userId).select("isAdmin isSuperAdmin").lean();
  if (!me?.isAdmin && !me?.isSuperAdmin) return fail(res, 403, "Réservé aux admins.");
  if (req.body?.remove) room.seats = room.seats.filter((s) => !(s.bot && s.id === String(req.body.remove)));
  else {
    if (active(room).length >= MAX_SEATS) return fail(res, 409, `La table est pleine (${MAX_SEATS} places).`);
    const taken = new Set(room.seats.filter((s) => s.bot).map((s) => s.username));
    const name = BOT_NAMES.find((n) => !taken.has(n)) || "Bot";
    room.seats.push(newSeat(`bot:${makeCode(5)}`, { username: name, avatar: null }, "normal"));
  }
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

router.post("/:code/start", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!hostOnly(req, res, room)) return;
    room.cat = await getBombCatalog();
    for (const [id, w] of room.watchers) {
      if (active(room).length >= MAX_SEATS) break;
      room.seats.push(newSeat(id, w));
      room.watchers.delete(id);
    }
    room.seats = room.seats.filter((s) => !s.left);
    if (room.seats.length < 2) return fail(res, 422, "Il faut au moins deux joueurs.");
    gameChatReset(EVENT, room.code);
    startGame(room);
    res.json({ room: serialize(room, req.userId) });
  } catch (err) {
    console.error("party start error:", err.message);
    fail(res, 500, "Impossible de lancer la partie.");
  }
});

router.post("/:code/again", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  room.phase = "lobby";
  room.ranking = null;
  room.mini = null;
  room.landing = null;
  room.roll = null;
  room.seats = room.seats.filter((s) => !s.left);
  for (const s of room.seats) {
    s.pos = 0;
    s.coins = START_COINS;
    s.trophies = 0;
    s.wins = 0;
  }
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

// Le dé : c'est au serveur de le lancer, le client ne fait que l'animer.
router.post("/:code/roll", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Cette partie n'existe plus.");
  if (room.phase !== "roll" || current(room)?.id !== String(req.userId)) return fail(res, 409, "Ce n'est pas ton tour.");
  doRoll(room, String(req.userId));
  res.json({ ok: true });
});

router.post("/:code/buy", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Cette partie n'existe plus.");
  if (room.phase !== "buy" || current(room)?.id !== String(req.userId)) return fail(res, 409, "Pas maintenant.");
  decide(room, String(req.userId), !!req.body?.buy);
  res.json({ ok: true });
});

// POST /:code/mini — { text } (jeux à deviner) ou { value } (le juste prix).
router.post("/:code/mini", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Cette partie n'existe plus.");
  const seat = seatOf(room, req.userId);
  if (!seat || seat.left) return fail(res, 403, "Tu ne joues pas ici.");
  if (room.mini?.kind === "price") {
    const ok = guessPrice(room, seat.id, req.body?.value);
    return res.json({ ok });
  }
  const text = String(req.body?.text || "").trim().slice(0, 120);
  if (!text) return fail(res, 400, "Réponse vide.");
  res.json(answerMini(room, seat.id, text));
});

mountGameChat(router, { event: EVENT, load: async (code) => loadRoom(code), memberIds, find: findMember });

// Inviter un pote : la même mécanique que La Bombe.
router.post("/:code/challenge", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!room) return fail(res, 404, "Cette partie n'existe plus.");
    if (!memberIds(room).includes(String(req.userId))) return fail(res, 403, "Rejoins la partie avant d'inviter.");
    const targetId = String(req.body?.userId || "");
    const [me, target] = await Promise.all([
      User.findById(req.userId).select("username avatar").lean(),
      User.findById(targetId).select("username following").lean().catch(() => null),
    ]);
    if (!target) return fail(res, 404, "Joueur introuvable.");
    if (!(target.following || []).some((x) => String(x) === String(req.userId)))
      return fail(res, 403, `${target.username} ne te suit pas : envoie-lui le lien.`);
    const online = isOnline(targetId);
    if (online)
      emitTo([targetId], EVENT, {
        code: room.code,
        kind: "invite",
        by: { id: String(me._id), username: me.username, avatar: me.avatar || null },
      });
    else
      await deliverCard({
        fromId: req.userId,
        toId: target._id,
        text: "",
        versus: {
          kind: "party",
          code: room.code,
          hostName: me?.username || "",
          players: active(room).length,
          maxPlayers: MAX_SEATS,
          rounds: room.settings.turns,
        },
      });
    res.json({ online, target: { id: targetId, username: target.username } });
  } catch (err) {
    console.error("party challenge error:", err.message);
    fail(res, 500, "Invitation non envoyée.");
  }
});

router.get("/:code/card", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return res.json({ state: "gone" });
  const seats = active(room);
  const done = room.phase === "done";
  res.json({
    state: done ? "done" : room.phase === "lobby" ? "lobby" : "live",
    players: seats.map((s) => ({ id: s.id, username: s.username, avatar: s.avatar })),
    count: seats.length,
    max: MAX_SEATS,
    rounds: room.settings.turns,
    index: room.round,
    mine: memberIds(room).includes(String(req.userId)),
    winner: done ? room.ranking?.[0]?.username || null : null,
  });
});

export default router;
