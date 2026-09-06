import mongoose from "mongoose";

// Une personne créditée sur un jeu. `roles` est un tableau parce qu'on
// n'affiche qu'UNE carte par personne : Hideo Kojima est réalisateur,
// producteur, game designer ET scénariste de Death Stranding.
const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    roles: { type: [String], default: [] },
    // Photo : Wikimedia Commons pour la distribution, la vignette de l'article
    // Wikipédia pour l'équipe. Souvent absente — beaucoup de gens qui font les
    // jeux n'ont pas de portrait libre de droits, et c'est normal.
    image: { type: String, default: null },
    // Sa page Wikipédia, quand elle existe : c'est là qu'on l'envoie.
    link: { type: String, default: null },
    // La phrase de présentation (« compositeur polonais »).
    note: { type: String, default: null },
  },
  { _id: false }
);

// L'équipe d'un jeu, écrite une fois puis partagée — même patron que GameText
// et GameTrivia. Ces faits-là ne bougent plus une fois le jeu sorti ; `ver`
// permet de tout réécrire le jour où l'on change ce qu'on extrait.
const gameCreditsSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    gameName: { type: String, default: "" },
    people: { type: [personSchema], default: [] },
    source: {
      label: { type: String, default: null },
      url: { type: String, default: null },
    },
    ver: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("GameCredits", gameCreditsSchema);
