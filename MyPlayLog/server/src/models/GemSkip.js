import mongoose from "mongoose";

// Jeu écarté d'un swipe gauche dans la découverte de pépites : l'utilisateur
// ne veut plus JAMAIS le revoir dans ses prochaines fournées (exclu côté
// serveur au même titre que sa bibliothèque).
const gemSkipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true }, // id IGDB
  },
  { timestamps: true }
);

gemSkipSchema.index({ user: 1, gameId: 1 }, { unique: true });

export default mongoose.model("GemSkip", gemSkipSchema);
