import mongoose from "mongoose";

// ======================================================================
//  Le journal des Éclats : chaque recyclage, chaque forge
// ======================================================================
// Sert à ANNULER (le toast « Annuler » juste après) : on sait exactement
// quelles cartes rendre et combien d'Éclats reprendre. `firstAt` garde la date
// d'arrivée d'une carte recyclée jusqu'au dernier exemplaire, pour qu'une
// annulation la remette à sa place dans « Récentes ».
const cardShardLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["recycle", "forge"], required: true },
    cards: {
      type: [
        {
          card: { type: Number, required: true },
          n: { type: Number, required: true },
          firstAt: { type: Date, default: null },
          fav: { type: Boolean, default: false },
          _id: false,
        },
      ],
      default: [],
    },
    // Signé : + au recyclage, - à la forge.
    shards: { type: Number, required: true },
    undone: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

cardShardLogSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("CardShardLog", cardShardLogSchema, "cardshardlogs");
