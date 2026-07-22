import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import BlindTest from "../models/BlindTest.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import CustomOst from "../models/CustomOst.js";
import { ensureScraped } from "../lib/ostScrape.js";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";

// Blind test musical : on fait écouter un extrait d'OST tiré au sort et le
// joueur doit deviner de quel jeu il vient. Les manches viennent surtout de SES
// jeux (biblio), avec un peu de gros jeux qu'il n'a pas joués pour corser.
// Le scoring est fait côté serveur (anti-triche + il connaît le temps de jeu /
// la note du joueur, qui pondèrent la difficulté).
const router = express.Router();

// Exportés : Pixel Rush (routes/pixel.js) rejoue exactement les mêmes règles de
// comparaison de titres, le même pool de « gros jeux » et les mêmes indices.
export const IMG = "https://images.igdb.com/igdb/image/upload";
const CLIP_SEC = 15; // durée d'un extrait
const DEFAULT_ROUNDS = 10;

export const person = (u) =>
  u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null;

// Même normalisation que le client (pages/BlindTest.jsx).
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Suffixes d'édition / portage / remaster à ignorer dans la comparaison :
// deviner « BOTW » quand la réponse est « BOTW - Switch 2 Edition » (ou
// l'inverse), c'est le même jeu → bonne réponse. Miroir EXACT côté client.
const EDITION_RE =
  /\b(nintendo switch 2 edition|nintendo switch edition|definitive edition|deluxe edition|complete edition|game of the year edition|goty edition|goty|enhanced edition|special edition|anniversary edition|legacy edition|collector s edition|ultimate edition|royal edition|directors cut|director s cut|remastered|remaster|remake|intergrade|redux|vr edition|hd)\b/g;
const canonName = (s) => norm(s).replace(EDITION_RE, " ").replace(/\s+/g, " ").trim();

// Même jeu ? Par id IGDB, sinon par nom canonique.
export function sameGame(r, guessGameId, guessName) {
  if (guessGameId != null && Number(guessGameId) === Number(r.gameId)) return true;
  const a = canonName(guessName);
  return !!a && a === canonName(r.gameName);
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Tirage sans remise PONDÉRÉ (Efraimidis–Spirakis : clé = rand^(1/poids)) : les
// jeux sur lesquels le joueur a le plus d'heures (ou qu'il a le mieux notés)
// remontent plus souvent en tête — sans être systématiques, le hasard garde sa
// part pour la diversité. Retourne les jeux réordonnés.
export function weightedOrder(games) {
  const weight = (g) => {
    const h = Math.min(g.playtimeHours || 0, 120);
    const r = g.rating != null ? Math.max(0, g.rating - 60) / 40 : 0;
    return 1 + h / 8 + r * 3; // base 1 → tout jeu reste tirable
  };
  return games
    .map((g) => ({ g, k: Math.random() ** (1 / weight(g)) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.g);
}

// --- Pool de « gros jeux » pour les manches piège (jeux non joués) + décors de
// recherche. Mis en cache par jour (comme /feed/discover). ---
let famousCache = { day: 0, games: [] };
export async function getFamousPool() {
  const day = Math.floor(Date.now() / 86400000);
  if (famousCache.day === day && famousCache.games.length) return famousCache.games;
  try {
    const q =
      "fields name,cover.image_id,total_rating_count;" +
      " where cover != null & version_parent = null & game_type = (0,8,9)" +
      " & total_rating_count > 150; sort total_rating_count desc; limit 180;";
    const raw = await igdbQuery("games", q);
    const games = raw.map((g) => ({
      id: g.id,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    }));
    if (games.length) famousCache = { day, games };
  } catch (err) {
    console.error("blindtest famous pool error:", err.message);
  }
  return famousCache.games;
}

// Pistes déjà en base pour un lot de jeux → Map(gameId → [tracks]).
async function tracksForGames(gameIds) {
  if (!gameIds.length) return new Map();
  const rows = await CustomOst.find({ gameId: { $in: gameIds } })
    .select("gameId name videoId")
    .lean();
  const map = new Map();
  for (const r of rows) {
    if (!r.videoId) continue;
    if (!map.has(r.gameId)) map.set(r.gameId, []);
    map.get(r.gameId).push({ videoId: r.videoId, name: r.name });
  }
  return map;
}

// Scrape l'OST d'un jeu à la volée si absente, borné dans le temps (le scraping
// YouTube peut traîner ; on ne bloque pas la partie pour un jeu récalcitrant).
function scrapeWithBudget(gameId, name, ms = 5000) {
  return Promise.race([
    ensureScraped(gameId, name)
      .then((list) =>
        (list || [])
          .filter((c) => c.videoId)
          .map((c) => ({ videoId: c.videoId, name: c.name }))
      )
      .catch(() => []),
    new Promise((r) => setTimeout(() => r([]), ms)),
  ]);
}

// Indices progressifs dévoilés au fil de l'extrait (année → plateformes →
// studio). Récupérés en un seul appel IGDB pour tous les jeux du set ;
// best-effort : sans réponse IGDB, la manche se joue simplement sans indices.
export async function hintsForGames(gameIds) {
  const ids = [...new Set(gameIds)].filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const q =
      "fields first_release_date, genres.name, platforms.abbreviation, platforms.name," +
      " involved_companies.company.name, involved_companies.developer, involved_companies.publisher;" +
      ` where id = (${ids.join(",")}); limit ${ids.length};`;
    const raw = await igdbQuery("games", q);
    const map = new Map();
    for (const g of raw) {
      const dev = (g.involved_companies || []).find((c) => c.developer)?.company?.name;
      const pub = (g.involved_companies || []).find((c) => c.publisher)?.company?.name;
      map.set(g.id, {
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getUTCFullYear()
          : null,
        platforms: (g.platforms || [])
          .map((p) => p.abbreviation || p.name)
          .filter(Boolean)
          .slice(0, 4),
        studio: dev || pub || null,
        genre: (g.genres || [])[0]?.name || null,
      });
    }
    return map;
  } catch (err) {
    console.error("blindtest hints error:", err.message);
    return new Map();
  }
}

// Noms alternatifs (dont FR) des jeux, pour rendre la recherche du joueur
// tolérante : « Another Code » retrouve « Trace Memory », « Biohazard » →
// « Resident Evil », etc. Un ou deux appels IGDB bornés, best-effort.
// Retourne Map(gameId → [noms]).
async function altNamesForGames(ids) {
  const list = [...new Set(ids)].filter(Boolean);
  const map = new Map();
  if (!list.length) return map;
  try {
    for (let i = 0; i < list.length; i += 300) {
      const chunk = list.slice(i, i + 300);
      const raw = await igdbQuery(
        "games",
        `fields alternative_names.name; where id = (${chunk.join(",")}); limit ${chunk.length};`
      );
      for (const g of raw) {
        const names = (g.alternative_names || []).map((a) => a.name).filter(Boolean);
        if (names.length) map.set(g.id, names);
      }
    }
  } catch (err) {
    console.error("blindtest altnames error:", err.message);
  }
  return map;
}

// Attache les noms alternatifs à une liste de candidats (recherche tolérante).
export async function attachAltNames(candidates) {
  const altMap = await altNamesForGames(candidates.map((c) => c.id));
  for (const c of candidates) {
    const a = altMap.get(c.id);
    if (a && a.length) c.alt = a;
  }
  return candidates;
}

function mkRound(g, track, owned) {
  return {
    gameId: g.gameId,
    gameName: g.name,
    cover: g.cover || null,
    videoId: track.videoId,
    ostName: track.name || "",
    // Démarre l'extrait entre 5 % et 50 % de la piste (pas toujours l'intro,
    // souvent la plus iconique) — le client re-cale si la piste est courte.
    startFrac: Math.random() * 0.45 + 0.05,
    owned,
    playtimeHours: g.playtimeHours ?? null,
    rating: g.rating ?? null,
  };
}

// Scrape en parallèle un lot de jeux et en tire `need` manches jouables.
async function scrapeFill(games, need, owned, usedVideo) {
  if (need <= 0 || !games.length) return [];
  const batch = games.slice(0, need + 6);
  const results = await Promise.all(
    batch.map((g) => scrapeWithBudget(g.gameId, g.name).then((tracks) => ({ g, tracks })))
  );
  const out = [];
  for (const { g, tracks } of results) {
    if (out.length >= need) break;
    const avail = tracks.filter((t) => !usedVideo.has(t.videoId));
    if (!avail.length) continue;
    const t = sample(avail);
    usedVideo.add(t.videoId);
    out.push(mkRound(g, t, owned));
  }
  return out;
}

// Construit un set de manches (avec les réponses, côté serveur) + la liste des
// jeux proposables à la recherche (tous les jeux dont une réponse peut sortir,
// plus des décors). ~65 % de jeux joués, ~35 % de gros jeux non joués.
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

  // Moins de manches « jamais joué » qu'avant (elles étaient trop nombreuses et
  // répétitives) : ~20 %, le reste vient de la biblio du joueur.
  const foreignTarget = ownedIds.length ? Math.max(1, Math.round(count * 0.2)) : count;
  const ownedTarget = count - foreignTarget;

  const usedVideo = new Set();

  // 1. Manches « mes jeux » : d'abord ceux qui ont déjà une OST en base (rapide).
  //    Ordre pondéré par le temps de jeu → un peu plus souvent les jeux que le
  //    joueur a le plus pratiqués, tout en gardant de la variété.
  const ownedTrackMap = await tracksForGames(ownedIds);
  const ownedRounds = [];
  for (const g of weightedOrder(playedGames)) {
    if (ownedRounds.length >= ownedTarget) break;
    const tracks = (ownedTrackMap.get(g.gameId) || []).filter(
      (t) => !usedVideo.has(t.videoId)
    );
    if (!tracks.length) continue;
    const t = sample(tracks);
    usedVideo.add(t.videoId);
    ownedRounds.push(mkRound(g, t, true));
  }
  // Complément : scrape quelques jeux joués sans OST encore (même pondération).
  if (ownedRounds.length < ownedTarget) {
    const missing = weightedOrder(
      playedGames.filter((g) => !(ownedTrackMap.get(g.gameId) || []).length)
    );
    ownedRounds.push(
      ...(await scrapeFill(missing, ownedTarget - ownedRounds.length, true, usedVideo))
    );
  }

  // 2. Manches pièges : gros jeux non joués.
  const famous = await getFamousPool();
  const ownedSet = new Set(ownedIds);
  const foreignPool = shuffle(famous.filter((g) => !ownedSet.has(g.id))).map((g) => ({
    gameId: g.id,
    name: g.name,
    cover: g.cover,
    playtimeHours: null,
    rating: null,
  }));
  const foreignIds = foreignPool.map((g) => g.gameId);
  const foreignTrackMap = await tracksForGames(foreignIds);
  const foreignRounds = [];
  for (const g of foreignPool) {
    if (foreignRounds.length >= foreignTarget) break;
    const tracks = (foreignTrackMap.get(g.gameId) || []).filter(
      (t) => !usedVideo.has(t.videoId)
    );
    if (!tracks.length) continue;
    const t = sample(tracks);
    usedVideo.add(t.videoId);
    foreignRounds.push(mkRound(g, t, false));
  }
  if (foreignRounds.length < foreignTarget) {
    const missing = foreignPool.filter((g) => !(foreignTrackMap.get(g.gameId) || []).length);
    foreignRounds.push(
      ...(await scrapeFill(missing, foreignTarget - foreignRounds.length, false, usedVideo))
    );
  }

  // 3. Si une catégorie a manqué de matière, on complète avec l'autre.
  let rounds = [...ownedRounds, ...foreignRounds];
  if (rounds.length < count) {
    const usedGames = new Set(rounds.map((r) => r.gameId));
    const extraForeign = foreignPool.filter((g) => !usedGames.has(g.gameId));
    rounds.push(
      ...(await scrapeFill(extraForeign, count - rounds.length, false, usedVideo))
    );
  }
  rounds = shuffle(rounds).slice(0, count);

  // 4. Liste proposable à la recherche : toutes les réponses possibles + décors.
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

// Score d'une manche (serveur). Rapide = plus de points ; un jeu piège deviné
// rapporte gros ; ne PAS trouver un jeu qu'on adore (bcp d'heures / grosse note)
// coûte davantage.
function scoreRound(r, guessGameId, guessName, timeMs, durationSec) {
  const correct = sameGame(r, guessGameId, guessName);
  const dur = durationSec * 1000;
  const t = timeMs == null ? dur : Math.min(Math.max(timeMs, 0), dur);
  const frac = dur > 0 ? (dur - t) / dur : 0; // 1 = instantané, 0 = à la fin
  // Familiarité (0→1) : plus le joueur a d'heures / a mis une grosse note.
  const fam = r.owned
    ? Math.max(
        Math.min((r.playtimeHours || 0) / 40, 1),
        r.rating != null ? Math.max(0, (r.rating - 60) / 40) : 0
      )
    : 0;

  if (correct) {
    let pts = 200 + Math.round(600 * frac); // 200 → 800 selon la vitesse
    if (!r.owned)
      pts += 250 + Math.round(150 * frac); // jeu jamais joué → gros bonus
    else pts += Math.round(120 * fam); // reconnu un jeu qu'on adore → petit bonus
    return pts;
  }
  // Raté :
  if (r.owned) return -Math.round(60 + 240 * fam); // pire si on l'adorait
  return -40; // piège raté : petite pénalité
}

// --- Sessions en cours (réponses gardées serveur, jamais envoyées avant la
//     correction). Mémoire process, TTL 30 min. ---
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
function gcSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}

// Manches envoyées au client. On inclut la réponse (jeu, jaquette, titre) et la
// difficulté : le client révèle la solution après chaque manche et affiche des
// points « en direct » avec la même formule que le serveur. Le score officiel
// (leaderboard) reste recalculé serveur au /finish à partir de la session — le
// client ne fait que refléter. C'est une appli entre amis : ce compromis
// privilégie une expérience fluide et satisfaisante.
function publicRounds(rounds, durationSec, hintMap = new Map()) {
  return rounds.map((r, i) => ({
    id: i,
    videoId: r.videoId,
    startFrac: r.startFrac,
    durationSec,
    gameId: r.gameId,
    gameName: r.gameName,
    cover: r.cover || null,
    ostName: r.ostName || "",
    owned: !!r.owned,
    playtimeHours: r.playtimeHours ?? null,
    rating: r.rating ?? null,
    hints: hintMap.get(r.gameId) || null,
  }));
}

// POST /api/blindtest/start — démarre une partie fraîche.
router.post("/start", requireAuth, async (req, res) => {
  try {
    gcSessions();
    const count = Math.min(Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, 5), 15);
    const { rounds, candidates } = await buildRounds(req.userId, count);
    if (rounds.length < 3) {
      return res.status(422).json({
        error:
          "Pas assez de musiques pour lancer un blind test. Ouvre l'onglet OST de quelques-uns de tes jeux, puis réessaie.",
      });
    }
    const hintMap = await hintsForGames(rounds.map((r) => r.gameId));
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      durationSec: CLIP_SEC,
      rounds,
      challengeOf: null,
      challengedUser: null,
      challengedScore: null,
      challengedUsername: null,
      createdAt: Date.now(),
    });
    res.json({
      sessionId,
      durationSec: CLIP_SEC,
      rounds: publicRounds(rounds, CLIP_SEC, hintMap),
      candidates,
      challenge: null,
    });
  } catch (err) {
    console.error("blindtest start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer le blind test." });
  }
});

// GET /api/blindtest/challenge/:id — rejoue le MÊME set qu'une partie d'un pote.
router.get("/challenge/:id", requireAuth, async (req, res) => {
  try {
    gcSessions();
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Défi introuvable." });
    const orig = await BlindTest.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!orig || !orig.rounds?.length)
      return res.status(404).json({ error: "Défi introuvable." });

    // On rejoue les mêmes pistes, mais la difficulté (owned/heures/note) est
    // recalculée pour CE joueur : un jeu que l'auteur adorait peut m'être inconnu.
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
        videoId: r.videoId,
        ostName: r.ostName || "",
        startFrac: r.startFrac || 0,
        owned,
        playtimeHours: owned ? e.playtimeHours ?? null : null,
        rating: owned ? e.rating ?? null : null,
      };
    });

    // Candidats : les réponses du set + mes jeux + décors du pool famous.
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

    const hintMap = await hintsForGames(rounds.map((r) => r.gameId));
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      durationSec: orig.durationSec || CLIP_SEC,
      rounds,
      challengeOf: String(orig._id),
      challengedUser: String(orig.user?._id || ""),
      challengedScore: orig.score,
      challengedUsername: orig.user?.username || "",
      createdAt: Date.now(),
    });

    res.json({
      sessionId,
      durationSec: orig.durationSec || CLIP_SEC,
      rounds: publicRounds(rounds, orig.durationSec || CLIP_SEC, hintMap),
      candidates,
      challenge: {
        user: person(orig.user),
        score: orig.score,
        correct: orig.correctCount,
        total: orig.roundCount,
      },
    });
  } catch (err) {
    console.error("blindtest challenge error:", err.message);
    res.status(500).json({ error: "Impossible de charger le défi." });
  }
});

// POST /api/blindtest/finish — corrige, enregistre, journalise pour le fil.
router.post("/finish", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session || session.userId !== String(req.userId))
      return res.status(404).json({ error: "Partie expirée. Relance un blind test." });

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
        videoId: r.videoId,
        ostName: r.ostName || "",
        startFrac: r.startFrac || 0,
        owned: !!r.owned,
        playtimeHours: r.playtimeHours ?? null,
        rating: r.rating ?? null,
        guessedGameId: guessId,
        guessedName: String(g.name || "").slice(0, 160),
        correct,
        timeMs,
        points,
      };
    });
    score = Math.max(0, score); // pas de score négatif affiché

    const doc = await BlindTest.create({
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

    // Le score se transforme en points DÉPENSABLES à l'arcade (1 pour 1). Le
    // score du classement, lui, ne bouge pas : dépenser ses points ne fait pas
    // reculer au leaderboard. Best-effort — une partie reste valide même si le
    // crédit échoue (le grand livre le dirait).
    const balance = await grantPoints(req.userId, score, "blindtest", {
      blindTestId: String(doc._id),
      correct: correctCount,
      total: rounds.length,
    });

    // Journal pour le fil des abonnés (best-effort).
    recordActivity({
      actor: req.userId,
      type: "blindtest",
      meta: {
        blindTestId: String(doc._id),
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
    // Mission « Oreille absolue ».
    triggerMissionCheck(req.userId);

    res.json({
      blindTestId: String(doc._id),
      score,
      correctCount,
      roundCount: rounds.length,
      durationSec: dur,
      // Arcade : points crédités par cette partie + nouveau solde (null si le
      // crédit n'a pas pu se faire — le scoreboard masque alors la mention).
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
        ostName: r.ostName,
        videoId: r.videoId,
        owned: r.owned,
        correct: r.correct,
        guessedName: r.guessedName,
        points: r.points,
        timeMs: r.timeMs,
      })),
    });
  } catch (err) {
    console.error("blindtest finish error:", err.message);
    res.status(500).json({ error: "Impossible d'enregistrer le score." });
  }
});

// GET /api/blindtest/:id/results — le détail d'une partie terminée, pour la
// modale « Voir les résultats » du fil : chaque manche avec la bonne réponse
// (écoutable) et la réponse donnée. Pour les manches ratées, on joint la
// jaquette du jeu répondu (IGDB, best-effort).
router.get("/:id/results", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Partie introuvable." });
    const doc = await BlindTest.findById(req.params.id)
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
          videoId: r.videoId,
          ostName: r.ostName || "",
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
    console.error("blindtest results error:", err.message);
    res.status(500).json({ error: "Impossible de charger les résultats." });
  }
});

// GET /api/blindtest/leaderboard — une ligne par joueur (moi + mes suivis) avec
// SES DEUX scores : `bestScore` (record sur une partie) et `score` (cumul de
// toutes les parties). Le widget de l'accueil bascule entre les deux classements
// via ses onglets, donc on ne tranche pas ici : on renvoie les deux et le client
// trie. Le blindTestId retenu est celui de la partie la plus récente → le bouton
// « Défier » pointe sur un set à jour.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await BlindTest.aggregate([
      { $match: { user: { $in: ids } } },
      { $sort: { createdAt: -1 } }, // récent d'abord → $first = dernière partie
      {
        $group: {
          _id: "$user",
          score: { $sum: "$score" }, // total cumulé de toutes les parties
          games: { $sum: 1 },
          blindTestId: { $first: "$_id" }, // la partie la plus récente
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
          blindTestId: String(r.blindTestId),
          correct: r.correctCount,
          total: r.roundCount,
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("blindtest leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

export default router;
