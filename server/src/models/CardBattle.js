import mongoose from "mongoose";

// ======================================================================
//  Un combat de cartes en cours (contre le bot)
// ======================================================================
// Tout l'état de la partie tient dans `state` (mains, pioches, score, manche
// en cours, choix du bot déjà fait) : le serveur décide, le client met en
// scène. `rev` empêche deux requêtes simultanées de jouer la même manche.
// Une partie oubliée s'efface seule au bout d'un jour.
const cardBattleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    live: { type: Boolean, default: true },
    rev: { type: Number, default: 0 },
    state: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

cardBattleSchema.index({ user: 1, live: 1 });
cardBattleSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export default mongoose.model("CardBattle", cardBattleSchema, "cardbattles");
