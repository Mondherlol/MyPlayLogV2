import mongoose from "mongoose";

// Patchs FR Switch (nxbrew.net) d'un jeu. Le scraping ne se fait PLUS côté
// serveur (l'IP datacenter du VPS est bloquée par Cloudflare) : une app locale
// (AUTRES/nxbrew-manager) tourne sur une machine à IP résidentielle, scrape, et
// pousse ici les données via l'API admin. Ce document sert donc de store :
//   - `data`     : patch normalisé poussé par l'app locale (ou null si aucun)
//   - `requested`: un utilisateur a cliqué « Demander » → l'app locale la voit
const switchPatchSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    name: { type: String, default: "" }, // nom du jeu (pour l'app locale)
    data: { type: Object, default: null }, // patch normalisé, ou null si aucun
    ver: { type: Number, default: 0 }, // version de l'algo de scraping
    at: { type: Date, default: null }, // date du dernier push admin
    requested: { type: Boolean, default: false }, // demande de scrape en attente
    requestedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("SwitchPatchCache", switchPatchSchema);
