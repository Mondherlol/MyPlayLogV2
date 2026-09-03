import mongoose from "mongoose";

// La réponse brute d'IGDB pour un jeu, gardée en base et partagée par TOUS les
// visiteurs. Sans elle, mille personnes qui ouvrent la même fiche le même jour
// posent mille fois la même question à IGDB — qui n'accepte que 4 requêtes par
// seconde et refuse le reste.
//
// Une ligne = (jeu, `kind`), où `kind` désigne le morceau demandé : "core" pour
// la fiche elle-même, "links" pour sa parenté, "chars" pour ses personnages…
// Chacun a sa propre fraîcheur, mais tous suivent la même règle : c'est L'ÂGE
// DU JEU qui décide (voir lib/gameIgdb.js). Un jeu de 2004 ne bouge plus.
//
// `releaseDate` est recopiée ici exprès : elle permet de juger la fraîcheur
// d'une entrée sans avoir à relire la fiche pour savoir quand le jeu est sorti.
const gameCacheSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    kind: { type: String, required: true },
    // Version du format : la bumper invalide tout le cache d'un coup, ce qui
    // évite d'avoir à vider la collection à la main quand on ajoute un champ.
    ver: { type: Number, default: 1 },
    releaseDate: { type: Number, default: null }, // timestamp IGDB (secondes)
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

gameCacheSchema.index({ gameId: 1, kind: 1 }, { unique: true });

export default mongoose.model("GameCache", gameCacheSchema);
