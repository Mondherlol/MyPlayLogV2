import express from "express";
import mongoose from "mongoose";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

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
      },
    });
  } catch (err) {
    console.error("admin quiz list error:", err.message);
    res.status(500).json({ error: "Banque illisible." });
  }
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
