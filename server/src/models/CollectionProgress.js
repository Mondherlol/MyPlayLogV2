import mongoose from "mongoose";

// Où en est CE joueur sur CE média de la collection.
// Un doc par (user, media) : la reprise de lecture (« la cassette redémarre
// là où tu l'as arrêtée ») et les épisodes déjà vus, qui cochent la liste
// d'épisodes et alimentent la rangée « Reprendre » de la page Collection.
const collectionProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CollectionMedia",
      required: true,
    },

    // Épisode en cours (index absolu dans CollectionMedia.episodes ; 0 pour
    // un film) et position dans cet épisode.
    episodeIndex: { type: Number, default: 0 },
    positionSeconds: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },

    // Index des épisodes terminés (vus à ~90 %, ou cochés à la main).
    watched: { type: [Number], default: [] },

    completed: { type: Boolean, default: false },
    lastWatchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

collectionProgressSchema.index({ user: 1, media: 1 }, { unique: true });
collectionProgressSchema.index({ user: 1, lastWatchedAt: -1 }); // « Reprendre »

export default mongoose.model("CollectionProgress", collectionProgressSchema);
