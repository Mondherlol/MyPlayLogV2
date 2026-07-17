import mongoose from "mongoose";

// ======================================================================
//  Grand livre des points : une ligne par gain / dépense.
// ======================================================================
// `User.points` est le solde dénormalisé (lu partout, tout le temps) ; ce modèle
// est l'historique qui explique COMMENT on y est arrivé. Il sert à afficher
// « d'où viennent mes points » et à retrouver un solde en cas de pépin.
//
// Ajouter une nouvelle façon de gagner des points = ajouter une source ici,
// puis appeler grantPoints(userId, montant, "ma-source") depuis la route
// concernée. Rien d'autre à câbler.
export const POINT_SOURCES = {
  blindtest: "Blind test",
  case: "Ouverture de caisse",
  duplicate: "Doublon reconverti",
  admin: "Ajustement admin",
  // Rattrapage des parties jouées AVANT l'arcade (scripts/backfillArcadePoints.js).
  backfill: "Parties d'avant l'arcade",
};

const pointEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Signé : positif = gain, négatif = dépense.
    amount: { type: Number, required: true },
    source: { type: String, required: true },
    // Solde APRÈS l'opération (pratique pour l'historique, évite un recalcul).
    balance: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

pointEntrySchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("PointEntry", pointEntrySchema);
