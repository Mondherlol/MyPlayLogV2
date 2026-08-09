import mongoose from "mongoose";

// ======================================================================
//  La banque de questions du Grand Quiz
// ======================================================================
// Le Grand Quiz a besoin de CULTURE GÉNÉRALE JEU VIDÉO EN FRANÇAIS, et c'est
// la seule chose du site qu'aucune API ne sait fournir. IGDB donne des faits
// (une date, un studio, une plateforme) mais pas une question ; personne ne
// publie de banque de trivia JV en français réutilisable.
//
// On en fabrique donc une, en trois nappes qui se complètent :
//
//   1. LES FAITS (source « igdb ») — générés à la volée par lib/quizBank.js à
//      partir des données IGDB. Infinis, toujours justes, jamais périmés… mais
//      d'une forme mécanique (« En quelle année est sorti X ? »). Ils ne
//      passent PAS par ce modèle : ils sont recalculés à chaque partie, il n'y
//      a rien à stocker. Le modèle ne garde que ce qui se rédige.
//   2. LE SEED (source « seed ») — src/data/quizQuestions.fr.json, écrit à la
//      main, commité, rejoué par `npm run seed:quiz`. C'est le socle de
//      qualité : les questions qu'on veut voir tomber le premier jour.
//   3. GEMINI (source « gemini ») — `npm run gen:quiz` remplit la banque hors
//      ligne, JAMAIS pendant une partie. Une question inventée par un modèle
//      peut être fausse : elle arrive donc avec `approved: false` et ne sera
//      jamais tirée avant relecture dans l'onglet Quiz du panneau d'admin.
//
// ------------------------------------------------------------- pourquoi hors
// La tentation était de générer avec Gemini au lancement de chaque partie.
// Trois raisons de ne pas le faire : la latence (plusieurs secondes avant la
// première question), le quota (une partie = un appel, à plusieurs joueurs ça
// s'envole), et surtout l'impossibilité de relire. Une question fausse tombée
// en versus, c'est une manche volée à quelqu'un.

const quizQuestionSchema = new mongoose.Schema(
  {
    // « qcm » : quatre propositions, une bonne. « truefalse » : vrai ou faux,
    // qui alimente aussi les piles de l'épreuve de swipe.
    kind: { type: String, enum: ["qcm", "truefalse"], default: "qcm" },

    text: { type: String, required: true, trim: true },
    // Pour un QCM : les propositions, la bonne EN PREMIER. L'ordre est
    // mélangé au tirage (cf. lib/quizBank.js) — stocker la réponse à l'index 0
    // évite de trimballer un champ d'index qui se désynchronise à la première
    // édition depuis l'admin.
    choices: { type: [String], default: [] },
    // Pour un vrai/faux : la réponse. Ignoré pour un QCM.
    answer: { type: Boolean, default: null },

    // La petite phrase affichée à la révélation. C'est ce qui fait la
    // différence entre un quiz et un contrôle : on apprend quelque chose même
    // quand on s'est trompé.
    explain: { type: String, default: "" },

    source: { type: String, enum: ["seed", "gemini", "igdb", "admin"], default: "seed" },
    // 1 (grand public) → 5 (pointu). Sert à doser une partie, pas à filtrer.
    difficulty: { type: Number, min: 1, max: 5, default: 3 },
    // Thème libre (« sagas », « studios », « histoire », « personnages »…) :
    // évite trois questions Nintendo d'affilée.
    theme: { type: String, default: "" },
    // Le jeu concerné, quand la question en vise un : permet d'illustrer la
    // question avec sa jaquette et d'éviter de le reprendre dans une autre
    // épreuve de la même partie.
    gameId: { type: Number, default: null },

    // Une question Gemini n'est jamais tirée avant relecture humaine.
    approved: { type: Boolean, default: false, index: true },
    // Qui a relu, et quand : l'onglet admin l'affiche.
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    // Statistiques de terrain. Une question que personne ne rate est trop
    // facile, une que personne ne trouve est probablement fausse : ces deux
    // compteurs sont le seul garde-fou qu'on ait APRÈS la mise en service.
    timesAsked: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 },
    // Signalée par un joueur comme douteuse → repasse en relecture.
    flags: { type: Number, default: 0 },

    // Empreinte du texte : empêche `npm run gen:quiz` de réécrire vingt fois
    // « Qui a développé Bloodborne ? » au fil des fournées. Son index est
    // déclaré plus bas, en unique.
    fingerprint: { type: String },
  },
  { timestamps: true }
);

// Le tirage part toujours de « approuvée », puis filtre par thème/difficulté.
quizQuestionSchema.index({ approved: 1, kind: 1, difficulty: 1 });
quizQuestionSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });

export default mongoose.model("QuizQuestion", quizQuestionSchema);
