import mongoose from "mongoose";

const unlockSchema = new mongoose.Schema(
  {
    apiName: { type: String, required: true },
    name: { type: String, default: "" },
    icon: { type: String, default: null },
    at: { type: Date, default: null },
  },
  { _id: false }
);

// Un envoi du compagnon PC, tel qu'il apparaît dans l'historique du site :
// des succès, du temps de jeu, ou l'ajout d'un jeu à la bibliothèque.
//
//   pending   reçu, pas encore appliqué (jeu à valider, ou mode manuel) ;
//   applied   appliqué au profil — annulable ;
//   undone    annulé après coup — rétablissable ;
//   rejected  refusé avant d'être appliqué — rétablissable aussi.
//
// Les envois rapprochés se regroupent (même jeu, même type, même statut, moins
// de 30 min d'écart) : une soirée de jeu fait UNE ligne « 2 h 15 », pas
// vingt-sept morceaux de cinq minutes.
const companionEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    game: { type: mongoose.Schema.Types.ObjectId, ref: "CompanionGame", required: true },
    type: { type: String, enum: ["achievements", "playtime", "library"], required: true },
    status: {
      type: String,
      enum: ["pending", "applied", "undone", "rejected"],
      default: "pending",
    },
    seconds: { type: Number, default: 0 },
    achievements: { type: [unlockSchema], default: [] },
    // Identifiants des morceaux de temps reçus (un renvoi ne compte pas double).
    chunkIds: { type: [String], default: [] },
    from: { type: Date, default: Date.now },
    to: { type: Date, default: Date.now },
    // Le jeu IGDB sur lequel l'envoi a été appliqué (pour l'annuler au bon endroit).
    appliedGameId: { type: Number, default: null },
    appliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

companionEventSchema.index({ user: 1, status: 1, updatedAt: -1 });
companionEventSchema.index({ game: 1, type: 1, status: 1, to: -1 });
companionEventSchema.index({ user: 1, chunkIds: 1 });

export default mongoose.model("CompanionEvent", companionEventSchema);
