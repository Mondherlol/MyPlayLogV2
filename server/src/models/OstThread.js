import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Fil de commentaires attaché à l'OST favorite d'un profil, identifiée par
// (owner = propriétaire du profil, gameId = jeu dont vient l'OST). Un document
// par OST commentée ; réutilise exactement le schéma de commentaire des listes.
const ostThreadSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gameId: { type: Number, required: true }, // id IGDB du jeu
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

// Un seul fil par (propriétaire, jeu).
ostThreadSchema.index({ owner: 1, gameId: 1 }, { unique: true });

export default mongoose.model("OstThread", ostThreadSchema);
