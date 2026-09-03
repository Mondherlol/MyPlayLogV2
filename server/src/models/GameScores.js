import mongoose from "mongoose";

// La note d'un jeu chez UNE source extérieure (Metacritic, OpenCritic…).
//
// `ok` à faux garde la trace d'une recherche INFRUCTUEUSE : le jeu n'est pas
// référencé là-bas, ou le site a refusé. Sans cette trace, chaque ouverture de
// fiche relancerait la même requête perdue — c'est justement ce qu'on veut
// éviter sur un catalogue de dizaines de milliers de jeux.
const sourceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // "metacritic", "opencritic"…
    score: { type: Number, default: null }, // dans l'échelle de la source
    max: { type: Number, default: 100 }, // 100, 20, 10 : on n'harmonise pas
    count: { type: Number, default: null }, // nb de tests / d'avis, si connu
    url: { type: String, default: null }, // la page, pour aller vérifier
    ok: { type: Boolean, default: false },
    checkedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Cache des notes extérieures d'un jeu, partagé par tous les utilisateurs.
//
// ⚠️ UN JEU DE 2004 NE CHANGE PLUS DE NOTE. C'est le principe de fraîcheur ici
// (cf. lib/gameScores.js) : passé quelques années, une note relevée une fois
// l'est pour toujours et le site extérieur n'est plus jamais rappelé. Seuls les
// jeux récents — dont les tests tombent encore — sont re-relevés, et de plus en
// plus rarement à mesure qu'ils vieillissent.
const gameScoresSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    name: { type: String, default: "" },
    year: { type: Number, default: null },
    sources: { type: [sourceSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("GameScores", gameScoresSchema);
