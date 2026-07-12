import mongoose from "mongoose";

// Cache des patchs FR Switch (nxbrew.net) résolus pour un jeu, afin de ne pas
// re-scraper le site à chaque ouverture. On met en cache aussi les « rien
// trouvé » (data: null), avec un TTL plus court, pour ne pas marteler le site —
// mais jamais les « site injoignable » (géré côté résolveur : on n'écrit pas).
const switchPatchSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    data: { type: Object, default: null }, // patch normalisé, ou null si aucun
    ver: { type: Number, default: 0 }, // version de l'algo de scraping
    at: { type: Date, default: null }, // date de la dernière résolution
  },
  { timestamps: true }
);

export default mongoose.model("SwitchPatchCache", switchPatchSchema);
