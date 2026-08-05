import mongoose from "mongoose";

// Renommages personnalisés d'OST par utilisateur pour un jeu (ex: retirer un
// préfixe répété comme "Phoenix Wright OST - "). Un doc par (user, game).
const ostRenameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true },
    renames: { type: Map, of: String, default: {} }, // id de piste -> nom personnalisé
  },
  { timestamps: true }
);

ostRenameSchema.index({ user: 1, gameId: 1 }, { unique: true });

export default mongoose.model("OstRename", ostRenameSchema);
