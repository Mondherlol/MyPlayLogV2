import mongoose from "mongoose";

// ======================================================================
//  Une partie solo du Grand Quiz
// ======================================================================
// Même rôle que BlindTest.js / PixelGame.js / GeoGame.js : la trace d'une
// partie finie, qui sert au classement, au bouton « Défier » (on rejoue le
// MÊME set) et à la modale de résultats du fil.
//
// La différence avec les trois autres : une partie du Grand Quiz n'enchaîne
// pas dix fois la même épreuve, elle en enchaîne SEPT DIFFÉRENTES. Une manche
// n'a donc pas de forme fixe — un QCM garde des propositions, un swipe garde
// une pile de jeux, un duel garde ses cartes. D'où le `payload` en Mixed :
// figer un schéma par épreuve aurait voulu dire sept sous-schémas à faire
// évoluer ensemble, pour une donnée qu'on ne relit qu'en bloc au moment de
// rejouer un défi ou d'afficher un récap.
//
// Ce qui EST typé, c'est tout ce sur quoi on requête ou on calcule : le type
// de l'épreuve, les points, la justesse, le temps.

const roundSchema = new mongoose.Schema(
  {
    // qcm | emoji | studio | duel | pixel | swipe | fill
    type: { type: String, required: true },
    durationSec: { type: Number, default: 20 },

    // L'énigme telle qu'elle a été posée + la solution attendue. Rejouée
    // telle quelle par le mode défi : le rejeu doit être À L'IDENTIQUE, y
    // compris les mauvaises propositions d'un QCM et l'ordre des cartes d'un
    // duel — sinon ce n'est plus le même set et le score n'est plus comparable.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Ce que le joueur a répondu, dans la forme propre à l'épreuve.
    given: { type: mongoose.Schema.Types.Mixed, default: null },

    // Réussite « pleine » (toutes les cartes bien placées, les 3 jeux du
    // studio trouvés…). Les épreuves à points partiels (swipe, duel) gardent
    // en plus leur détail dans `payload`/`given`.
    correct: { type: Boolean, default: false },
    // Part de réussite 0→1, pour les épreuves qui se marquent au partiel.
    ratio: { type: Number, default: 0 },
    timeMs: { type: Number, default: null },
    points: { type: Number, default: 0 },
  },
  { _id: false }
);

const quizGameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    score: { type: Number, default: 0 },
    roundCount: { type: Number, default: 0 },
    // Nombre d'épreuves pleinement réussies (pour le « 5/8 » du récap).
    correctCount: { type: Number, default: 0 },

    // Le défi qu'on relevait, s'il y en avait un.
    challengeOf: { type: mongoose.Schema.Types.ObjectId, ref: "QuizGame", default: null },
    challengedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    challengedScore: { type: Number, default: null },

    rounds: { type: [roundSchema], default: [] },
  },
  { timestamps: true }
);

quizGameSchema.index({ user: 1, createdAt: -1 });
quizGameSchema.index({ score: -1 });

export default mongoose.model("QuizGame", quizGameSchema);
