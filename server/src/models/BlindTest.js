import mongoose from "mongoose";

// Une manche de blind test : un extrait d'OST à reconnaître. On garde de quoi
// rejouer EXACTEMENT le même set (videoId + startFrac + le vrai jeu) pour qu'un
// pote puisse défier le joueur, et de quoi afficher la correction (jaquette,
// nom du jeu, titre de la piste, réponse donnée).
const roundSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true }, // le VRAI jeu (la réponse)
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },
    videoId: { type: String, required: true },
    ostName: { type: String, default: "" },
    startFrac: { type: Number, default: 0 }, // où démarrer l'extrait (0→1)
    // Difficulté (relative au joueur de CETTE partie) :
    owned: { type: Boolean, default: false }, // le jeu est dans sa biblio ?
    playtimeHours: { type: Number, default: null },
    rating: { type: Number, default: null },
    // Réponse du joueur :
    guessedGameId: { type: Number, default: null },
    guessedName: { type: String, default: "" },
    correct: { type: Boolean, default: false },
    timeMs: { type: Number, default: null }, // temps de réponse
    points: { type: Number, default: 0 },
  },
  { _id: false }
);

const blindTestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, default: 0 },
    roundCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    durationSec: { type: Number, default: 15 }, // durée d'un extrait
    // Défi : cette partie rejoue le set d'un autre joueur.
    challengeOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlindTest",
      default: null,
    },
    challengedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    challengedScore: { type: Number, default: null }, // le score à battre
    rounds: { type: [roundSchema], default: [] },
  },
  { timestamps: true }
);

// Leaderboard : meilleurs scores, récents d'abord.
blindTestSchema.index({ user: 1, score: -1 });
blindTestSchema.index({ createdAt: -1 });

export default mongoose.model("BlindTest", blindTestSchema);
