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
    // Relevés au scraping de la playlist (cf. lib/ostScrape.js). `null` pour
    // les pistes ajoutées à la main et pour celles scrapées avant l'ajout de
    // ces champs — d'où `npm run backfill:ost-stats`.
    //
    // Les VUES sont ce qui permet au blind test de ne pas tirer au hasard dans
    // 200 pistes dont personne n'a jamais entendu la moitié : un morceau à 3 M
    // de vues est un morceau que les joueurs reconnaissent.
    views: { type: Number, default: null },
    durationSec: { type: Number, default: null },
    playlistId: { type: String, default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CustomOst", customOstSchema);
