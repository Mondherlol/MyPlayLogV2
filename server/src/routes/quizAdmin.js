import express from "express";
import mongoose from "mongoose";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { seedFromFiles, generateWithGemini } from "../lib/quizSeed.js";
import { isGeminiConfigured } from "../lib/gemini.js";

// ======================================================================
//  La relecture de la banque du Grand Quiz
// ======================================================================
// Sans cet écran, `npm run gen:quiz` ne sert à rien : tout ce qu'il produit
// sort `approved: false` et ne sera JAMAIS tiré. C'est délibéré (cf.
// models/QuizQuestion.js) — un modèle de langage énonce des faits faux avec le
// même aplomb que des vrais, et une question fausse tombée en versus vole une
// manche à quelqu'un. Il fallait donc un endroit pour trancher.
//
// Trois files, dans l'ordre où on veut les traiter :
//   • « à relire »  — ce que Gemini vient de produire ;
//   • « signalées » — ce que des joueurs ont contesté en cours de partie
//     (POST /api/quiz/report), et qui est retombé en attente ;
//   • « en service » — pour retirer après coup une question qui passe mal.
//
// Les statistiques de terrain accompagnent chaque ligne : une question que
// personne ne trouve est très probablement fausse, et c'est le seul signal
// dont on dispose une fois qu'elle est en service.
const router = express.Router();

router.use(requireAuth, requireAdmin);

const PAGE = 40;

// ============================================================
//  Les tâches de remplissage, en arrière-plan
// ============================================================
// Importer le contenu local demande une minute (chaque titre d'emoji est résolu
// auprès d'IGDB, au rythme que leur limite autorise) ; une fournée Gemini, plus
// encore. Répondre à la requête HTTP seulement à la fin, c'est garantir un
// délai d'attente dépassé côté navigateur ou proxy.
//
// La tâche part donc en fond et la route rend la main tout de suite. Son état
// vit en mémoire du process — comme les sessions de partie : si le serveur
// redémarre pendant l'import, on relance, c'est tout. Rien n'est perdu, les
// écritures déjà faites sont des upserts.
//
// UNE SEULE À LA FOIS : deux imports concurrents écriraient les mêmes documents
// et le compte rendu n'aurait plus de sens.
let job = null;

const jobView = () =>
  job && {
    kind: job.kind,
    running: job.running,
    step: job.step,
    done: job.done,
    total: job.total,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };

function startJob(kind, run) {
  if (job?.running) return false;
  job = {
    kind,
    running: true,
    step: "",
    done: 0,
    total: 0,
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  const onProgress = ({ step, done, total }) => {
    job.step = step;
    job.done = done;
    job.total = total;
  };
  // Volontairement sans `await` : la route a déjà répondu.
  run(onProgress)
    .then((result) => {
      job.result = result;
    })
    .catch((err) => {
      console.error(`admin quiz ${kind} error:`, err.message);
      job.error = err.message || "Échec de la tâche.";
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = Date.now();
    });
  return true;
}

// GET /api/admin/quiz — l'état de la banque + une page de la file demandée.
router.get("/", async (req, res) => {
  try {
    const kind = req.query.kind === "emoji" ? "emoji" : "question";
    const filter = String(req.query.filter || "pending");
    const Model = kind === "emoji" ? QuizEmoji : QuizQuestion;

    const where =
      filter === "flagged"
        ? { approved: false, flags: { $gt: 0 } }
        : filter === "live"
          ? { approved: true }
          : { approved: false };

    const [rows, counts] = await Promise.all([
      Model.find(where)
        // Les signalements d'abord : ce sont les plus urgents à trancher.
        .sort({ flags: -1, createdAt: -1 })
        .limit(PAGE)
        .lean(),
      Promise.all([
        QuizQuestion.countDocuments({ approved: false }),
        QuizQuestion.countDocuments({ approved: true }),
        QuizQuestion.countDocuments({ approved: false, flags: { $gt: 0 } }),
        QuizEmoji.countDocuments({ approved: false }),
        QuizEmoji.countDocuments({ approved: true }),
        // La part écrite à la main : elle dit si l'import local a déjà eu lieu.
        QuizQuestion.countDocuments({ source: "seed" }),
        QuizEmoji.countDocuments({ source: "seed" }),
        QuizQuestion.countDocuments({ source: "gemini" }),
        QuizEmoji.countDocuments({ source: "gemini" }),
      ]),
    ]);

    res.json({
      kind,
      filter,
      items: rows.map((r) => ({
        id: String(r._id),
        kind: r.kind || kind,
        text: r.text || "",
        choices: r.choices || [],
        // La bonne réponse est TOUJOURS en tête en base (cf. le modèle) : on le
        // dit ici, sinon le relecteur ne sait pas laquelle il valide.
        answer: r.kind === "truefalse" ? r.answer : (r.choices || [])[0],
        explain: r.explain || "",
        emojis: r.emojis || [],
        name: r.name || "",
        gameId: r.gameId ?? null,
        difficulty: r.difficulty || 3,
        theme: r.theme || "",
        source: r.source || "seed",
        approved: !!r.approved,
        flags: r.flags || 0,
        timesAsked: r.timesAsked || 0,
        timesCorrect: r.timesCorrect || 0,
        createdAt: r.createdAt,
      })),
      counts: {
        questionsPending: counts[0],
        questionsLive: counts[1],
        questionsFlagged: counts[2],
        emojisPending: counts[3],
        emojisLive: counts[4],
        questionsSeed: counts[5],
        emojisSeed: counts[6],
        questionsGemini: counts[7],
        emojisGemini: counts[8],
      },
      // De quoi piloter les deux boutons sans deuxième requête.
      job: jobView(),
      geminiReady: isGeminiConfigured(),
    });
  } catch (err) {
    console.error("admin quiz list error:", err.message);
    res.status(500).json({ error: "Banque illisible." });
  }
});

// POST /api/admin/quiz/seed — importer le contenu écrit à la main.
//
// C'est l'équivalent exact de `npm run seed:quiz`, en un clic. Rejouable sans
// risque : tout est upserté sur l'empreinte du texte (questions) ou sur le jeu
// (emojis), et ce qui vient de Gemini ou de l'admin n'est jamais touché.
router.post("/seed", (req, res) => {
  if (!startJob("seed", (onProgress) => seedFromFiles({ onProgress })))
    return res.status(409).json({ error: "Une tâche est déjà en cours." });
  res.json({ job: jobView() });
});

// POST /api/admin/quiz/generate — une fournée écrite par Gemini.
// Tout en sort EN ATTENTE DE RELECTURE : la file « à relire » se remplit, le
// jeu ne change pas tant que rien n'est validé.
router.post("/generate", (req, res) => {
  const questions = Math.min(Math.max(Number(req.body?.questions) ?? 30, 0), 100);
  const emojis = Math.min(Math.max(Number(req.body?.emojis) ?? 20, 0), 100);
  if (!questions && !emojis)
    return res.status(400).json({ error: "Rien à générer." });
  if (!startJob("generate", (onProgress) => generateWithGemini({ questions, emojis, onProgress })))
    return res.status(409).json({ error: "Une tâche est déjà en cours." });
  res.json({ job: jobView() });
});

// GET /api/admin/quiz/job — l'avancement, pour la barre de progression.
// Séparé de GET / : pendant une tâche on interroge toutes les deux secondes, et
// recompter la banque entière à chaque fois serait du gâchis.
router.get("/job", (req, res) => {
  res.json({ job: jobView() });
});

// POST /api/admin/quiz/:id — approuver, retirer, ou corriger.
// Une correction remet les compteurs de terrain à zéro : ils portaient sur une
// AUTRE question, et les garder fausserait le seul garde-fou d'après-vente.
router.post("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Entrée introuvable." });
    const Model = req.body?.kind === "emoji" ? QuizEmoji : QuizQuestion;

    const set = {};
    if (typeof req.body?.approved === "boolean") {
      set.approved = req.body.approved;
      set.reviewedBy = req.userId;
      set.reviewedAt = new Date();
      // Approuver, c'est trancher le signalement : on repart de zéro.
      if (req.body.approved) set.flags = 0;
    }
    if (typeof req.body?.text === "string") set.text = req.body.text.slice(0, 400);
    if (typeof req.body?.explain === "string") set.explain = req.body.explain.slice(0, 500);
    if (Array.isArray(req.body?.choices)) {
      const clean = req.body.choices.map((c) => String(c).slice(0, 160).trim()).filter(Boolean);
      // On refuse une correction qui casserait la question : moins de deux
      // propositions, ou deux fois la même.
      if (clean.length >= 2 && new Set(clean).size === clean.length) {
        set.choices = clean;
        set.timesAsked = 0;
        set.timesCorrect = 0;
      }
    }
    if (Array.isArray(req.body?.emojis)) {
      const clean = req.body.emojis.map((e) => String(e).slice(0, 12)).filter(Boolean);
      if (clean.length >= 3) set.emojis = clean.slice(0, 5);
    }
    if (req.body?.difficulty != null)
      set.difficulty = Math.min(Math.max(Number(req.body.difficulty) || 3, 1), 5);

    if (!Object.keys(set).length)
      return res.status(400).json({ error: "Rien à modifier." });

    const doc = await Model.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: "Entrée introuvable." });

    // Pas de journalisation explicite : `auditLog` est monté globalement dans
    // index.js et enregistre déjà toute écriture d'un administrateur.
    res.json({ ok: true, approved: !!doc.approved });
  } catch (err) {
    console.error("admin quiz update error:", err.message);
    res.status(500).json({ error: "Modification impossible." });
  }
});

// DELETE /api/admin/quiz/:id — jeter définitivement.
// Utile pour les productions du modèle qui ne se rattrapent pas : une question
// dont la prémisse est fausse ne se corrige pas, elle se supprime.
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return res.status(404).json({ error: "Entrée introuvable." });
    const Model = req.query.kind === "emoji" ? QuizEmoji : QuizQuestion;
    await Model.deleteOne({ _id: id });
    res.json({ ok: true });
  } catch (err) {
    console.error("admin quiz delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
