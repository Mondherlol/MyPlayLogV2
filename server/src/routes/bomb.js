import express from "express";
import User from "../models/User.js";
import BombSkin from "../models/BombSkin.js";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong, isOnline } from "../lib/realtime.js";
import { grantPoints, arcadePoints } from "../lib/points.js";
import { recordActivity } from "../lib/activity.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import { makeCode } from "../lib/versusRoom.js";
import { mountGameChat, gameChatSystem, gameChatReset } from "../lib/gameChat.js";
import {
  getBombCatalog,
  judge,
  pickPrompt,
  promptView,
  examples,
  hintFor,
  botPick,
  typedName,
  titleKey,
  coverUrl,
} from "../lib/bombCatalog.js";

// ======================================================================
//  La Bombe — un BombParty où le dictionnaire est le catalogue de jeux
// ======================================================================
// Les joueurs sont assis en cercle, une bombe au milieu. Celui qui la tient
// voit un défi (un logo de studio, « Jeu de course », « Sorti sur GameCube »,
// « le titre contient ZEL ») et doit taper un jeu qui colle. Bonne réponse : la
// bombe passe au suivant, avec un nouveau défi. Elle explose quand ELLE veut —
// la mèche est tirée au hasard et JAMAIS envoyée au client — et celui qui la
// tient perd une vie. Dernier debout gagne.
//
// Ce qu'on a gardé de BombParty, parce que c'est ce qui fait le jeu :
//   - LA FRAPPE EN DIRECT : tout le monde voit le titre se former lettre par
//     lettre sous la tête de celui qui joue (POST /typing, rien en base) ;
//   - LA MÈCHE CACHÉE ET COMMUNE : une seule mèche pour toute la table, qui
//     continue de brûler quand la bombe passe — seule une petite grâce,
//     aléatoire, sauve celui qui la reçoit à la dernière seconde ;
//   - LES LETTRES BONUS : chaque lettre tapée dans une bonne réponse s'allume,
//     l'alphabet complet (sans K, W, X, Y, Z) rend une vie ;
//   - un jeu ne sort qu'une fois par partie.
//
// ------------------------------------------------------- tout est en mémoire
// Contrairement aux autres salons (documents Mongo), une partie de Bombe vit
// dans le process : un tour dure quelques secondes, la frappe part à chaque
// lettre, et un aller-retour en base par réponse n'apporterait rien — les
// salons des autres jeux ne survivent pas non plus à un redémarrage (leurs
// chronos sont en mémoire, cf. lib/versusRoom.js). Le chat de salon fait déjà
// pareil (lib/gameChat.js). Et tout ce qui modifie un salon s'exécute d'un
// bloc, sans `await` au milieu : deux réponses à la même milliseconde ne
// peuvent pas s'entrelacer.
const router = express.Router();
// ------------------------------------------------------------ la bombe de chacun
// GET /skin/:id.png — le dessin d'un joueur. PUBLIC et AVANT l'authentification :
// une balise <img> n'envoie pas de jeton, et un dessin de bombe n'a rien de
// privé. L'URL porte la version (`?v=`) : on peut la garder en cache un an.
router.get("/skin/:id.png", async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).end();
    const skin = await BombSkin.findOne({ user: req.params.id }).select("png").lean();
    if (!skin?.png) return res.status(404).end();
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(skin.png.buffer || skin.png));
  } catch {
    res.status(404).end();
  }
});

router.use(requireAuth);

const EVENT = "bombe";
export const MAX_SEATS = 8;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const COUNTDOWN_MS = 3500;
// La mèche d'une bombe neuve, tirée entre ces deux bornes. Plus longue que
// dans BombParty : un titre de jeu se tape moins vite qu'un mot.
const FUSE_MIN = 15000;
const FUSE_MAX = 34000;
// La grâce : qui reçoit la bombe à moins de GRACE_FROM de l'explosion se voit
// laisser entre GRACE_MIN et GRACE_MAX — de quoi taper un titre court. Tirée
// au hasard, pour que personne ne puisse compter dessus.
const GRACE_FROM = 2500;
const GRACE_MIN = 2500;
const GRACE_MAX = 4500;
// Un joueur hors ligne ne fait pas attendre la table une demi-minute.
const OFFLINE_TURN = 3500;
// Le temps de voir l'explosion et les réponses qu'il fallait donner.
// Court : « il fallait dire » se lit d'un coup d'œil, la partie repart vite.
const BOOM_PAUSE = 2200;
// Celui qui sèche reçoit un indice (les initiales d'une réponse) au bout de :
const HINT_AFTER = 9000;
// … et au plus tard quand il ne reste plus que ça avant l'explosion (ou tout
// de suite pour qui reçoit la bombe pendant la grâce de dernière seconde).
const HINT_BEFORE_BOOM = 7000;
const MAX_LIVES = 3;
// L'alphabet des lettres bonus, sans les lettres rares — comme BombParty.
export const BONUS = "ABCDEFGHIJLMNOPQRSTUV";
// Deux façons de jouer :
//   - « classic » : un défi pour TOUTE la table, qui reste jusqu'à l'explosion
//     (Capcom : Ace Attorney, puis Street Fighter, puis Mega Man…) ;
//   - « rotate »  : un défi neuf à chaque passage de bombe.
const MODES = ["classic", "rotate"];

const BOT_NAMES = ["Pixel", "Bitou", "Sprite", "Turbo", "Glitch", "Combo", "Polygone", "Kernel"];
// Un bot « connaît » les `reach` jeux les plus votés du catalogue, réfléchit
// `think` ms, tape à `cps` lettres par seconde, et sèche parfois (`blank`).
const BOT_LEVELS = {
  easy: { reach: 900, think: [2600, 6500], cps: [6, 9], blank: 0.2 },
  normal: { reach: 2600, think: [1800, 4800], cps: [8, 12], blank: 0.1 },
  hard: { reach: 7000, think: [1000, 3200], cps: [11, 16], blank: 0.04 },
};

// ------------------------------------------------------------- la triche
// Quitter l'onglet, coller un titre : ça se voit, et ça se DIT à toute la
// table. Pas de sanction — la honte publique suffit, et un faux positif (une
// notification qui vole le focus) ne doit coûter personne une vie.
// Les répliques s'affichent À CÔTÉ de la tête du joueur (le nom est déjà là) :
// ce sont des bouts de phrase sans sujet. Le chat, lui, les préfixe du pseudo.
const CHEAT_LINES = {
  away: [
    "est parti chercher sur Google",
    "demande à ChatGPT",
    "fouille IGDB en douce",
    "appelle son grand frère",
    "tape « liste jeux {p} »",
    "a quitté la table des yeux",
    "ouvre Wikipédia, l'air de rien",
    "check une tier list en scred",
    "relit ses vieux Joypad",
    "lit un forum de 2007",
    "demande à sa daronne",
    "consulte sa ludothèque",
    "envoie un vocal à un pote",
    "regarde une vidéo « top 10 {p} »",
    "a ouvert un autre onglet",
    "fait semblant d'aller aux toilettes",
  ],
  paste: [
    "fait du copier-coller",
    "a tenté le Ctrl+V",
    "colle des titres trouvés ailleurs",
    "a un presse-papier très chargé",
  ],
  back: [
    "revient après {s} s, l'air de rien",
    "est de retour après {s} s, louche",
    "réapparaît après {s} s avec une idée",
    "revient de {s} s de « pause »",
  ],
};
const CHEAT_GAP_MS = 5000;

const rooms = new Map();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => Date.now();

// Le ménage : un salon oublié s'efface au bout de deux heures sans geste.
setInterval(() => {
  const t = now();
  for (const [code, room] of rooms)
    if (t - room.lastActiveAt > ROOM_IDLE_MS) destroy(room);
}, 10 * 60 * 1000).unref?.();

function destroy(room) {
  clearTimeout(room.timer);
  clearBots(room);
  rooms.delete(room.code);
}

// ============================================================
//  Sièges, membres, sérialisation
// ============================================================
const humans = (room) => room.seats.filter((s) => !s.bot && !s.left);
const alive = (room) => room.seats.filter((s) => !s.out && !s.left);
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

function seatView(room, s, meId, online) {
  return {
    id: s.id,
    bot: s.bot || null,
    username: s.username,
    avatar: s.avatar || null,
    lives: s.lives,
    letters: [...s.letters],
    answers: s.answers,
    out: !!s.out,
    left: !!s.left,
    place: s.place || null,
    cheats: s.cheats || 0,
    // Sa bombe : la couleur, et la version de son dessin (0 = pas de dessin,
    // la tête de mort par défaut).
    skin: s.skin || null,
    online: s.bot ? true : online.has(s.id),
    isMe: s.id === String(meId),
    isHost: s.id === room.hostId,
  };
}

function serialize(room, meId) {
  const cat = room.cat;
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
    maxLives: MAX_LIVES,
    bonus: BONUS,
    seats: room.seats.filter((s) => !s.left || room.phase !== "lobby").map((s) => seatView(room, s, meId, online)),
    watchers: [...room.watchers].map(([id, w]) => ({ id, ...w })),
    seated: !!seatOf(room, meId) && !seatOf(room, meId).left,
    turn: room.turn
      ? {
          seatId: room.turn.seatId,
          prompt: cat ? promptView(cat, room.turn.prompt) : null,
          startedAt: room.turn.startedAt,
          // L'allumage de la bombe, le même pour toute la table : le tic-tac
          // s'accélère avec LUI (la mèche, elle, n'est jamais envoyée).
          litAt: room.litAt || room.turn.startedAt,
          text: room.turn.text || "",
          hint: room.turn.hint || null,
          n: room.turnCount,
        }
      : null,
    // Tout ce qui est déjà sorti : la liste « Déjà sortis » à côté de la table.
    history: room.history,
    usedCount: room.used.ids.size,
    ranking: room.ranking || null,
  };
}

function toEach(room, kind, payload = {}) {
  for (const id of memberIds(room))
    emitTo([id], EVENT, { code: room.code, kind, room: serialize(room, id), ...payload });
}
function toAll(room, kind, payload = {}, except = null) {
  emitTo(
    memberIds(room).filter((id) => id !== except),
    EVENT,
    { code: room.code, kind, ...payload }
  );
}

function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return rooms.get(String(code)) || null;
}

async function userCard(id) {
  const [u, skin] = await Promise.all([
    User.findById(id).select("username avatar").lean(),
    BombSkin.findOne({ user: id }).select("color v").lean(),
  ]);
  return u
    ? {
        username: u.username,
        avatar: u.avatar || null,
        skin: skin ? { color: skin.color, v: skin.v || 0 } : null,
      }
    : null;
}

function newSeat(id, profile, bot = null) {
  return {
    id: String(id),
    bot,
    username: profile.username,
    avatar: profile.avatar || null,
    lives: 3,
    letters: new Set(),
    answers: 0,
    out: false,
    left: false,
    place: null,
    outAt: 0,
    cheats: 0,
    lastCheatAt: 0,
    skin: profile.skin || null,
  };
}

// ============================================================
//  Le déroulé
// ============================================================
function schedule(room, at, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error("bombe clock error:", err.message);
    }
  }, Math.max(0, at - now()));
  room.timer.unref?.();
}

function clearBots(room) {
  for (const t of room.botTimers || []) clearTimeout(t);
  room.botTimers = [];
}

// Le prochain siège encore en vie, dans le sens du cercle.
function nextAlive(room, fromId) {
  const list = room.seats;
  const i = list.findIndex((s) => s.id === fromId);
  for (let k = 1; k <= list.length; k += 1) {
    const s = list[(i + k + list.length) % list.length];
    if (!s.out && !s.left) return s;
  }
  return null;
}

function startGame(room) {
  for (const s of room.seats) {
    s.lives = room.settings.lives;
    s.letters = new Set();
    s.answers = 0;
    s.out = false;
    s.place = null;
    s.outAt = 0;
    s.cheats = 0;
  }
  room.used = { ids: new Set(), keys: new Set() };
  room.history = [];
  room.recent = [];
  room.turnCount = 0;
  room.turn = null;
  room.ranking = null;
  room.startedAt = now();
  room.phase = "countdown";
  room.phaseEndsAt = now() + COUNTDOWN_MS;
  touch(room);
  toEach(room, "countdown");
  schedule(room, room.phaseEndsAt, () => {
    const first = pick(alive(room));
    room.phase = "play";
    room.phaseEndsAt = 0;
    newTurn(room, first, true);
  });
}

// Donner la bombe à un siège, avec un défi neuf. `fresh` : bombe neuve (début
// de partie, après une explosion) — sinon la mèche continue de brûler.
function newTurn(room, seat, fresh) {
  if (!seat) return finish(room);
  const cat = room.cat;
  // Mode classique : le même défi pour toute la table tant que la bombe n'a
  // pas explosé (on n'en change que s'il n'a plus aucune réponse à offrir).
  const keep =
    !fresh &&
    room.settings.mode !== "rotate" &&
    room.turn?.prompt &&
    room.turn.prompt.known.some((id) => !room.used.ids.has(id));
  const prompt = keep ? room.turn.prompt : pickPrompt(cat, {
    // Un défi qui doit tenir toute une bombe a besoin de beaucoup de réponses.
    difficulty: room.settings.mode === "rotate" ? "normal" : "easy",
    // Jamais « un jeu favori de » celui qui reçoit le défi : ce serait gratuit.
    extra: (room.extra || []).filter((p) => p.key !== `u:${seat.id}`),
    turn: room.turnCount,
    recent: room.recent,
    used: room.used,
  });
  if (!keep) room.recent = [...room.recent.slice(-15), prompt.key];
  room.turnCount += 1;
  room.turn = { seatId: seat.id, prompt, startedAt: now(), text: "" };
  const t = now();
  if (fresh || !room.bombAt) {
    room.bombAt = t + rand(FUSE_MIN, FUSE_MAX);
    room.litAt = t;
  }
  // La mèche est COMMUNE : passer la bombe ne la rallonge pas. Seule exception,
  // la grâce de dernière seconde (cf. GRACE_FROM).
  if (!seat.bot && !isOnline(seat.id)) {
    // Hors ligne : on ne le fait pas attendre, mais on ne RALLONGE jamais.
    room.bombAt = Math.min(room.bombAt, t + OFFLINE_TURN);
  } else if (room.bombAt - t < GRACE_FROM) {
    room.bombAt = t + rand(GRACE_MIN, GRACE_MAX);
  }
  room.seq = (room.seq || 0) + 1;
  clearBots(room);
  touch(room);
  toEach(room, "turn");
  schedule(room, room.bombAt, () => explode(room));
  if (seat.bot) botTurn(room, seat, room.seq);
  else {
    // L'indice, s'il sèche encore au bout de HINT_AFTER (rien si la bombe
    // passe ou explose avant : le numéro de tour a changé).
    const seq = room.seq;
    const hintIn = Math.max(1200, Math.min(HINT_AFTER, room.bombAt - t - HINT_BEFORE_BOOM));
    const t2 = setTimeout(() => {
      if (room.seq !== seq || room.phase !== "play" || !room.turn) return;
      const hint = hintFor(room.cat, room.turn.prompt, room.used);
      if (!hint) return;
      room.turn.hint = hint;
      toAll(room, "hint", { seatId: seat.id, n: room.turnCount, hint });
    }, hintIn);
    t2.unref?.();
    room.botTimers.push(t2);
  }
}

function explode(room) {
  if (room.phase !== "play" || !room.turn) return;
  clearBots(room);
  const seat = seatOf(room, room.turn.seatId);
  const prompt = room.turn.prompt;
  if (seat) {
    seat.lives = Math.max(0, seat.lives - 1);
    if (seat.lives === 0) {
      seat.out = true;
      seat.outAt = now();
      seat.place = alive(room).length + 1;
    }
  }
  const ex = examples(room.cat, prompt, room.used, 3);
  room.phase = "boom";
  room.phaseEndsAt = now() + BOOM_PAUSE;
  room.bombAt = 0;
  room.litAt = 0;
  room.turn.text = "";
  touch(room);
  toEach(room, "boom", {
    seatId: seat?.id || null,
    out: !!seat?.out,
    examples: ex,
  });
  if (seat)
    gameChatSystem(
      EVENT,
      room,
      "boom",
      seat,
      seat.out ? `${seat.username} a explosé — éliminé` : `${seat.username} a explosé`
    );
  schedule(room, room.phaseEndsAt, () => {
    if (alive(room).length <= 1) return finish(room);
    room.phase = "play";
    room.phaseEndsAt = 0;
    // Comme dans BombParty : la bombe neuve part chez le VOISIN de celui qui
    // vient d'exploser — on ne remet pas la pression sur le même.
    newTurn(room, seat ? nextAlive(room, seat.id) : pick(alive(room)), true);
  });
}

function finish(room) {
  if (room.phase === "done") return;
  clearTimeout(room.timer);
  clearBots(room);
  room.phase = "done";
  room.phaseEndsAt = 0;
  room.turn = null;
  room.bombAt = 0;
  const winner = alive(room)[0] || null;
  if (winner) winner.place = 1;
  const ranking = room.seats
    .filter((s) => s.place || s === winner)
    .slice()
    .sort((a, b) => (a.place || 99) - (b.place || 99))
    .map((s) => ({
      id: s.id,
      bot: s.bot || null,
      username: s.username,
      avatar: s.avatar,
      place: s.place,
      answers: s.answers,
      points: 0,
    }));

  // Les points d'arcade. Une bonne réponse paie peu, gagner paie bien — et
  // seulement entre humains à plein tarif : contre des bots, c'est un
  // entraînement, à moitié prix.
  const nHumans = room.seats.filter((s) => !s.bot).length;
  const factor = nHumans >= 2 ? 1 : 0.5;
  for (const r of ranking) {
    if (r.bot) continue;
    const raw =
      r.answers * 8 +
      (r.place === 1 ? 60 + 15 * (room.seats.length - 1) : 0) +
      (r.place === 2 ? 25 : 0);
    r.points = arcadePoints("bombe", Math.round(raw * factor));
    if (r.points > 0)
      grantPoints(r.id, r.points, "bombe", { code: room.code, place: r.place, answers: r.answers }).catch(
        () => {}
      );
    triggerMissionCheck(r.id);
  }
  // Le fil : une ligne par humain, une seule carte (dédoublonnée par
  // versusId, cf. routes/feed.js). L'id de partie n'est PAS le code de la
  // table : une même table enchaîne plusieurs parties.
  const gameId = `bombe-${room.code}-${Date.now()}`;
  const players = ranking.map((r) => ({
    id: r.id,
    bot: !!r.bot,
    username: r.username,
    avatar: r.avatar || null,
    score: r.answers || 0,
    rank: r.place || 99,
  }));
  for (const r of ranking) {
    if (r.bot) continue;
    recordActivity({
      actor: r.id,
      type: "bombe",
      meta: { versusId: gameId, rank: r.place || 99, points: r.points, total: room.seats.length, players },
    });
  }

  room.ranking = ranking;
  touch(room);
  toEach(room, "done", { ranking });
  if (winner) gameChatSystem(EVENT, room, "win", winner, `${winner.username} remporte la partie`);
}

// ------------------------------------------------------------ une réponse
// Renvoie le verdict ; la diffusion est faite ici, pour les humains comme pour
// les bots.
function answer(room, seat, text) {
  const verdict = judge(room.cat, room.turn.prompt, text, room.used);
  if (!verdict.ok) {
    toAll(room, "miss", {
      seatId: seat.id,
      text: String(text).slice(0, 80),
      reason: verdict.reason,
      game: verdict.game ? { name: verdict.game.name, year: verdict.game.year, license: !!verdict.game.license } : null,
    });
    return verdict;
  }
  const g = verdict.game;
  room.used.ids.add(g.id);
  room.used.keys.add(verdict.key);
  room.used.keys.add(titleKey(text));
  seat.answers += 1;

  // Les lettres bonus : celles du titre TAPÉ (c'est l'effort qui compte).
  const fresh = [];
  for (const ch of String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()) {
    if (BONUS.includes(ch) && !seat.letters.has(ch)) {
      seat.letters.add(ch);
      fresh.push(ch);
    }
  }
  let life = false;
  if (seat.letters.size >= BONUS.length) {
    seat.letters = new Set();
    if (seat.lives < MAX_LIVES) {
      seat.lives += 1;
      life = true;
    }
  }
  const hit = {
    seatId: seat.id,
    text: String(text).slice(0, 80),
    id: g.id,
    // Une licence se montre comme une licence : « Fire Emblem », pas l'épisode
    // qui a servi à valider le défi.
    name: verdict.license || g.name,
    license: !!verdict.license,
    cover: coverUrl(g.cover),
    year: verdict.license ? null : g.year,
    typo: !!verdict.typo,
    letters: fresh,
    life,
    prompt: promptView(room.cat, room.turn.prompt),
    at: now(),
  };
  room.history.push({
    seatId: seat.id,
    id: g.id,
    name: hit.name,
    license: hit.license,
    cover: hit.cover,
    year: hit.year,
    // Ce qui a été tapé : une licence (« zelda ») bloque son écriture aussi.
    typed: hit.text,
  });
  if (room.history.length > 200) room.history.splice(0, room.history.length - 200);
  toAll(room, "hit", hit);
  newTurn(room, nextAlive(room, seat.id), false);
  return verdict;
}

// ------------------------------------------------------------ les bots
// Un bot réfléchit, tape son titre lettre à lettre (la même frappe en direct
// que les humains), valide. Parfois il sèche : il commence un titre, l'efface,
// ou propose un jeu à côté — la table doit le voir hésiter.
function botTurn(room, seat, seq) {
  const lvl = BOT_LEVELS[seat.bot] || BOT_LEVELS.normal;
  const later = (ms, fn) => {
    const t = setTimeout(() => {
      if (room.seq !== seq || room.phase !== "play" || room.turn?.seatId !== seat.id) return;
      fn();
    }, ms);
    t.unref?.();
    room.botTimers.push(t);
  };
  const typeOut = (text, startMs, cps, then) => {
    let at = startMs;
    for (let i = 1; i <= text.length; i += 1) {
      at += (1000 / cps) * rand(0.6, 1.5);
      const part = text.slice(0, i);
      later(at, () => {
        room.turn.text = part;
        toAll(room, "typing", { seatId: seat.id, text: part });
      });
    }
    later(at + rand(180, 420), then);
    return at;
  };
  const think = rand(...lvl.think);
  const cps = rand(...lvl.cps);
  const g = Math.random() < lvl.blank ? null : botPick(room.cat, room.turn.prompt, room.used, lvl.reach);
  if (g) {
    const name = typedName(g);
    typeOut(name, think, cps, () => answer(room, seat, name));
    return;
  }
  // Il sèche : une fausse piste (un jeu connu qui ne colle pas), puis plus rien.
  const wrong = room.cat.byId.get(pick(room.cat.top));
  const tryName = typedName(wrong || { name: "Tetris" });
  typeOut(tryName, think, cps, () => {
    answer(room, seat, tryName);
    later(1200, () => {
      room.turn.text = "";
      toAll(room, "typing", { seatId: seat.id, text: "" });
    });
  });
}

// « Un jeu favori de X » : un défi par joueur de la table qui a au moins
// quatre favoris dans le catalogue. La réponse, c'est l'un de SES favoris.
async function favPrompts(room) {
  const cat = room.cat;
  const out = [];
  for (const seat of room.seats) {
    if (seat.bot || seat.left) continue;
    // eslint-disable-next-line no-await-in-loop
    const favs = await UserGame.find({ user: seat.id, favorite: true }).select("gameId").lean();
    const ids = favs.map((f) => f.gameId).filter((id) => cat.byId.has(id));
    if (ids.length < 4) continue;
    ids.sort((a, b) => cat.byId.get(a).rank - cat.byId.get(b).rank);
    out.push({
      key: `u:${seat.id}`,
      kind: "fav",
      label: seat.username,
      avatar: seat.avatar || null,
      ids: new Set(ids),
      known: ids,
    });
  }
  return out;
}

// ============================================================
//  Les routes
// ============================================================
function fail(res, status, error) {
  return res.status(status).json({ error });
}

// POST / — ouvrir un salon.
router.post("/", async (req, res) => {
  try {
    const [profile, cat] = await Promise.all([userCard(req.userId), getBombCatalog()]);
    if (!profile) return fail(res, 401, "Compte introuvable.");
    if (!cat?.prompts?.length) return fail(res, 503, "Le catalogue de jeux n'est pas prêt.");
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = {
      code,
      hostId: String(req.userId),
      settings: { lives: 3, mode: "classic" },
      seats: [newSeat(req.userId, profile)],
      watchers: new Map(),
      phase: "lobby",
      phaseEndsAt: 0,
      turn: null,
      bombAt: 0,
      turnCount: 0,
      recent: [],
      used: { ids: new Set(), keys: new Set() },
      history: [],
      ranking: null,
      cat,
      timer: null,
      botTimers: [],
      seq: 0,
      lastActiveAt: now(),
    };
    rooms.set(code, room);
    res.status(201).json({ room: serialize(room, req.userId) });
  } catch (err) {
    console.error("bombe create error:", err.message);
    fail(res, 500, "Impossible d'ouvrir le salon.");
  }
});

// Avant « /:code » : sinon « friends » serait pris pour un code de salon.
// GET /friends — mes potes (ceux qui me suivent : la règle de la messagerie),
// en ligne d'abord. « Occupé » : déjà assis à une autre table en pleine partie.
router.get("/friends", async (req, res) => {
  try {
    const followers = await User.find({ following: req.userId }).select("username avatar").lean();
    const online = onlineAmong(followers.map((f) => f._id));
    const busy = new Set();
    for (const room of rooms.values())
      if (room.phase !== "lobby" && room.phase !== "done")
        for (const s of room.seats) if (!s.bot && !s.out && !s.left) busy.add(s.id);
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
  } catch (err) {
    console.error("bombe friends error:", err.message);
    res.status(500).json({ error: "Liste indisponible." });
  }
});

// GET /skin — ma bombe, pour la rouvrir dans l'atelier (traits compris).
router.get("/skin", async (req, res) => {
  try {
    const skin = await BombSkin.findOne({ user: req.userId }).select("color strokes v").lean();
    res.json({ skin: skin ? { color: skin.color, strokes: skin.strokes || [], v: skin.v || 0 } : null });
  } catch {
    res.status(500).json({ error: "Bombe illisible." });
  }
});

// POST /skin — { color, png (data URL), strokes }. Sans dessin (png vide) :
// retour à la tête de mort, la couleur reste.
const SKIN_PNG_MAX = 400 * 1024;
router.post("/skin", async (req, res) => {
  try {
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || "") ? req.body.color : "#1d1d23";
    let png = null;
    const raw = String(req.body?.png || "");
    if (raw) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
      if (!m) return res.status(400).json({ error: "Dessin illisible." });
      png = Buffer.from(m[1], "base64");
      if (png.length > SKIN_PNG_MAX) return res.status(413).json({ error: "Dessin trop lourd." });
    }
    const strokes = Array.isArray(req.body?.strokes) ? req.body.strokes : [];
    if (JSON.stringify(strokes).length > 600 * 1024)
      return res.status(413).json({ error: "Dessin trop détaillé." });
    const v = Date.now();
    await BombSkin.updateOne(
      { user: req.userId },
      { $set: { color, png, strokes: png ? strokes : [], v: png ? v : 0 } },
      { upsert: true }
    );
    const skin = { color, v: png ? v : 0 };
    // Les tables où je suis assis voient ma nouvelle bombe tout de suite.
    for (const room of rooms.values()) {
      const seat = seatOf(room, req.userId);
      if (!seat || seat.left) continue;
      seat.skin = skin;
      toEach(room, "state");
    }
    res.json({ skin });
  } catch (err) {
    console.error("bombe skin error:", err.message);
    res.status(500).json({ error: "Bombe non enregistrée." });
  }
});

router.get("/:code", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Ce salon n'existe plus.");
  const member = memberIds(room).includes(String(req.userId));
  res.json({ room: serialize(room, req.userId), member });
});

// POST /:code/join — s'asseoir (salon d'attente) ou regarder (partie lancée).
router.post("/:code/join", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!room) return fail(res, 404, "Ce salon n'existe plus.");
    const id = String(req.userId);
    const profile = await userCard(id);
    if (!profile) return fail(res, 401, "Compte introuvable.");
    const seat = seatOf(room, id);
    if (seat && !seat.left) return res.json({ room: serialize(room, id), member: true });
    const seatsTaken = room.seats.filter((s) => !s.left).length;
    if (room.phase === "lobby" && seatsTaken < MAX_SEATS) {
      if (seat) {
        seat.left = false;
        Object.assign(seat, profile);
      } else room.seats.push(newSeat(id, profile));
      room.watchers.delete(id);
    } else {
      // Partie en cours ou table pleine : on regarde, on discute, et on
      // s'assied à la prochaine.
      room.watchers.set(id, profile);
    }
    touch(room);
    toEach(room, "state");
    gameChatSystem(EVENT, room, "join", profile);
    res.json({ room: serialize(room, id), member: true });
  } catch (err) {
    console.error("bombe join error:", err.message);
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
    if (room.phase === "lobby" || room.phase === "done") {
      room.seats = room.seats.filter((s) => s !== seat);
    } else {
      seat.left = true;
      if (!seat.out) {
        seat.out = true;
        seat.outAt = now();
        seat.place = alive(room).length + 1;
      }
    }
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
  const playing = room.phase === "play" || room.phase === "boom" || room.phase === "countdown";
  if (playing && alive(room).length <= 1) finish(room);
  else if (room.phase === "play" && room.turn?.seatId === id) newTurn(room, nextAlive(room, id), false);
  else toEach(room, "state");
  res.json({ ok: true });
});

function hostOnly(req, res, room) {
  if (!room) return fail(res, 404, "Ce salon n'existe plus."), false;
  if (room.hostId !== String(req.userId)) return fail(res, 403, "L'hôte règle la partie."), false;
  if (room.phase !== "lobby" && room.phase !== "done")
    return fail(res, 409, "La partie a déjà commencé."), false;
  return true;
}

// POST /:code/settings — { lives, mode }
router.post("/:code/settings", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  const lives = Number(req.body?.lives);
  if (lives >= 1 && lives <= MAX_LIVES) room.settings.lives = Math.round(lives);
  if (MODES.includes(req.body?.mode)) room.settings.mode = req.body.mode;
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

// POST /:code/bot — { level } ajoute un bot ; { remove: id } le retire.
router.post("/:code/bot", async (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  // Les bots ne servent qu'à tester : réservés aux admins.
  const me = await User.findById(req.userId).select("isAdmin isSuperAdmin").lean();
  if (!me?.isAdmin && !me?.isSuperAdmin) return fail(res, 403, "Réservé aux admins.");
  if (req.body?.remove) {
    room.seats = room.seats.filter((s) => !(s.bot && s.id === String(req.body.remove)));
  } else if (req.body?.id) {
    // Changer le niveau d'un bot déjà assis (un clic sur sa tête).
    const b = room.seats.find((s) => s.bot && s.id === String(req.body.id));
    if (b && BOT_LEVELS[req.body.level]) b.bot = req.body.level;
  } else {
    if (room.seats.filter((s) => !s.left).length >= MAX_SEATS)
      return fail(res, 409, `La table est pleine (${MAX_SEATS} places).`);
    const level = BOT_LEVELS[req.body?.level] ? req.body.level : "normal";
    const taken = new Set(room.seats.filter((s) => s.bot).map((s) => s.username));
    const name = BOT_NAMES.find((n) => !taken.has(n)) || `Bot ${room.seats.length + 1}`;
    room.seats.push(newSeat(`bot:${makeCode(5)}`, { username: name, avatar: null }, level));
  }
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

router.post("/:code/start", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!hostOnly(req, res, room)) return;
    // Le catalogue a pu être rechargé depuis l'ouverture du salon.
    room.cat = await getBombCatalog();
    if (room.phase !== "lobby" && room.phase !== "done") return fail(res, 409, "Déjà lancée.");
    // Retour au salon après une partie : les spectateurs prennent place.
    for (const [id, w] of room.watchers) {
      if (room.seats.filter((s) => !s.left).length >= MAX_SEATS) break;
      room.seats.push(newSeat(id, w));
      room.watchers.delete(id);
    }
    room.seats = room.seats.filter((s) => !s.left);
    if (room.seats.length < 2)
      return fail(res, 422, "Il faut au moins deux joueurs — invite quelqu'un ou ajoute un bot.");
    room.extra = await favPrompts(room);
    gameChatReset(EVENT, room.code);
    startGame(room);
    res.json({ room: serialize(room, req.userId) });
  } catch (err) {
    console.error("bombe start error:", err.message);
    fail(res, 500, "Impossible de lancer la partie.");
  }
});

// POST /:code/again — retour au salon d'attente, mêmes réglages.
router.post("/:code/again", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!hostOnly(req, res, room)) return;
  room.phase = "lobby";
  room.turn = null;
  room.ranking = null;
  room.seats = room.seats.filter((s) => !s.left);
  for (const s of room.seats) {
    s.out = false;
    s.place = null;
    s.lives = room.settings.lives;
    s.letters = new Set();
  }
  for (const [id, w] of room.watchers) {
    if (room.seats.length >= MAX_SEATS) break;
    room.seats.push(newSeat(id, w));
    room.watchers.delete(id);
  }
  touch(room);
  toEach(room, "state");
  res.json({ room: serialize(room, req.userId) });
});

// POST /:code/typing — la frappe en direct de celui qui tient la bombe.
router.post("/:code/typing", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room || room.phase !== "play" || room.turn?.seatId !== String(req.userId))
    return res.json({ ok: true });
  const text = String(req.body?.text || "").slice(0, 80);
  room.turn.text = text;
  toAll(room, "typing", { seatId: String(req.userId), text }, String(req.userId));
  res.json({ ok: true });
});

// POST /:code/answer — { text }. Le serveur tranche.
router.post("/:code/answer", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return fail(res, 404, "Ce salon n'existe plus.");
  if (room.phase !== "play" || !room.turn) return fail(res, 409, "Ce n'est pas le moment.");
  const seat = seatOf(room, req.userId);
  if (!seat || seat.out || room.turn.seatId !== seat.id)
    return fail(res, 409, "Ce n'est pas ton tour.");
  const text = String(req.body?.text || "").trim().slice(0, 120);
  if (!text) return fail(res, 400, "Réponse vide.");
  touch(room);
  const v = answer(room, seat, text);
  res.json({ ok: v.ok, reason: v.reason || null, game: v.game ? { name: v.game.name } : null });
});

// POST /:code/cheat — { what: "away" | "paste" | "back", ms }
router.post("/:code/cheat", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room || !["play", "boom", "countdown"].includes(room.phase)) return res.json({ ok: true });
  const seat = seatOf(room, req.userId);
  if (!seat || seat.out || seat.bot) return res.json({ ok: true });
  const what = CHEAT_LINES[req.body?.what] ? req.body.what : "away";
  const ms = Math.max(0, Math.min(10 * 60 * 1000, Number(req.body?.ms) || 0));
  if (what === "back" && ms < 3000) return res.json({ ok: true });
  const t = now();
  if (t - (seat.lastCheatAt || 0) < CHEAT_GAP_MS) return res.json({ ok: true });
  seat.lastCheatAt = t;
  seat.cheats = (seat.cheats || 0) + 1;
  const label = room.turn?.prompt?.label || "jeux vidéo";
  const line = pick(CHEAT_LINES[what])
    .replace("{n}", seat.username)
    .replace("{p}", label.toLowerCase())
    .replace("{s}", String(Math.round(ms / 1000)));
  toAll(room, "cheat", { seatId: seat.id, what, line, cheats: seat.cheats });
  gameChatSystem(EVENT, room, "cheat", seat, `${seat.username} ${line}`);
  res.json({ ok: true });
});

// Le chat du salon : joueurs ET spectateurs (une partie de Bombe se regarde,
// et on y charrie celui qui vient d'exploser).
mountGameChat(router, {
  event: EVENT,
  load: async (code) => loadRoom(code),
  memberIds,
  find: findMember,
});

// ============================================================
//  Inviter (cartes de la messagerie)
// ============================================================
router.post("/:code/invite", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!room) return fail(res, 404, "Ce salon n'existe plus.");
    if (!memberIds(room).includes(String(req.userId)))
      return fail(res, 403, "Rejoins le salon avant d'inviter.");
    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [...new Set((req.body?.conversationIds || []).map(String))].slice(0, 10);
    if (!userIds.length && !conversationIds.length) return fail(res, 400, "Personne à inviter.");
    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: userIds } }).select("username following").lean(),
    ]);
    const card = {
      kind: "bombe",
      code: room.code,
      hostName: me?.username || "",
      players: room.seats.filter((s) => !s.left).length,
      maxPlayers: MAX_SEATS,
      rounds: room.settings.lives,
    };
    const text = String(req.body?.text || "").slice(0, 300);
    const sent = [];
    const skipped = [];
    for (const target of targets) {
      const allowed = (target.following || []).some((x) => String(x) === String(req.userId));
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await deliverCard({ fromId: req.userId, toId: target._id, text, versus: card });
      sent.push({ id: String(target._id), username: target.username });
    }
    const groups = [];
    for (const cid of conversationIds) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await deliverCardToConversation({ fromId: req.userId, conversationId: cid, text, versus: card });
      if (ok) groups.push(cid);
    }
    touch(room);
    res.json({ sent, skipped, groups });
  } catch (err) {
    console.error("bombe invite error:", err.message);
    fail(res, 500, "Invitation non envoyée.");
  }
});

// ============================================================
//  Inviter un pote (comme le duel de cartes)
// ============================================================
// POST /:code/challenge — { userId }. En ligne : une fenêtre s'ouvre chez lui,
// où qu'il soit sur le site (components/cards/battle/DuelInvites.jsx). Hors
// ligne : la carte d'invitation part dans ses messages.
router.post("/:code/challenge", async (req, res) => {
  try {
    const room = loadRoom(req.params.code);
    if (!room) return fail(res, 404, "Ce salon n'existe plus.");
    if (!memberIds(room).includes(String(req.userId))) return fail(res, 403, "Rejoins la table avant d'inviter.");
    const targetId = String(req.body?.userId || "");
    if (!targetId || targetId === String(req.userId)) return fail(res, 400, "Choisis un pote.");
    const [me, target] = await Promise.all([
      User.findById(req.userId).select("username avatar").lean(),
      User.findById(targetId).select("username avatar following").lean().catch(() => null),
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
          kind: "bombe",
          code: room.code,
          hostName: me?.username || "",
          players: room.seats.filter((s) => !s.left).length,
          maxPlayers: MAX_SEATS,
          rounds: room.settings.lives,
        },
      });
    touch(room);
    res.json({ online, target: { id: targetId, username: target.username } });
  } catch (err) {
    console.error("bombe challenge error:", err.message);
    fail(res, 500, "Invitation non envoyée.");
  }
});

// GET /:code/card — l'état du salon pour la carte d'invitation (même forme que
// les autres jeux : la carte du chat est un composant unique).
router.get("/:code/card", (req, res) => {
  const room = loadRoom(req.params.code);
  if (!room) return res.json({ state: "gone" });
  const seats = room.seats.filter((s) => !s.left);
  const done = room.phase === "done";
  const winner = done ? room.ranking?.find((r) => r.place === 1) : null;
  res.json({
    state: done ? "done" : room.phase === "lobby" ? "lobby" : "live",
    players: seats.map((s) => ({ id: s.id, username: s.username, avatar: s.avatar })),
    count: seats.length,
    max: MAX_SEATS,
    rounds: room.settings.lives,
    index: 0,
    mine: memberIds(room).includes(String(req.userId)),
    winner: winner?.username || null,
  });
});

export default router;
