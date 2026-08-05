import mongoose from "mongoose";

// ======================================================================
//  Une CAISSE : on la paie en points, elle crache un lot de son pool.
// ======================================================================
// Le pool est une liste de lots (Reward) choisie à la main dans le panel admin.
// Les probabilités ne sont PAS stockées : elles se déduisent du poids de chaque
// lot au moment du tirage (voir lib/rarity.js). Une caisse dont le pool est vide
// (ou dont tous les lots sont désactivés) n'est simplement pas ouvrable.
const lootCaseSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", maxlength: 240 },
    // Prix en points. Le débit est vérifié serveur à chaque ouverture.
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: null }, // visuel de la caisse (upload)
    rewards: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Reward" }],
      default: [],
    },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 }, // rang d'affichage dans /arcade
  },
  { timestamps: true }
);

lootCaseSchema.index({ enabled: 1, order: 1 });

export default mongoose.model("LootCase", lootCaseSchema);
