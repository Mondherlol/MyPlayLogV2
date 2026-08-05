import mongoose from "mongoose";

// ======================================================================
//  L'avancement d'un joueur sur une mission : accomplie, puis récupérée.
// ======================================================================
// Le catalogue des missions vit dans le code (lib/missions.js) — ici on ne
// garde QUE l'état par joueur, par slug stable, en DEUX temps :
//
//   status "ready"   → la mission est accomplie, la récompense attend d'être
//                      réclamée (le joueur clique « Récupérer »).
//   status "claimed" → points crédités, badge acquis. Terminal.
//
// Séparer les deux compte : accomplir une mission ne doit jamais créditer des
// points dans le dos du joueur — c'est lui qui vient les chercher.
// L'index unique (user, missionKey) rend le passage en "ready" idempotent, et
// la réclamation se fait par une mise à jour conditionnelle sur le statut :
// deux clics simultanés ne peuvent pas créditer deux fois.
const missionAwardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    missionKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["ready", "claimed"],
      default: "ready",
      required: true,
    },
    // Points crédités À LA RÉCUPÉRATION (instantané : si le barème d'une
    // mission change ensuite, on ne recrédite ni ne réajuste jamais).
    points: { type: Number, default: 0 },
    readyAt: { type: Date, default: Date.now },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

missionAwardSchema.index({ user: 1, missionKey: 1 }, { unique: true });
missionAwardSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("MissionAward", missionAwardSchema);
