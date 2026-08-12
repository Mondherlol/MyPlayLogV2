import express from "express";
import BlindTestVersus, { MAX_PLAYERS, LIVES } from "../models/BlindTestVersus.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import {
  buildVersusRounds,
  person,
  sameGame,
  versusCandidates,
} from "./blindtest.js";
import {
  makeRoomQueue,
  makeClock,
  makeCode,
  hostIdOf,
  isHost,
  activePlayers,
  playerIds,
  allIds,
  findPlayer,
} from "../lib/versusRoom.js";
import { mountGameChat, gameChatSystem, gameChatReset } from "../lib/gameChat.js";

// ======================================================================
//  Blind test VERSUS
// ======================================================================
// Le pendant musical de routes/geoVersus.js, dont il reprend la machinerie
// (lib/versusRoom.js) et l'esprit : le serveur arbitre, le chrono est à lui, et
// la réponse ne sort qu'à la révélation.
//
// Deux choses lui sont propres :
//
//   1. L'AUDIO SORT DE L'IFRAME YOUTUBE, exactement comme en solo. Il a
//      longtemps été relayé par notre serveur sous une adresse opaque
//      (/clip/:index) pour ne pas livrer le videoId — donc la réponse — à qui
//      ouvre la console. Ce chemin dépendait de yt-dlp, et depuis une IP de
//      datacenter YouTube le casse en permanence : en prod le mode multi
//      partait MUET, pendant que le solo retombait sur l'iframe et jouait très
//      bien la même piste. On a tranché pour un mode jouable plutôt qu'un mode
//      inviolable et silencieux. Le videoId part donc dès le sas (roundView).
//   2. LES INDICES du solo (année, plateformes, studio) sont conservés : ils
//      sont l'essentiel de la tension d'une manche, et ils sont les mêmes pour
//      tout le monde au même instant.
const router = express.Router();

router.use(requireAuth);

// L'EXTRAIT DURE PLUS LONGTEMPS QU'EN SOLO, ET IL N'Y A PAS DE TEMPS MORT.
// Le solo coupe le son au bout de quinze secondes et laisse dix secondes de
// silence pour finir de taper : c'est un chrono personnel, il faut bien le
// clore. En buzzer, la manche s'arrête d'elle-même dès que quelqu'un trouve ou
// que plus personne n'a de vie (`shouldEndEarly`) — la borne de temps ne sert
// qu'aux manches que personne ne décroche. Autant, alors, laisser la musique
// tourner : dix secondes de silence collectif pendant que trois joueurs
// cherchent encore, c'est du jeu en moins pour tout le monde.
const CLIP_SEC = 35;
const GRACE_MS = 0;
const ROUND_MS = CLIP_SEC * 1000 + GRACE_MS;
// Le sas : « 3, 2, 1 ». Il laisse aussi à chaque iframe le temps de charger la
// vidéo et de poser l'aiguille au climax, muette, avant le départ commun.
const CUE_MIN_MS = 5000;
const REVEAL_MS = 7000;
const DEFAULT_ROUNDS = 8;

// BUZZER : le premier bon jeu rafle tout et clôt la manche, les autres n'ont
// rien. Brutal, et c'est le principe — comme le mode buzzer de GeoGamer.
const BUZZER_POINTS = 300;
// Bonus de vitesse : trouver dans les trois premières secondes de l'extrait
// vaut plus que trouver à la vingtième. Sans lui, un buzz sur la première note
// et un buzz au forceps se paieraient pareil, alors que c'est exactement ce que
// le mode veut départager.
const SPEED_BONUS = 120;
const MISS_FACTOR = [1, 0.65, 0.3];
const WINNER_BONUS = 0.2;
const missFactor = (m) => MISS_FACTOR[Math.min(Math.max(m, 0), MISS_FACTOR.length - 1)];

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];

const withRoom = makeRoomQueue((code) =>
  BlindTestVersus.findOne({ code }).populate(POPULATE)
);
const clock = makeClock("btversus");

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return BlindTestVersus.findOne({ code: String(code) }).populate(POPULATE);
}

const touch = (room) => {
  room.lastActiveAt = new Date();
};
const curRound = (room) => room.rounds[room.index] || null;

// ============================================================
//  Vies et état d'un joueur sur la manche
// ============================================================
function livesOf(round, userId) {
  if (!round) return LIVES;
  const misses = round.attempts.filter(
    (a) => !a.correct && String(a.user) === String(userId)
  ).length;
  return Math.max(0, LIVES - misses);
}

function isSettled(round, userId) {
  if (!round) return false;
  const mine = round.attempts.filter((a) => String(a.user) === String(userId));
  return mine.some((a) => a.correct) || mine.filter((a) => !a.correct).length >= LIVES;
}

// ============================================================
//  Sérialisation
// ============================================================
// CE QUE LE CLIENT A LE DROIT DE SAVOIR. Avant la révélation : de quoi jouer
// l'extrait, les indices, et l'état des autres. Ni le nom du jeu, ni la
// jaquette, ni le titre du morceau — le videoId, lui, est nécessaire à l'iframe
// et part donc tout de suite (voir l'en-tête du fichier).
function roundView(room, meId) {
  const round = curRound(room);
  if (!round || room.phase === "lobby") return null;
  const revealed = room.phase === "reveal" || room.phase === "done";

  const found = round.attempts
    .filter((a) => a.correct)
    .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));

  const view = {
    index: room.index,
    total: room.rounds.length,
    // L'EXTRAIT SORT DE L'IFRAME YOUTUBE, comme en solo — donc le videoId part
    // dès le sas. C'est un choix assumé et il a un prix : qui ouvre la console
    // pendant la manche peut remonter au titre de la vidéo, donc à la réponse.
    // On l'accepte parce que l'autre chemin (l'audio relayé par notre serveur
    // sous une adresse opaque) dépend de yt-dlp, que YouTube casse en
    // permanence depuis une IP de datacenter : il rendait le mode multi muet en
    // prod alors que le solo, lui, retombait sur cette même iframe et jouait.
    // Mieux vaut un mode jouable qu'un mode inviolable et silencieux.
    videoId: round.videoId,
    // Où se caler dans le morceau : le client reçoit la vidéo entière, pas
    // l'extrait découpé, et doit savoir où poser l'aiguille.
    startFrac: round.startFrac ?? 0.4,
    durationSec: CLIP_SEC,
    graceMs: GRACE_MS,
    hints: round.hints || null,
    lives: livesOf(round, meId),
    settled: isSettled(round, meId),
    found,
    // Les vies de tout le monde : voir un adversaire brûler ses cœurs fait
    // partie de la course. Le TITRE qu'il a tapé, lui, ne sort jamais.
    livesById: Object.fromEntries(
      activePlayers(room).map((p) => {
        const id = String(p.user?._id || p.user);
        return [id, livesOf(round, id)];
      })
    ),
    out: activePlayers(room)
      .map((p) => String(p.user?._id || p.user))
      .filter((id) => isSettled(round, id) && !found.some((f) => f.userId === id)),
    // Le fil des tentatives de tout le monde : en buzzer c'est public (voir
    // POST /guess). Utile aussi au rechargement de page en pleine manche.
    attempts: round.attempts.map((a) => ({
      userId: String(a.user),
      name: a.name,
      correct: a.correct,
      atMs: a.atMs,
    })),
  };

  if (revealed) {
    view.winner = round.winner ? String(round.winner) : null;
    view.gameId = round.gameId;
    view.gameName = round.gameName;
    view.cover = round.cover;
    view.ostName = round.ostName;
    view.results = round.results.map((r) => ({
      userId: String(r.user),
      correct: r.correct,
      order: r.order,
      misses: r.misses,
      timeMs: r.timeMs,
      points: r.points,
    }));
  }
  return view;
}

function serializeRoom(room, meId) {
  const ids = allIds(room);
  const online = onlineAmong(ids);
  const hostId = hostIdOf(room);
  return {
    code: room.code,
    hostId,
    isHost: hostId === String(meId),
    roundCount: room.roundCount,
    durationSec: room.durationSec,
    phase: room.phase,
    index: room.index,
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    now: Date.now(),
    players: room.players.map((p) => {
      const id = String(p.user?._id || p.user);
      return {
        ...person(p.user),
        id,
        ready: !!p.ready,
        score: p.score || 0,
        correctCount: p.correctCount || 0,
        online: online.has(id),
        isHost: id === hostId,
        isMe: id === String(meId),
        left: !!p.leftAt,
      };
    }),
    round: roundView(room, meId),
    started: !!room.startedAt,
    endedAt: room.endedAt,
  };
}

function toRoom(room, kind, payload = {}) {
  emitTo(playerIds(room), "btversus", { code: room.code, kind, ...payload });
}

function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "btversus", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

// ============================================================
//  Le déroulé d'une manche
// ============================================================
// LE SAS EST DE DURÉE FIXE. Il s'allongeait avant, le temps que notre serveur
// ait extrait la piste lui-même — c'était le prix de
// l'audio relayé maison. Maintenant que chaque navigateur charge la vidéo
// directement chez YouTube, il n'y a plus rien à attendre côté serveur : les
// cinq secondes servent au décompte « 3, 2, 1 » et au préchargement de l'iframe
// de chacun, qui se cale au climax pendant ce temps-là.
async function startCue(room, index) {
  room.phase = "cue";
  room.index = index;
  room.phaseStartsAt = Date.now() + CUE_MIN_MS;
  room.phaseEndsAt = room.phaseStartsAt + ROUND_MS;
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "cue");
  clock.at(room.code, room.phaseStartsAt, () => withRoom(room.code, beginRound));
  return room;
}

async function beginRound(room) {
  if (room.phase !== "cue") return room;
  room.phase = "round";
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "go");
  clock.at(room.code, room.phaseEndsAt, () => withRoom(room.code, endRound));
  return room;
}

async function endRound(room) {
  if (room.phase !== "round" && room.phase !== "cue") return room;
  const round = curRound(room);
  if (!round) return finishGame(room);

  const players = activePlayers(room);
  const winners = round.attempts.filter((a) => a.correct);

  // BUZZER : seul le premier à avoir trouvé marque. Les autres peuvent avoir
  // eu la bonne réponse en tête, elle ne vaut rien — la manche s'est arrêtée.
  round.results = players.map((p) => {
    const uid = String(p.user?._id || p.user);
    const mine = round.attempts.filter((a) => String(a.user) === String(uid));
    const hit = mine.find((a) => a.correct) || null;
    const misses = mine.filter((a) => !a.correct).length;
    const order = hit ? winners.findIndex((a) => String(a.user) === uid) + 1 : null;
    const won = order === 1;
    // Part de l'extrait qu'il restait à écouter : 1 = buzz sur la première
    // note, 0 = buzz à la toute fin.
    const frac = won ? Math.max(0, 1 - Math.min(hit.atMs, CLIP_SEC * 1000) / (CLIP_SEC * 1000)) : 0;
    return {
      user: p.user?._id || p.user,
      correct: !!hit,
      timeMs: hit ? hit.atMs : null,
      misses,
      order,
      points: won
        ? Math.round((BUZZER_POINTS + SPEED_BONUS * frac) * missFactor(misses))
        : 0,
    };
  });
  if (winners.length) round.winner = winners[0].user;

  for (const r of round.results) {
    const p = findPlayer(room, r.user);
    if (!p) continue;
    p.score = (p.score || 0) + (r.points || 0);
    if (r.correct) p.correctCount = (p.correctCount || 0) + 1;
  }

  room.phase = "reveal";
  room.phaseStartsAt = Date.now();
  room.phaseEndsAt = room.phaseStartsAt + REVEAL_MS;
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "reveal");

  clock.at(room.code, room.phaseEndsAt, () =>
    withRoom(room.code, async (r) => {
      if (r.phase !== "reveal") return r;
      if (r.index + 1 < r.rounds.length) return startCue(r, r.index + 1);
      return finishGame(r);
    })
  );
  return room;
}

async function finishGame(room) {
  if (room.phase === "done") return room;
  clock.stop(room.code);
  room.phase = "done";
  room.endedAt = new Date();
  room.phaseStartsAt = Date.now();
  room.phaseEndsAt = 0;
  touch(room);
  await room.save();
  await room.populate(POPULATE);

  const ranking = activePlayers(room)
    .slice()
    .sort(
      (a, b) => (b.score || 0) - (a.score || 0) || (b.correctCount || 0) - (a.correctCount || 0)
    )
    .map((p, i) => ({
      user: person(p.user),
      id: String(p.user?._id || p.user),
      rank: i + 1,
      score: p.score || 0,
      correct: p.correctCount || 0,
    }));

  toEachRoom(room, "done", { ranking });

  const mates = ranking.map((r) => ({
    id: r.id,
    username: r.user?.username || "",
    avatar: r.user?.avatar || null,
    score: r.score,
    rank: r.rank,
  }));
  for (const r of ranking) {
    const bonus = r.rank === 1 ? Math.round(r.score * WINNER_BONUS) : 0;
    grantPoints(r.id, r.score + bonus, "btversus", {
      versusId: String(room._id),
      rank: r.rank,
      bonus,
    }).catch(() => {});
    recordActivity({
      actor: r.id,
      type: "btversus",
      meta: {
        versusId: String(room._id),
        score: r.score,
        rank: r.rank,
        correct: r.correct,
        total: room.rounds.length,
        players: mates,
      },
    });
    triggerMissionCheck(r.id);
  }
  return room;
}

// Une manche se clôt dès que plus personne n'a de raison de chercher — et en
// buzzer, ça arrive DÈS LE PREMIER BON JEU : c'est toute la règle du mode.
function shouldEndEarly(room, round) {
  const players = playerIds(room);
  if (!players.length) return true;
  if (round.attempts.some((a) => a.correct)) return true;
  return players.every((id) => isSettled(round, id));
}

// ============================================================
//  Ouvrir / rejoindre / quitter
// ============================================================

router.post("/", async (req, res) => {
  try {
    const roundCount = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 3), 12);
    let room = null;
    for (let i = 0; i < 3 && !room; i += 1) {
      const code = makeCode();
      // eslint-disable-next-line no-await-in-loop
      if (await BlindTestVersus.exists({ code })) continue;
      // eslint-disable-next-line no-await-in-loop
      room = await BlindTestVersus.create({
        code,
        host: req.userId,
        roundCount,
        players: [{ user: req.userId, joinedAt: new Date(), ready: true }],
      });
    }
    if (!room) return res.status(500).json({ error: "Salon non créé, réessaie." });
    await room.populate(POPULATE);
    res.status(201).json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("btversus create error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir le salon." });
  }
});

router.get("/:code", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    const mine = allIds(room).includes(String(req.userId));
    const payload = { room: serializeRoom(room, req.userId), member: mine };
    if (mine && room.startedAt && room.phase !== "done")
      payload.candidates = await versusCandidates(playerIds(room), room.rounds);
    res.json(payload);
  } catch (err) {
    console.error("btversus get error:", err.message);
    res.status(500).json({ error: "Salon illisible." });
  }
});

router.post("/:code/join", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.endedAt || room.phase === "done")
        return { error: "Cette partie est terminée.", status: 410 };
      const existing = findPlayer(room, req.userId);
      if (!existing && room.startedAt)
        return { error: "La partie a déjà commencé.", status: 409 };
      if (!existing && activePlayers(room).length >= MAX_PLAYERS)
        return { error: `Le salon est complet (${MAX_PLAYERS} joueurs).`, status: 409 };
      if (existing) existing.leftAt = null;
      else room.players.push({ user: req.userId, joinedAt: new Date(), ready: false });
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      gameChatSystem("btversus", room, "join", findPlayer(room, req.userId)?.user);
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), member: true });
  } catch (err) {
    console.error("btversus join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre." });
  }
});

router.post("/:code/leave", async (req, res) => {
  try {
    await withRoom(String(req.params.code), async (room) => {
      const me = findPlayer(room, req.userId);
      if (!me) return room;
      me.leftAt = new Date();
      const hostLeft = isHost(room, req.userId);
      if (!room.startedAt && hostLeft) {
        clock.stop(room.code);
        room.endedAt = new Date();
        room.phase = "done";
        await room.save();
        toRoom(room, "closed");
        return room;
      }
      if (room.startedAt && !activePlayers(room).length) {
        await room.save();
        return finishGame(room);
      }
      if (hostLeft && activePlayers(room).length) room.host = activePlayers(room)[0].user;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      gameChatSystem("btversus", room, "leave", me.user);
      const round = curRound(room);
      if (room.phase === "round" && round && shouldEndEarly(room, round))
        return endRound(room);
      return room;
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("btversus leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/:code/ready", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      const me = findPlayer(room, req.userId);
      if (!me || room.startedAt) return room;
      me.ready = req.body?.ready !== false;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return room;
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    res.json({ room: serializeRoom(out, req.userId) });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/:code/rounds", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "L'hôte règle la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      room.roundCount = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 3), 12);
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId) });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/start — l'hôte lance. Les manches sont tirées ici.
router.post("/:code/start", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "Seul l'hôte lance la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (activePlayers(room).length < 2)
        return { error: "Il faut être au moins deux pour un versus.", status: 422 };

      // Les manches sont tirées pour LA TABLE, pas pour un joueur : elles
      // mélangent les bibliothèques de tous les participants (cf. blindtest.js).
      const rounds = await buildVersusRounds(playerIds(room), room.roundCount);
      if (rounds.length < 3)
        return {
          error: "Pas assez d'OST disponibles pour lancer un versus.",
          status: 422,
        };
      room.rounds = rounds;
      room.roundCount = rounds.length;
      room.durationSec = CLIP_SEC;
      room.startedAt = new Date();
      for (const p of room.players) {
        p.score = 0;
        p.correctCount = 0;
      }
      await room.save();
      await room.populate(POPULATE);
      // La liste de recherche se construit ICI, avant d'armer le sas : elle
      // dépend des manches (toutes les réponses doivent y être) mais passe par
      // IGDB, et la calculer après le départ grignoterait le décompte commun.
      const candidates = await versusCandidates(playerIds(room), room.rounds);
      return { room: await startCue(room, 0), candidates };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), candidates: out.candidates });
  } catch (err) {
    console.error("btversus start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// POST /:code/guess — une proposition. LE SERVEUR TRANCHE.
router.post("/:code/guess", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "round") return { error: "Ce n'est pas le moment.", status: 409 };
      const me = findPlayer(room, req.userId);
      if (!me || me.leftAt) return { error: "Tu ne joues pas ici.", status: 403 };
      const round = curRound(room);
      if (!round) return { error: "Manche introuvable.", status: 409 };
      if (isSettled(round, req.userId))
        return { error: "Tu as déjà joué cette manche.", status: 409 };

      const gameId = req.body?.gameId != null ? Number(req.body.gameId) : null;
      const name = String(req.body?.name || "").slice(0, 160);
      if (gameId == null && !name) return { error: "Réponse vide.", status: 400 };

      const correct = sameGame(round, gameId, name);
      const atMs = Math.max(0, Date.now() - (room.phaseEndsAt - ROUND_MS));
      round.attempts.push({ user: req.userId, gameId, name, correct, atMs });
      touch(room);
      await room.save();
      await room.populate(POPULATE);

      const lives = livesOf(round, req.userId);
      const found = round.attempts
        .filter((a) => a.correct)
        .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));
      // En BUZZER on diffuse TOUT, y compris le titre proposé : voir les
      // fausses pistes des autres tomber fait partie du mode (c'est aussi ce
      // qui permet de ne pas retenter la même). La manche s'arrêtant au premier
      // bon jeu, il n'y a plus rien à protéger — celui qui lit une mauvaise
      // réponse a déjà perdu le temps de la lire.
      toRoom(room, "guess", {
        by: String(req.userId),
        correct,
        name,
        found,
        livesById: Object.fromEntries(
          activePlayers(room).map((p) => {
            const id = String(p.user?._id || p.user);
            return [id, livesOf(round, id)];
          })
        ),
        out: activePlayers(room)
          .map((p) => String(p.user?._id || p.user))
          .filter((id) => isSettled(round, id) && !found.some((f) => f.userId === id)),
      });

      if (shouldEndEarly(room, round)) await endRound(room);
      return { correct, lives, settled: isSettled(round, req.userId) };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("btversus guess error:", err.message);
    res.status(500).json({ error: "Réponse non enregistrée." });
  }
});

// POST /:code/typing — ce que je suis en train de taper, diffusé aux autres.
// Le sel du buzzer : voir une piste se former en face et accélérer. Rien n'est
// écrit en base, c'est un geste et pas une donnée.
router.post("/:code/typing", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room || room.phase !== "round") return res.json({ ok: true });
    if (!playerIds(room).includes(String(req.userId))) return res.json({ ok: true });
    emitTo(
      playerIds(room).filter((id) => id !== String(req.userId)),
      "btversus",
      {
        code: room.code,
        kind: "typing",
        by: String(req.userId),
        text: String(req.body?.text || "").slice(0, 60),
      }
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

router.post("/:code/again", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId)) return { error: "Seul l'hôte relance.", status: 403 };
      if (room.phase !== "done") return { error: "La partie n'est pas finie.", status: 409 };
      room.rounds = [];
      room.index = 0;
      room.phase = "lobby";
      room.startedAt = null;
      room.endedAt = null;
      room.phaseStartsAt = 0;
      room.phaseEndsAt = 0;
      for (const p of room.players) {
        p.score = 0;
        p.correctCount = 0;
        p.ready = String(p.user?._id || p.user) === String(req.userId);
      }
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      // Nouvelle partie, fil neuf : les vannes de la précédente n'ont plus de
      // contexte une fois le tableau des scores effacé.
      gameChatReset("btversus", room.code);
      toEachRoom(room, "lobby");
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId) });
  } catch {
    res.status(500).json({ error: "Erreur." });
  }
});

// Le chat du salon (lib/gameChat.js) : GET/POST /:code/chat.
mountGameChat(router, { event: "btversus", load: loadRoom });

// ============================================================
//  Inviter
// ============================================================
router.post("/:code/invite", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (!allIds(room).includes(String(req.userId)))
      return res.status(403).json({ error: "Rejoins le salon avant d'inviter." });
    if (room.startedAt) return res.status(409).json({ error: "La partie a déjà commencé." });

    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [...new Set((req.body?.conversationIds || []).map(String))].slice(0, 10);
    if (!userIds.length && !conversationIds.length)
      return res.status(400).json({ error: "Personne à inviter." });

    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: userIds } }).select("username following").lean(),
    ]);

    const card = {
      kind: "blindtest",
      code: room.code,
      hostName: me?.username || "",
      players: activePlayers(room).length,
      maxPlayers: MAX_PLAYERS,
      rounds: room.roundCount,
    };
    const text = String(req.body?.text || "").slice(0, 300);

    const sent = [];
    const skipped = [];
    for (const target of targets) {
      const allowed = (target.following || []).some((id) => String(id) === String(req.userId));
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
      const ok = await deliverCardToConversation({
        fromId: req.userId,
        conversationId: cid,
        text,
        versus: card,
      });
      if (ok) groups.push(cid);
    }

    touch(room);
    await room.save();
    res.json({ sent, skipped, groups });
  } catch (err) {
    console.error("btversus invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /:code/card — l'état du salon pour la carte d'invitation de la
// messagerie. Strictement le pendant de celui de GeoGamer (routes/geoVersus.js,
// même en-tête) : la carte du chat est un composant unique, les deux jeux
// doivent lui répondre la même forme.
router.get("/:code/card", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room) return res.json({ state: "gone" });
    const active = activePlayers(room);
    const done = room.phase === "done" || !!room.endedAt;
    const champ = done
      ? [...room.players]
          .filter((p) => !p.leftAt)
          .sort(
            (a, b) =>
              (b.score || 0) - (a.score || 0) || (b.correctCount || 0) - (a.correctCount || 0)
          )[0]
      : null;
    res.json({
      state: done ? "done" : room.startedAt ? "live" : "lobby",
      players: active.map((p) => person(p.user)),
      count: active.length,
      max: MAX_PLAYERS,
      rounds: room.roundCount,
      index: room.index,
      mine: allIds(room).includes(String(req.userId)),
      winner: champ ? person(champ.user)?.username || null : null,
    });
  } catch (err) {
    console.error("btversus card error:", err.message);
    res.json({ state: "gone" });
  }
});

export default router;
