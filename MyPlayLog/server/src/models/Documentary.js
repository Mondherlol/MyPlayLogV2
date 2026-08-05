import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Relation d'un utilisateur avec une vidéo « documentaire » (docu / analyse / test)
// d'un jeu vidéo. Un doc par (user, videoId) regroupe les relations possibles
// pour rester simple à requêter :
//   - seen        : déjà vue → exclue du feed « Lancer un documentaire »
//   - later       : mise dans « Regarder plus tard » (onglet profil, privé)
//   - recommended : recommandée → onglet profil (public) + pool partagé du feed
//   - watched     : réellement regardée (seuil ~30 s / 10 %) → onglet Historique
//                   (public) + évènement « a regardé » du fil
// Recommander / mettre en « plus tard » / lancer la lecture posent aussi seen=true.
// La position de lecture (positionSeconds) permet de reprendre une vidéo.
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
    laterAt: { type: Date, default: null }, // horodatage de mise en « plus tard » (fil)
    recommended: { type: Boolean, default: false },
    recommendedAt: { type: Date, default: null },

    // Relations sociales de CE joueur, horodatées pour le fil (« a aimé » /
    // « a commenté » une vidéo). Le like/commentaire réel vit dans VideoSocial
    // (global) ; ces marqueurs ne servent qu'à dater l'évènement du fil.
    liked: { type: Boolean, default: false },
    likedAt: { type: Date, default: null },
    commented: { type: Boolean, default: false },
    commentedAt: { type: Date, default: null },

    // Historique de visionnage : reprise + barre de progression.
    positionSeconds: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    watched: { type: Boolean, default: false },
    watchedAt: { type: Date, default: null },

    // Interactions sociales sur la recommandation (même schéma que reposts / listes).
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

documentarySchema.index({ user: 1, videoId: 1 }, { unique: true });
documentarySchema.index({ recommended: 1, recommendedAt: -1 }); // pool partagé
documentarySchema.index({ user: 1, recommended: 1 }); // onglet Recommandations
documentarySchema.index({ user: 1, later: 1 }); // onglet Regarder plus tard
documentarySchema.index({ user: 1, watched: 1, watchedAt: -1 }); // Historique + fil
documentarySchema.index({ user: 1, liked: 1, likedAt: -1 }); // « a aimé » — fil
documentarySchema.index({ user: 1, commented: 1, commentedAt: -1 }); // « a commenté » — fil
documentarySchema.index({ user: 1, later: 1, laterAt: -1 }); // « a mis en plus tard » — fil

export default mongoose.model("Documentary", documentarySchema);
