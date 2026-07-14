import mongoose from "mongoose";

// Une partie jouée sur un jeu tracké (Marvel Rivals…). Source dédiée du fil
// d'actualité — comme models/Download.js : les parties rapprochées d'un même
// joueur sont regroupées en une carte « a enchaîné N parties sur … » (voir le
// clustering dans routes/feed.js). Sert aussi d'historique pour l'onglet
// Tracking du profil.
const trackerMatchSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    provider: { type: String, required: true, enum: ["marvel-rivals"] },
    matchUid: { type: String, required: true }, // id de la partie chez le provider
    playedAt: { type: Date, required: true },

    hero: {
      name: { type: String, default: null },
      thumb: { type: String, default: null },
    },
    k: { type: Number, default: 0 },
    d: { type: Number, default: 0 },
    a: { type: Number, default: 0 },
    kda: { type: Number, default: 0 },
    win: { type: Boolean, default: false },
    mode: { type: String, default: null },
    map: { type: String, default: null },
  },
  { timestamps: true }
);

// Anti-doublon : une partie n'est enregistrée qu'une fois par joueur.
trackerMatchSchema.index({ user: 1, matchUid: 1 }, { unique: true });
// Fil + historique : parcours anté-chronologique par joueur/provider.
trackerMatchSchema.index({ user: 1, provider: 1, playedAt: -1 });

export default mongoose.model("TrackerMatch", trackerMatchSchema);
