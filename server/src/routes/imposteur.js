import express from "express";
import mongoose from "mongoose";
import Imposteur, {
  MAX_PLAYERS,
  MIN_PLAYERS,
  CARD_SEC,
  TURN_SEC,
  VOTE_SEC,
  STEAL_SEC,
  RESULT_SEC,
} from "../models/Imposteur.js";
import PointEntry from "../models/PointEntry.js";
import User from "../models/User.js";
import PAIRS, { ALL_TITLES } from "../data/imposteurPairs.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { person } from "./blindtest.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import {
  makeCode,
  makeRoomQueue,
  makeClock,
  idOf,
  isHost,
  activePlayers,
  playerIds,
  allIds,
  findPlayer,
} from "../lib/versusRoom.js";

// ======================================================================
//  L'Imposteur — salons
// ======================================================================
// Tout le monde reçoit le même jeu, sauf un. Chacun donne un mot à son tour,
// puis on vote.
//
// --------------------------------------------------- le serveur ne juge rien
// C'est le seul mini-jeu du site où le serveur n'a pas d'avis. Il ne note aucun
// mot, ne mesure aucune proximité — il distribue une asymétrie et compte des
// voix. La tentation d'ajouter « le serveur détecte les indices trop proches du
// titre » a été limitée au strict minimum (voir `tooRevealing`) : refuser
// « Nook » sur Animal Crossing empêche de gâcher la manche en un mot, mais tout
// jugement au-delà retirerait aux joueurs la seule chose qu'ils ont à faire.
//
// ------------------------------------------ pourquoi le chrono et pas l'hôte
// Comme les autres salons : les phases s'enchaînent côté serveur
// (lib/versusRoom.js). Ici c'est encore plus vrai qu'ailleurs — le tour de
// parole DOIT tomber tout seul, sinon un joueur parti chercher un café gèle la
// partie de sept personnes.

const router = express.Router();
router.use(requireAuth);

const clock = makeClock("imposteur");
const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];
const withRoom = makeRoomQueue((code) =>
  Imposteur.findOne({ code: String(code) }).populate(POPULATE)
);

const touch = (room) => {
  room.lastActiveAt = new Date();
};
const at = (sec) => new Date(Date.now() + sec * 1000);

// ============================================================
//  La frappe en direct
// ============================================================
// LE CŒUR DU MODE, et il ne touche NI la base NI le document du salon. Voir
// chacun taper, hésiter, effacer trois fois avant de lâcher son mot, c'est ce
// qui rend la manche drôle — mais c'est aussi une frappe toutes les cent
// millisecondes, par joueur. Écrire ça dans Mongo (ou même le faire passer par
// la file du salon) reviendrait à une écriture disque pour une information qui
// n'a plus aucune valeur une seconde plus tard.
//
// D'où ce registre en mémoire : le strict nécessaire pour vérifier que celui
// qui tape est bien celui dont c'est le tour, sans lire le salon. Un
// redémarrage le vide, et c'est sans conséquence — la frappe s'arrête, la
// partie continue.
const liveTurn = new Map(); // code → { phase, userId, ids }

const setTurnCache = (room) => {
  const r = room.rounds[room.index];
  liveTurn.set(room.code, {
    phase: room.phase,
    userId: room.phase === "clue" && r ? String(currentSpeaker(room, r) || "") : "",
    // Les destinataires viennent d'ICI et jamais du corps de la requête :
    // laisser le client dire à qui diffuser, c'est laisser n'importe qui
    // arroser n'importe quel compte d'évènements en direct.
    ids: playerIds(room),
  });
};
const clearTurnCache = (code) => liveTurn.delete(code);

// ============================================================
//  Le tour de parole
// ============================================================
// `cursor` est une position dans l'ordre APLATI : tour 0 joueur 0, tour 0
// joueur 1, … puis tour 1 joueur 0. Le locuteur s'en déduit, ce qui évite de
// tenir deux compteurs qui finiraient par diverger.
//
// Les joueurs partis sont sautés à la volée plutôt que retirés de `order` :
// retirer une case décalerait tout le monde et changerait le tour de parole au
// milieu d'une manche.
const speakerAt = (round, cursor) =>
  round.order.length ? round.order[cursor % round.order.length] : null;
const turnAt = (round, cursor) =>
  round.order.length ? Math.floor(cursor / round.order.length) : 0;
const currentSpeaker = (room, round) => speakerAt(round, round.cursor);
const totalCursors = (room, round) => round.order.length * (room.turnCount || 2);

// ============================================================
//  Sérialisation
// ============================================================
// LA RÈGLE DU MODE : chacun ne reçoit que SON titre, et rien de la manche qui
// permettrait de deviner qui est l'imposteur avant la révélation. C'est la
// raison d'être de `toEachRoom` — une diffusion unique à tout le salon rendrait
// le jeu impossible dès l'ouverture de l'onglet réseau.
function roundView(room, meId) {
  const r = room.rounds[room.index];
  if (!r || room.phase === "lobby") return null;
  const me = String(meId);
  const revealing = room.phase === "result";
  const imposteurId = idOf(r.imposteur);
  const iAmImposteur = imposteurId === me;

  const speaker = room.phase === "clue" ? currentSpeaker(room, r) : null;

  return {
    index: room.index,
    total: room.roundCount,

    // MON titre — jamais celui des autres. Un imposteur qui recevrait les deux
    // saurait immédiatement qu'il est l'imposteur, ce qui est très exactement
    // l'information que le mode lui cache. La jaquette et l'identifiant suivent
    // la même règle : ceux de MON jeu, point.
    myGame: iAmImposteur ? r.gameB : r.gameA,
    myGameCover: (iAmImposteur ? r.gameBCover : r.gameACover) || "",
    myGameId: (iAmImposteur ? r.gameBId : r.gameAId) || null,

    // L'ordre de parole est public : c'est ce qui permet de voir son tour
    // arriver, et l'attente EST le sel du mode.
    order: r.order.map((id) => String(id)),
    turn: turnAt(r, r.cursor) + 1,
    turns: room.turnCount || 2,
    speaker: speaker ? String(speaker) : null,
    myTurn: speaker ? String(speaker) === me : false,

    // Les indices déjà donnés : publics par nature, c'est la matière du débat.
    clues: r.clues.map((c) => ({
      userId: idOf(c.user),
      word: c.word,
      turn: c.turn,
      missed: !!c.missed,
    })),

    // Qui a demandé le vote (le décompte s'affiche sur le bouton), et si moi
    // j'ai déjà demandé.
    calls: r.voteCalls.map((id) => String(id)),
    called: r.voteCalls.some((id) => String(id) === me),

    // Pendant le vote : QUI a voté, jamais POUR QUI. Voir les votes tomber en
    // direct ferait basculer tout le monde sur le premier accusé.
    voted: r.votes.map((v) => idOf(v.voter)),
    myVote: (() => {
      const v = r.votes.find((x) => idOf(x.voter) === me);
      return v ? idOf(v.target) : null;
    })(),

    // La dernière chance : seul l'imposteur voit les propositions, les autres
    // savent juste qu'il est en train de tenter le coup.
    //
    // `accused` sort ICI et pas avant : la phase n'existe QUE si l'accusé était
    // bien l'imposteur, donc l'annoncer ne divulgue rien que l'écran ne dise
    // déjà en gros (« Démasqué ! »). C'est ce qui permet à la table de lire un
    // nom plutôt qu'un « quelqu'un » qui n'aurait aucune saveur.
    steal:
      room.phase === "steal"
        ? {
            mine: iAmImposteur,
            options: iAmImposteur ? r.stealOptions : [],
            accused: r.accused ? idOf(r.accused) : null,
          }
        : null,

    // ---------- la révélation ----------
    result: revealing
      ? {
          imposteur: imposteurId,
          gameA: r.gameA,
          gameB: r.gameB,
          gameACover: r.gameACover || "",
          gameBCover: r.gameBCover || "",
          gameAId: r.gameAId || null,
          gameBId: r.gameBId || null,
          accused: r.accused ? idOf(r.accused) : null,
          caught: !!r.caught,
          stolen: !!r.stolen,
          stealPick: r.stealPick || "",
          hadSteal: r.stealOptions.length > 0,
          votes: r.votes.map((v) => ({ voter: idOf(v.voter), target: idOf(v.target) })),
          gains: r.gains.map((g) => ({ userId: idOf(g.user), points: g.points })),
        }
      : null,
  };
}

function serializeRoom(room, meId) {
  const ids = allIds(room);
  const online = onlineAmong(ids);
  const hostId = idOf(room.host);
  return {
    code: room.code,
    hostId,
    isHost: hostId === String(meId),
    roundCount: room.roundCount,
    turnCount: room.turnCount,
    phase: room.phase,
    index: room.index,
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    // L'heure du serveur : le client corrige l'écart avec la sienne, sinon un
    // poste en avance afficherait la fin de son tour alors qu'il lui reste dix
    // secondes pour taper.
    now: Date.now(),
    timings: {
      card: CARD_SEC,
      clue: TURN_SEC,
      vote: VOTE_SEC,
      steal: STEAL_SEC,
      result: RESULT_SEC,
    },
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => {
      const id = idOf(p.user);
      return {
        ...person(p.user),
        id,
        score: p.score || 0,
        escapes: p.escapes || 0,
        ready: !!p.ready,
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

function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "imposteur", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

// ============================================================
//  Machine à phases
// ============================================================
async function beginCard(room) {
  room.phase = "card";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(CARD_SEC);
  touch(room);
  setTurnCache(room);
  await room.save();
  toEachRoom(room, "card");
  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, (r) => (r && r.phase === "card" ? beginClue(r) : null))
  );
}

async function beginClue(room) {
  room.phase = "clue";
  const round = room.rounds[room.index];
  if (!round) return finish(room);
  // Le premier locuteur peut déjà être parti : on avance jusqu'à quelqu'un de
  // présent avant d'ouvrir la fenêtre, sinon la manche s'ouvre sur 25 secondes
  // de silence pour un joueur qui a fermé son onglet.
  skipAbsent(room, round);
  if (round.cursor >= totalCursors(room, round)) return beginVote(room);
  return openTurn(room, "clue");
}

// Ouvre la fenêtre du locuteur courant.
async function openTurn(room, kind) {
  room.phase = "clue";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(TURN_SEC);
  touch(room);
  setTurnCache(room);
  await room.save();
  toEachRoom(room, kind);
  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, async (r) => {
      if (!r || r.phase !== "clue") return null;
      const rd = r.rounds[r.index];
      if (!rd) return null;
      // La fenêtre est passée sans un mot : on l'inscrit comme telle et on
      // passe. Un silence est une information, pas un trou.
      const who = currentSpeaker(r, rd);
      if (who)
        rd.clues.push({ user: who, word: "", turn: turnAt(rd, rd.cursor), missed: true });
      rd.cursor += 1;
      return advance(r);
    })
  );
}

// Saute les joueurs partis. Appelé avant chaque ouverture de fenêtre.
function skipAbsent(room, round) {
  const present = new Set(playerIds(room));
  const max = totalCursors(room, round);
  let guard = 0;
  while (
    round.cursor < max &&
    guard < max + 1 &&
    !present.has(String(speakerAt(round, round.cursor)))
  ) {
    round.cursor += 1;
    guard += 1;
  }
}

// Après un mot (ou une fenêtre ratée) : au suivant, ou au vote.
async function advance(room) {
  const round = room.rounds[room.index];
  if (!round) return finish(room);
  skipAbsent(room, round);
  if (round.cursor >= totalCursors(room, round)) return beginVote(room);
  return openTurn(room, "turn");
}

async function beginVote(room) {
  room.phase = "vote";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(VOTE_SEC);
  touch(room);
  setTurnCache(room);
  await room.save();
  toEachRoom(room, "vote");
  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, (r) => (r && r.phase === "vote" ? closeVote(r) : null))
  );
}

// Le dépouillement. Égalité = personne n'est démasqué : sans cette règle, le
// premier de la liste serait exécuté par ordre alphabétique.
function tally(round, present) {
  const counts = new Map();
  for (const v of round.votes) {
    const t = idOf(v.target);
    if (!t || !present.has(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  let tie = false;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
      tie = false;
    } else if (n === bestN) tie = true;
  }
  return tie || !best ? null : best;
}

async function closeVote(room) {
  const round = room.rounds[room.index];
  if (!round) return finish(room);
  const present = new Set(playerIds(room));
  round.accused = tally(round, present);
  round.caught = !!round.accused && String(round.accused) === idOf(round.imposteur);

  // Démasqué : il lui reste une chance de reconnaître le jeu des autres. C'est
  // ce qui empêche la manche perdue d'être une humiliation muette — et ça
  // relance la table, qui a soudain quelque chose à regarder.
  if (round.caught && present.has(idOf(round.imposteur))) {
    const leurres = ALL_TITLES.filter(
      (t) => t !== round.gameA && t !== round.gameB
    ).sort(() => Math.random() - 0.5);
    round.stealOptions = [round.gameA, ...leurres.slice(0, 3)].sort(
      () => Math.random() - 0.5
    );
    room.phase = "steal";
    room.phaseStartsAt = new Date();
    room.phaseEndsAt = at(STEAL_SEC);
    touch(room);
    setTurnCache(room);
    await room.save();
    toEachRoom(room, "steal");
    clock.at(room.code, room.phaseEndsAt.getTime(), () =>
      withRoom(room.code, (r) => (r && r.phase === "steal" ? beginResult(r) : null))
    );
    return null;
  }
  return beginResult(room);
}

// ---------- Le barème ----------
// Il tient en trois lignes, et c'est voulu : un mode social se joue pour la
// tête des autres, pas pour un tableau. Ce qui compte, c'est que chaque issue
// rapporte quelque chose à quelqu'un — une manche où personne ne marque n'a
// l'air d'un bug.
const PTS_ESCAPE = 100; // l'imposteur passe entre les gouttes
const PTS_CATCH = 60;   // avoir voté juste
const PTS_STEAL = 70;   // démasqué, mais il a reconnu le jeu des autres

async function beginResult(room) {
  const round = room.rounds[room.index];
  if (!round) return finish(room);
  const impId = idOf(round.imposteur);
  const gains = new Map();
  const add = (id, n) => gains.set(id, (gains.get(id) || 0) + n);

  if (!round.caught) {
    add(impId, PTS_ESCAPE);
    const p = findPlayer(room, impId);
    if (p) p.escapes = (p.escapes || 0) + 1;
  } else {
    for (const v of round.votes) {
      if (idOf(v.target) === impId && idOf(v.voter) !== impId)
        add(idOf(v.voter), PTS_CATCH);
    }
    // Le vol ne retire RIEN aux innocents : ils ont fait leur travail. Il
    // rattrape l'imposteur, il ne les punit pas — une règle qui déposséderait
    // la table d'un point gagné rendrait la fin de manche amère.
    if (round.stolen) add(impId, PTS_STEAL);
  }

  round.gains = [...gains].map(([user, points]) => ({ user, points }));
  for (const [id, n] of gains) {
    const p = findPlayer(room, id);
    if (p) p.score = (p.score || 0) + n;
  }

  room.phase = "result";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(RESULT_SEC);
  touch(room);
  setTurnCache(room);
  await room.save();
  toEachRoom(room, "result");

  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, async (r) => {
      if (!r || r.phase !== "result") return null;
      // `rounds.length` compte les manches DISTRIBUÉES : la partie s'arrête
      // quand on en a joué autant que promis au lobby.
      if (r.rounds.length >= r.roundCount) return finish(r);
      return (await dealRound(r)) ? beginCard(r) : finish(r);
    })
  );
  return null;
}

async function finish(room) {
  room.phase = "done";
  room.endedAt = new Date();
  room.phaseEndsAt = null;
  touch(room);
  await room.save();
  clock.stop(room.code);
  clearTurnCache(room.code);
  toEachRoom(room, "done");

  const table = [...activePlayers(room)].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (let i = 0; i < table.length; i += 1) {
    const p = table[i];
    const pts = p.score || 0;
    if (pts > 0)
      grantPoints(idOf(p.user), pts, "imposteur", {
        code: room.code,
        rank: i + 1,
        rounds: room.rounds.length,
      }).catch(() => {});

    // Une entrée PAR JOUEUR, mais le fil n'en montrera qu'une : routes/feed.js
    // dédoublonne par meta.versusId comme pour les cinq autres versus, et la
    // carte partagée lit exactement cette forme de `players`.
    recordActivity({
      actor: idOf(p.user),
      type: "impversus",
      meta: {
        versusId: room.code,
        rank: i + 1,
        rounds: room.rounds.length,
        total: room.rounds.length,
        players: table.map((q, j) => ({
          id: idOf(q.user),
          username: q.user?.username || "",
          avatar: q.user?.avatar || null,
          score: q.score || 0,
          escapes: q.escapes || 0,
          rank: j + 1,
        })),
      },
    });
  }
}

// ============================================================
//  Du titre à la jaquette
// ============================================================
// La banque de paires ne contient que des NOMS (data/imposteurPairs.js) : elle
// doit rester lisible et modifiable à la main, donc pas d'identifiants IGDB
// écrits en dur dedans, qu'aucun humain ne pourrait relire.
//
// On les résout donc ici, une fois par titre et par process. Le cache mémoire
// suffit : la banque fait moins de 200 titres, et une soirée de parties les
// touche à peine. Ce qu'on en tire vaut le détour — la jaquette (« ah oui, CE
// jeu-là ») et l'identifiant, qui ouvre la fiche complète sans quitter la
// partie.
//
// TOUT ÉCHEC EST SANS CONSÉQUENCE : IGDB muet, hors ligne, titre introuvable →
// on renvoie du vide et la manche se joue avec le nom seul, comme avant. Une
// partie ne doit jamais dépendre d'une API tierce.
const titleCache = new Map();
const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

async function resolveTitle(title) {
  const key = String(title);
  if (titleCache.has(key)) return titleCache.get(key);
  let out = { cover: "", igdbId: null };
  try {
    const safe = key.replace(/"/g, "");
    // Le filtre est celui de lib/quizSeed.js, et il n'est PAS cosmétique : sans
    // lui, « Journey » remontait d'abord « Star Wars: Journey to Batuu », une
    // extension des Sims — la table découvrait une jaquette qui n'avait rien à
    // voir avec le jeu qu'elle devait deviner. On exclut donc les DLC, les
    // éditions et les doublons de version, et on ne garde que des jeux à part
    // entière (principal, remaster, remake, portage…).
    const rows = await igdbQuery(
      "games",
      `search "${safe}"; fields id,name,cover.image_id,total_rating_count;` +
        " where version_parent = null & game_type = (0,4,8,9,10,11); limit 12;"
    );
    // Le nom EXACT d'abord (« Animal Crossing » et non « Animal Crossing
    // Plaza »). À défaut, le plus connu : sur un titre de série, c'est
    // l'épisode auquel les joueurs pensent, pas le spin-off obscur.
    const withCover = rows.filter((r) => r.cover?.image_id);
    const exact = withCover.filter((r) => fold(r.name) === fold(key));
    const pool = exact.length ? exact : withCover;
    const best = [...pool].sort(
      (a, b) => (b.total_rating_count || 0) - (a.total_rating_count || 0)
    )[0];
    if (best)
      out = {
        cover: `${IMG_BASE}/t_cover_big/${best.cover.image_id}.jpg`,
        igdbId: best.id,
      };
  } catch {
    /* voir la note ci-dessus : on joue sans jaquette */
  }
  titleCache.set(key, out);
  return out;
}

// ============================================================
//  Le tirage d'une manche
// ============================================================
// Deux tirages indépendants, et le second compte plus que le premier :
//
//   - LA PAIRE : jamais deux fois la même dans un salon (`usedPairs`), et le
//     titre de l'imposteur est tiré à pile ou face DANS la paire. Sans ce
//     pile ou face, un habitué apprendrait que le second titre du fichier est
//     toujours le titre piégé.
//   - L'IMPOSTEUR : en priorité quelqu'un qui ne l'a pas encore été. Le hasard
//     pur donne trois fois de suite la même personne une fois sur neuf à trois
//     joueurs — et cette personne-là passe la soirée à jouer un autre jeu.
async function dealRound(room) {
  const present = playerIds(room);
  if (present.length < MIN_PLAYERS) return false;

  const free = PAIRS.map((_, i) => i).filter((i) => !room.usedPairs.includes(i));
  const pool = free.length ? free : PAIRS.map((_, i) => i);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  room.usedPairs.push(pick);
  const pair = PAIRS[pick];
  const flip = Math.random() < 0.5;

  const counts = present.map((id) => ({
    id,
    n: findPlayer(room, id)?.imposteurCount || 0,
  }));
  const min = Math.min(...counts.map((c) => c.n));
  const candidates = counts.filter((c) => c.n === min);
  const imposteur = candidates[Math.floor(Math.random() * candidates.length)].id;
  const p = findPlayer(room, imposteur);
  if (p) p.imposteurCount = (p.imposteurCount || 0) + 1;

  const order = [...present].sort(() => Math.random() - 0.5);

  // Les deux jaquettes, en parallèle. Résolues AVANT d'écrire la manche : une
  // manche à moitié illustrée (l'une avec image, l'autre sans) se lirait comme
  // un indice, alors que ce n'en est pas un.
  const titleA = flip ? pair[0] : pair[1];
  const titleB = flip ? pair[1] : pair[0];
  const [metaA, metaB] = await Promise.all([resolveTitle(titleA), resolveTitle(titleB)]);

  // On EMPILE la manche au lieu de pré-allouer `roundCount` cases vides :
  // écrire `room.rounds[i] = {…}` sur un tableau de sous-documents Mongoose ne
  // marque pas toujours le chemin comme modifié, et la manche se perdrait
  // silencieusement à la sauvegarde. `push` caste et marque, toujours.
  room.rounds.push({
    gameA: titleA,
    gameB: titleB,
    gameACover: metaA.cover,
    gameBCover: metaB.cover,
    gameAId: metaA.igdbId,
    gameBId: metaB.igdbId,
    imposteur,
    order,
    cursor: 0,
    clues: [],
    voteCalls: [],
    votes: [],
    accused: null,
    caught: false,
    stealOptions: [],
    stealPick: "",
    stolen: false,
    gains: [],
  });
  room.index = room.rounds.length - 1;
  return true;
}

// ============================================================
//  Le seul jugement du serveur : le mot ne doit pas ÊTRE la réponse
// ============================================================
// Écrire « Nook » sur Animal Crossing, c'est finir la manche au premier mot.
// On refuse donc les mots contenus dans l'un des deux titres (et l'inverse),
// accents et casse mis de côté. Rien de plus : au-delà, juger la pertinence
// d'un indice reviendrait à jouer à la place des joueurs.
const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function tooRevealing(word, ...titles) {
  const w = fold(word);
  if (w.length < 3) return false; // « go », « vr » : trop courts pour trahir
  return titles.some((t) =>
    String(t)
      .split(/[\s:'’,-]+/)
      .some((piece) => {
        const f = fold(piece);
        return f.length >= 3 && (f.includes(w) || w.includes(f));
      })
  );
}

// ============================================================
//  Routes
// ============================================================

// GET /leaderboard — DÉCLARÉ AVANT `/:code`, sinon « leaderboard » passerait
// pour un code de salon (le piège classique de ce routeur).
//
// Le classement se lit dans le grand livre des points plutôt que dans les
// salons : ceux-ci portent un TTL de six heures, un classement bâti dessus
// serait vide tous les matins.
router.get("/leaderboard", async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await PointEntry.aggregate([
      { $match: { user: { $in: ids }, source: "imposteur" } },
      {
        $group: {
          _id: "$user",
          score: { $sum: "$amount" },
          games: { $sum: 1 },
          bestScore: { $max: "$amount" },
          date: { $max: "$createdAt" },
        },
      },
      { $sort: { score: -1, date: -1 } },
      { $limit: 30 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("username avatar")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const entries = rows
      .map((r) => {
        const u = byId.get(String(r._id));
        if (!u) return null;
        return {
          user: person(u),
          score: r.score,
          games: r.games,
          bestScore: r.bestScore,
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("imposteur leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

// POST / — créer un salon
router.post("/", async (req, res) => {
  try {
    let code;
    for (let i = 0; i < 6; i += 1) {
      code = makeCode();
      if (!(await Imposteur.exists({ code }))) break;
    }
    const roundCount = Math.max(1, Math.min(6, Number(req.body?.rounds) || 3));
    // Pas de `turnCount` ici : deux mots par joueur, toujours (cf. le modèle).
    const room = await Imposteur.create({
      code,
      host: req.userId,
      roundCount,
      players: [{ user: req.userId }],
    });
    await room.populate(POPULATE);
    res.status(201).json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("imposteur create error:", err.message);
    res.status(500).json({ error: "Impossible de créer le salon." });
  }
});

// GET /:code — l'état du salon
router.get("/:code", async (req, res) => {
  try {
    const room = await Imposteur.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.status(404).json({ error: "Salon introuvable." });
    res.json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("imposteur get error:", err.message);
    res.status(500).json({ error: "Erreur de chargement." });
  }
});

// POST /:code/join
router.post("/:code/join", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (room.phase === "done")
        return { status: 410, body: { error: "Cette partie est terminée." } };

      const existing = findPlayer(room, req.userId);
      if (existing) {
        // Retour après une coupure : on le remet en jeu. Il a peut-être un
        // rôle d'imposteur en cours — le perdre le sortirait de la manche.
        existing.leftAt = null;
      } else {
        if (room.startedAt)
          return { status: 409, body: { error: "La partie a déjà commencé." } };
        if (activePlayers(room).length >= MAX_PLAYERS)
          return { status: 409, body: { error: "Le salon est complet." } };
        room.players.push({ user: req.userId });
      }
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre." });
  }
});

// ============================================================
//  POST /:code/ready — « je suis prêt »
// ============================================================
// Un signal des invités vers l'hôte. Il NE BLOQUE PAS le départ, et c'est
// délibéré : l'hôte reste maître de sa partie, sinon un joueur qui a laissé
// son onglet ouvert en allant manger retiendrait cinq personnes en otage.
// Ce que ça change, c'est que l'hôte sait enfin s'il attend quelqu'un.
router.post("/:code/ready", async (req, res) => {
  try {
    await withRoom(req.params.code, async (room) => {
      if (!room || room.startedAt) return;
      const p = findPlayer(room, req.userId);
      if (!p) return;
      p.ready = req.body?.ready !== false;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("imposteur ready error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/options — les réglages de l'hôte (avant le départ)
router.post("/:code/options", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (!isHost(room, req.userId))
        return { status: 403, body: { error: "Seul l'hôte change les réglages." } };
      if (room.startedAt)
        return { status: 409, body: { error: "La partie a déjà commencé." } };

      // Le nombre de manches est le SEUL réglage. « Mots par joueur » a été
      // retiré : voir le modèle, aucune de ses valeurs n'était jouable sauf
      // celle par défaut.
      if (req.body?.rounds != null)
        room.roundCount = Math.max(1, Math.min(6, Number(req.body.rounds) || 3));
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur options error:", err.message);
    res.status(500).json({ error: "Réglage impossible." });
  }
});

// POST /:code/start — l'hôte lance
router.post("/:code/start", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (!isHost(room, req.userId))
        return { status: 403, body: { error: "Seul l'hôte lance la partie." } };
      if (room.startedAt)
        return { status: 409, body: { error: "La partie a déjà commencé." } };
      if (activePlayers(room).length < MIN_PLAYERS)
        return {
          status: 409,
          body: { error: `Il faut être au moins ${MIN_PLAYERS} joueurs.` },
        };

      room.rounds = [];
      room.index = 0;
      room.startedAt = new Date();
      if (!(await dealRound(room)))
        return { status: 409, body: { error: "Impossible de distribuer la manche." } };
      await beginCard(room);
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer." });
  }
});

// ============================================================
//  POST /:code/typing — la frappe en direct
// ============================================================
// Elle NE PASSE PAS par la file du salon et ne lit pas la base : voir le
// registre `liveTurn` en tête de fichier. C'est une route chaude (plusieurs
// appels par seconde et par salon), elle doit rester du pur relais.
//
// On diffuse à tout le monde SAUF au locuteur : il voit déjà ce qu'il tape, et
// se le faire renvoyer par le réseau ferait sauter son curseur.
router.post("/:code/typing", (req, res) => {
  const code = String(req.params.code);
  const live = liveTurn.get(code);
  // Ce n'est pas son tour (ou le serveur a redémarré) : on ne dit rien. Une
  // erreur ici ferait clignoter un message d'échec à chaque touche.
  if (!live || live.phase !== "clue" || live.userId !== String(req.userId))
    return res.json({ ok: false });

  const text = String(req.body?.text || "").slice(0, 24);
  emitTo(
    (live.ids || []).filter((id) => id !== String(req.userId)),
    "imposteur",
    { code, kind: "typing", userId: String(req.userId), text }
  );
  res.json({ ok: true });
});

// POST /:code/clue — lâcher son mot
router.post("/:code/clue", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (room.phase !== "clue")
        return { status: 409, body: { error: "Ce n'est pas le moment." } };
      const round = room.rounds[room.index];
      if (!round) return { status: 409, body: { error: "Manche inconnue." } };
      if (String(currentSpeaker(room, round)) !== String(req.userId))
        return { status: 409, body: { error: "Ce n'est pas ton tour." } };

      // L'espace est AUTORISÉ. Le mode se joue « un mot chacun », mais c'est
      // une règle de table, pas une règle de logiciel : « chat botté », « game
      // over », un nom propre en deux morceaux — les refuser ne rendait
      // personne plus honnête, ça faisait juste perdre trois secondes de
      // fenêtre à celui qui essayait. La limite de longueur suffit à empêcher
      // la phrase explicative.
      const word = String(req.body?.word || "").trim().replace(/\s+/g, " ");
      if (!word) return { status: 400, body: { error: "Il faut un indice." } };
      if (word.length > 24)
        return { status: 400, body: { error: "Un indice, pas une phrase (24 caractères)." } };
      if (tooRevealing(word, round.gameA, round.gameB))
        return {
          status: 400,
          body: { error: "Trop proche du titre : trouve autre chose." },
        };
      if (round.clues.some((c) => fold(c.word) === fold(word)))
        return { status: 400, body: { error: "Ce mot est déjà tombé." } };

      round.clues.push({
        user: req.userId,
        word,
        turn: turnAt(round, round.cursor),
        missed: false,
      });
      round.cursor += 1;
      clock.stop(room.code);
      await advance(room);
      return { status: 200, body: { ok: true } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur clue error:", err.message);
    res.status(500).json({ error: "Mot non retenu." });
  }
});

// POST /:code/callvote — « on vote maintenant »
// À la majorité STRICTE des présents. La moitié pile ne suffit pas : à quatre,
// deux joueurs pressés couperaient la parole aux deux autres.
router.post("/:code/callvote", async (req, res) => {
  try {
    await withRoom(req.params.code, async (room) => {
      if (!room || room.phase !== "clue") return;
      const round = room.rounds[room.index];
      if (!round) return;
      const me = String(req.userId);
      if (!playerIds(room).includes(me)) return;
      if (round.voteCalls.some((id) => String(id) === me)) return;
      round.voteCalls.push(req.userId);
      touch(room);

      if (round.voteCalls.length > playerIds(room).length / 2) {
        clock.stop(room.code);
        await beginVote(room);
        return;
      }
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "call");
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("imposteur callvote error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/vote
router.post("/:code/vote", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (room.phase !== "vote")
        return { status: 409, body: { error: "Ce n'est pas l'heure du vote." } };
      const round = room.rounds[room.index];
      if (!round) return { status: 409, body: { error: "Manche inconnue." } };
      const me = String(req.userId);
      if (!playerIds(room).includes(me))
        return { status: 403, body: { error: "Tu n'es pas dans cette partie." } };
      if (round.votes.some((v) => idOf(v.voter) === me))
        return { status: 409, body: { error: "Tu as déjà voté." } };

      const target = String(req.body?.target || "");
      if (target === me)
        return { status: 400, body: { error: "On ne se dénonce pas soi-même." } };
      if (!playerIds(room).includes(target))
        return { status: 400, body: { error: "Ce joueur n'est pas dans la partie." } };

      round.votes.push({ voter: req.userId, target });
      touch(room);

      // Tout le monde a voté : on n'attend pas la fin du chrono pour rien.
      if (round.votes.length >= playerIds(room).length) {
        clock.stop(room.code);
        await closeVote(room);
        return { status: 200, body: { ok: true } };
      }
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "voted");
      return { status: 200, body: { ok: true } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur vote error:", err.message);
    res.status(500).json({ error: "Vote non retenu." });
  }
});

// POST /:code/steal — la dernière chance de l'imposteur démasqué
router.post("/:code/steal", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (room.phase !== "steal")
        return { status: 409, body: { error: "Ce n'est pas le moment." } };
      const round = room.rounds[room.index];
      if (!round) return { status: 409, body: { error: "Manche inconnue." } };
      if (idOf(round.imposteur) !== String(req.userId))
        return { status: 403, body: { error: "Ce n'est pas ton tour." } };

      const pick = String(req.body?.pick || "");
      if (!round.stealOptions.includes(pick))
        return { status: 400, body: { error: "Proposition inconnue." } };
      round.stealPick = pick;
      round.stolen = pick === round.gameA;
      clock.stop(room.code);
      await beginResult(room);
      return { status: 200, body: { ok: true } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("imposteur steal error:", err.message);
    res.status(500).json({ error: "Choix non retenu." });
  }
});

// POST /:code/leave
router.post("/:code/leave", async (req, res) => {
  try {
    await withRoom(req.params.code, async (room) => {
      if (!room) return;
      const p = findPlayer(room, req.userId);
      if (!p) return;
      p.leftAt = new Date();
      touch(room);
      if (!room.startedAt && isHost(room, req.userId) && activePlayers(room).length)
        room.host = activePlayers(room)[0].user;
      await room.save();
      await room.populate(POPULATE);

      if (!activePlayers(room).length) {
        clock.stop(room.code);
        clearTurnCache(room.code);
        return;
      }
      // La table est descendue sous le minimum en pleine partie : le mode n'a
      // plus de sens à deux (l'imposteur serait l'un des deux). On termine
      // proprement plutôt que de laisser tourner une partie injouable.
      if (room.startedAt && room.phase !== "done" && activePlayers(room).length < MIN_PLAYERS) {
        clock.stop(room.code);
        await finish(room);
        return;
      }
      // Celui qui part avait la parole : on ne bloque pas les autres 25 s.
      const round = room.rounds[room.index];
      if (
        room.phase === "clue" &&
        round &&
        String(currentSpeaker(room, round)) === String(req.userId)
      ) {
        round.cursor += 1;
        clock.stop(room.code);
        await advance(room);
        return;
      }
      toEachRoom(room, "lobby");
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("imposteur leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/invite — la carte d'invitation en message privé
// Même forme que les cinq autres salons : la carte de la messagerie est
// partagée et attend exactement ces champs.
router.post("/:code/invite", async (req, res) => {
  try {
    const room = await Imposteur.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (!allIds(room).includes(String(req.userId)))
      return res.status(403).json({ error: "Rejoins le salon avant d'inviter." });
    if (room.startedAt)
      return res.status(409).json({ error: "La partie a déjà commencé." });

    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [...new Set((req.body?.conversationIds || []).map(String))].slice(
      0,
      10
    );
    if (!userIds.length && !conversationIds.length)
      return res.status(400).json({ error: "Personne à inviter." });

    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: userIds } }).select("username following").lean(),
    ]);

    const card = {
      kind: "imposteur",
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

    res.json({ sent, skipped, groups: groups.length });
  } catch (err) {
    console.error("imposteur invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /:code/card — l'état du salon pour la carte de la messagerie
// Séparé de `GET /:code`, qui répondrait la manche en cours — donc le titre du
// jeu, c'est-à-dire toute la partie. Un salon disparu n'est pas une erreur :
// c'est l'issue normale d'une carte relue trois jours plus tard.
router.get("/:code/card", async (req, res) => {
  try {
    const room = await Imposteur.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.json({ state: "gone" });
    const active = activePlayers(room);
    const done = room.phase === "done" || !!room.endedAt;
    const champ = done
      ? [...room.players]
          .filter((p) => !p.leftAt)
          .sort((a, b) => (b.score || 0) - (a.score || 0))[0]
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
    console.error("imposteur card error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
