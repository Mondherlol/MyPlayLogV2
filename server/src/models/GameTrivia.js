import mongoose from "mongoose";

// Réaction d'un joueur à une anecdote : un emoji, un seul par personne et par
// carte (le re-cliquer l'enlève, en cliquer un autre le remplace). Même règle
// que les réactions d'un avis, cf. models/UserGame.js.
const triviaReactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true },
  },
  { _id: false }
);

// L'image qui illustre une anecdote : la photo du créateur dont on parle, le
// tableau qui a inspiré un décor, la console dont il est question. Elle vient
// de Wikipédia (avec son crédit et son lien, c'est la règle) ou, à défaut,
// d'une capture du jeu — cf. lib/gameTrivia.js.
const triviaImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    credit: { type: String, default: null },
    link: { type: String, default: null },
  },
  { _id: false }
);

// Une anecdote. `key` est une empreinte du texte : elle survit aux fournées
// suivantes (on ajoute des cartes sans renuméroter les anciennes), et c'est
// donc à elle que les réactions s'accrochent.
const triviaFactSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, default: "" },
    // Le texte porte un balisage minimal : `**mot**` met en valeur. C'est le
    // modèle qui le pose, sur ce qui fait le sel de l'anecdote (cf. le prompt).
    text: { type: String, required: true },
    image: { type: triviaImageSchema, default: null },
    // D'OÙ ÇA VIENT. Affiché sous la carte et cliquable : c'est ce qui sépare
    // une anecdote d'une rumeur, et ça vaut mieux que n'importe quelle promesse
    // de fiabilité qu'on pourrait écrire à côté.
    sourceLabel: { type: String, default: null },
    sourceUrl: { type: String, default: null },
    // Le rayon de l'anecdote : « création », « coulisses », « easter egg »,
    // « record », « personnage », « anecdote ». Affiché en pastille sur la
    // carte — c'est ce qui fait qu'on sait avant de lire si on va rire ou
    // apprendre quelque chose.
    tag: { type: String, default: "anecdote" },
    // ⚠️ Vrai dès que l'anecdote raconte quelque chose de l'histoire : elle
    // reste alors CACHÉE tant que le jeu n'est pas fini (cf. app/game/trivia).
    spoiler: { type: Boolean, default: false },
    reactions: { type: [triviaReactionSchema], default: [] },
  },
  { _id: false }
);

// Les anecdotes d'un jeu, écrites une fois par Gemini puis PARTAGÉES par tout
// le monde — même patron que GameText (les traductions) : le premier qui ouvre
// le mode Trivia paie l'appel à l'IA, les suivants lisent la base.
const gameTriviaSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    gameName: { type: String, default: "" },
    // Le jeu SOUCHE sur lequel les anecdotes ont été cherchées. Ouvrir une
    // édition « Definitive » ou un remake et recevoir les coulisses de
    // l'original est voulu — c'est là qu'est l'histoire (cf. lib/gameLore.js).
    // On le retient pour pouvoir le dire à l'écran.
    originalId: { type: Number, default: null },
    originalName: { type: String, default: "" },
    facts: { type: [triviaFactSchema], default: [] },
    // Nombre de fournées demandées. Sert de garde-fou : « encore des
    // anecdotes » ne peut pas être cliqué à l'infini sur le même jeu, un jeu
    // n'a pas cinquante histoires vraies à raconter.
    batches: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("GameTrivia", gameTriviaSchema);
