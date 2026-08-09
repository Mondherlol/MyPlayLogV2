import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import PixelGame from "../models/PixelGame.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
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
  keepRealGames,
  attachAltNames,
  hintsForGames,
} from "./blindtest.js";

// Pixel Rush : on montre UNE capture d'écran d'un jeu, ÉNORMÉMENT pixelisée,
// et le joueur devine de quel jeu il s'agit. Le temps qui passe fait remonter
// un peu la définition — sans jamais la rendre lisible — et coûte des points.
// L'image nette n'apparaît qu'à la révélation.
//
// UNE SEULE CAPTURE, ET C'ÉTAIT QUATRE. La grille de quatre vignettes divisait
// l'attention sans rien apprendre de plus : à 12 blocs de large, quatre petites
// images floues ne valent pas une grande. On en montre donc une, en grand, et
// on donne de quoi la fouiller — le coin libre et la loupe (voir `clearCorner`
// ci-dessous et components/PixelCanvas.jsx).
//
// Le pixel est appliqué CÔTÉ CLIENT (canvas) : le serveur envoie des URLs
// IGDB standard. C'est assumé — comme pour le blind test, la triche par
// devtools est possible et sans intérêt entre amis (cf. publicRounds).
const router = express.Router();

// Durée d'une manche. Trente secondes, comme le versus : depuis qu'il n'y a
// plus qu'une capture, la manche se joue à la loupe — on balaie l'image, on
// revient sur un détail. Quinze secondes suffisaient à REGARDER quatre
// vignettes ; elles ne suffisent pas à en FOUILLER une.
const ROUND_SEC = 30;
const DEFAULT_ROUNDS = 10;
const SHOTS_PER_ROUND = 1;

// Les quatre coins possibles du « coin libre » : l'angle de l'image qui échappe
// à la pixelisation. Tiré ICI et transporté avec la manche — en versus, tout le
// monde doit avoir le même, et au rejeu d'un défi on veut retrouver le sien.
const CORNERS = ["tl", "tr", "bl", "br"];
const pickCorner = () => CORNERS[Math.floor(Math.random() * CORNERS.length)];

// Screenshots d'un lot de jeux → Map(gameId → [urls]). Un seul aller-retour
// IGDB par tranche de 300 jeux ; les jeux sans screenshot sont simplement
// absents de la Map (ils ne feront pas de manche).
//
// Exporté pour l'épreuve « pixel » du Grand Quiz (lib/quizRounds.js) : elle
// pixelise exactement de la même façon, autant que la façon d'aller chercher
// les captures soit littéralement la même fonction.
export async function shotsForGames(ids) {
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
    clearCorner: pickCorner(),
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
  // Bundles, packs, DLC… sortent ici : ni manche, ni suggestion de recherche.
  // (Les captures d'un bundle sont celles d'un des jeux inclus : impossible à
  // deviner, et la réponse attendue serait le nom de la compilation.)
  const playedGames = await keepRealGames(
    played.map((g) => ({
      gameId: g.gameId,
      name: g.name,
      cover: g.cover || null,
      playtimeHours: g.playtimeHours ?? null,
      rating: g.rating ?? null,
    }))
  );
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

// ======================================================================
//  Le versus : tirer pour UNE TABLE
// ======================================================================
// Même philosophie que le blind test (cf. buildVersusRounds dans
// routes/blindtest.js, qui porte le raisonnement en entier) : on réunit les
// bibliothèques de tous les participants, on se garantit quelques jeux que
// TOUT LE MONDE a joués, et on tire le reste à plat pour ne pas rejouer le même
// petit noyau commun à chaque partie.
//
// La différence tient à la matière : ici il faut des SCREENSHOTS IGDB, pas des
// OST. Beaucoup de jeux n'en ont pas — on interroge donc large et on garde ce
// qui répond.
const PXV_FOREIGN_SHARE = 0.25;
const PXV_EVERYONE_SHARE = 0.3;

export async function buildPixelVersusRounds(userIds, count) {
  const playerCount = new Set(userIds.map(String)).size;
  const played = await UserGame.find({
    user: { $in: userIds },
    status: { $ne: "wishlist" },
  })
    .select("gameId name cover user favorite")
    .lean();

  // QUI a joué à QUOI : sert au tirage ET au dernier indice de la manche
  // (« y ont joué », avec les têtes des joueurs concernés).
  const owners = new Map(); // gameId → Map(userId → { favorite })
  const byId = new Map();
  for (const g of played) {
    if (!g.gameId) continue;
    if (!owners.has(g.gameId)) owners.set(g.gameId, new Map());
    const seat = owners.get(g.gameId);
    const uid = String(g.user);
    seat.set(uid, { favorite: !!g.favorite || !!seat.get(uid)?.favorite });
    if (!byId.has(g.gameId))
      byId.set(g.gameId, { gameId: g.gameId, name: g.name, cover: g.cover || null });
  }
  const tableGames = await keepRealGames([...byId.values()]);
  const ownedIds = tableGames.map((g) => g.gameId);

  const foreignTarget = ownedIds.length
    ? Math.max(1, Math.round(count * PXV_FOREIGN_SHARE))
    : count;
  const ownedTarget = count - foreignTarget;

  const everyone = [];
  const rest = [];
  for (const g of tableGames) {
    const n = owners.get(g.gameId)?.size || 0;
    if (playerCount >= 2 && n >= playerCount) everyone.push(g);
    else rest.push(g);
  }
  const everyoneShuf = shuffle(everyone);
  const headroom = Math.max(1, Math.round(ownedTarget * PXV_EVERYONE_SHARE));
  const ownedPool = [
    ...everyoneShuf.slice(0, headroom),
    ...shuffle([...rest, ...everyoneShuf.slice(headroom)]),
  ];

  const famous = await getFamousPool();
  const ownedSet = new Set(ownedIds);
  const foreignPool = shuffle(famous.filter((g) => !ownedSet.has(g.id))).map((g) => ({
    gameId: g.id,
    name: g.name,
    cover: g.cover,
  }));

  // On demande BEAUCOUP plus de jeux que de manches : tous n'ont pas de
  // screenshot, et une seule requête IGDB sert tout le monde.
  const ownedPick = ownedPool.slice(0, ownedTarget * 4 + 10);
  const foreignPick = foreignPool.slice(0, foreignTarget * 4 + 10);
  const shotMap = await shotsForGames([...ownedPick, ...foreignPick].map((g) => g.gameId));

  const usedGames = new Set();
  const take = (pool, target, owned) => {
    const out = [];
    for (const g of pool) {
      if (out.length >= target) break;
      if (usedGames.has(g.gameId)) continue;
      const shots = shotMap.get(g.gameId);
      if (!shots?.length) continue;
      usedGames.add(g.gameId);
      out.push(mkRound(g, shots, owned));
    }
    return out;
  };

  let rounds = [...take(ownedPick, ownedTarget, true), ...take(foreignPick, foreignTarget, false)];
  // Une catégorie a manqué de matière : on complète avec l'autre.
  if (rounds.length < count)
    rounds.push(...take(foreignPick, count - rounds.length, false));
  if (rounds.length < count) rounds.push(...take(ownedPick, count - rounds.length, true));
  rounds = shuffle(rounds).slice(0, count);

  // Indices, dont le quatrième propre au versus : qui, à cette table, a ce jeu
  // en bibliothèque. Voir models/PixelVersus.js.
  let hintMap = new Map();
  try {
    hintMap = await hintsForGames(rounds.map((r) => r.gameId));
  } catch {
    /* une manche se joue très bien sans indices IGDB */
  }
  for (const r of rounds) {
    r.hints = {
      ...(hintMap.get(r.gameId) || {}),
      players: [...(owners.get(r.gameId) || new Map())].map(([id, seat]) => ({
        id,
        favorite: !!seat.favorite,
      })),
    };
  }
  return rounds;
}

// La liste proposable à la recherche, IDENTIQUE POUR TOUTE LA TABLE — même
// exigence d'équité qu'au blind test : un joueur dont la liste contiendrait un
// titre absent chez les autres le taperait plus vite.
export async function pixelVersusCandidates(userIds = [], rounds = []) {
  const [played, famous] = await Promise.all([
    userIds.length
      ? UserGame.find({ user: { $in: userIds }, status: { $ne: "wishlist" } })
          .select("gameId name cover")
          .lean()
      : [],
    getFamousPool(),
  ]);
  const candMap = new Map();
  const addCand = (id, name, cover) => {
    if (!id || candMap.has(id)) return;
    candMap.set(id, { id, name, cover: cover || null });
  };
  for (const g of played) addCand(g.gameId, g.name, g.cover || null);
  for (const g of famous) addCand(g.id, g.name, g.cover);
  for (const r of rounds) addCand(r.gameId, r.gameName, r.cover);
  return attachAltNames([...candMap.values()]);
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
    clearCorner: r.clearCorner || "tl",
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
    // Pas de jaquette de bundle non plus sur les cartes : elles annoncent le
    // jeu, autant montrer ce qu'on peut réellement avoir à deviner.
    return shuffle(await keepRealGames(pool)).slice(0, limit);
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
        // Même coin libre que l'auteur du défi — sinon ce n'est plus le même
        // set. Les parties d'avant n'en ont pas : on en tire un.
        clearCorner: r.clearCorner || pickCorner(),
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
    // Même règle qu'au démarrage d'une partie : pas de bundle/DLC en suggestion.
    for (const g of await keepRealGames(played)) addCand(g.gameId, g.name, g.cover || null);
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
        clearCorner: r.clearCorner || null,
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

    // Carte du fil « a fait une partie de Pixel Rush » (cf. routes/feed.js et
    // client/components/FeedCards.jsx). Best-effort, comme le blind test.
    recordActivity({
      actor: req.userId,
      type: "pixel",
      meta: {
        pixelGameId: String(doc._id),
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

// GET /api/pixel/:id/results — le détail d'une partie terminée, pour la modale
// « Voir les résultats » du fil : chaque manche avec sa réponse, la réponse
// donnée, ET TOUTES SES CAPTURES (c'est tout l'intérêt ici — on veut revoir
// les images sur lesquelles le joueur a séché). Pour les manches ratées, on
// joint la jaquette du jeu répondu (IGDB, best-effort).
router.get("/:id/results", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Partie introuvable." });
    const doc = await PixelGame.findById(req.params.id)
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
          shots: r.shots || [],
          owned: !!r.owned,
          correct: !!r.correct,
          guessedName: r.guessedName || "",
          points: r.points || 0,
          timeMs: r.timeMs ?? null,
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
    console.error("pixel results error:", err.message);
    res.status(500).json({ error: "Impossible de charger les résultats." });
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
