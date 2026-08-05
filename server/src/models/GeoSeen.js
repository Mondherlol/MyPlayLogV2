import mongoose from "mongoose";

// ======================================================================
//  GeoSeen — la trace « ce joueur a déjà vu ce lieu »
// ======================================================================
// Règle du jeu : chaque joueur tombe sur un panorama donné UNE seule fois.
// Une fois qu'il a fait le tour du catalogue, on lui dit d'attendre que de
// nouveaux lieux arrivent. Cette collection est la mémoire de ce parcours :
// un document par (joueur, lieu) réellement traversé.
//
// Écrit au /finish d'une partie, pas à son démarrage : un joueur qui
// abandonne en cours de route ne « brûle » donc pas les lieux qu'il n'a fait
// que survoler — ils pourront lui être reproposés. Seule une partie menée à
// son terme consomme ses lieux.
//
// Sert aussi au volet social : `correct` retient si le joueur a trouvé le jeu,
// ce qui permet d'afficher aux autres « N de tes amis ont trouvé ce lieu ».
const geoSeenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    panorama: { type: mongoose.Schema.Types.ObjectId, ref: "Panorama", required: true },
    // gameId dénormalisé : évite une jointure pour la règle « pas deux fois le
    // même jeu à quelques parties d'intervalle ».
    gameId: { type: Number, default: null },
    correct: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Un seul enregistrement par (joueur, lieu) : l'upsert au /finish s'appuie
// dessus, et c'est ce qui garantit le « une seule fois ».
geoSeenSchema.index({ user: 1, panorama: 1 }, { unique: true });
// Pour le volet social : « qui a vu / trouvé ce lieu ? ».
geoSeenSchema.index({ panorama: 1, user: 1 });
// Pour lister les jeux récemment vus d'un joueur.
geoSeenSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("GeoSeen", geoSeenSchema);
