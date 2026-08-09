import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import QuizGame from "../models/QuizGame.js";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizSeen from "../models/QuizSeen.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { person } from "./blindtest.js";
import { userCovers } from "./pixel.js";
import {
  buildQuizRounds,
  packRound,
  publicRound,
  unpackRound,
  ROUND_TYPES,
  TYPE_META,
} from "../lib/quizRounds.js";
import { checkRound, toScoreInput } from "../lib/quizCheck.js";
import { scoreRound } from "../lib/quizScore.js";
import { recordAnswers } from "../lib/quizBank.js";

// ======================================================================
//  Le Grand Quiz — solo
// ======================================================================
// La quatrième porte de l'arcade, et la première qui n'enchaîne pas dix fois
// la même chose : une partie traverse huit épreuves différentes (cf.
// lib/quizRounds.js). Le squelette est celui du blind test et de Pixel Rush —
// une session en mémoire qui garde les réponses, un /finish qui recalcule tout
// côté serveur — mais la mécanique de chaque manche vit ailleurs, et c'est
// volontaire : cette route ne sait pas ce qu'est un swipe ou un duel, elle sait
// seulement demander des manches, les servir, puis les faire corriger.
const router = express.Router();

const DEFAULT_ROUNDS = 8;
const MIN_ROUNDS = 5;
const MAX_ROUNDS = 14;

// --- Sessions en cours (les réponses restent au serveur). Mémoire process,
//     TTL 40 min : une partie de quatorze manches dont un duel de 55 s peut
//     durer, et personne ne doit perdre son score parce qu'il a répondu au
//     téléphone entre deux épreuves. ---
const sessions = new Map();
const SESSION_TTL = 40 * 60 * 1000;
function gcSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}

// En solo, le client reçoit la solution de chaque manche : il révèle après
// chaque épreuve et affiche des points « en direct » avec la formule miroir
// (client/src/lib/quizGame.js). Le score officiel reste celui du /finish,
// recalculé depuis la session — le client ne fait que refléter. Même choix
// assumé que le blind test et Pixel Rush.
const serveRounds = (rounds) =>
  rounds.map((r, i) =>
    publicRound(r, { reveal: true, index: i, total: rounds.length })
  );

// ============================================================
//  Les épreuves qu'on veut voir tomber
// ============================================================
// Le joueur peut en décocher : certains détestent taper au clavier, d'autres
// ne supportent pas le chrono du swipe. Une liste vide (ou farfelue) retombe
// sur tout — mieux vaut une partie complète qu'un refus de lancer.
function pickTypes(raw) {
  const list = Array.isArray(raw) ? raw.map(String).filter((t) => ROUND_TYPES.includes(t)) : [];
  return list.length ? [...new Set(list)] : ROUND_TYPES;
}

// GET /api/quiz/covers — quelques jaquettes du joueur pour la carte d'accueil.
router.get("/covers", requireAuth, async (req, res) => {
  res.json({ games: await userCovers(req.userId) });
});

// GET /api/quiz/types — le catalogue des épreuves, pour l'écran de réglages.
// Servi par le serveur plutôt que recopié côté client : ajouter une huitième
// épreuve ne doit demander qu'un fichier à toucher.
router.get("/types", requireAuth, (req, res) => {
  res.json({
    types: ROUND_TYPES.map((key) => ({
      key,
      label: TYPE_META[key].label,
      durationSec: TYPE_META[key].durationSec,
      mode: TYPE_META[key].mode,
      icon: TYPE_META[key].icon,
    })),
  });
});

// POST /api/quiz/start — nouvelle partie.
router.post("/start", requireAuth, async (req, res) => {
  try {
    gcSessions();
    const count = Math.min(
      Math.max(Number(req.body?.rounds) || DEFAULT_ROUNDS, MIN_ROUNDS),
      MAX_ROUNDS
    );
    const types = pickTypes(req.body?.types);
    const { rounds, candidates } = await buildQuizRounds({
      userIds: [req.userId],
      count,
      types,
    });

    // Trois manches, c'est le plancher en dessous duquel ça ne vaut pas la
    // peine de lancer. Le cas se produit surtout sur une installation neuve :
    // banque vide, emojis pas encore relus, IGDB pas configuré.
    if (rounds.length < 3) {
      return res.status(422).json({
        error:
          "Pas encore assez de matière pour lancer une partie. Réessaie avec toutes les épreuves cochées, ou préviens l'admin que la banque de questions est vide.",
      });
    }

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      rounds,
      challengeOf: null,
      challengedUser: null,
      challengedScore: null,
      challengedUsername: null,
      createdAt: Date.now(),
    });

    res.json({
      sessionId,
      rounds: serveRounds(rounds),
      candidates,
      challenge: null,
    });
  } catch (err) {
    console.error("quiz start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// GET /api/quiz/challenge/:id — rejoue le MÊME set qu'un autre joueur.
// Les manches sont reprises telles quelles depuis la partie d'origine : mêmes
// questions, mêmes propositions dans le même ordre, mêmes cartes. C'est la
// condition pour que les deux scores soient comparables.
router.get("/challenge/:id", requireAuth, async (req, res) => {
  try {
    gcSessions();
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Défi introuvable." });
    const orig = await QuizGame.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!orig || !orig.rounds?.length)
      return res.status(404).json({ error: "Défi introuvable." });

    // `payload` porte la manche complète, solution comprise (cf.
    // models/QuizGame.js) : il suffit de la ressortir. Seule la liste
    // d'acceptation du studio a été retirée à l'écriture (elle pèse tout un
    // catalogue IGDB) — `unpackRound` la refabrique.
    const rounds = await Promise.all(
      orig.rounds.map((r) =>
        unpackRound({ ...r.payload, type: r.type, durationSec: r.durationSec })
      )
    );

    // La liste de recherche, elle, est reconstruite pour CE joueur : elle
    // dépend de sa bibliothèque, pas de celle de l'auteur du défi. On repasse
    // donc par le constructeur, en ne lui demandant aucune manche.
    const { candidates } = await buildQuizRounds({
      userIds: [req.userId],
      count: 0,
      types: [],
    }).catch(() => ({ candidates: [] }));

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      userId: String(req.userId),
      rounds,
      challengeOf: String(orig._id),
      challengedUser: String(orig.user?._id || ""),
      challengedScore: orig.score,
      challengedUsername: orig.user?.username || "",
      createdAt: Date.now(),
    });

    res.json({
      sessionId,
      rounds: serveRounds(rounds),
      candidates: candidates || [],
      challenge: {
        user: person(orig.user),
        score: orig.score,
        correct: orig.correctCount,
        total: orig.roundCount,
      },
    });
  } catch (err) {
    console.error("quiz challenge error:", err.message);
    res.status(500).json({ error: "Impossible de charger le défi." });
  }
});

// ============================================================
//  POST /api/quiz/finish — la correction
// ============================================================
// Le client envoie ce qu'il a fait, le serveur recalcule TOUT depuis la
// session : correction (lib/quizCheck.js) puis barème (lib/quizScore.js). Rien
// de ce qui arrive du navigateur n'est pris pour argent comptant — pas même le
// nombre de bonnes réponses d'un swipe, qui est pourtant fastidieux à
// recompter.
router.post("/finish", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "");
    const session = sessions.get(sessionId);
    if (!session || session.userId !== String(req.userId))
      return res.status(404).json({ error: "Partie expirée. Relance une partie." });

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const byId = new Map(
      answers.map((a) => [Number(a.id), a]).filter(([id]) => Number.isInteger(id))
    );

    let score = 0;
    let correctCount = 0;
    // Statistiques de la banque : quelles questions ont été posées, et
    // réussies (cf. models/QuizQuestion.js).
    const stats = new Map();
    // Ce qui part dans QuizSeen pour ne pas reposer la même chose bientôt.
    const seenOps = [];

    const rounds = session.rounds.map((r, i) => {
      const a = byId.get(i) || {};
      const timeMs = a.timeMs != null ? Number(a.timeMs) : null;
      const res_ = checkRound(r, a.given);
      const points = Math.max(0, scoreRound(r, toScoreInput(r, res_), timeMs).points);
      score += points;
      if (res_.correct) correctCount += 1;

      if (r.questionId) {
        const prev = stats.get(r.questionId) || { asked: 0, correct: 0 };
        stats.set(r.questionId, {
          asked: prev.asked + 1,
          correct: prev.correct + (res_.correct ? 1 : 0),
        });
      }
      if (r.seenRef) {
        seenOps.push({
          updateOne: {
            filter: { user: req.userId, ref: r.seenRef, type: r.type },
            update: {
              $set: {
                kind: r.seenRef.startsWith("q:") ? "question" : "game",
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        });
      }

      return {
        type: r.type,
        durationSec: r.durationSec,
        // La manche entière, solution comprise : c'est elle qu'on rejouera si
        // quelqu'un relève le défi. `packRound` en retire ce qui se refabrique
        // (la liste d'acceptation du studio, plusieurs centaines de titres).
        payload: packRound(r),
        given: a.given ?? null,
        correct: res_.correct,
        ratio: res_.ratio,
        timeMs,
        points,
        detail: res_.detail,
      };
    });

    const doc = await QuizGame.create({
      user: req.userId,
      score,
      roundCount: rounds.length,
      correctCount,
      challengeOf: session.challengeOf || null,
      challengedUser: session.challengedUser || null,
      challengedScore: session.challengedScore ?? null,
      rounds: rounds.map(({ detail, ...r }) => r), // `detail` ne sert qu'à la réponse
    });
    sessions.delete(sessionId);

    // Mémoire et statistiques : best-effort toutes les deux, une partie
    // enregistrée ne doit pas échouer parce qu'un compteur n'a pas bougé.
    recordAnswers(stats);
    if (seenOps.length)
      QuizSeen.bulkWrite(seenOps, { ordered: false }).catch((e) =>
        console.error("quiz seen error:", e.message)
      );

    // Le score devient des points dépensables à l'arcade (1 pour 1), comme les
    // trois autres mini-jeux.
    const balance = await grantPoints(req.userId, score, "quiz", {
      quizGameId: String(doc._id),
      correct: correctCount,
      total: rounds.length,
    });

    const challenge = session.challengedUser
      ? {
          username: session.challengedUsername || "",
          score: session.challengedScore ?? null,
          beaten: score > (session.challengedScore ?? 0),
        }
      : null;

    recordActivity({
      actor: req.userId,
      type: "quiz",
      meta: {
        quizGameId: String(doc._id),
        score,
        correct: correctCount,
        total: rounds.length,
        // Les épreuves traversées : la carte du fil les affiche en pastilles,
        // c'est ce qui distingue une partie de Grand Quiz d'une autre.
        types: [...new Set(rounds.map((r) => r.type))],
        challenge,
      },
    });

    triggerMissionCheck(req.userId);

    res.json({
      quizGameId: String(doc._id),
      score,
      correctCount,
      roundCount: rounds.length,
      pointsEarned: balance != null ? score : null,
      points: balance,
      challenge,
      rounds: rounds.map((r, i) => ({
        index: i,
        type: r.type,
        label: TYPE_META[r.type]?.label || r.type,
        correct: r.correct,
        ratio: r.ratio,
        points: r.points,
        timeMs: r.timeMs,
        detail: r.detail,
        // De quoi illustrer le récap sans renvoyer toute la manche.
        recap: recapOf(r.payload),
      })),
    });
  } catch (err) {
    console.error("quiz finish error:", err.message);
    res.status(500).json({ error: "Impossible d'enregistrer le score." });
  }
});

// Le résumé d'une manche pour le récap : de quoi la reconnaître d'un coup
// d'œil (« ah oui, celle sur Capcom ») sans réexpédier une pile de vingt-quatre
// jaquettes ou une liste d'acceptation de cinq cents jeux.
function recapOf(r) {
  switch (r.type) {
    case "qcm":
      return {
        title: r.text,
        answer: r.choices?.[r.answerIndex] || "",
        explain: r.explain || "",
        cover: r.cover || null,
      };
    case "emoji":
      return {
        title: (r.emojis || []).join(" "),
        answer: r.gameName,
        gameId: r.gameId,
        cover: r.cover || null,
      };
    case "studio":
      return { title: r.studio, answer: `${r.need} jeux à trouver`, examples: r.examples || [] };
    case "duel":
      return {
        title: (r.games || []).map((g) => g.name).join("  vs  "),
        answer: `${(r.cards || []).length} cartes`,
        cover: r.games?.[0]?.cover || null,
      };
    case "pixel":
      return { title: "Capture pixelisée", answer: r.gameName, gameId: r.gameId, cover: r.cover || null };
    case "swipe":
      return { title: r.criterion?.label || "", answer: `${(r.deck || []).length} jeux` };
    case "anagram":
      return {
        title: (r.letters || []).join(" "),
        answer: r.gameName,
        gameId: r.gameId,
        cover: r.cover || null,
      };
    case "motus":
      return {
        title: `${r.length} lettres · ${r.hint || ""}`.trim(),
        answer: r.gameName,
        gameId: r.gameId,
        cover: r.cover || null,
      };
    default:
      return { title: "", answer: "" };
  }
}

// GET /api/quiz/:id/results — le détail d'une partie, pour la modale du fil.
router.get("/:id/results", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Partie introuvable." });
    const doc = await QuizGame.findById(req.params.id)
      .populate("user", "username avatar")
      .populate("challengedUser", "username avatar")
      .lean();
    if (!doc) return res.status(404).json({ error: "Partie introuvable." });

    res.json({
      id: String(doc._id),
      user: person(doc.user),
      score: doc.score,
      correctCount: doc.correctCount,
      roundCount: doc.roundCount,
      date: doc.createdAt,
      challenge: doc.challengedUser
        ? {
            user: person(doc.challengedUser),
            score: doc.challengedScore ?? null,
            beaten: doc.score > (doc.challengedScore ?? 0),
          }
        : null,
      rounds: (doc.rounds || []).map((r, i) => ({
        index: i,
        type: r.type,
        label: TYPE_META[r.type]?.label || r.type,
        correct: !!r.correct,
        ratio: r.ratio || 0,
        points: r.points || 0,
        timeMs: r.timeMs ?? null,
        recap: recapOf(r.payload || { type: r.type }),
      })),
    });
  } catch (err) {
    console.error("quiz results error:", err.message);
    res.status(500).json({ error: "Impossible de charger les résultats." });
  }
});

// POST /api/quiz/report — « cette question est fausse ».
// Le seul garde-fou qui vaille sur une banque partiellement générée : un
// joueur qui sait que la réponse est erronée le signale, la question repasse
// en relecture et cesse immédiatement d'être tirée.
router.post("/report", requireAuth, async (req, res) => {
  try {
    const id = String(req.body?.questionId || "");
    if (!mongoose.isValidObjectId(id))
      return res.status(400).json({ error: "Question inconnue." });
    await QuizQuestion.updateOne(
      { _id: id },
      { $inc: { flags: 1 }, $set: { approved: false } }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("quiz report error:", err.message);
    res.status(500).json({ error: "Signalement non enregistré." });
  }
});

// GET /api/quiz/leaderboard — moi + mes suivis, avec record et cumul.
// MÊME CONTRAT que /blindtest/leaderboard, /pixel/leaderboard et
// /geo/leaderboard : le widget de l'arcade bascule de l'un à l'autre sans
// savoir de quel jeu il parle.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await QuizGame.aggregate([
      { $match: { user: { $in: ids } } },
      { $sort: { createdAt: -1 } }, // récent d'abord → $first = dernière partie
      {
        $group: {
          _id: "$user",
          score: { $sum: "$score" },
          games: { $sum: 1 },
          gameDocId: { $first: "$_id" }, // cible du bouton « Défier »
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
          quizGameId: String(r.gameDocId),
          correct: r.correctCount,
          total: r.roundCount,
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("quiz leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

export default router;
