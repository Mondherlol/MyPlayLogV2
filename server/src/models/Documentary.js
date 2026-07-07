import mongoose from "mongoose";

// Relation d'un utilisateur avec une vidéo « documentaire » (docu / analyse / test)
// d'un jeu vidéo. Un doc par (user, videoId) regroupe les trois relations
// possibles pour rester simple à requêter :
//   - seen        : déjà vue → exclue du feed « Lancer un documentaire »
//   - later       : mise dans « Regarder plus tard » (onglet profil, privé)
//   - recommended : recommandée → onglet profil (public) + pool partagé du feed
// Recommander / mettre en « plus tard » / lancer la lecture posent aussi seen=true.
const documentarySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    videoId: { type: String, required: true },

    // Snapshot des métadonnées YouTube (pour l'affichage sans re-scraper).
    title: { type: String, default: "" },
    author: { type: String, default: "" },
    thumb: { type: String, default: null },
    duration: { type: String, default: null },

    // Jeu d'origine (null pour une vidéo venue du pool communautaire).
    gameId: { type: Number, default: null },
    gameName: { type: String, default: null },

    // Flags
    seen: { type: Boolean, default: false },
    later: { type: Boolean, default: false },
    recommended: { type: Boolean, default: false },
    recommendedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

documentarySchema.index({ user: 1, videoId: 1 }, { unique: true });
documentarySchema.index({ recommended: 1, recommendedAt: -1 }); // pool partagé
documentarySchema.index({ user: 1, recommended: 1 }); // onglet Recommandations
documentarySchema.index({ user: 1, later: 1 }); // onglet Regarder plus tard

export default mongoose.model("Documentary", documentarySchema);
