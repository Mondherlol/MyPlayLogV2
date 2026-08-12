import express from "express";
import PixelVersus, { MAX_PLAYERS, LIVES, AMMO, SPLAT_MS } from "../models/PixelVersus.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import { person, sameGame } from "./blindtest.js";
import { buildPixelVersusRounds, pixelVersusCandidates } from "./pixel.js";
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
//  Pixel Rush VERSUS
// ======================================================================
// Le jumeau visuel du blind test versus (routes/blindtestVersus.js), dont il
// reprend la structure phase par phase. Deux choses seulement lui appartiennent,
// et ce sont elles qui ont demandé du travail :
//
//   1. LA RÉPONSE RESTE AU SERVEUR. On n'envoie que la capture ; ni le nom du
//      jeu, ni sa jaquette, ni son id ne traversent avant la révélation. C'est
//      la même règle que le videoId caché du blind test, pour la même raison :
//      en solo tricher ne lèse que soi, ici ça vole la manche aux autres.
//      (L'URL de la capture reste, elle, un identifiant IGDB — on ne peut rien
//      en tirer sans requêter IGDB soi-même, ce qui est très au-delà du coup
//      d'œil dans la console qu'on cherche à empêcher.)
//   2. LES TOMATES. Voir POST /:code/splat, tout en bas.
//
// Pas de sas d'extraction ici, contrairement au blind test : la capture vient
// du CDN d'IGDB, il n'y a rien à préparer. Le « 3, 2, 1 » est donc fixe.
const router = express.Router();

router.use(requireAuth);

const ROUND_SEC = 30;
const ROUND_MS = ROUND_SEC * 1000;
const CUE_MS = 4000;
const REVEAL_MS = 7000;
const DEFAULT_ROUNDS = 8;

// BUZZER : le premier bon jeu rafle tout et clôt la manche. Même barème que le
// blind test versus, pour que les deux modes se vaillent à la cagnotte.
const BUZZER_POINTS = 300;
const SPEED_BONUS = 120;
const MISS_FACTOR = [1, 0.65, 0.3];
const WINNER_BONUS = 0.2;
const missFactor = (m) => MISS_FACTOR[Math.min(Math.max(m, 0), MISS_FACTOR.length - 1)];

// Deux tomates coup sur coup sur la même personne, ça ne fait plus rire :
// l'éclaboussure ne se rallume qu'après ce délai chez le lanceur.
const SPLAT_COOLDOWN_MS = 2500;
// `${code}:${userId}` → timestamp du dernier tir. En mémoire du process, comme
// les sessions du solo : un redémarrage n'offre au pire qu'une tomate d'avance.
// Purgée à chaque tir, sinon elle grossirait salon après salon sans jamais
// rendre une ligne (les salons, eux, s'effacent tout seuls au bout de 2 h).
const lastSplat = new Map();
function pruneSplats(now) {
  for (const [k, t] of lastSplat) if (now - t > 60000) lastSplat.delete(k);
}

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];

const withRoom = makeRoomQueue((code) =>
  PixelVersus.findOne({ code }).populate(POPULATE)
);
const clock = makeClock("pxversus");

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return PixelVersus.findOne({ code: String(code) }).populate(POPULATE);
}

const touch = (room) => {
  room.lastActiveAt = new Date();
};
const curRound = (room) => room.rounds[room.index] || null;

function toRoom(room, kind, payload = {}) {
  emitTo(playerIds(room), "pxversus", { code: room.code, kind, ...payload });
}
function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "pxversus", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

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
// CE QUE LE CLIENT A LE DROIT DE SAVOIR avant la révélation : la capture, le
// coin laissé net, les indices, et l'état des autres. Rien du jeu lui-même.
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
    shot: round.shots?.[0] || null,
    clearCorner: round.clearCorner || "tl",
    durationSec: ROUND_SEC,
    hints: round.hints || null,
    lives: livesOf(round, meId),
    settled: isSettled(round, meId),
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
    // Le fil des tentatives : en buzzer c'est public (voir POST /guess).
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
    splatMs: SPLAT_MS,
    players: room.players.map((p) => {
      const id = String(p.user?._id || p.user);
      return {
        ...person(p.user),
        id,
        ready: !!p.ready,
        score: p.score || 0,
        correctCount: p.correctCount || 0,
        ammo: p.ammo ?? AMMO,
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

// ============================================================
//  Le déroulé d'une manche
// ============================================================
async function startCue(room, index) {
  room.phase = "cue";
  room.index = index;
  room.phaseStartsAt = Date.now() + CUE_MS;
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

  // BUZZER : seul le premier à avoir trouvé marque.
  round.results = players.map((p) => {
    const uid = String(p.user?._id || p.user);
    const mine = round.attempts.filter((a) => String(a.user) === String(uid));
    const hit = mine.find((a) => a.correct) || null;
    const misses = mine.filter((a) => !a.correct).length;
    const order = hit ? winners.findIndex((a) => String(a.user) === uid) + 1 : null;
    const won = order === 1;
    const frac = won ? Math.max(0, 1 - Math.min(hit.atMs, ROUND_MS) / ROUND_MS) : 0;
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
    grantPoints(r.id, r.score + bonus, "pxversus", {
      versusId: String(room._id),
      rank: r.rank,
      bonus,
    }).catch(() => {});
    recordActivity({
      actor: r.id,
      type: "pxversus",
      meta: {
        versusId: String(room._id),
        code: room.code,
        rank: r.rank,
        score: r.score,
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
// buzzer, ça arrive DÈS LE PREMIER BON JEU.
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
      if (await PixelVersus.exists({ code })) continue;
      // eslint-disable-next-line no-await-in-loop
      room = await PixelVersus.create({
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
    console.error("pxversus create error:", err.message);
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
      payload.candidates = await pixelVersusCandidates(playerIds(room), room.rounds);
    res.json(payload);
  } catch (err) {
    console.error("pxversus get error:", err.message);
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
      gameChatSystem("pxversus", room, "join", findPlayer(room, req.userId)?.user);
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), member: true });
  } catch (err) {
    console.error("pxversus join error:", err.message);
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
      gameChatSystem("pxversus", room, "leave", me.user);
      const round = curRound(room);
      if (room.phase === "round" && round && shouldEndEarly(room, round))
        return endRound(room);
      return room;
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("pxversus leave error:", err.message);
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

// POST /:code/start — l'hôte lance. Les manches sont tirées ici, pour LA TABLE.
router.post("/:code/start", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "Seul l'hôte lance la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (activePlayers(room).length < 2)
        return { error: "Il faut être au moins deux pour un versus.", status: 422 };

      const rounds = await buildPixelVersusRounds(playerIds(room), room.roundCount);
      if (rounds.length < 3)
        return {
          error: "Pas assez de captures d'écran pour lancer un versus.",
          status: 422,
        };
      room.rounds = rounds;
      room.roundCount = rounds.length;
      room.durationSec = ROUND_SEC;
      room.startedAt = new Date();
      for (const p of room.players) {
        p.score = 0;
        p.correctCount = 0;
        p.ammo = AMMO;
      }
      await room.save();
      await room.populate(POPULATE);
      // La liste de recherche se construit ICI : elle dépend des manches mais
      // passe par IGDB, et la calculer après le départ grignoterait le décompte.
      const candidates = await pixelVersusCandidates(playerIds(room), room.rounds);
      return { room: await startCue(room, 0), candidates };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), candidates: out.candidates });
  } catch (err) {
    console.error("pxversus start error:", err.message);
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
      // En BUZZER on diffuse TOUT, titre proposé compris : voir les fausses
      // pistes des autres fait partie du mode, et la manche s'arrêtant au
      // premier bon jeu, il n'y a plus rien à protéger.
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
    console.error("pxversus guess error:", err.message);
    res.status(500).json({ error: "Réponse non enregistrée." });
  }
});

// POST /:code/typing — ce que je suis en train de taper, diffusé aux autres.
// Rien n'est écrit en base : c'est un geste, pas une donnée.
router.post("/:code/typing", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room || room.phase !== "round") return res.json({ ok: true });
    if (!playerIds(room).includes(String(req.userId))) return res.json({ ok: true });
    emitTo(
      playerIds(room).filter((id) => id !== String(req.userId)),
      "pxversus",
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

// ============================================================
//  POST /:code/splat — la tomate
// ============================================================
// Trois par partie, et c'est TOUT le dosage du truc : une ressource rare se
// garde pour le moment où quelqu'un est visiblement en train de trouver. En
// illimité, ce serait un écran couvert de purée du début à la fin et plus
// personne ne jouerait.
//
// Ce qu'elle ne fait PAS, délibérément : voler des points, retirer une vie,
// allonger la manche. Elle coûte deux secondes de vue, rien d'autre — le champ
// de réponse reste actif, on peut valider à l'aveugle si on avait déjà l'idée.
//
// Et elle est PUBLIQUE : tout le monde voit qui a visé qui. La moitié du
// plaisir est là, et ça évite le tir anonyme qu'on subit sans savoir d'où il
// vient. On ne peut pas viser quelqu'un qui a déjà trouvé ou qui n'a plus de
// vies : sa manche est finie, l'aveugler ne serait que méchant.
router.post("/:code/splat", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "round") return { error: "Ce n'est pas le moment.", status: 409 };
      const me = findPlayer(room, req.userId);
      if (!me || me.leftAt) return { error: "Tu ne joues pas ici.", status: 403 };
      if ((me.ammo ?? 0) <= 0) return { error: "Plus de tomates.", status: 409 };

      const key = `${room.code}:${req.userId}`;
      const now = Date.now();
      pruneSplats(now);
      if (now - (lastSplat.get(key) || 0) < SPLAT_COOLDOWN_MS)
        return { error: "Laisse-lui le temps de s'essuyer.", status: 429 };

      const targetId = String(req.body?.target || "");
      if (targetId === String(req.userId))
        return { error: "Vise quelqu'un d'autre.", status: 400 };
      const target = findPlayer(room, targetId);
      if (!target || target.leftAt) return { error: "Cible introuvable.", status: 404 };

      const round = curRound(room);
      if (!round) return { error: "Manche introuvable.", status: 409 };
      if (isSettled(round, targetId))
        return { error: "Sa manche est déjà finie.", status: 409 };

      me.ammo = (me.ammo ?? AMMO) - 1;
      lastSplat.set(key, now);
      touch(room);
      await room.save();
      await room.populate(POPULATE);

      // « ink » ou « tomato » : purement cosmétique, mais deux salissures
      // valent mieux qu'une quand elles s'enchaînent.
      const kind = req.body?.kind === "ink" ? "ink" : "tomato";
      toRoom(room, "splat", {
        by: String(req.userId),
        target: targetId,
        splat: kind,
        ms: SPLAT_MS,
        // Le stock de chacun, pour que les boutons se grisent chez tout le monde.
        ammoById: Object.fromEntries(
          activePlayers(room).map((p) => [
            String(p.user?._id || p.user),
            p.ammo ?? AMMO,
          ])
        ),
      });
      return { ammo: me.ammo };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("pxversus splat error:", err.message);
    res.status(500).json({ error: "Tomate perdue en route." });
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
        p.ammo = AMMO;
        p.ready = String(p.user?._id || p.user) === String(req.userId);
      }
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      // Nouvelle partie, fil neuf : les vannes de la précédente n'ont plus de
      // contexte une fois le tableau des scores effacé.
      gameChatReset("pxversus", room.code);
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
mountGameChat(router, { event: "pxversus", load: loadRoom });

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
      kind: "pixel",
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
    console.error("pxversus invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /:code/card — l'état du salon pour la carte d'invitation de la messagerie.
// Même forme que celles de GeoGamer et du blind test : la carte du chat est un
// composant unique, les trois jeux doivent lui répondre pareil.
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
    console.error("pxversus card error:", err.message);
    res.json({ state: "gone" });
  }
});

export default router;
