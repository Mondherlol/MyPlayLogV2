import mongoose from "mongoose";

// Les voisins « co-joués » d'un jeu : ceux que les joueurs qui ont aimé ce jeu
// ont aussi aimés (cf. lib/coPlay.js pour le calcul, lib/recoCoPlay.js pour
// l'import). Deux listes, qui vivent chacune à leur rythme :
//   - `ext`   : calculée sur ton PC à partir de millions d'avis publics
//     (Amazon, Steam), livrée avec le serveur dans data/coplay.json.gz ;
//   - `local` : recalculée chaque nuit sur les bibliothèques de MyPlayLog.
//
// Format à plat pour tenir peu de place : [id, force×1000, id, force×1000, …].
const gameNeighborsSchema = new mongoose.Schema(
  {
    _id: { type: Number }, // id IGDB
    ext: { type: [Number], default: [] },
    local: { type: [Number], default: [] },
  },
  { versionKey: false }
);

export default mongoose.model("GameNeighbors", gameNeighborsSchema, "gameneighbors");
