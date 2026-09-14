import mongoose from "mongoose";

// À quel point un joueur attend un jeu qui n'est pas encore sorti, de 0 à 100.
//
// ⚠️ PAS UN CHAMP DE `UserGame`. On peut être hypé par un jeu sans l'avoir mis
// dans sa bibliothèque — c'est même le cas le plus courant le soir d'une
// annonce —, et créer une entrée de bibliothèque pour ranger un curseur
// ferait apparaître des jeux « à jouer » que personne n'a ajoutés.
const gameHypeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true }, // id IGDB
    level: { type: Number, min: 0, max: 100, required: true },
  },
  { timestamps: true }
);

gameHypeSchema.index({ user: 1, gameId: 1 }, { unique: true });
// La moyenne d'un jeu se calcule par gameId seul (cf. UserGame, même raison).
gameHypeSchema.index({ gameId: 1 });

export default mongoose.model("GameHype", gameHypeSchema);
