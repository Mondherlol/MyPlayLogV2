import mongoose from "mongoose";

// Cache des traductions FR (à la demande) du résumé et du scénario d'un jeu.
// Rempli quand un utilisateur clique « Traduire » sur la fiche, puis partagé
// entre tous — même pattern que GameMeta/VnCache. On mémorise aussi le texte
// source EN pour détecter un changement côté IGDB et invalider la traduction.
const gameTextSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    summaryEn: { type: String, default: null },
    summaryFr: { type: String, default: null },
    storylineEn: { type: String, default: null },
    storylineFr: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("GameText", gameTextSchema);
