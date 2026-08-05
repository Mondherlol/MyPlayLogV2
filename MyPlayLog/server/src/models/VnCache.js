import mongoose from "mongoose";

// Cache des personnages VNDB résolus pour un visual novel, afin de ne pas
// interroger l'API VNDB à chaque ouverture. Rafraîchi si vide et périmé.
const vnCacheSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    vnId: { type: String, default: null }, // id VNDB (ex: "v2002") ou null
    characters: { type: Array, default: [] },
    ver: { type: Number, default: 0 }, // version de l'algo de résolution (invalide le cache)
    // Patchs de traduction FR (onglet Patchs) — cache séparé (invalidation propre).
    frPatches: { type: Array, default: [] },
    frPatchesVer: { type: Number, default: 0 },
    frPatchesAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("VnCache", vnCacheSchema);
