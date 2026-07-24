import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import GeoGame from "../models/GeoGame.js";
import GeoSeen from "../models/GeoSeen.js";
import Panorama from "../models/Panorama.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
// Règles communes aux mini-jeux « devine le jeu » (cf. routes/blindtest.js).
import {
  IMG,
  person,
  sameGame,
  shuffle,
  getFamousPool,
  attachAltNames,
} from "./blindtest.js";

// ======================================================================
//  GeoGamer — devine le jeu depuis un panorama 360°
// ======================================================================
// On est lâché quelque part dans un monde de jeu. On ne peut pas se déplacer,
// seulement tourner la tête. Il faut nommer le jeu.
//
// Différence de fond avec le blind test et Pixel Rush : ces deux-là fabriquent
// leurs manches à la volée depuis la bibliothèque du joueur (IGDB fournit
// screenshots et OST pour n'importe quel titre). Ici, non : un panorama
// équirectangulaire, ça ne s'improvise pas. Les manches sont donc tirées d'un
// CATALOGUE en base (models/Panorama.js), rempli par un import hors ligne.
// Conséquence pratique : le pool est fini et bien plus petit qu'une
// bibliothèque, donc le tirage doit être plus tolérant (cf. buildRounds).
const router = express.Router();

// Une manche dure plus longtemps qu'à Pixel Rush : il faut le temps de charger
// une image lourde PUIS de faire un tour d'horizon complet. En dessous de ~40 s
// on ne joue plus, on subit.
const ROUND_SEC = 45;
const DEFAULT_ROUNDS = 10;

// Part de manches tirées dans les jeux que le joueur possède. Comme le
// catalogue est fini, c'est une CIBLE, pas une garantie : le remplissage
// complète avec l'autre catégorie quand la matière manque.
const OWNED_SHARE = 0.6;

// Les panoramas rapatriés sont stockés en chemin racine-relatif
// (« /uploads/panoramas/x.webp »). En production, Caddy sert l'API et /uploads
// sur le même domaine, donc ce relatif suffirait ; en développement le front
// tourne sur 5173 et l'API sur 4000, et le navigateur irait alors demander
// l'image à Vite, qui ne la connaît pas. On absolutise donc à la réponse,
// comme le font déjà routes/feed.js et routes/reposts.js pour les uploads.
//
// Le chemin relatif reste la valeur STOCKÉE, en base comme dans les parties
// enregistrées : changer de domaine ne doit pas périmer le catalogue.
const baseOf = (req) => `${req.protocol}://${req.get("host")}`;
const absolutize = (base, url) =>
  url && url.startsWith("/uploads/") ? `${base}${url}` : url;

// Ordre pondéré par la difficulté du lieu : on veut de la variété mais on
// préfère commencer doucement, donc les lieux faciles remontent légèrement.
// Le facteur reste petit — un lieu difficile doit rester tirable.
function difficultyOrder(list) {
  return list
    .map((p) => ({ p, k: Math.random() * (1 + (5 - (p.difficulty || 3)) * 0.15) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.p);
}

// La manche bonus n'est proposée que si TOUT est là : l'image, son point de
// réponse normalisé, et ses dimensions — ces dernières uniquement pour donner
// au conteneur d'affichage le bon ratio (cf. models/Panorama.js).
function mapOf(pano) {
  if (!pano.mapImage || pano.mapAnswerX == null || pano.mapAnswerY == null) return null;
  if (!pano.mapWidth || !pano.mapHeight) return null;
  return {
    image: pano.mapImage,
    width: pano.mapWidth,
    height: pano.mapHeight,
    answer: { x: pano.mapAnswerX, y: pano.mapAnswerY },
  };
}

function mkRound(pano, mine) {
  const owned = !!mine;
  return {
    gameId: pano.gameId,
    gameName: pano.gameName,
    cover: pano.cover || null,
    panorama: pano._id,
    image: pano.image,
    difficulty: pano.difficulty || 3,
    map: mapOf(pano),
    owned,
    playtimeHours: owned ? mine.playtimeHours ?? null : null,
    rating: owned ? mine.rating ?? null : null,
  };
}

// Score de la manche carte. Tout se joue en FRACTIONS de la carte, donc la
// mesure ne dépend ni des dimensions du fichier ni de la taille d'écran.
//
// Le barème est celui de la source, relevé tel quel dans son geogamer.js : il a
// le mérite d'être déjà éprouvé. Ses paliers sont exprimés dans le repère de
// 2100 unités, d'où la remise à l'échelle avant application ; le résultat est
// ensuite multiplié par 4 pour culminer à 400 et non à 100, à la mesure des
// autres manches. Repères : pile dessus = 400, à 2 % de la carte = 400,
// à 7 % = 340, à 14 % = 260, à 24 % = 160, à 38 % = 60.
const MAP_FRAME = 2100;

function mapCurve(d) {
  if (d <= 50) return 100;
  if (d <= 150) return Math.round(100 - 0.15 * (d - 50));
  if (d <= 300) return Math.round(85 - 0.133 * (d - 150));
  if (d <= 500) return Math.round(65 - 0.125 * (d - 300));
  if (d <= 800) return Math.round(40 - 0.083 * (d - 500));
  return Math.max(0, Math.round(15 - 0.015 * (d - 800)));
}

function scoreMapGuess(map, guess) {
  if (!map || !guess) return { points: 0, distance: null };
  // 0 = pile dessus, ~1,41 = d'un coin à l'autre.
  const distance = Math.hypot(guess.x - map.answer.x, guess.y - map.answer.y);
  return { points: mapCurve(distance * MAP_FRAME) * 4, distance };
}

// Nettoie le clic reçu du client : une fraction, donc forcément dans [0,1].
function sanitizeMapGuess(map, raw) {
  if (!map || !raw) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(Math.max(x, 0), 1), y: Math.min(Math.max(y, 0), 1) };
}

// Combien de lieux récents on regarde pour éviter de reproposer le même jeu à
// quelques parties d'intervalle (« pas deux fois de suite »).
const RECENT_LOOKBACK = 15;

// Volet social : pour chaque lieu d'une partie, combien des joueurs suivis
// l'ont déjà vu, et combien l'ont trouvé. Ne renvoie une entrée QUE si au
// moins un ami est déjà tombé dessus — le client n'affiche rien sinon.
async function friendStatsFor(userId, panoramaIds, friendIds) {
  if (!friendIds.length || !panoramaIds.length) return new Map();
  const rows = await GeoSeen.aggregate([
    { $match: { panorama: { $in: panoramaIds }, user: { $in: friendIds } } },
    {
      $group: {
        _id: "$panorama",
        seen: { $sum: 1 },
        found: { $sum: { $cond: ["$correct", 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { seen: r.seen, found: r.found }]));
}

// Construit un set de manches + la liste des jeux proposables à la recherche.
//
// Deux règles nouvelles gouvernent le tirage :
//   • chaque lieu n'est vu QU'UNE FOIS par un joueur (models/GeoSeen.js) : on
//     exclut donc tout ce qu'il a déjà traversé, et on signale l'épuisement
//     quand il a fait le tour ;
//   • jamais le même jeu à deux ou trois parties d'intervalle : on écarte
//     mollement les jeux vus tout récemment, tant qu'il reste de la matière.
async function buildRounds(userId, count, friendIds = []) {
  const [played, seen, recent, catalog] = await Promise.all([
    UserGame.find({ user: userId, status: { $ne: "wishlist" } })
      .select("gameId name cover playtimeHours rating")
      .lean(),
    GeoSeen.find({ user: userId }).select("panorama").lean(),
    GeoSeen.find({ user: userId })
      .select("gameId")
      .sort({ createdAt: -1 })
      .limit(RECENT_LOOKBACK)
      .lean(),
    // Tout le catalogue jouable. Il tient largement en mémoire (quelques
    // milliers de documents au plus) et on a de toute façon besoin de la liste
    // complète pour la recherche : autant ne faire qu'un aller-retour.
    Panorama.find({ active: true, gameId: { $ne: null } })
      .select(
        "gameId gameName cover image difficulty mapImage mapAnswerX mapAnswerY mapWidth mapHeight"
      )
      .lean(),
  ]);

  const mineById = new Map(played.map((g) => [g.gameId, g]));
  const seenIds = new Set(seen.map((s) => String(s.panorama)));
  const recentGames = new Set(recent.map((r) => r.gameId).filter((g) => g != null));

  // Uniquement les lieux JAMAIS vus par ce joueur.
  const fresh = catalog.filter((p) => !seenIds.has(String(p._id)));
  if (!fresh.length) {
    // Le catalogue de recherche reste utile même à vide (l'écran d'épuisement
    // n'en a pas besoin, mais on garde le contrat de retour cohérent).
    return { rounds: [], candidates: [], exhausted: true };
  }

  // Un lieu inédit au hasard par jeu : jamais deux fois le même jeu DANS une
  // partie, et pas toujours le même recoin d'un jeu d'une partie à l'autre.
  const byGame = new Map();
  for (const p of fresh) {
    if (!byGame.has(p.gameId)) byGame.set(p.gameId, []);
    byGame.get(p.gameId).push(p);
  }
  const oneEach = [...byGame.values()].map(
    (list) => list[Math.floor(Math.random() * list.length)]
  );

  // On écarte les jeux vus tout récemment — mais mollement : si les retirer ne
  // laisse plus assez de matière pour une partie, on les réintègre plutôt que
  // de servir une partie tronquée.
  const notRecent = oneEach.filter((p) => !recentGames.has(p.gameId));
  const pool = notRecent.length >= count ? notRecent : oneEach;

  const ownedPool = difficultyOrder(pool.filter((p) => mineById.has(p.gameId)));
  const foreignPool = difficultyOrder(pool.filter((p) => !mineById.has(p.gameId)));

  const ownedTarget = ownedPool.length ? Math.round(count * OWNED_SHARE) : 0;
  const chosen = [
    ...ownedPool.slice(0, ownedTarget),
    ...foreignPool.slice(0, count - ownedTarget),
  ];
  // Une catégorie a manqué de matière : on complète avec le reste de l'autre.
  if (chosen.length < count) {
    const used = new Set(chosen.map((p) => p.gameId));
    for (const p of [...ownedPool, ...foreignPool]) {
      if (chosen.length >= count) break;
      if (used.has(p.gameId)) continue;
      used.add(p.gameId);
      chosen.push(p);
    }
  }

  // Volet social sur les lieux réellement retenus.
  const stats = await friendStatsFor(
    userId,
    chosen.map((p) => p._id),
    friendIds
  );
  const rounds = shuffle(
    chosen.map((p) => {
      const r = mkRound(p, mineById.get(p.gameId) || null);
      r.friends = stats.get(String(p._id)) || null;
      return r;
    })
  );

  // Liste proposable à la recherche. La règle absolue : TOUTES les réponses
  // possibles doivent y être, sinon une manche devient injouable. On y ajoute
  // la bibliothèque et les gros jeux comme leurres crédibles.
  const candMap = new Map();
  const addCand = (id, name, cover) => {
    if (!id || candMap.has(id)) return;
    candMap.set(id, { id, name, cover: cover || null });
  };
  for (const p of catalog) addCand(p.gameId, p.gameName, p.cover);
  for (const g of played) addCand(g.gameId, g.name, g.cover || null);
  for (const g of await getFamousPool()) addCand(g.id, g.name, g.cover);
  const candidates = await attachAltNames([...candMap.values()]);

  return { rounds, candidates, exhausted: false };
}

// Marque les lieux d'une partie terminée comme « vus » par le joueur, avec le
// verdict (trouvé ou non). Idempotent grâce à l'index unique (user, panorama) :
// rejouer un défi ne crée pas de doublon, il met à jour le verdict.
async function markSeen(userId, rounds) {
  const ops = rounds
    .filter((r) => r.panorama)
    .map((r) => ({
      updateOne: {
        filter: { user: userId, panorama: r.panorama },
        update: {
          $set: { gameId: r.gameId, correct: !!r.correct },
          $setOnInsert: { user: userId, panorama: r.panorama },
        },
        upsert: true,
      },
    }));
  if (ops.length) await GeoSeen.bulkWrite(ops, { ordered: false });
}

// La liste des joueurs suivis (les « amis » du volet social).
async function friendsOf(userId) {
  const me = await User.findById(userId).select("following").lean();
  return (me?.following || []).map((id) => new mongoose.Types.ObjectId(id));
}

// Score d'une manche (serveur). Deux principes voulus par le jeu :
//   • on ne PERD JAMAIS de points : rater un jeu rapporte simplement 0, pas de
//     pénalité — l'exploration doit rester détendue ;
//   • trouver le jeu rapporte un lot de base, plus vite = un peu plus, et un
//     lieu difficile (un recoin obscur) vaut davantage qu'une place centrale.
// La précision sur la carte, elle, est un bonus À PART (cf. scoreMapGuess).
function scoreRound(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  if (!correct) return 0; // aucune sanction pour une mauvaise réponse

  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0; // 1 = instantané, 0 = à la fin
  // 0 pour un lieu évident (1), 1 pour un cauchemar (5).
  const hard = (Math.min(Math.max(r.difficulty || 3, 1), 5) - 1) / 4;

  // Base 300, jusqu'à +300 pour la vitesse, jusqu'à +200 pour la difficulté.
  return 300 + Math.round(300 * frac) + Math.round(200 * hard);
}

// --- Sessions en cours (réponses gardées serveur). Mémoire process, TTL 30 min. ---
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
function gcSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}

// Manches envoyées au client. Comme les deux autres jeux, on inclut la réponse :
// le client révèle la solution dès la fin de la manche et affiche des points
// « en direct ». Le score officiel reste recalculé au /finish depuis la session.
function publicRounds(rounds, durationSec, base = "") {
  return rounds.map((r, i) => ({
    id: i,
    image: absolutize(base, r.image),
    difficulty: r.difficulty,
    // La carte part AVEC son point de réponse, dans la même logique que le nom
    // du jeu ci-dessous : le client affiche la distance et les points dès le
    // clic, sans aller-retour. Le serveur recalcule tout au /finish depuis la
    // session — le client ne fait que refléter.
    map: r.map
      ? {
          image: absolutize(base, r.map.image),
          width: r.map.width,
          height: r.map.height,
          answer: r.map.answer,
        }
      : null,
    durationSec,
    gameId: r.gameId,
    gameName: r.gameName,
    cover: r.cover || null,
    owned: !!r.owned,
    playtimeHours: r.playtimeHours ?? null,
    rating: r.rating ?? null,
    // Volet social : présent seulement si au moins un ami est déjà tombé sur
    // ce lieu. Le client n'affiche rien quand c'est absent.
    friends: r.friends || null,
  }));
}

// POST /api/geo/start — démarre une partie fraîche.
router.post("/start", requireAuth, async (req, res) => {
  try {
    gcSessions();
    const count = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 5), 15);
    const friendIds = await friendsOf(req.userId);
    const { rounds, candidates, exhausted } = await buildRounds(req.userId, count, friendIds);
    if (exhausted) {
      // Le joueur a fait le tour de TOUT le catalogue : il n'a plus de lieu
      // inédit. Code dédié pour que le client affiche l'écran « reviens plus
      // tard » plutôt qu'une erreur générique.
      return res.status(409).json({
        code: "EXHAUSTED",
        error:
          "Tu as exploré tous les lieux disponibles ! Reviens bientôt : de nouveaux panoramas sont ajoutés régulièrement.",
      });
    }
    if (rounds.length < 3) {
      return res.status(422).json({
        error:
          "Le catalogue de lieux est encore trop petit pour lancer une partie. Reviens quand d'autres panoramas auront été ajoutés.",
      });
    }
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      durationSec: ROUND_SEC,
      rounds,
      challengeOf: null,
      challengedUser: null,
      challengedScore: null,
      challengedUsername: null,
      createdAt: Date.now(),
    });
    res.json({
      sessionId,
      durationSec: ROUND_SEC,
      rounds: publicRounds(rounds, ROUND_SEC, baseOf(req)),
      candidates,
      challenge: null,
    });
  } catch (err) {
    console.error("geo start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// GET /api/geo/challenge/:id — rejoue les MÊMES lieux qu'une partie d'un pote.
router.get("/challenge/:id", requireAuth, async (req, res) => {
  try {
    gcSessions();
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Défi introuvable." });
    const orig = await GeoGame.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!orig || !orig.rounds?.length)
      return res.status(404).json({ error: "Défi introuvable." });

    // Mêmes lieux, mais la difficulté (owned/heures/note) est recalculée pour
    // CE joueur : un jeu que l'auteur connaissait par cœur peut m'être inconnu.
    const gameIds = orig.rounds.map((r) => r.gameId);
    const mine = await UserGame.find({ user: req.userId, gameId: { $in: gameIds } })
      .select("gameId playtimeHours rating status")
      .lean();
    const mineById = new Map(mine.map((e) => [e.gameId, e]));

    const rounds = orig.rounds.map((r) => {
      const e = mineById.get(r.gameId);
      const owned = !!e && e.status !== "wishlist";
      return {
        gameId: r.gameId,
        gameName: r.gameName,
        cover: r.cover || null,
        panorama: r.panorama || null,
        image: r.image,
        difficulty: r.difficulty || 3,
        // Le défi rejoue les MÊMES lieux, donc les mêmes cartes : on les
        // reconstruit depuis la partie enregistrée plutôt que depuis le
        // catalogue, qui a pu bouger entre-temps.
        map:
          r.mapImage && r.mapWidth && r.mapHeight && r.mapAnswerX != null
            ? {
                image: r.mapImage,
                width: r.mapWidth,
                height: r.mapHeight,
                answer: { x: r.mapAnswerX, y: r.mapAnswerY },
              }
            : null,
        owned,
        playtimeHours: owned ? e.playtimeHours ?? null : null,
        rating: owned ? e.rating ?? null : null,
      };
    });

    // Même règle qu'au démarrage : toutes les réponses doivent être trouvables
    // dans la recherche, plus des leurres.
    const [played, famous, catalog] = await Promise.all([
      UserGame.find({ user: req.userId, status: { $ne: "wishlist" } })
        .select("gameId name cover")
        .lean(),
      getFamousPool(),
      Panorama.find({ active: true, gameId: { $ne: null } })
        .select("gameId gameName cover")
        .lean(),
    ]);
    const candMap = new Map();
    const addCand = (id, name, cover) => {
      if (!id || candMap.has(id)) return;
      candMap.set(id, { id, name, cover: cover || null });
    };
    for (const r of rounds) addCand(r.gameId, r.gameName, r.cover);
    for (const p of catalog) addCand(p.gameId, p.gameName, p.cover);
    for (const g of played) addCand(g.gameId, g.name, g.cover || null);
    for (const g of famous) addCand(g.id, g.name, g.cover);
    const candidates = await attachAltNames([...candMap.values()]);

    // Volet social : même traitement qu'une partie normale.
    const friendIds = await friendsOf(req.userId);
    const stats = await friendStatsFor(
      req.userId,
      rounds.map((r) => r.panorama).filter(Boolean),
      friendIds
    );
    for (const r of rounds) r.friends = r.panorama ? stats.get(String(r.panorama)) || null : null;

    const dur = orig.durationSec || ROUND_SEC;
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      durationSec: dur,
      rounds,
      challengeOf: String(orig._id),
      challengedUser: String(orig.user?._id || ""),
      challengedScore: orig.score,
      challengedUsername: orig.user?.username || "",
      createdAt: Date.now(),
    });

    res.json({
      sessionId,
      durationSec: dur,
      rounds: publicRounds(rounds, dur, baseOf(req)),
      candidates,
      challenge: {
        user: person(orig.user),
        score: orig.score,
        correct: orig.correctCount,
        total: orig.roundCount,
      },
    });
  } catch (err) {
    console.error("geo challenge error:", err.message);
    res.status(500).json({ error: "Impossible de charger le défi." });
  }
});

// POST /api/geo/finish — corrige, enregistre, crédite les points.
router.post("/finish", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session || session.userId !== String(req.userId))
      return res.status(404).json({ error: "Partie expirée. Relance une partie." });

    const guesses = Array.isArray(req.body?.guesses) ? req.body.guesses : [];
    const byId = new Map(
      guesses.map((g) => [Number(g.id), g]).filter(([id]) => Number.isInteger(id))
    );

    const dur = session.durationSec;
    let score = 0;
    let correctCount = 0;
    const rounds = session.rounds.map((r, i) => {
      const g = byId.get(i) || {};
      const guessId = g.gameId != null ? Number(g.gameId) : null;
      const guessName = String(g.name || "").slice(0, 160);
      const timeMs = g.timeMs != null ? Number(g.timeMs) : null;
      const correct = sameGame(r, guessId, guessName);
      const points = scoreRound(r, guessId, guessName, timeMs, dur);
      score += points;
      if (correct) correctCount += 1;

      // Manche carte : elle n'est proposée QUE si le jeu a été trouvé, donc un
      // clic envoyé sur une manche ratée est ignoré. C'est une récompense, pas
      // une session de rattrapage.
      const mapGuess = correct ? sanitizeMapGuess(r.map, g.mapGuess) : null;
      const { points: mapPoints, distance: mapDistance } = scoreMapGuess(r.map, mapGuess);
      score += mapPoints;

      return {
        gameId: r.gameId,
        gameName: r.gameName,
        cover: r.cover || null,
        panorama: r.panorama || null,
        image: r.image,
        difficulty: r.difficulty || 3,
        owned: !!r.owned,
        playtimeHours: r.playtimeHours ?? null,
        rating: r.rating ?? null,
        guessedGameId: guessId,
        guessedName: guessName,
        correct,
        timeMs,
        points,
        mapImage: r.map?.image || null,
        mapWidth: r.map?.width ?? null,
        mapHeight: r.map?.height ?? null,
        mapAnswerX: r.map?.answer.x ?? null,
        mapAnswerY: r.map?.answer.y ?? null,
        mapGuessX: mapGuess?.x ?? null,
        mapGuessY: mapGuess?.y ?? null,
        mapDistance,
        mapPoints,
      };
    });
    score = Math.max(0, score); // pas de score négatif affiché

    const doc = await GeoGame.create({
      user: req.userId,
      score,
      roundCount: rounds.length,
      correctCount,
      durationSec: dur,
      challengeOf: session.challengeOf || null,
      challengedUser: session.challengedUser || null,
      challengedScore: session.challengedScore ?? null,
      rounds,
    });
    sessions.delete(sessionId);

    // Mémorise le parcours : ces lieux ne seront plus reproposés à ce joueur,
    // et le verdict (trouvé ou non) alimente le volet social des autres.
    // Best-effort — le score reste valide si l'écriture échoue.
    markSeen(req.userId, rounds).catch((e) =>
      console.error("geo markSeen error:", e.message)
    );

    // Le score devient des points dépensables à l'arcade (1 pour 1), comme les
    // deux autres jeux. Best-effort : la partie reste valide si le crédit rate.
    const balance = await grantPoints(req.userId, score, "geo", {
      geoGameId: String(doc._id),
      correct: correctCount,
      total: rounds.length,
    });

    recordActivity({
      actor: req.userId,
      type: "geo",
      meta: {
        geoGameId: String(doc._id),
        score,
        correct: correctCount,
        total: rounds.length,
        challenge: session.challengedUser
          ? {
              username: session.challengedUsername || "",
              score: session.challengedScore ?? null,
              beaten: score > (session.challengedScore ?? 0),
            }
          : null,
      },
    });

    triggerMissionCheck(req.userId);

    res.json({
      geoGameId: String(doc._id),
      score,
      correctCount,
      roundCount: rounds.length,
      durationSec: dur,
      pointsEarned: balance != null ? score : null,
      points: balance,
      challenge: session.challengedUser
        ? {
            username: session.challengedUsername || "",
            score: session.challengedScore ?? null,
            beaten: score > (session.challengedScore ?? 0),
          }
        : null,
      rounds: rounds.map((r) => ({
        gameId: r.gameId,
        gameName: r.gameName,
        cover: r.cover,
        image: absolutize(baseOf(req), r.image),
        difficulty: r.difficulty,
        owned: r.owned,
        correct: r.correct,
        guessedName: r.guessedName,
        points: r.points,
        timeMs: r.timeMs,
        map: r.mapImage
          ? {
              image: absolutize(baseOf(req), r.mapImage),
              width: r.mapWidth,
              height: r.mapHeight,
              answer: { x: r.mapAnswerX, y: r.mapAnswerY },
              guess: r.mapGuessX != null ? { x: r.mapGuessX, y: r.mapGuessY } : null,
              distance: r.mapDistance,
              points: r.mapPoints,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("geo finish error:", err.message);
    res.status(500).json({ error: "Impossible d'enregistrer le score." });
  }
});

// GET /api/geo/:id/results — le détail d'une partie terminée, pour la modale
// « Voir les résultats » du fil. Pour les manches ratées, on joint la jaquette
// du jeu répondu (IGDB, best-effort).
router.get("/:id/results", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Partie introuvable." });
    const doc = await GeoGame.findById(req.params.id)
      .populate("user", "username avatar")
      .populate("challengedUser", "username avatar")
      .lean();
    if (!doc) return res.status(404).json({ error: "Partie introuvable." });

    const wrongIds = [
      ...new Set(
        (doc.rounds || [])
          .filter((r) => !r.correct && r.guessedGameId != null && r.guessedGameId !== r.gameId)
          .map((r) => r.guessedGameId)
      ),
    ];
    let guessCovers = new Map();
    if (wrongIds.length) {
      try {
        const raw = await igdbQuery(
          "games",
          `fields name,cover.image_id; where id = (${wrongIds.join(",")}); limit ${wrongIds.length};`
        );
        guessCovers = new Map(
          raw.map((g) => [
            g.id,
            g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
          ])
        );
      } catch {
        /* pas de jaquette, tant pis */
      }
    }

    res.json({
      id: String(doc._id),
      user: person(doc.user),
      score: doc.score,
      correctCount: doc.correctCount,
      roundCount: doc.roundCount,
      durationSec: doc.durationSec,
      date: doc.createdAt,
      challenge: doc.challengedUser
        ? {
            user: person(doc.challengedUser),
            score: doc.challengedScore ?? null,
            beaten: doc.score > (doc.challengedScore ?? 0),
          }
        : null,
      rounds: (doc.rounds || []).map((r) => {
        const wrongGuess =
          !r.correct && r.guessedGameId != null && r.guessedGameId !== r.gameId;
        return {
          gameId: r.gameId,
          gameName: r.gameName,
          cover: r.cover || null,
          image: absolutize(baseOf(req), r.image),
          difficulty: r.difficulty || 3,
          owned: !!r.owned,
          correct: !!r.correct,
          guessedName: r.guessedName || "",
          points: r.points || 0,
          timeMs: r.timeMs ?? null,
          map: r.mapImage
            ? {
                image: absolutize(baseOf(req), r.mapImage),
                width: r.mapWidth,
                height: r.mapHeight,
                answer: { x: r.mapAnswerX, y: r.mapAnswerY },
                guess: r.mapGuessX != null ? { x: r.mapGuessX, y: r.mapGuessY } : null,
                distance: r.mapDistance,
                points: r.mapPoints || 0,
              }
            : null,
          guessed: wrongGuess
            ? {
                gameId: r.guessedGameId,
                name: r.guessedName || "",
                cover: guessCovers.get(r.guessedGameId) || null,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("geo results error:", err.message);
    res.status(500).json({ error: "Impossible de charger les résultats." });
  }
});

// GET /api/geo/leaderboard — même contrat que /blindtest et /pixel : une ligne
// par joueur (moi + mes suivis) avec `bestScore` (record) et `score` (cumul),
// pour que le widget de l'arcade bascule sans savoir de quel jeu il parle.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await GeoGame.aggregate([
      { $match: { user: { $in: ids } } },
      { $sort: { createdAt: -1 } }, // récent d'abord → $first = dernière partie
      {
        $group: {
          _id: "$user",
          score: { $sum: "$score" },
          games: { $sum: 1 },
          gameDocId: { $first: "$_id" }, // la partie la plus récente (défi)
          bestScore: { $max: "$score" },
          correctCount: { $sum: "$correctCount" },
          roundCount: { $sum: "$roundCount" },
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
          geoGameId: String(r.gameDocId), // cible du bouton « Défier »
          correct: r.correctCount,
          total: r.roundCount,
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("geo leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

export default router;
