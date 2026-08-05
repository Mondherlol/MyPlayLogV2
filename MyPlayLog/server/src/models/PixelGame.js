import mongoose from "mongoose";

// Une manche de Pixel Rush : des screenshots d'un jeu, affichés très pixelisés,
// dont la définition remonte au fil du chrono. On garde les URLs exactes pour
// pouvoir rejouer le même set (défi entre joueurs) et afficher la correction.
const roundSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true }, // le VRAI jeu (la réponse)
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },
    shots: { type: [String], default: [] }, // screenshots IGDB (2 à 4)
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

const pixelGameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, default: 0 },
    roundCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    durationSec: { type: Number, default: 30 }, // durée d'une manche
    // Défi : cette partie rejoue le set d'un autre joueur.
    challengeOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PixelGame",
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
pixelGameSchema.index({ user: 1, score: -1 });
pixelGameSchema.index({ createdAt: -1 });

export default mongoose.model("PixelGame", pixelGameSchema);
