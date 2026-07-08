import mongoose from "mongoose";

// Piste d'OST d'un jeu (lien YouTube), partagée pour ce jeu. Deux origines :
//  - "auto" : scrapée depuis une playlist YouTube à la 1re ouverture de l'onglet ;
//  - "user" : ajoutée manuellement par un utilisateur.
const customOstSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    artist: { type: String, default: null },
    url: { type: String, required: true },
    videoId: { type: String, required: true },
    artwork: { type: String, default: null },
    source: { type: String, enum: ["auto", "user"], default: "user" },
    order: { type: Number, default: 0 }, // ordre dans la playlist (pistes auto)
    playlistId: { type: String, default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CustomOst", customOstSchema);
