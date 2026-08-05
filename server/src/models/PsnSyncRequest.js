import mongoose from "mongoose";

// Une demande de synchro PlayStation en attente de traitement par le WORKER
// maison (l'IP du VPS étant bloquée par Sony/Akamai, le VPS ne parle jamais à
// PSN : il enregistre la demande, le PC de l'admin la traite et renvoie le
// résultat). Cycle de vie : pending → processing → done | error.
const psnSyncRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // PSN ID saisi (première liaison) ; null pour une simple re-synchro d'un
    // compte déjà lié (le worker utilise alors l'accountId déjà connu).
    psnId: { type: String, default: null },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "error"],
      default: "pending",
    },
    error: { type: String, default: null },
    // Petit résumé pour l'affichage (panel admin / user).
    summary: {
      games: { type: Number, default: 0 },
      trophies: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
    },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

psnSyncRequestSchema.index({ status: 1, createdAt: 1 });
psnSyncRequestSchema.index({ user: 1, status: 1 });

export default mongoose.model("PsnSyncRequest", psnSyncRequestSchema);
