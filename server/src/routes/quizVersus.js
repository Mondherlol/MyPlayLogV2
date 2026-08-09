import express from "express";
import QuizVersus, { MAX_PLAYERS, LIVES, JOKERS } from "../models/QuizVersus.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import { person, shuffle } from "./blindtest.js";
import {
  buildQuizRounds,
  publicRound,
  ANAGRAM_TRIES,
  MOTUS_TRIES,
  ROUND_TYPES,
  TYPE_META,
} from "../lib/quizRounds.js";
import { checkRound } from "../lib/quizCheck.js";
import {
  scoreVersusBuzzer,
  scoreVersusParallel,
  PARALLEL_BEST_BONUS,
  streakMult,
} from "../lib/quizScore.js";
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

// ======================================================================
//  Le Grand Quiz VERSUS
// ======================================================================
// Le quatrième salon du site. Il emprunte tout son squelette à Pixel Rush
// versus (routes/pixelVersus.js) — phases pilotées par une horloge serveur,
// file d'attente par salon, invitations en carte de messagerie — et s'en écarte
// sur un point qui change beaucoup de choses :
//
//   UNE MANCHE SUR DEUX NE SE JOUE PAS AU BUZZER.
//
// Les trois autres salons enchaînent la même épreuve, donc le même contrat :
// le premier qui trouve rafle et la manche s'arrête. Ici, trois épreuves sur
// huit (le studio, le duel, le tri) demandent à tout le monde de travailler
// pendant toute la manche. Y appliquer le buzzer reviendrait à récompenser
// celui qui rend une copie à moitié remplie le plus vite.
//
// D'où deux régimes, portés par `TYPE_META[type].mode` :
//
//   • BUZZER (qcm, emoji, pixel, anagramme, motus) — première bonne réponse,
//     seul le buzzeur marque. Barème aligné sur les trois autres salons pour
//     que les cagnottes se vaillent.
//   • PARALLÈLE (studio, duel, swipe) — chacun rend sa copie avant la sonnerie,
//     tout le monde marque au prorata, et le meilleur de la manche empoche une
//     prime. Sans cette prime, une manche parallèle rapporterait moins qu'un
//     buzzer gagné et personne ne voudrait en voir tomber.
//
// -------------------------------------------------------------------- la série
// Un multiplicateur monte avec les bonnes réponses d'affilée (cf. streakMult).
// C'est ce qui donne au plateau sa tension de fin de partie : un joueur en
// retard de deux manches peut encore revenir, mais il faut enchaîner.
const router = express.Router();

router.use(requireAuth);

const CUE_MS = 4200;
const REVEAL_MS = 7500;
const DEFAULT_ROUNDS = 8;
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 14;
const WINNER_BONUS = 0.2;

// Ce qu'il reste à jouer une fois qu'un joueur a rendu une copie PARFAITE sur
// une manche parallèle. Assez pour finir une réponse en cours, pas assez pour
// reprendre sa recherche de zéro.
const LAST_STRETCH_MS = 12000;

// ============================================================
//  Combien d'essais, et quand une manche est finie pour quelqu'un
// ============================================================
// Trois régimes, et ils ne se déduisent pas du mode buzzer/parallèle — d'où ce
// tableau explicite plutôt qu'un `if` disséminé dans le fichier :
//
//   • UN SEUL ESSAI (qcm, duel, swipe) — sur un QCM à quatre propositions, un
//     deuxième essai revient à offrir la réponse et le troisième la donne. Sur
//     le duel et le tri, le joueur rend UNE copie : il a passé la manche à la
//     composer, il n'y a rien à retenter.
//   • TROIS ESSAIS QUI S'ARRÊTENT AU BON (emoji, pixel, anagramme) — la saisie libre
//     classique des trois autres salons.
//   • SIX ESSAIS CUMULATIFS (studio) — le cas particulier du lot. Le joueur
//     propose ses jeux UN PAR UN et doit savoir tout de suite si celui-ci
//     compte : sans ce retour, on tape trois noms à l'aveugle et l'épreuve
//     n'est plus qu'un pari. Chaque envoi porte donc la LISTE COMPLÈTE
//     accumulée (cf. lib/quizCheck.js, checkStudio), et c'est le meilleur
//     `ratio` atteint qui fait le score. Six essais laissent de la marge pour
//     trois erreurs.
const STUDIO_TRIES = 6;

function attemptsAllowed(type) {
  if (type === "studio") return STUDIO_TRIES;
  // Le Motus vit de ses essais successifs : cinq, et chacun renvoie son
  // pavage de couleurs. C'est la seule épreuve où un essai raté APPREND
  // quelque chose, donc la seule où on en autorise autant.
  if (type === "motus") return MOTUS_TRIES;
  // L'anagramme n'élimine pas : on propose autant de titres qu'on veut dans le
  // temps imparti (le barème, lui, rogne à chaque raté).
  if (type === "anagram") return ANAGRAM_TRIES;
  if (type === "qcm" || type === "duel" || type === "swipe") return 1;
  return LIVES;
}

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];

const withRoom = makeRoomQueue((code) =>
  QuizVersus.findOne({ code }).populate(POPULATE)
);
const clock = makeClock("quizversus");

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return QuizVersus.findOne({ code: String(code) }).populate(POPULATE);
}

const touch = (room) => {
  room.lastActiveAt = new Date();
};
const curRound = (room) => room.rounds[room.index] || null;
const modeOf = (round) => TYPE_META[round?.type]?.mode || "buzzer";

function toRoom(room, kind, payload = {}) {
  emitTo(playerIds(room), "quizversus", { code: room.code, kind, ...payload });
}
function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "quizversus", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

// ============================================================
//  L'état d'un joueur sur la manche en cours
// ============================================================
const attemptsOf = (round, userId) =>
  (round?.attempts || []).filter((a) => String(a.user) === String(userId));

// Essais restants. Sur le studio, tous les envois comptent (même un accepté :
// c'est une proposition de plus) ; ailleurs, seuls les ratés brûlent une vie.
function livesOf(round, userId) {
  if (!round) return LIVES;
  const max = attemptsAllowed(round.type);
  const mine = attemptsOf(round, userId);
  const used = round.type === "studio" ? mine.length : mine.filter((a) => !a.correct).length;
  return Math.max(0, max - used);
}

// « Réglé » = ce joueur n'a plus rien à faire sur cette manche.
function isSettled(round, userId) {
  if (!round) return false;
  const mine = attemptsOf(round, userId);
  if (!mine.length) return false;
  // Le studio s'arrête au triplé ou à court d'essais — pas au premier envoi,
  // sinon le joueur serait sorti dès son premier nom proposé.
  if (round.type === "studio")
    return mine.some((a) => a.correct) || mine.length >= attemptsAllowed(round.type);
  return (
    mine.some((a) => a.correct) ||
    mine.filter((a) => !a.correct).length >= attemptsAllowed(round.type)
  );
}

// ============================================================
//  Sérialisation — ce que le client a le droit de savoir
// ============================================================
// La règle est celle de Pixel Rush, étendue à huit formes d'énigme : avant la
// révélation, l'énigme part, la solution reste (cf. publicRound). On y ajoute
// l'état visible des autres — c'est lui qui fait vivre le rail de pupitres :
// qui a déjà répondu, qui a combien de vies, qui vient de se planter.
function roundView(room, meId) {
  const round = curRound(room);
  if (!round || room.phase === "lobby") return null;
  const revealed = room.phase === "reveal" || room.phase === "done";
  const elapsedMs = Math.max(0, Date.now() - (room.phaseEndsAt - round.durationSec * 1000));

  const ids = activePlayers(room).map((p) => String(p.user?._id || p.user));
  const found = round.attempts
    .filter((a) => a.correct)
    .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));

  const view = {
    // `round.payload`, PAS `round` : la manche est stockée dans une enveloppe
    // { type, mode, durationSec, payload } et tout le contenu — l'énoncé, les
    // propositions, les emojis, les cartes du duel — vit dans `payload`.
    //
    // Sérialiser l'enveloppe renvoyait un objet où seuls `type` et
    // `durationSec` étaient renseignés : le bandeau, le chrono et le joker
    // s'affichaient normalement, mais la question était vide et la liste des
    // propositions aussi. La partie paraissait figée alors qu'elle tournait.
    // (Le reste du fichier lisait déjà `round.payload` — la correction et le
    // joker, eux, fonctionnaient.)
    ...publicRound(round.payload || {}, {
      reveal: revealed,
      elapsedMs,
      index: room.index,
      total: room.rounds.length,
    }),
    lives: livesOf(round, meId),
    settled: isSettled(round, meId),
    found,
    livesById: Object.fromEntries(ids.map((id) => [id, livesOf(round, id)])),
    settledById: Object.fromEntries(ids.map((id) => [id, isSettled(round, id)])),
  };

  // Le fil des tentatives. En BUZZER on diffuse le titre proposé : voir les
  // fausses pistes des autres fait partie du mode, et la manche s'arrêtant au
  // premier bon coup, il n'y a plus rien à protéger. En PARALLÈLE, on n'annonce
  // que « untel a rendu sa copie » — le contenu révélerait la solution à ceux
  // qui cherchent encore.
  view.attempts =
    modeOf(round) === "buzzer"
      ? round.attempts.map((a) => ({
          userId: String(a.user),
          label: typeof a.value?.name === "string" ? a.value.name : a.value?.text || "",
          correct: a.correct,
          atMs: a.atMs,
        }))
      : round.attempts.map((a) => ({
          userId: String(a.user),
          label: "",
          correct: false,
          atMs: a.atMs,
        }));

  if (revealed) {
    view.winner = round.winner ? String(round.winner) : null;
    view.results = round.results.map((r) => ({
      userId: String(r.user),
      correct: r.correct,
      ratio: r.ratio,
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
    // Le nombre de places : le salon en dessinait trois en dur, alors qu'on
    // joue jusqu'à six. C'est au serveur de le dire — lui seul connaît
    // MAX_PLAYERS, et c'est lui qui refuse le septième arrivant.
    maxPlayers: MAX_PLAYERS,
    roundCount: room.roundCount,
    types: room.types?.length ? room.types : ROUND_TYPES,
    phase: room.phase,
    index: room.index,
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    now: Date.now(),
    // L'épreuve à venir : le « 3, 2, 1 » l'annonce, pour qu'on sache à quoi on
    // va jouer avant que le chrono parte. C'est LA différence d'ergonomie avec
    // les trois autres salons, où toutes les manches se ressemblent.
    nextType: room.rounds[room.index]?.type || null,
    players: room.players.map((p) => {
      const id = String(p.user?._id || p.user);
      return {
        ...person(p.user),
        id,
        ready: !!p.ready,
        score: p.score || 0,
        correctCount: p.correctCount || 0,
        streak: p.streak || 0,
        bestStreak: p.bestStreak || 0,
        jokers: p.jokers ?? JOKERS,
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
  const dur = (room.rounds[index]?.durationSec || 20) * 1000;
  room.phaseStartsAt = Date.now() + CUE_MS;
  room.phaseEndsAt = room.phaseStartsAt + dur;
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

// --------------------------------------------------------- le dépouillement
async function endRound(room) {
  if (room.phase !== "round" && room.phase !== "cue") return room;
  const round = curRound(room);
  if (!round) return finishGame(room);

  const players = activePlayers(room);
  const dur = round.durationSec || 20;
  const buzzer = modeOf(round) === "buzzer";
  const winners = round.attempts.filter((a) => a.correct);

  round.results = players.map((p) => {
    const uid = String(p.user?._id || p.user);
    const mine = attemptsOf(round, uid);
    const hit = mine.find((a) => a.correct) || null;
    const misses = mine.filter((a) => !a.correct).length;
    const last = mine[mine.length - 1] || null;
    const ratio = Math.max(0, ...mine.map((a) => a.ratio || 0), 0);

    if (buzzer) {
      const order = hit ? winners.findIndex((a) => String(a.user) === uid) + 1 : null;
      const won = order === 1;
      return {
        user: p.user?._id || p.user,
        correct: !!hit,
        ratio: hit ? 1 : 0,
        timeMs: hit ? hit.atMs : null,
        misses,
        order,
        points: won ? scoreVersusBuzzer(hit.atMs, dur, misses) : 0,
      };
    }
    return {
      user: p.user?._id || p.user,
      // `some` et pas « le dernier essai » : sur le studio, le triplé peut
      // avoir été décroché avant un envoi supplémentaire.
      correct: mine.some((a) => a.correct),
      ratio,
      timeMs: last ? last.atMs : null,
      misses: 0,
      order: null,
      points: scoreVersusParallel(ratio),
    };
  });

  // La prime du meilleur, sur une manche parallèle — DÉPARTAGÉE AU TEMPS.
  //
  // Elle n'allait qu'au meilleur ratio, et seulement s'il était unique. Or sur
  // l'épreuve du studio, l'égalité à 100 % est le CAS NORMAL : tout le monde
  // finit par citer trois jeux, donc personne ne touchait jamais la prime, et
  // trouver ses trois titres en dix secondes rapportait exactement autant que
  // les trouver en cinquante. Il n'y avait aucune raison de se dépêcher.
  //
  // À ratio égal, c'est donc le PREMIER ARRIVÉ qui l'empoche. C'est la seule
  // chose qui distingue encore deux copies parfaites.
  if (!buzzer && round.results.length) {
    const best = Math.max(...round.results.map((r) => r.ratio || 0));
    const tops = round.results
      .filter((r) => (r.ratio || 0) === best && best > 0)
      .sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));
    if (tops.length) tops[0].points += PARALLEL_BEST_BONUS;
  }
  if (buzzer && winners.length) round.winner = winners[0].user;
  else if (!buzzer && round.results.length) {
    const top = [...round.results].sort((a, b) => (b.points || 0) - (a.points || 0))[0];
    if (top && top.points > 0) round.winner = top.user;
  }

  // Report au tableau, série comprise. Le multiplicateur s'applique APRÈS le
  // barème de la manche, et la série se casse dès qu'on rate.
  for (const r of round.results) {
    const p = findPlayer(room, r.user);
    if (!p) continue;
    if (r.correct) {
      p.streak = (p.streak || 0) + 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      p.correctCount = (p.correctCount || 0) + 1;
    } else {
      p.streak = 0;
    }
    const mult = r.correct ? streakMult(p.streak) : 1;
    r.points = Math.round((r.points || 0) * mult);
    p.score = (p.score || 0) + r.points;
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
      (a, b) =>
        (b.score || 0) - (a.score || 0) || (b.correctCount || 0) - (a.correctCount || 0)
    )
    .map((p, i) => ({
      user: person(p.user),
      id: String(p.user?._id || p.user),
      rank: i + 1,
      score: p.score || 0,
      correct: p.correctCount || 0,
      bestStreak: p.bestStreak || 0,
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
    grantPoints(r.id, r.score + bonus, "quizversus", {
      versusId: String(room._id),
      rank: r.rank,
      bonus,
    }).catch(() => {});
    recordActivity({
      actor: r.id,
      type: "quizversus",
      meta: {
        versusId: String(room._id),
        code: room.code,
        rank: r.rank,
        score: r.score,
        correct: r.correct,
        bestStreak: r.bestStreak,
        total: room.rounds.length,
        players: mates,
      },
    });
    triggerMissionCheck(r.id);
  }
  return room;
}

// Une manche se clôt dès que plus personne n'a de raison de chercher. En
// buzzer, ça arrive dès le premier bon coup ; en parallèle, seulement quand
// tout le monde a rendu sa copie.
function shouldEndEarly(room, round) {
  const ids = playerIds(room);
  if (!ids.length) return true;
  if (modeOf(round) === "buzzer" && round.attempts.some((a) => a.correct)) return true;
  return ids.every((id) => isSettled(round, id));
}

// ============================================================
//  Ouvrir / rejoindre / régler / quitter
// ============================================================
router.post("/", async (req, res) => {
  try {
    const roundCount = Math.min(
      Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, MIN_ROUNDS),
      MAX_ROUNDS
    );
    let room = null;
    for (let i = 0; i < 3 && !room; i += 1) {
      const code = makeCode();
      // eslint-disable-next-line no-await-in-loop
      if (await QuizVersus.exists({ code })) continue;
      // eslint-disable-next-line no-await-in-loop
      room = await QuizVersus.create({
        code,
        host: req.userId,
        roundCount,
        types: ROUND_TYPES,
        players: [{ user: req.userId, joinedAt: new Date(), ready: true }],
      });
    }
    if (!room) return res.status(500).json({ error: "Salon non créé, réessaie." });
    await room.populate(POPULATE);
    res.status(201).json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("quizversus create error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir le salon." });
  }
});

router.get("/:code", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    const mine = allIds(room).includes(String(req.userId));
    const payload = { room: serializeRoom(room, req.userId), member: mine };
    // La liste de recherche est renvoyée au rechargement d'une partie en cours :
    // sans elle, un joueur qui rafraîchit sa page ne peut plus rien taper.
    if (mine && room.startedAt && room.phase !== "done") {
      const built = await buildQuizRounds({ userIds: playerIds(room), count: 0 }).catch(
        () => ({ candidates: [] })
      );
      payload.candidates = built.candidates;
    }
    res.json(payload);
  } catch (err) {
    console.error("quizversus get error:", err.message);
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
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), member: true });
  } catch (err) {
    console.error("quizversus join error:", err.message);
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
      const round = curRound(room);
      if (room.phase === "round" && round && shouldEndEarly(room, round))
        return endRound(room);
      return room;
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("quizversus leave error:", err.message);
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

// POST /:code/settings — l'hôte règle le nombre de manches ET les épreuves.
// Décocher des épreuves est un vrai réglage de table : à quatre, on veut
// parfois enchaîner du buzzer pur sans les manches parallèles qui durent une
// minute.
router.post("/:code/settings", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "L'hôte règle la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (req.body?.rounds != null)
        room.roundCount = Math.min(
          Math.max(Number(req.body.rounds) || DEFAULT_ROUNDS, MIN_ROUNDS),
          MAX_ROUNDS
        );
      if (Array.isArray(req.body?.types)) {
        const list = [
          ...new Set(req.body.types.map(String).filter((t) => ROUND_TYPES.includes(t))),
        ];
        // On refuse de tout décocher : un salon sans épreuve ne se lance pas,
        // autant ne jamais l'y laisser arriver.
        if (list.length) room.types = list;
      }
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

// POST /:code/start — l'hôte lance. Les manches sont tirées ICI, pour LA TABLE :
// le vivier réunit les bibliothèques de tous les participants.
router.post("/:code/start", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "Seul l'hôte lance la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (activePlayers(room).length < 2)
        return { error: "Il faut être au moins deux pour un versus.", status: 422 };

      const { rounds, candidates } = await buildQuizRounds({
        userIds: playerIds(room),
        count: room.roundCount,
        types: room.types?.length ? room.types : ROUND_TYPES,
      });
      if (rounds.length < 3)
        return {
          error: "Pas assez de matière pour lancer un versus. Recoche des épreuves.",
          status: 422,
        };

      room.rounds = rounds.map((r) => ({
        type: r.type,
        mode: TYPE_META[r.type]?.mode || "buzzer",
        durationSec: r.durationSec,
        // La manche ENTIÈRE, liste d'acceptation du studio comprise —
        // contrairement au solo, qui l'allège avant d'archiver (packRound).
        // Ici elle sert à corriger à chaque réponse, et le salon s'efface tout
        // seul au bout de deux heures : rien à économiser.
        payload: r,
      }));
      room.roundCount = rounds.length;
      room.startedAt = new Date();
      for (const p of room.players) {
        p.score = 0;
        p.correctCount = 0;
        p.streak = 0;
        p.bestStreak = 0;
        p.jokers = JOKERS;
      }
      await room.save();
      await room.populate(POPULATE);
      return { room: await startCue(room, 0), candidates };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), candidates: out.candidates });
  } catch (err) {
    console.error("quizversus start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// ============================================================
//  POST /:code/answer — LE SERVEUR TRANCHE
// ============================================================
// Une seule porte pour les huit épreuves : le corps porte `given`, dans la
// forme attendue par le type de la manche (cf. lib/quizCheck.js). C'est le
// pendant exact du /guess de Pixel Rush, généralisé.
//
// La manche stocke la manche COMPLÈTE dans `payload` (solution comprise) : la
// correction se fait donc ici, sans jamais avoir eu besoin de faire confiance
// au navigateur — pas même sur le décompte d'un swipe de vingt-quatre cartes.
router.post("/:code/answer", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "round") return { error: "Ce n'est pas le moment.", status: 409 };
      const me = findPlayer(room, req.userId);
      if (!me || me.leftAt) return { error: "Tu ne joues pas ici.", status: 403 };
      const round = curRound(room);
      if (!round) return { error: "Manche introuvable.", status: 409 };
      if (isSettled(round, req.userId))
        return { error: "Tu as déjà joué cette manche.", status: 409 };

      const given = req.body?.given && typeof req.body.given === "object" ? req.body.given : {};
      const verdict = checkRound(round.payload, given);
      const atMs = Math.max(0, Date.now() - (room.phaseEndsAt - round.durationSec * 1000));

      round.attempts.push({
        user: req.userId,
        value: given,
        correct: verdict.correct,
        ratio: verdict.ratio,
        atMs,
      });

      // ------------------------------------------- la dernière ligne droite
      // Sur une manche parallèle, le PREMIER qui rend une copie parfaite
      // raccourcit le temps qu'il reste à tout le monde.
      //
      // Sans ça, avoir cité ses trois jeux en dix secondes n'avait aucun effet :
      // on restait spectateur pendant que les autres cherchaient tranquillement
      // jusqu'à la sonnerie, et finir premier ne servait à rien. Maintenant
      // c'est une pression qu'on met à la table.
      //
      // On ne coupe PAS net : douze secondes laissent finir une réponse presque
      // aboutie. Terminer premier doit avantager, pas éliminer.
      let stretched = false;
      if (
        modeOf(round) === "parallel" &&
        verdict.correct &&
        round.attempts.filter((a) => a.correct).length === 1
      ) {
        const target = Date.now() + LAST_STRETCH_MS;
        if (target < room.phaseEndsAt) {
          room.phaseEndsAt = target;
          stretched = true;
        }
      }

      touch(room);
      await room.save();
      await room.populate(POPULATE);
      // Le minuteur du salon doit suivre la nouvelle heure de fin, sinon la
      // manche se refermerait à l'heure initialement prévue.
      if (stretched) clock.at(room.code, room.phaseEndsAt, () => withRoom(room.code, endRound));

      const ids = activePlayers(room).map((p) => String(p.user?._id || p.user));
      const found = round.attempts
        .filter((a) => a.correct)
        .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));

      toRoom(room, "answer", {
        by: String(req.userId),
        correct: verdict.correct,
        // En parallèle, on ne dit RIEN du contenu ni même de la justesse : ceux
        // qui cherchent encore en déduiraient la solution.
        label:
          modeOf(round) === "buzzer"
            ? String(given.name || given.text || "").slice(0, 80)
            : "",
        buzzer: modeOf(round) === "buzzer",
        found,
        livesById: Object.fromEntries(ids.map((id) => [id, livesOf(round, id)])),
        settledById: Object.fromEntries(ids.map((id) => [id, isSettled(round, id)])),
      });

      // Chacun reçoit le salon complet quand l'heure de fin a bougé : sans ça
      // les chronos des autres continueraient d'égrener l'ancienne.
      if (stretched) toEachRoom(room, "stretch", { by: String(req.userId) });

      if (shouldEndEarly(room, round)) await endRound(room);
      return {
        correct: verdict.correct,
        ratio: verdict.ratio,
        lives: livesOf(round, req.userId),
        settled: isSettled(round, req.userId),
        // Le détail de la correction ne remonte QUE pour le studio, et ce
        // n'est pas de la timidité : `detail` contient, selon l'épreuve, le
        // verdict attendu de chaque carte d'un swipe ou les cartes mal placées
        // d'un duel — de quoi rejouer la manche à coup sûr. Le studio est le
        // seul cas où il ne dit rien de plus que « voici lesquelles de TES
        // propositions comptent », ce dont le joueur a justement besoin pour
        // continuer à chercher.
        ...(round.type === "studio" ? { detail: { hit: verdict.detail.hit || [] } } : {}),
        // Le Motus doit renvoyer son pavage, sinon la grille reste grise et
        // l'épreuve n'existe pas. Ce que ça révèle, le joueur vient de le
        // GAGNER en dépensant un essai — c'est la règle du jeu, pas une fuite.
        ...(round.type === "motus"
          ? { detail: { guess: verdict.detail.guess, marks: verdict.detail.marks || [] } }
          : {}),
      };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("quizversus answer error:", err.message);
    res.status(500).json({ error: "Réponse non enregistrée." });
  }
});

// ============================================================
//  POST /:code/joker — le 50/50
// ============================================================
// Deux par partie, utilisables sur un QCM : deux mauvaises propositions
// s'éteignent. C'est le pendant des tomates de Pixel Rush, avec un parti pris
// inverse — il aide celui qui le lance au lieu de gêner les autres.
//
// Pourquoi ce choix : un quiz de culture se joue CONTRE LA QUESTION. Éclabousser
// l'écran de quelqu'un pendant qu'il lit un énoncé de trois lignes ne serait pas
// drôle, juste illisible ; sur une capture pixelisée, la tomate est une gêne,
// ici ce serait une annulation de manche.
//
// Le serveur choisit les deux propositions à éteindre : il est le seul à
// connaître la bonne, et il ne la donne évidemment pas.
router.post("/:code/joker", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "round") return { error: "Ce n'est pas le moment.", status: 409 };
      const me = findPlayer(room, req.userId);
      if (!me || me.leftAt) return { error: "Tu ne joues pas ici.", status: 403 };
      if ((me.jokers ?? 0) <= 0) return { error: "Plus de joker.", status: 409 };
      const round = curRound(room);
      if (round?.type !== "qcm")
        return { error: "Le joker ne marche que sur une question.", status: 409 };
      if (isSettled(round, req.userId))
        return { error: "Tu as déjà répondu.", status: 409 };

      const answerIndex = Number(round.payload?.answerIndex);
      const total = (round.payload?.choices || []).length;
      const wrong = shuffle(
        Array.from({ length: total }, (_, i) => i).filter((i) => i !== answerIndex)
      ).slice(0, Math.max(0, total - 2));

      me.jokers = (me.jokers ?? JOKERS) - 1;
      touch(room);
      await room.save();
      await room.populate(POPULATE);

      // Public : tout le monde voit qui a brûlé un joker (le stock des autres
      // se met à jour), mais PERSONNE d'autre ne reçoit les indices éteints.
      toRoom(room, "joker", {
        by: String(req.userId),
        jokersById: Object.fromEntries(
          activePlayers(room).map((p) => [
            String(p.user?._id || p.user),
            p.jokers ?? JOKERS,
          ])
        ),
      });
      return { removed: wrong, jokers: me.jokers };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("quizversus joker error:", err.message);
    res.status(500).json({ error: "Joker perdu en route." });
  }
});

// POST /:code/progress — « j'en suis à 12 cartes ». Diffusé aux autres, rien
// n'est écrit en base : c'est un geste, pas une donnée. C'est ce qui fait vivre
// les pupitres pendant une manche parallèle, où sans ça l'écran des autres
// resterait figé pendant trente secondes.
router.post("/:code/progress", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room || room.phase !== "round") return res.json({ ok: true });
    if (!playerIds(room).includes(String(req.userId))) return res.json({ ok: true });
    emitTo(
      playerIds(room).filter((id) => id !== String(req.userId)),
      "quizversus",
      {
        code: room.code,
        kind: "progress",
        by: String(req.userId),
        done: Math.max(0, Math.min(999, Number(req.body?.done) || 0)),
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
        p.streak = 0;
        p.bestStreak = 0;
        p.jokers = JOKERS;
        p.ready = String(p.user?._id || p.user) === String(req.userId);
      }
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
      kind: "quiz",
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
    console.error("quizversus invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /:code/card — l'état du salon pour la carte d'invitation de la
// messagerie. MÊME FORME que celles des trois autres jeux : la carte du chat
// est un composant unique, tous les salons doivent lui répondre pareil.
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
    console.error("quizversus card error:", err.message);
    res.json({ state: "gone" });
  }
});

export default router;
