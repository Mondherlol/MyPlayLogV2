import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import PixelGame from "../models/PixelGame.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
// Règles communes aux mini-jeux « devine le jeu » (cf. routes/blindtest.js) :
// comparaison de titres, pool de gros jeux, indices, noms alternatifs.
import {
  IMG,
  person,
  sameGame,
  shuffle,
  weightedOrder,
  getFamousPool,
  attachAltNames,
  hintsForGames,
} from "./blindtest.js";

// Pixel Rush : on montre les captures d'écran d'un jeu, ÉNORMÉMENT pixelisées,
// et le joueur devine de quel jeu il s'agit. Toutes les captures de la manche
// sont visibles d'emblée (grille 2×2) ; le temps qui passe fait juste remonter
// un peu leur définition — sans jamais les rendre lisibles — et coûte des
// points. L'image nette n'apparaît qu'à la révélation.
//
// Le pixel est appliqué CÔTÉ CLIENT (canvas) : le serveur envoie des URLs
// IGDB standard. C'est assumé — comme pour le blind test, la triche par
// devtools est possible et sans intérêt entre amis (cf. publicRounds).
const router = express.Router();

const ROUND_SEC = 15; // durée d'une manche
const DEFAULT_ROUNDS = 10;
const SHOTS_PER_ROUND = 4;

// Screenshots d'un lot de jeux → Map(gameId → [urls]). Un seul aller-retour
// IGDB par tranche de 300 jeux ; les jeux sans screenshot sont simplement
// absents de la Map (ils ne feront pas de manche).
async function shotsForGames(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  const map = new Map();
  if (!list.length) return map;
  try {
    for (let i = 0; i < list.length; i += 300) {
      const chunk = list.slice(i, i + 300);
      const raw = await igdbQuery(
        "games",
        `fields screenshots.image_id; where id = (${chunk.join(",")}); limit ${chunk.length};`
      );
      for (const g of raw) {
        const urls = (g.screenshots || [])
          .map((s) => s.image_id)
          .filter(Boolean)
          // t_screenshot_big (889×500) : assez net pour la révélation, assez
          // léger pour en charger une quarantaine par partie.
          .map((id) => `${IMG}/t_screenshot_big/${id}.jpg`);
        if (urls.length) map.set(g.id, urls);
      }
    }
  } catch (err) {
    console.error("pixel shots error:", err.message);
  }
  return map;
}

function mkRound(g, shots, owned) {
  return {
    gameId: g.gameId,
    gameName: g.name,
    cover: g.cover || null,
    shots: shuffle([...shots]).slice(0, SHOTS_PER_ROUND),
    owned,
    playtimeHours: g.playtimeHours ?? null,
    rating: g.rating ?? null,
  };
}

// Construit un set de manches + la liste des jeux proposables à la recherche.
// ~75 % de jeux joués, ~25 % de gros jeux non joués (mêmes proportions que le
// blind test). On interroge IGDB avec BEAUCOUP plus de jeux que nécessaire :
// tous n'ont pas de screenshots, et une seule requête sert tout le monde.
async function buildRounds(userId, count) {
  const played = await UserGame.find({ user: userId, status: { $ne: "wishlist" } })
    .select("gameId name cover playtimeHours rating")
    .lean();
  const playedGames = played.map((g) => ({
    gameId: g.gameId,
    name: g.name,
    cover: g.cover || null,
    playtimeHours: g.playtimeHours ?? null,
    rating: g.rating ?? null,
  }));
  const ownedIds = playedGames.map((g) => g.gameId);

  const foreignTarget = ownedIds.length ? Math.max(1, Math.round(count * 0.25)) : count;
  const ownedTarget = count - foreignTarget;

  const famous = await getFamousPool();
  const ownedSet = new Set(ownedIds);
  const foreignPool = shuffle(famous.filter((g) => !ownedSet.has(g.id))).map((g) => ({
    gameId: g.id,
    name: g.name,
    cover: g.cover,
    playtimeHours: null,
    rating: null,
  }));

  // Ordre pondéré par le temps de jeu : un peu plus souvent les jeux que le
  // joueur a le plus pratiqués, tout en gardant de la variété.
  const ownedPick = weightedOrder(playedGames).slice(0, ownedTarget * 4 + 10);
  const foreignPick = foreignPool.slice(0, foreignTarget * 4 + 10);
  const shotMap = await shotsForGames(
    [...ownedPick, ...foreignPick].map((g) => g.gameId)
  );

  const take = (pool, target, owned) => {
    const out = [];
    for (const g of pool) {
      if (out.length >= target) break;
      const shots = shotMap.get(g.gameId);
      if (!shots?.length) continue;
      out.push(mkRound(g, shots, owned));
    }
    return out;
  };

  const ownedRounds = take(ownedPick, ownedTarget, true);
  const foreignRounds = take(foreignPick, foreignTarget, false);

  // Si une catégorie a manqué de matière, on complète avec l'autre.
  let rounds = [...ownedRounds, ...foreignRounds];
  if (rounds.length < count) {
    const used = new Set(rounds.map((r) => r.gameId));
    rounds.push(
      ...take(
        foreignPick.filter((g) => !used.has(g.gameId)),
        count - rounds.length,
        false
      )
    );
  }
  if (rounds.length < count) {
    const used = new Set(rounds.map((r) => r.gameId));
    rounds.push(
      ...take(
        ownedPick.filter((g) => !used.has(g.gameId)),
        count - rounds.length,
        true
      )
    );
  }
  rounds = shuffle(rounds).slice(0, count);

  // Liste proposable à la recherche : toutes les réponses possibles + décors.
  const candMap = new Map();
  const addCand = (id, name, cover) => {
    if (!id || candMap.has(id)) return;
    candMap.set(id, { id, name, cover: cover || null });
  };
  for (const g of playedGames) addCand(g.gameId, g.name, g.cover);
  for (const g of foreignPool) addCand(g.gameId, g.name, g.cover);
  for (const r of rounds) addCand(r.gameId, r.gameName, r.cover); // filet de sécurité
  const candidates = await attachAltNames([...candMap.values()]);

  return { rounds, candidates };
}

// Score d'une manche (serveur) — MÊME formule que le blind test, pour que les
// deux jeux se valent au classement et à la cagnotte. Rapide = plus de points ;
// un jeu jamais joué deviné rapporte gros ; ne PAS reconnaître un jeu qu'on
// adore (beaucoup d'heures / grosse note) coûte davantage.
function scoreRound(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0; // 1 = instantané, 0 = à la fin
  const fam = r.owned
    ? Math.max(
        Math.min((r.playtimeHours || 0) / 40, 1),
        r.rating != null ? Math.max(0, (r.rating - 60) / 40) : 0
      )
    : 0;

  if (correct) {
    let pts = 200 + Math.round(600 * frac);
    if (!r.owned) pts += 250 + Math.round(150 * frac);
    else pts += Math.round(120 * fam);
    return pts;
  }
  if (r.owned) return -Math.round(60 + 240 * fam);
  return -40;
}

// --- Sessions en cours (réponses gardées serveur). Mémoire process, TTL 30 min. ---
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
function gcSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}

// Manches envoyées au client. Comme pour le blind test, on inclut la réponse :
// le client révèle la solution après chaque manche et affiche des points « en
// direct » avec la même formule. Le score officiel reste recalculé au /finish
// à partir de la session — le client ne fait que refléter.
function publicRounds(rounds, durationSec, hintMap = new Map()) {
  return rounds.map((r, i) => ({
    id: i,
    shots: r.shots,
    durationSec,
    gameId: r.gameId,
    gameName: r.gameName,
    cover: r.cover || null,
    owned: !!r.owned,
    playtimeHours: r.playtimeHours ?? null,
    rating: r.rating ?? null,
    hints: hintMap.get(r.gameId) || null,
  }));
}

// Quelques jaquettes de la bibliothèque du joueur, pour illustrer les
// mini-jeux avec SES jeux : la carte d'accueil de Pixel Rush les montre
// pixelisées, les cartes de l'arcade les glissent dans une pochette ou les
// pixelisent aussi. Les favoris d'abord, puis les mieux notés / les plus
// joués, et à défaut le pool de gros jeux (bibliothèque vide au premier
// lancement).
//
// Purement DÉCORATIF : jamais bloquant, on renvoie une liste vide en cas de
// pépin et l'appelant retombe sur son icône.
export async function userCovers(userId, limit = 6) {
  try {
    const pick = (list) =>
      list
        .filter((g) => g.cover && g.gameId)
        .map((g) => ({ gameId: g.gameId, name: g.name, cover: g.cover }));

    let pool = pick(
      await UserGame.find({ user: userId, favorite: true })
        .select("gameId name cover")
        .lean()
    );
    if (pool.length < 3) {
      const seen = new Set(pool.map((g) => g.gameId));
      const more = pick(
        await UserGame.find({ user: userId, status: { $ne: "wishlist" } })
          .select("gameId name cover rating playtimeHours")
          .sort({ rating: -1, playtimeHours: -1 })
          .limit(20)
          .lean()
      );
      pool = [...pool, ...more.filter((g) => !seen.has(g.gameId))];
    }
    if (!pool.length) {
      const famous = await getFamousPool();
      pool = pick(famous.map((g) => ({ gameId: g.id, name: g.name, cover: g.cover })));
    }
    return shuffle(pool).slice(0, limit);
  } catch (err) {
    console.error("covers error:", err.message);
    return [];
  }
}

// GET /api/pixel/covers — les jaquettes de la carte d'accueil du jeu.
router.get("/covers", requireAuth, async (req, res) => {
  res.json({ games: await userCovers(req.userId) });
});

// POST /api/pixel/start — démarre une partie fraîche.
router.post("/start", requireAuth, async (req, res) => {
  try {
    gcSessions();
    const count = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 5), 15);
    const { rounds, candidates } = await buildRounds(req.userId, count);
    if (rounds.length < 3) {
      return res.status(422).json({
        error:
          "Pas assez de captures d'écran pour lancer une partie. Ajoute quelques jeux à ta bibliothèque, puis réessaie.",
      });
    }
    const hintMap = await hintsForGames(rounds.map((r) => r.gameId));
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
      rounds: publicRounds(rounds, ROUND_SEC, hintMap),
      candidates,
      challenge: null,
    });
  } catch (err) {
    console.error("pixel start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// GET /api/pixel/challenge/:id — rejoue le MÊME set qu'une partie d'un pote.
router.get("/challenge/:id", requireAuth, async (req, res) => {
  try {
    gcSessions();
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Défi introuvable." });
    const orig = await PixelGame.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!orig || !orig.rounds?.length)
      return res.status(404).json({ error: "Défi introuvable." });

    // Mêmes images, mais la difficulté (owned/heures/note) est recalculée pour
    // CE joueur : un jeu que l'auteur adorait peut m'être inconnu.
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
        shots: r.shots || [],
        owned,
        playtimeHours: owned ? e.playtimeHours ?? null : null,
        rating: owned ? e.rating ?? null : null,
      };
    });

    const [played, famous] = await Promise.all([
      UserGame.find({ user: req.userId, status: { $ne: "wishlist" } })
        .select("gameId name cover")
        .lean(),
      getFamousPool(),
    ]);
    const candMap = new Map();
    const addCand = (id, name, cover) => {
      if (!id || candMap.has(id)) return;
      candMap.set(id, { id, name, cover: cover || null });
    };
    for (const r of rounds) addCand(r.gameId, r.gameName, r.cover);
    for (const g of played) addCand(g.gameId, g.name, g.cover || null);
    for (const g of famous) addCand(g.id, g.name, g.cover);
    const candidates = await attachAltNames([...candMap.values()]);

    const dur = orig.durationSec || ROUND_SEC;
    const hintMap = await hintsForGames(rounds.map((r) => r.gameId));
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
      rounds: publicRounds(rounds, dur, hintMap),
      candidates,
      challenge: {
        user: person(orig.user),
        score: orig.score,
        correct: orig.correctCount,
        total: orig.roundCount,
      },
    });
  } catch (err) {
    console.error("pixel challenge error:", err.message);
    res.status(500).json({ error: "Impossible de charger le défi." });
  }
});

// POST /api/pixel/finish — corrige, enregistre, crédite les points.
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
      return {
        gameId: r.gameId,
        gameName: r.gameName,
        cover: r.cover || null,
        shots: r.shots || [],
        owned: !!r.owned,
        playtimeHours: r.playtimeHours ?? null,
        rating: r.rating ?? null,
        guessedGameId: guessId,
        guessedName: guessName,
        correct,
        timeMs,
        points,
      };
    });
    score = Math.max(0, score); // pas de score négatif affiché

    const doc = await PixelGame.create({
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

    // Le score se transforme en points dépensables à l'arcade (1 pour 1), comme
    // le blind test. Best-effort : la partie reste valide si le crédit échoue.
    const balance = await grantPoints(req.userId, score, "pixel", {
      pixelGameId: String(doc._id),
      correct: correctCount,
      total: rounds.length,
    });

    triggerMissionCheck(req.userId);

    res.json({
      pixelGameId: String(doc._id),
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
        // Toutes les captures : le récap les rouvre en grand au clic.
        shots: r.shots || [],
        owned: r.owned,
        correct: r.correct,
        guessedName: r.guessedName,
        points: r.points,
        timeMs: r.timeMs,
      })),
    });
  } catch (err) {
    console.error("pixel finish error:", err.message);
    res.status(500).json({ error: "Impossible d'enregistrer le score." });
  }
});

// GET /api/pixel/leaderboard — une ligne par joueur (moi + mes suivis) avec ses
// DEUX scores : `bestScore` (record sur une partie) et `score` (cumul). Même
// contrat que /blindtest/leaderboard : le widget de l'accueil bascule de l'un à
// l'autre sans savoir de quel jeu il parle.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await PixelGame.aggregate([
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
          gameId: String(r.gameDocId), // cible du bouton « Défier »
          correct: r.correctCount,
          total: r.roundCount,
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("pixel leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

export default router;
