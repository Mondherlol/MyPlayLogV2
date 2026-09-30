import mongoose from "mongoose";

// ======================================================================
//  « Ce joueur est venu ce jour-là » — une ligne par joueur et par jour
// ======================================================================
// Écrite une seule fois par jour et par joueur, à sa première requête
// authentifiée (lib/siteStats.js). Sert à compter les joueurs actifs par jour
// (onglet Statistiques du panel admin). `day` est la date à Paris.
const activeDaySchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // AAAA-MM-JJ, heure de Paris
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now }, // première requête du jour
  },
  { versionKey: false }
);

activeDaySchema.index({ day: 1, user: 1 }, { unique: true });
activeDaySchema.index({ at: 1 }, { expireAfterSeconds: 400 * 86400 });

export default mongoose.model("ActiveDay", activeDaySchema, "activedays");
