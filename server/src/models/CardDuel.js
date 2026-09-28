import mongoose from "mongoose";

// ======================================================================
//  Un duel de cartes entre deux joueurs (1 contre 1, en temps réel)
// ======================================================================
// Le salon a une adresse (`code`, dans le lien qu'on envoie) : l'hôte l'ouvre,
// l'invité le rejoint, la partie part aussitôt. Tout l'état de la partie tient
// dans `state`, sur le modèle du combat contre le bot (lib/cardBattle.js) :
// l'hôte y est « you », l'invité « bot » — c'est la vue de chacun qui remet
// les côtés à l'endroit. `rev` empêche deux écritures de se croiser.
// Un salon oublié s'efface seul au bout d'un jour.
const cardDuelSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    guest: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Une revanche : celui qu'on attend (le salon lui reste ouvert à tous).
    rival: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["lobby", "live", "done"], default: "lobby" },
    rev: { type: Number, default: 0 },
    state: { type: mongoose.Schema.Types.Mixed, default: null },
    // La revanche proposée à la fin : le code du salon suivant.
    next: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

cardDuelSchema.index({ host: 1, status: 1 });
cardDuelSchema.index({ guest: 1, status: 1 });
cardDuelSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export default mongoose.model("CardDuel", cardDuelSchema, "cardduels");
