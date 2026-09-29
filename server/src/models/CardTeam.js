import mongoose from "mongoose";

// ======================================================================
//  Un combat de cartes en 2 contre 2 (temps réel)
// ======================================================================
// Quatre places : 0 et 1 pour l'équipe or, 2 et 3 pour l'équipe rose. L'hôte
// ouvre le salon, ses potes s'assoient où ils veulent ; au lancement, les
// places vides sont prises par des bots. Tout l'état de la partie tient dans
// `state` (lib/cardTeam.js), `rev` empêche deux écritures de se croiser.
// Un salon oublié s'efface seul au bout d'un jour.
const seatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const cardTeamSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seats: { type: [seatSchema], default: () => [{}, {}, {}, {}] },
    status: { type: String, enum: ["lobby", "live", "done"], default: "lobby" },
    rev: { type: Number, default: 0 },
    state: { type: mongoose.Schema.Types.Mixed, default: null },
    // La revanche proposée à la fin : le code du salon suivant.
    next: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

cardTeamSchema.index({ "seats.user": 1, status: 1 });
cardTeamSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export default mongoose.model("CardTeam", cardTeamSchema, "cardteams");
