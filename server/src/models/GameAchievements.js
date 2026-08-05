import mongoose from "mongoose";

// Un succès individuel (Steam pour l'instant ; même forme prévue pour PSN).
const achievementSchema = new mongoose.Schema(
  {
    apiName: { type: String, required: true }, // identifiant technique (apiname Steam)
    name: { type: String, default: "" }, // libellé lisible
    description: { type: String, default: "" },
    icon: { type: String, default: null },
    hidden: { type: Boolean, default: false },
    unlocked: { type: Boolean, default: false },
    unlockedAt: { type: Date, default: null },
    // Rareté mondiale : % de joueurs ayant débloqué ce succès (null si inconnu).
    rarity: { type: Number, default: null },
    // PSN uniquement : grade du trophée (bronze | silver | gold | platinum).
    tier: { type: String, default: null },
  },
  { _id: false }
);

// Les succès d'UN joueur pour UN jeu, sur UNE plateforme. On stocke le tout
// (débloqués ou non) pour calculer taux de complétion, succès rares, etc. dans
// l'onglet « Succès » du profil. Rafraîchi à chaque import.
const gameAchievementsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true }, // id IGDB (rattachement à la fiche)
    platform: { type: String, enum: ["steam", "psn"], default: "steam" },
    // Référence propre à la plateforme (appid Steam / npCommunicationId PSN).
    platformAppId: { type: String, default: null },
    gameName: { type: String, default: "" },
    gameCover: { type: String, default: null },
    total: { type: Number, default: 0 },
    unlocked: { type: Number, default: 0 },
    achievements: { type: [achievementSchema], default: [] },
  },
  { timestamps: true }
);

// Un seul enregistrement par (utilisateur, jeu, plateforme).
gameAchievementsSchema.index({ user: 1, gameId: 1, platform: 1 }, { unique: true });

export default mongoose.model("GameAchievements", gameAchievementsSchema);
