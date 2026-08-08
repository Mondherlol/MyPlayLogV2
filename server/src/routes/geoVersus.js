import express from "express";
import GeoVersus, { makeCode, MAX_PLAYERS, LIVES } from "../models/GeoVersus.js";
import Panorama from "../models/Panorama.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import { person, sameGame, shuffle, getFamousPool, attachAltNames } from "./blindtest.js";
import { absolutize, baseOf, mapOf, scoreMapGuess } from "./geo.js";
import {
  makeRoomQueue,
  makeClock,
  makeBaseStore,
  hostIdOf,
  isHost,
  activePlayers,
  playerIds,
  allIds,
  findPlayer,
} from "../lib/versusRoom.js";

// ======================================================================
//  GeoGamer VERSUS — le même panorama, en même temps, à plusieurs
// ======================================================================
// Le solo (routes/geo.js) est un jeu de collection : chaque lieu n'est vu
// QU'UNE FOIS (models/GeoSeen.js), et le catalogue s'épuise. Ce mode-ci ne joue
// pas à ça — il pioche AU HASARD dans tout le catalogue actif, sans regarder ce
// que les uns et les autres ont déjà traversé, et sans rien marquer ensuite.
//
// C'est délibéré et c'est la seule façon que ça tienne : à cinq joueurs, exiger
// un lieu inédit POUR TOUT LE MONDE viderait le catalogue en quelques parties
// et finirait par ne plus rien trouver du tout. Un lieu déjà vu par l'un est un
// désavantage local, pas une injustice — l'autre le connaîtra la fois suivante.
// Corollaire : une partie versus ne consomme JAMAIS le stock de lieux inédits du
// solo (aucune écriture dans GeoSeen).
//
// ---------------------------------------------------------- le serveur arbitre
// Ici la réponse ne quitte pas le serveur avant la révélation (cf. l'en-tête de
// models/GeoVersus.js). Le client envoie « je propose Hollow Knight », le
// serveur répond oui ou non. En buzzer c'est ce qui rend le « premier arrivé »
// honnête ; en classique ça évite qu'un onglet ouvert sur les outils de dev
// vende la mèche.
//
// ------------------------------------------------------------ le chrono du salon
// Les manches s'enchaînent toutes seules, sans que personne ait à cliquer :
// un `setTimeout` par salon, gardé en mémoire du process (`clocks`). Un
// redémarrage du serveur perd les parties en cours — c'est assumé, elles durent
// dix minutes et le document porte son propre TTL. Ce qui NE devait pas être
// assumé, en revanche, c'est qu'une partie dépende d'un navigateur resté
// ouvert : si tout le monde ferme son onglet en pleine manche, le salon se
// termine quand même proprement.
const router = express.Router();

router.use(requireAuth);

// Sas de chargement avant chaque manche. Un panorama pèse plusieurs mégaoctets :
// on annonce l'image ET l'heure du départ, et chacun charge dans son coin
// pendant le « 3, 2, 1 ».
//
// ET LE SAS ATTEND LE PLUS LENT. Avec un décompte fixe, celui dont l'image
// n'était pas chargée restait sur « Atterrissage… » pendant que les autres
// tapaient déjà — le défaut le plus rageant du mode. Personne ne part donc tant
// que tout le monde n'a pas atterri (POST /:code/armed, `round.armed`), et cela
// n'avantage personne : ceux qui ont fini regardent un décompte, pas le décor.
// Deux butées pour qu'un onglet mort ne gèle pas la partie : on ne prolonge
// jamais au-delà de CUE_MAX_MS, et on repousse par petits pas.
const CUE_MS = 5000;
// 20 s : au-delà, mieux vaut une manche entamée en retard par un seul qu'un
// salon entier immobile — et une manche ne dure que 45 s.
const CUE_MAX_MS = 20000;
const CUE_STEP_MS = 1200;
const ROUND_MS = 45000;
const MAP_MS = 25000;
const REVEAL_MS = 7000;
// Le tableau final reste affiché : c'est la fin de la partie, pas une manche.
const DEFAULT_ROUNDS = 8;

// ---------------------------------------------------------------- le barème
// CLASSIQUE — l'ordre d'arrivée fait le score. On récompense le rang, pas le
// chrono : « deuxième » se compare d'un coup d'œil, « 12,4 s » ne se compare à
// rien quand on ne voit pas le temps des autres. L'écart reste net entre le
// premier et le dernier sans être écrasant — une manche ratée par le meneur
// suffit à rendre la partie.
const ORDER_POINTS = [300, 230, 180, 150, 130];
// BUZZER — le premier bon jeu rafle tout, les autres n'ont rien. C'est brutal,
// c'est le principe : la manche s'arrête à la seconde où il tombe.
const BUZZER_POINTS = 300;
// Essais ratés avant de trouver (même courbe qu'en solo, cf. routes/geo.js).
const MISS_FACTOR = [1, 0.65, 0.3];
// Manche carte en BUZZER : tout le monde plante son épingle, même ceux qui
// n'ont pas trouvé le jeu, et c'est le CLASSEMENT DES DISTANCES qui paie. C'est
// la revanche des perdants de la manche — celui qui s'est fait souffler le buzz
// peut encore rattraper 200 points s'il connaît vraiment les lieux.
const MAP_RANK_POINTS = [200, 130, 90, 60, 40];
// Le vainqueur repart avec un cinquième de plus. Assez pour que gagner compte,
// trop peu pour que le versus devienne LA façon de farmer des points d'arcade.
const WINNER_BONUS = 0.2;

const missFactor = (m) => MISS_FACTOR[Math.min(Math.max(m, 0), MISS_FACTOR.length - 1)];

// Le clic reçu du client : une FRACTION de la carte, donc forcément dans [0,1].
// (Le solo passe par sanitizeMapGuess, qui a besoin de la carte pour valider ;
// ici la carte reste au serveur et seule la borne compte.)
function clampPin(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
}

// ============================================================
//  Accès concurrent : un salon ne se modifie qu'à la queue leu leu
// ============================================================
// DEUX BUZZ À LA MÊME MILLISECONDE, C'EST LE CŒUR DU MODE. Sans sérialisation,
// deux requêtes peuvent charger le même document, se croire toutes deux
// « premières », puis s'écraser l'une l'autre à la sauvegarde : deux vainqueurs,
// ou pire, un vainqueur qui disparaît. On fait donc passer toute mutation d'un
// salon par une file d'attente — chaque opération relit le document APRÈS que
// la précédente l'a écrit.
const withRoom = makeRoomQueue((code) => GeoVersus.findOne({ code }).populate(POPULATE));

// Le chrono du salon. Un seul minuteur à la fois : chaque phase programme la
// suivante, et reprogrammer écrase toujours le précédent (une manche close en
// avance ne doit pas se refermer une seconde fois à l'heure prévue).
const clock = makeClock("geoversus");
const schedule = (code, atMs, fn) => clock.at(code, atMs, fn);
const stopClock = (code) => clock.stop(code);

// L'origine des URL (« https://myplaylog.cc ») retenue au lancement de la
// partie : les diffusions SSE n'ont pas de `req` sous la main pour absolutiser
// les chemins d'upload. En production Caddy sert l'API et /uploads sur le même
// domaine, donc le repli sur le chemin relatif reste valide — c'est en
// développement (front 5173, API 4000) que la valeur compte vraiment.
const bases = makeBaseStore();
const baseFor = (code) => bases.get(code);

// ============================================================
//  « Suivant » — couper court à la révélation
// ============================================================
// Personne ne peut décider pour les autres : la manche suivante ne démarre en
// avance que si TOUT LE MONDE a cliqué. C'est un vote, pas un bouton — sans
// quoi le premier joueur à s'ennuyer escamoterait la révélation de ceux qui
// sont encore en train de lire le nom du jeu.
//
// En mémoire du process, comme le chrono des salons : ça ne survit pas à un
// redémarrage, et ça n'a aucune raison d'y survivre (le décompte reprend la
// main, la partie continue).
const skips = new Map(); // code -> Set<userId>
const skipsOf = (code) => skips.get(code) || new Set();
const clearSkips = (code) => skips.delete(code);

// ============================================================
//  Sérialisation
// ============================================================

const curRound = (room) => room.rounds[room.index] || null;

// Vies restantes d'un joueur sur la manche courante : trois, moins ses ratés.
function livesOf(round, userId) {
  if (!round) return LIVES;
  const misses = round.attempts.filter(
    (a) => !a.correct && String(a.user) === String(userId)
  ).length;
  return Math.max(0, LIVES - misses);
}

// Un joueur a fini sa manche s'il a trouvé, ou s'il a brûlé ses trois vies.
function isSettled(round, userId) {
  if (!round) return false;
  const mine = round.attempts.filter((a) => String(a.user) === String(userId));
  return mine.some((a) => a.correct) || mine.filter((a) => !a.correct).length >= LIVES;
}

// ------------------------------------------------------------ les spectateurs
// QUI A LE DROIT DE REGARDER LES AUTRES. Un joueur qui a fini sa manche —
// trouvé, ou à court de vies — n'a plus rien à gagner sur ce lieu : il peut
// donc voir les écrans des autres sans que ça change quoi que ce soit au
// classement. Un joueur ENCORE EN COURSE, lui, n'y a jamais droit : voir où un
// adversaire pointe sa caméra ou ce qu'il tape serait l'indice le plus fort du
// jeu, et c'est exactement ce que le mode classique refuse.
//
// C'est la seule règle derrière la grille d'écrans (« ils cherchent encore »)
// et elle se vérifie ICI, jamais côté client : le serveur n'envoie rien à ceux
// qui n'y ont pas droit, plutôt que de leur demander de ne pas regarder.
function watcherIds(room, round, exceptId) {
  return playerIds(room).filter(
    (id) => id !== String(exceptId ?? "") && isSettled(round, id)
  );
}

function mapPayload(base, round) {
  if (!round?.mapImage) return null;
  return {
    image: absolutize(base, round.mapImage),
    width: round.mapWidth,
    height: round.mapHeight,
  };
}

// ------------------------------------------------------------------ la manche
// CE QUE LE CLIENT A LE DROIT DE SAVOIR, et c'est tout le sujet. Avant la
// révélation : l'image, et l'état des autres. Le nom du jeu, la jaquette et le
// point de réponse de la carte n'apparaissent qu'en phase `reveal`.
//
// En CLASSIQUE on ne diffuse que le fait qu'un joueur a trouvé (et son rang) —
// jamais ce qu'il a tapé, ni ses fausses pistes : chacun cherche dans son coin.
// En BUZZER on diffuse tout, c'est le sel du mode.
function roundView(room, meId) {
  const round = curRound(room);
  if (!round || room.phase === "lobby") return null;
  const base = baseFor(room.code);
  const revealed = room.phase === "reveal" || room.phase === "done";
  // Le NOM du jeu tombe dès la manche carte, un cran avant le reste : la
  // recherche est close (personne ne peut plus marquer dessus) et « où étais-tu
  // dans ce jeu ? » n'a aucun sens si on ne dit pas lequel. Le POINT DE RÉPONSE
  // de la carte, lui, reste au serveur jusqu'à la révélation — c'est encore un
  // score en jeu.
  //
  // …et il tombe aussi, en pleine manche, POUR QUI VIENT DE LE TROUVER : en
  // classique sa carte se joue tout de suite, et l'en-tête sans titre serait
  // absurde. Ça ne lui apprend rien — c'est le mot qu'il vient de taper.
  const iFound = round.attempts.some(
    (a) => a.correct && String(a.user) === String(meId)
  );
  const named = revealed || room.phase === "map" || iFound;

  const found = round.attempts
    .filter((a) => a.correct)
    .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));

  const view = {
    index: room.index,
    total: room.rounds.length,
    image: absolutize(base, round.image),
    difficulty: round.difficulty,
    map: mapPayload(base, round),
    // Qui a fini d'atterrir : le sas s'en sert pour dire qui l'on attend.
    armed: (round.armed || []).map(String),
    lives: livesOf(round, meId),
    settled: isSettled(round, meId),
    found,
    // Les vies de TOUT LE MONDE, dans les deux modes. Ce qui reste caché en
    // classique, c'est le titre proposé — pas le fait de s'être trompé : voir
    // les cœurs d'un adversaire tomber est précisément ce qui rend la course
    // lisible (« il a brûlé deux vies, il patine »). Seul le NOM renseignerait
    // vraiment (« il a cru que c'était Zelda, donc ça y ressemble »).
    livesById: Object.fromEntries(
      activePlayers(room).map((p) => {
        const id = String(p.user?._id || p.user);
        return [id, livesOf(round, id)];
      })
    ),
    // Ceux qui ont brûlé leurs trois vies sans trouver.
    out: activePlayers(room)
      .map((p) => String(p.user?._id || p.user))
      .filter((id) => isSettled(round, id) && !found.some((f) => f.userId === id)),
    // Qui a déjà posé son épingle (phase carte) : on montre l'avancement sans
    // rien dire de l'endroit choisi.
    pinned: round.results.filter((r) => r.mapX != null).map((r) => String(r.user)),
    // Buzzer : le fil des tentatives de tout le monde. Classique : les miennes
    // (pour réafficher mes propres ratés au rechargement) — plus celles des
    // autres UNE FOIS MA MANCHE FINIE, sinon un rechargement de page en plein
    // spectacle viderait les fausses pistes de la grille d'écrans.
    attempts:
      room.mode === "buzzer" || isSettled(round, meId)
        ? round.attempts.map((a) => ({
            userId: String(a.user),
            name: a.name,
            correct: a.correct,
            atMs: a.atMs,
          }))
        : round.attempts
            .filter((a) => String(a.user) === String(meId))
            .map((a) => ({
              userId: String(a.user),
              name: a.name,
              correct: a.correct,
              atMs: a.atMs,
            })),
  };

  if (named) {
    view.gameId = round.gameId;
    view.gameName = round.gameName;
    view.cover = round.cover;
    view.winner = round.winner ? String(round.winner) : null;
  }

  if (revealed) {
    if (round.mapImage && round.mapAnswerX != null)
      view.map = { ...view.map, answer: { x: round.mapAnswerX, y: round.mapAnswerY } };
    view.results = round.results.map((r) => ({
      userId: String(r.user),
      correct: r.correct,
      order: r.order,
      misses: r.misses,
      timeMs: r.timeMs,
      points: r.points,
      map:
        r.mapX != null
          ? { x: r.mapX, y: r.mapY, distance: r.mapDistance, rank: r.mapRank, points: r.mapPoints }
          : null,
      mapPoints: r.mapPoints,
    }));
  }
  return view;
}

function serializeRoom(room, meId) {
  const ids = allIds(room);
  const online = onlineAmong(ids);
  const hostId = String(room.host?._id || room.host);
  return {
    code: room.code,
    mode: room.mode,
    hostId,
    isHost: hostId === String(meId),
    roundCount: room.roundCount,
    durationSec: room.durationSec,
    phase: room.phase,
    index: room.index,
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    // L'heure du serveur : le client corrige l'écart avec sa propre horloge,
    // sinon une machine en avance de 30 s jouerait une manche déjà finie.
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

// Diffuse à tout le salon. Le `code` part avec : un onglet peut être ouvert sur
// un autre salon, il doit pouvoir ignorer ce qui ne le concerne pas.
function toRoom(room, kind, payload = {}) {
  emitTo(playerIds(room), "geoversus", { code: room.code, kind, ...payload });
}

// La vue d'ensemble, expédiée à chacun avec SA vue de la manche (les vies et
// les essais visibles diffèrent d'un joueur à l'autre).
function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "geoversus", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

const touch = (room) => {
  room.lastActiveAt = new Date();
};

const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];

async function loadRoom(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(String(code))) return null;
  return GeoVersus.findOne({ code: String(code) }).populate(POPULATE);
}

// ============================================================
//  Le tirage des lieux
// ============================================================
// Au hasard dans TOUT le catalogue actif : pas de filtre « déjà vu », pas de
// quota de jeux possédés. Une seule règle conservée du solo — jamais deux fois
// le même JEU dans une partie, sinon deux manches auraient la même réponse.
async function buildVersusRounds(count) {
  const catalog = await Panorama.find({ active: true, gameId: { $ne: null } })
    .select(
      "gameId gameName cover image difficulty mapImage mapAnswerX mapAnswerY mapWidth mapHeight"
    )
    .lean();
  if (catalog.length < 3) return { rounds: [] };

  const byGame = new Map();
  for (const p of catalog) {
    if (!byGame.has(p.gameId)) byGame.set(p.gameId, []);
    byGame.get(p.gameId).push(p);
  }
  // Un recoin au hasard par jeu, puis on bat le paquet et on sert.
  const oneEach = shuffle(
    [...byGame.values()].map((list) => list[Math.floor(Math.random() * list.length)])
  );

  const rounds = oneEach.slice(0, count).map((p) => {
    const map = mapOf(p);
    return {
      panorama: p._id,
      gameId: p.gameId,
      gameName: p.gameName,
      cover: p.cover || null,
      image: p.image,
      difficulty: p.difficulty || 3,
      mapImage: map?.image || null,
      mapWidth: map?.width ?? null,
      mapHeight: map?.height ?? null,
      mapAnswerX: map?.answer.x ?? null,
      mapAnswerY: map?.answer.y ?? null,
      attempts: [],
      results: [],
      winner: null,
    };
  });

  // La liste de suggestions ne se construit PAS ici : elle ne dépend que du
  // catalogue, jamais de la partie, et elle est la même pour tout le monde —
  // c'est `candidatesFor()` et son cache qui s'en chargent.
  return { rounds };
}

// ============================================================
//  Le déroulé d'une manche
// ============================================================

// Départ : on annonce l'image et l'heure du top. Chacun charge son panorama
// pendant le décompte — voir CUE_MS.
async function startCue(room, index) {
  room.phase = "cue";
  room.index = index;
  room.phaseStartsAt = Date.now() + CUE_MS;
  room.phaseEndsAt = room.phaseStartsAt + ROUND_MS;
  room.cueMaxAt = Date.now() + CUE_MAX_MS;
  // Nouvelle manche, nouveau décor : personne n'a encore atterri.
  const round = curRound(room);
  if (round) round.armed = [];
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "cue");
  schedule(room.code, room.phaseStartsAt, () => withRoom(room.code, beginRound));
  return room;
}

// Qui n'a pas encore fini de charger le décor.
function notArmed(room) {
  const round = curRound(room);
  if (!round) return [];
  const armed = new Set((round.armed || []).map(String));
  return activePlayers(room)
    .map((p) => String(p.user?._id || p.user))
    .filter((id) => !armed.has(id));
}

async function beginRound(room) {
  if (room.phase !== "cue") return room;

  // Il manque du monde et la butée n'est pas atteinte : on repousse le top
  // d'un cran et on le fait savoir (le sas affiche qui l'on attend). Le
  // décompte reste synchronisé chez tout le monde puisqu'il se lit sur
  // `phaseStartsAt`, rediffusé ici.
  if (notArmed(room).length && Date.now() < (room.cueMaxAt || 0)) {
    room.phaseStartsAt = Math.min(Date.now() + CUE_STEP_MS, room.cueMaxAt);
    room.phaseEndsAt = room.phaseStartsAt + ROUND_MS;
    touch(room);
    await room.save();
    await room.populate(POPULATE);
    toEachRoom(room, "cue");
    schedule(room.code, room.phaseStartsAt, () => withRoom(room.code, beginRound));
    return room;
  }

  room.phase = "round";
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "go");
  schedule(room.code, room.phaseEndsAt, () => withRoom(room.code, endRound));
  return room;
}

// Fin de la recherche : on arrête les scores du jeu, puis place à la carte (si
// le lieu en a une) ou directement à la révélation.
async function endRound(room) {
  if (room.phase !== "round" && room.phase !== "cue") return room;
  const round = curRound(room);
  if (!round) return finishGame(room);

  const players = activePlayers(room);
  const winners = round.attempts.filter((a) => a.correct);
  // Les épingles déjà posées PENDANT la manche (classique). `results` est
  // entièrement reconstruit juste en dessous : sans cette copie, le travail des
  // joueurs qui ont trouvé tôt et se sont situés dans la foulée serait effacé.
  const early = new Map(
    round.results.filter((r) => r.mapX != null).map((r) => [String(r.user), r])
  );

  round.results = players.map((p) => {
    const uid = String(p.user?._id || p.user);
    const mine = round.attempts.filter((a) => String(a.user) === String(uid));
    const hit = mine.find((a) => a.correct) || null;
    const misses = mine.filter((a) => !a.correct).length;
    const order = hit ? winners.findIndex((a) => String(a.user) === uid) + 1 : null;

    let points = 0;
    if (hit) {
      if (room.mode === "buzzer") points = Math.round(BUZZER_POINTS * missFactor(misses));
      else {
        const base = ORDER_POINTS[Math.min(order - 1, ORDER_POINTS.length - 1)];
        points = Math.round(base * missFactor(misses));
      }
    }
    return {
      user: p.user?._id || p.user,
      correct: !!hit,
      timeMs: hit ? hit.atMs : null,
      misses,
      order,
      points,
      mapX: early.get(uid)?.mapX ?? null,
      mapY: early.get(uid)?.mapY ?? null,
      mapDistance: null,
      mapRank: null,
      mapPoints: 0,
    };
  });

  if (room.mode === "buzzer" && winners.length)
    round.winner = winners[0].user;

  // ------------------------------------------------------ où se joue la carte
  // BUZZER : phase commune, après la manche. Tout le monde y va, y compris les
  // battus — c'est leur revanche, et c'est le classement des distances qui
  // paie. Un temps à part se justifie parce que TOUT LE MONDE joue.
  //
  // CLASSIQUE : plus de phase du tout. La carte se joue PENDANT la manche, dès
  // qu'on a trouvé le jeu, sur son propre temps restant (cf. POST /:code/map).
  // C'était l'anomalie : seuls ceux qui avaient trouvé y avaient droit, mais
  // TOUT LE MONDE attendait leurs 25 secondes — et celui qui trouvait en dix
  // secondes se retrouvait à patienter deux fois. Trouver vite doit acheter du
  // temps de carte, pas du temps d'attente. Qui ne s'est pas situé avant la fin
  // de la manche n'a pas de points de carte : tant pis, c'était son temps.
  if (room.mode === "buzzer") {
    const eligible = mapEligible(room, round);
    if (round.mapImage && round.mapAnswerX != null && eligible.length) {
      room.phase = "map";
      room.phaseStartsAt = Date.now();
      room.phaseEndsAt = room.phaseStartsAt + MAP_MS;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "map", { eligible });
      schedule(room.code, room.phaseEndsAt, () => withRoom(room.code, endMap));
      return room;
    }
  } else {
    scoreMapPins(room, round);
  }
  return startReveal(room);
}

// Qui a le droit de planter une épingle sur cette manche.
//
// On lit les TENTATIVES et non les résultats : en classique la carte se joue
// pendant la manche, à un moment où `round.results` n'existe pas encore (il
// n'est construit qu'à `endRound`). Les deux sources disent la même chose une
// fois la manche close — « avoir une tentative correcte » et « avoir
// `correct: true` dans les résultats » sont le même fait.
function mapEligible(room, round) {
  const players = activePlayers(room).map((p) => String(p.user?._id || p.user));
  if (room.mode === "buzzer") return players;
  const finders = new Set(
    round.attempts.filter((a) => a.correct).map((a) => String(a.user))
  );
  return players.filter((id) => finders.has(id));
}

// Le pointage des épingles, quel que soit le chemin par lequel on y arrive :
// la phase carte commune du buzzer, ou les épingles posées en cours de manche
// en classique.
function scoreMapPins(room, round) {
  if (!round.mapImage || round.mapAnswerX == null) return;
  const answer = { x: round.mapAnswerX, y: round.mapAnswerY };
  const pinned = round.results.filter((r) => r.mapX != null);
  for (const r of pinned) {
    const { distance } = scoreMapGuess({ answer }, { x: r.mapX, y: r.mapY });
    r.mapDistance = distance;
  }

  if (room.mode === "buzzer") {
    // Classement des distances : le plus proche rafle, les suivants grappillent.
    // Personne d'autre ne marque — une épingle au hasard ne doit rien valoir.
    const ranked = [...pinned].sort((a, b) => a.mapDistance - b.mapDistance);
    ranked.forEach((r, i) => {
      r.mapRank = i + 1;
      r.mapPoints = i < MAP_RANK_POINTS.length ? MAP_RANK_POINTS[i] : 0;
    });
  } else {
    // Classique : le barème absolu du solo (cf. scoreMapGuess), plafonné à 200.
    for (const r of pinned) {
      const { points } = scoreMapGuess({ answer }, { x: r.mapX, y: r.mapY });
      r.mapPoints = points;
    }
  }
}

async function endMap(room) {
  if (room.phase !== "map") return room;
  const round = curRound(room);
  if (!round) return finishGame(room);
  scoreMapPins(room, round);
  return startReveal(room);
}

async function startReveal(room) {
  const round = curRound(room);
  if (round) {
    // Les points de la manche tombent dans la cagnotte de chacun.
    for (const r of round.results) {
      const p = findPlayer(room, r.user);
      if (!p) continue;
      p.score = (p.score || 0) + (r.points || 0) + (r.mapPoints || 0);
      if (r.correct) p.correctCount = (p.correctCount || 0) + 1;
    }
  }
  room.phase = "reveal";
  room.phaseStartsAt = Date.now();
  room.phaseEndsAt = room.phaseStartsAt + REVEAL_MS;
  // Chaque révélation repart avec un vote vierge.
  clearSkips(room.code);
  touch(room);
  await room.save();
  await room.populate(POPULATE);
  toEachRoom(room, "reveal");

  schedule(room.code, room.phaseEndsAt, () => withRoom(room.code, leaveReveal));
  return room;
}

// La sortie de révélation : manche suivante, ou fin de partie. Deux chemins y
// mènent — le décompte, et le vote unanime de « suivant ».
async function leaveReveal(room) {
  if (room.phase !== "reveal") return room;
  clearSkips(room.code);
  if (room.index + 1 < room.rounds.length) return startCue(room, room.index + 1);
  return finishGame(room);
}

// ============================================================
//  Fin de partie
// ============================================================
async function finishGame(room) {
  if (room.phase === "done") return room;
  stopClock(room.code);
  clearSkips(room.code);
  room.phase = "done";
  room.endedAt = new Date();
  room.phaseStartsAt = Date.now();
  room.phaseEndsAt = 0;
  touch(room);
  await room.save();
  await room.populate(POPULATE);

  // Classement : le score, puis le nombre de lieux trouvés pour départager.
  const ranking = [...room.players]
    .filter((p) => !p.leftAt)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.correctCount || 0) - (a.correctCount || 0))
    .map((p, i) => ({
      user: person(p.user),
      id: String(p.user?._id || p.user),
      rank: i + 1,
      score: p.score || 0,
      correct: p.correctCount || 0,
    }));

  toEachRoom(room, "done", { ranking });

  // Les points d'arcade et les cartes du fil : best-effort, comme partout
  // ailleurs — une partie reste valide même si le crédit échoue.
  const total = room.rounds.length;
  const mates = ranking.map((r) => ({
    id: r.id,
    username: r.user?.username || "",
    avatar: r.user?.avatar || null,
    score: r.score,
    rank: r.rank,
  }));

  for (const r of ranking) {
    const bonus = r.rank === 1 ? Math.round(r.score * WINNER_BONUS) : 0;
    grantPoints(r.id, r.score + bonus, "geoversus", {
      versusId: String(room._id),
      mode: room.mode,
      rank: r.rank,
      bonus,
    }).catch(() => {});

    recordActivity({
      actor: r.id,
      type: "geoversus",
      meta: {
        versusId: String(room._id),
        mode: room.mode,
        score: r.score,
        rank: r.rank,
        correct: r.correct,
        total,
        players: mates,
      },
    });
    triggerMissionCheck(r.id);
  }
  return room;
}

// Une manche peut se clore AVANT l'heure : plus personne n'a de raison de
// chercher. C'est ce qui donne son rythme au mode — on n'attend pas 45 s pour
// rien quand tout le monde a répondu.
function shouldEndEarly(room, round) {
  const players = activePlayers(room).map((p) => String(p.user?._id || p.user));
  if (!players.length) return true;
  if (room.mode === "buzzer" && round.attempts.some((a) => a.correct)) return true;
  if (!players.every((id) => isSettled(round, id))) return false;
  // CLASSIQUE : la carte se joue dans le temps de la manche. Tant qu'un joueur
  // qui a trouvé n'a pas posé son épingle, il lui reste quelque chose à faire —
  // refermer la manche sur lui reviendrait à lui voler la moitié qu'il vient
  // justement de gagner en trouvant vite.
  if (room.mode === "classic" && round.mapImage && round.mapAnswerX != null) {
    const pinned = new Set(
      round.results.filter((r) => r.mapX != null).map((r) => String(r.user))
    );
    if (mapEligible(room, round).some((id) => !pinned.has(id))) return false;
  }
  return true;
}

// Idem pour la carte : quand tous les ayants droit ont planté leur épingle, on
// n'a plus rien à attendre.
function allPinned(room, round) {
  const eligible = mapEligible(room, round);
  if (!eligible.length) return true;
  const pinned = new Set(round.results.filter((r) => r.mapX != null).map((r) => String(r.user)));
  return eligible.every((id) => pinned.has(id));
}

// ============================================================
//  Ouvrir / rejoindre / quitter
// ============================================================

// POST /api/geo/versus — ouvre un salon.
router.post("/", async (req, res) => {
  try {
    const mode = req.body?.mode === "buzzer" ? "buzzer" : "classic";
    const roundCount = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 3), 12);
    let room = null;
    for (let i = 0; i < 3 && !room; i += 1) {
      const code = makeCode();
      // eslint-disable-next-line no-await-in-loop
      if (await GeoVersus.exists({ code })) continue;
      // eslint-disable-next-line no-await-in-loop
      room = await GeoVersus.create({
        code,
        host: req.userId,
        mode,
        roundCount,
        players: [{ user: req.userId, joinedAt: new Date(), ready: true }],
      });
    }
    if (!room) return res.status(500).json({ error: "Salon non créé, réessaie." });
    bases.set(room.code, baseOf(req));
    await room.populate(POPULATE);
    res.status(201).json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("geoversus create error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir le salon." });
  }
});

// GET /api/geo/versus/:code — l'état du salon (+ la liste de recherche une fois
// la partie lancée). On répond même à qui n'est pas encore entré : il faut bien
// lui montrer ce qu'on lui propose.
router.get("/:code", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (!bases.has(room.code)) bases.set(room.code, baseOf(req));
    const mine = allIds(room).includes(String(req.userId));
    const payload = { room: serializeRoom(room, req.userId), member: mine };
    // La liste de suggestions ne sert qu'en jeu, et elle est grosse : on ne
    // l'envoie qu'à ceux qui jouent vraiment.
    if (mine && room.startedAt && room.phase !== "done") {
      const { candidates } = await candidatesFor();
      payload.candidates = candidates;
    }
    res.json(payload);
  } catch (err) {
    console.error("geoversus get error:", err.message);
    res.status(500).json({ error: "Salon illisible." });
  }
});

// La liste de recherche est reconstruite à la demande (rechargement de page en
// pleine partie) : elle ne dépend que du catalogue, jamais du joueur.
const candCache = { at: 0, candidates: null };
async function candidatesFor() {
  // Deux minutes de cache : le catalogue ne bouge qu'à un import d'admin, et
  // reconstruire la liste à chaque rechargement d'onglet serait du gâchis.
  if (candCache.candidates && Date.now() - candCache.at < 120000)
    return { candidates: candCache.candidates };
  const catalog = await Panorama.find({ active: true, gameId: { $ne: null } })
    .select("gameId gameName cover")
    .lean();
  const candMap = new Map();
  const addCand = (id, name, cover) => {
    if (!id || candMap.has(id)) return;
    candMap.set(id, { id, name, cover: cover || null });
  };
  for (const p of catalog) addCand(p.gameId, p.gameName, p.cover);
  for (const g of await getFamousPool()) addCand(g.id, g.name, g.cover);
  const candidates = await attachAltNames([...candMap.values()]);
  candCache.at = Date.now();
  candCache.candidates = candidates;
  return { candidates };
}

// POST /:code/join
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
    if (!bases.has(out.room.code)) bases.set(out.room.code, baseOf(req));
    res.json({ room: serializeRoom(out.room, req.userId), member: true });
  } catch (err) {
    console.error("geoversus join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre." });
  }
});

// POST /:code/leave — l'hôte qui part pendant le lobby ferme le salon ; en
// pleine partie, il laisse les autres finir (le chrono est au serveur, il n'a
// besoin de personne).
router.post("/:code/leave", async (req, res) => {
  try {
    await withRoom(String(req.params.code), async (room) => {
      const me = findPlayer(room, req.userId);
      if (!me) return room;
      me.leftAt = new Date();
      const hostLeft = isHost(room, req.userId);
      if (!room.startedAt && hostLeft) {
        stopClock(room.code);
        room.endedAt = new Date();
        room.phase = "done";
        await room.save();
        toRoom(room, "closed");
        return room;
      }
      // Plus personne en jeu : on arrête les frais.
      if (room.startedAt && !activePlayers(room).length) {
        await room.save();
        return finishGame(room);
      }
      // L'hôte s'en va pendant la partie : la main passe au premier restant,
      // pour que quelqu'un puisse encore relancer à la fin.
      if (hostLeft && activePlayers(room).length)
        room.host = activePlayers(room)[0].user;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      // La manche courante n'attend plus un joueur qui vient de partir — ni la
      // révélation, dont il retenait peut-être le seul vote manquant.
      const round = curRound(room);
      if (room.phase === "round" && round && shouldEndEarly(room, round))
        return endRound(room);
      if (room.phase === "map" && round && allPinned(room, round)) return endMap(room);
      if (room.phase === "reveal") {
        const set = skipsOf(room.code);
        const ids = playerIds(room);
        if (ids.length && ids.every((id) => set.has(id))) return leaveReveal(room);
      }
      return room;
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("geoversus leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/armed — « mon panorama est affiché, je peux jouer ».
//
// C'est ce qui permet au sas d'attendre le plus lent plutôt que d'égrener cinq
// secondes dans le vide (voir CUE_MAX_MS). Le client l'envoie quand la texture
// est RÉELLEMENT à l'écran, pas quand le téléchargement se termine : sur un
// téléphone, décoder l'image et la monter en texture prend encore une seconde.
router.post("/:code/armed", async (req, res) => {
  try {
    const index = Number(req.body?.index);
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "cue" || room.index !== index) return room;
      const round = curRound(room);
      const me = findPlayer(room, req.userId);
      if (!round || !me || me.leftAt) return room;
      const id = String(req.userId);
      if ((round.armed || []).some((x) => String(x) === id)) return room;
      round.armed.push(req.userId);
      touch(room);
      await room.save();
      await room.populate(POPULATE);

      // Le dernier vient d'atterrir : plus rien à attendre. Si le décompte
      // était déjà écoulé (on prolongeait), on laisse une seconde pour que
      // tout le monde voie le « ! » avant de partir.
      if (!notArmed(room).length) {
        const soon = Date.now() + 1000;
        if (room.phaseStartsAt < soon) {
          room.phaseStartsAt = soon;
          room.phaseEndsAt = soon + ROUND_MS;
          await room.save();
          await room.populate(POPULATE);
          schedule(room.code, room.phaseStartsAt, () => withRoom(room.code, beginRound));
        }
      }
      toEachRoom(room, "cue");
      return room;
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    res.json({ ok: true });
  } catch (err) {
    console.error("geoversus armed error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/ready — je suis prêt (ou plus).
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
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/mode — l'hôte règle la partie tant qu'elle n'a pas commencé.
router.post("/:code/mode", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "L'hôte règle la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (req.body?.mode) room.mode = req.body.mode === "buzzer" ? "buzzer" : "classic";
      if (req.body?.rounds != null)
        room.roundCount = Math.min(Math.max(Number(req.body.rounds) || DEFAULT_ROUNDS, 3), 12);
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId) });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/start — l'hôte lance. C'est ici que les lieux sont tirés.
router.post("/:code/start", async (req, res) => {
  try {
    bases.set(String(req.params.code), baseOf(req));
    // LA LISTE DE RECHERCHE D'ABORD, LE DÉCOMPTE ENSUITE. Elle passe par IGDB
    // (les gros jeux servant de leurres) et peut coûter plusieurs secondes au
    // tout premier lancement, avant que le cache ne la retienne. Or `startCue`
    // arme le chrono commun : la construire après, c'était brûler le sas de
    // chargement dans l'attente, et servir aux joueurs une manche dont le
    // « 3, 2, 1 » était déjà terminé.
    const { candidates } = await candidatesFor();
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "Seul l'hôte lance la partie.", status: 403 };
      if (room.startedAt) return { error: "La partie a déjà commencé.", status: 409 };
      if (activePlayers(room).length < 2)
        return { error: "Il faut être au moins deux pour un versus.", status: 422 };

      const { rounds } = await buildVersusRounds(room.roundCount);
      if (rounds.length < 3)
        return {
          error: "Le catalogue de lieux est trop petit pour lancer un versus.",
          status: 422,
        };
      room.rounds = rounds;
      room.roundCount = rounds.length;
      room.durationSec = Math.round(ROUND_MS / 1000);
      room.startedAt = new Date();
      for (const p of room.players) p.score = 0;
      await room.save();
      await room.populate(POPULATE);
      return { room: await startCue(room, 0) };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId), candidates });
  } catch (err) {
    console.error("geoversus start error:", err.message);
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
      // Ce que les autres voient : qu'on a trouvé, ou qu'on vient de perdre un
      // cœur, et combien il en reste. La SEULE chose retenue en classique est
      // le titre tapé — lui renseigne vraiment (« il a cru que c'était Zelda,
      // donc ça y ressemble »), alors qu'un cœur qui tombe ne fait que rendre
      // la course lisible. En buzzer, le nom part aussi : c'est le mode où l'on
      // voit tout.
      const found = round.attempts
        .filter((a) => a.correct)
        .map((a, i) => ({ userId: String(a.user), order: i + 1, atMs: a.atMs }));
      const common = {
        by: String(req.userId),
        correct,
        lives,
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
      };
      if (room.mode === "buzzer") {
        toRoom(room, "guess", { ...common, name });
      } else {
        // Classique : le TITRE proposé ne part qu'aux spectateurs (cf.
        // watcherIds). Les autres reçoivent le même évènement sans le nom —
        // ils voient un cœur tomber, pas la fausse piste qui l'a coûté.
        const eyes = watcherIds(room, round, null);
        const blind = playerIds(room).filter((id) => !eyes.includes(id));
        const env = { code: room.code, kind: "guess" };
        emitTo(eyes, "geoversus", { ...env, ...common, name });
        emitTo(blind, "geoversus", { ...env, ...common, name: null });
      }

      if (shouldEndEarly(room, round)) await endRound(room);
      return { correct, lives, settled: isSettled(round, req.userId) };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("geoversus guess error:", err.message);
    res.status(500).json({ error: "Réponse non enregistrée." });
  }
});

// POST /:code/next — « suivant », pendant la révélation.
// ---------------------------------------------------------------------------
// C'EST UN VOTE, PAS UN BOUTON. Le premier joueur à s'ennuyer n'a pas à
// escamoter la révélation de celui qui est encore en train de lire le nom du
// jeu : la manche suivante ne part en avance que quand TOUT LE MONDE a cliqué.
// À deux, c'est presque instantané ; à cinq, le décompte reste le filet.
router.post("/:code/next", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (room.phase !== "reveal") return { error: "Ce n'est pas le moment.", status: 409 };
      const me = String(req.userId);
      const ids = playerIds(room);
      if (!ids.includes(me)) return { error: "Tu ne joues pas ici.", status: 403 };

      const set = skipsOf(room.code);
      set.add(me);
      skips.set(room.code, set);
      const ready = ids.filter((id) => set.has(id));
      toRoom(room, "skip", { ready, total: ids.length });

      if (ready.length >= ids.length) return { room: await leaveReveal(room) };
      return { ok: true, ready: ready.length, total: ids.length };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ ok: true });
  } catch (err) {
    console.error("geoversus next error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/map — je plante mon épingle. La vérité n'est renvoyée qu'à la
// révélation : répondre « à 4 % » tout de suite laisserait deviner la zone.
router.post("/:code/map", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      const round = curRound(room);
      if (!round) return { error: "Manche introuvable.", status: 409 };
      // Deux moments légitimes : la phase carte commune du buzzer, et — en
      // classique — la manche elle-même, une fois le jeu trouvé.
      const inline = room.mode === "classic" && room.phase === "round";
      if (room.phase !== "map" && !inline)
        return { error: "Ce n'est pas le moment.", status: 409 };
      if (!round.mapImage || round.mapAnswerX == null)
        return { error: "Pas de carte sur cette manche.", status: 409 };
      if (!mapEligible(room, round).includes(String(req.userId)))
        return { error: "Pas sur cette manche.", status: 403 };

      const pin = clampPin(req.body);
      if (!pin) return { error: "Épingle invalide.", status: 400 };
      const me = String(req.userId);
      let mine = round.results.find((r) => String(r.user) === me);
      if (mine) {
        if (mine.mapX != null) return { error: "Épingle déjà posée.", status: 409 };
        mine.mapX = pin.x;
        mine.mapY = pin.y;
      } else {
        if (!inline) return { error: "Manche introuvable.", status: 409 };
        // En pleine manche, les résultats n'existent pas encore : on ouvre la
        // ligne du joueur juste pour y ranger l'épingle. `endRound` la
        // complétera (et prend soin de ne pas l'écraser, cf. `early`).
        // Tout le reste a une valeur par défaut au schéma : on n'écrit que ce
        // qu'on sait, pour ne pas figer ici des champs qu'`endRound` calcule.
        round.results.push({ user: req.userId, mapX: pin.x, mapY: pin.y });
        mine = round.results[round.results.length - 1];
      }
      touch(room);
      await room.save();
      await room.populate(POPULATE);

      toRoom(room, "pin", {
        by: me,
        pinned: round.results.filter((r) => r.mapX != null).map((r) => String(r.user)),
      });
      // Poser sa dernière épingle peut refermer la manche : en classique elle
      // était peut-être la seule chose qu'on attendait encore.
      if (inline) {
        if (shouldEndEarly(room, round)) await endRound(room);
      } else if (allPinned(room, round)) await endMap(room);
      return { ok: true };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error("geoversus map error:", err.message);
    res.status(500).json({ error: "Épingle non enregistrée." });
  }
});

// POST /:code/typing — ce que je suis en train de taper.
//
// BUZZER : tout le monde le voit, c'est le sel du mode — on sent une piste se
// former en face et on accélère.
// CLASSIQUE : les SPECTATEURS seulement (cf. watcherIds). Le mode repose sur le
// fait qu'on est seul dans sa tête tant qu'on cherche ; une fois sa manche
// finie, on rejoint le public et on a le droit de voir les autres ramer.
//
// Rien n'est écrit en base : c'est un geste, pas une donnée (même parti pris
// que le `burst` de la watchparty).
router.post("/:code/typing", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room || room.phase !== "round") return res.json({ ok: true });
    const me = String(req.userId);
    if (!playerIds(room).includes(me)) return res.json({ ok: true });
    const to =
      room.mode === "buzzer"
        ? playerIds(room).filter((id) => id !== me)
        : watcherIds(room, curRound(room), me);
    if (!to.length) return res.json({ ok: true });
    emitTo(to, "geoversus", {
      code: room.code,
      kind: "typing",
      by: me,
      text: String(req.body?.text || "").slice(0, 60),
    });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

// NOTE — il a existé ici un POST /:code/look qui diffusait l'orientation de la
// caméra de chacun, pour reconstituer « l'écran » des joueurs encore en course
// chez les spectateurs. L'idée tenait techniquement (le panorama étant commun,
// trois angles suffisaient à recadrer une vignette locale) mais elle saccadait :
// quatre annonces par seconde et par joueur, chacune redessinant un fond
// d'image, pour un décor qui n'apprend rien à personne. On a gardé le seul
// morceau qui se regardait vraiment — CE QU'ILS TAPENT — et supprimé le reste.

// POST /:code/again — l'hôte relance une manche… pardon, une PARTIE, avec les
// mêmes joueurs. On remet le salon à zéro plutôt que d'en ouvrir un autre :
// personne n'a à recliquer sur un lien.
router.post("/:code/again", async (req, res) => {
  try {
    const out = await withRoom(String(req.params.code), async (room) => {
      if (!isHost(room, req.userId))
        return { error: "Seul l'hôte relance.", status: 403 };
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
      toEachRoom(room, "lobby");
      return { room };
    });
    if (!out) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (out.error) return res.status(out.status || 400).json({ error: out.error });
    res.json({ room: serializeRoom(out.room, req.userId) });
  } catch (err) {
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  Inviter
// ============================================================
// Deux destinations d'un seul geste, comme le mot du jour : des personnes
// (carte en message privé) et des GROUPES de discussion (carte dans le fil
// commun). La règle d'écriture de la messagerie s'applique telle quelle — on
// n'écrit qu'à qui est abonné à soi. Pour les autres, il y a le lien.
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
      kind: "geo",
      code: room.code,
      mode: room.mode,
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
    console.error("geoversus invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /:code/card — l'état d'un salon en trois lignes, pour la carte
// d'invitation de la messagerie.
// ---------------------------------------------------------------------------
// Volontairement SÉPARÉ de `GET /:code` : cette carte est relue à chaque
// ouverture du fil, par des gens qui pour la plupart ne jouent pas ici, et
// `GET /:code` répondrait la manche en cours (l'image du panorama !) plus la
// liste de recherche complète. Ici on ne dit que ce qu'une invitation a besoin
// de dire — qui attend, et si ça vaut encore le coup de cliquer.
//
// Un salon disparu n'est PAS une erreur : c'est l'issue normale d'une carte
// qu'on relit trois jours plus tard. On répond « gone » avec un 200 pour que le
// client l'affiche au lieu de le traiter comme une panne.
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
      mode: room.mode,
      players: active.map((p) => person(p.user)),
      count: active.length,
      max: MAX_PLAYERS,
      rounds: room.roundCount,
      // La manche en cours, pour « manche 3/8 ». Le NUMÉRO ne dit rien du lieu :
      // aucun risque de renseigner quelqu'un qui joue en parallèle.
      index: room.index,
      // Déjà dans le salon : la carte redevient une porte d'entrée (le serveur
      // laisse revenir un joueur déjà inscrit, même partie lancée).
      mine: allIds(room).includes(String(req.userId)),
      winner: champ ? person(champ.user)?.username || null : null,
    });
  } catch (err) {
    console.error("geoversus card error:", err.message);
    res.json({ state: "gone" });
  }
});

// GET /api/geo/versus/:code/results — le tableau final, pour la carte du fil.
router.get("/:code/results", async (req, res) => {
  try {
    const room = await loadRoom(req.params.code);
    if (!room || !room.endedAt) return res.status(404).json({ error: "Partie introuvable." });
    const base = baseOf(req);
    const ranking = [...room.players]
      .sort(
        (a, b) => (b.score || 0) - (a.score || 0) || (b.correctCount || 0) - (a.correctCount || 0)
      )
      .map((p, i) => ({
        user: person(p.user),
        rank: i + 1,
        score: p.score || 0,
        correct: p.correctCount || 0,
      }));
    res.json({
      code: room.code,
      mode: room.mode,
      date: room.endedAt,
      ranking,
      rounds: room.rounds.map((r) => ({
        gameId: r.gameId,
        gameName: r.gameName,
        cover: r.cover,
        image: absolutize(base, r.image),
        difficulty: r.difficulty,
        winner: r.winner ? String(r.winner) : null,
        results: r.results.map((x) => ({
          userId: String(x.user),
          correct: x.correct,
          order: x.order,
          points: (x.points || 0) + (x.mapPoints || 0),
        })),
      })),
    });
  } catch (err) {
    console.error("geoversus results error:", err.message);
    res.status(500).json({ error: "Résultats illisibles." });
  }
});

export default router;
