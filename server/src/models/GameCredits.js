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
    // Son identifiant Wikidata (Q…), quand on a su le trouver. C'est LA clé
    // qui permet de demander « et quoi d'autre ? » : deux homonymes ont le
    // même nom, jamais le même Q (cf. lib/gameCredits, `creditsWorks`).
    qid: { type: String, default: null },
  },
  { _id: false }
);

// Un jeu d'un autre jeu de la personne : juste de quoi poser une jaquette
// cliquable sous sa carte.
const workGameSchema = new mongoose.Schema(
  { id: Number, name: String, cover: { type: String, default: null }, year: Number },
  { _id: false }
);

// « Il a aussi fait… », par personne. Séparé des personnes elles-mêmes parce
// que ça se calcule à part, plus tard et plus lentement : l'équipe s'affiche
// sans attendre Wikidata (cf. GET /games/:id/credits/works).
const workSchema = new mongoose.Schema(
  { qid: String, games: { type: [workGameSchema], default: [] } },
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
    works: { type: [workSchema], default: [] },
    worksVer: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("GameCredits", gameCreditsSchema);
