import mongoose from "mongoose";

// ======================================================================
//  « Devine le jeu en emojis »
// ======================================================================
// Quatre ou cinq emojis, un titre masqué, et la première personne qui trouve
// rafle la manche. C'est l'épreuve la plus simple à jouer et la plus difficile
// à alimenter : traduire un jeu en emojis est un acte d'écriture, pas une
// requête. IGDB ne le fera jamais.
//
// D'où cette petite collection à part, remplie par deux voies :
//   • src/data/quizEmojis.fr.json, écrit à la main et rejoué par
//     `npm run seed:quiz` — le socle, celui dont on est sûr ;
//   • Gemini via `npm run gen:quiz`, avec relecture obligatoire (`approved`)
//     dans l'onglet Quiz du panneau d'admin, exactement comme les questions.
//
// ------------------------------------------------------- l'énigme, justement
// Une bonne suite d'emojis DÉCRIT sans NOMMER. « 🐺⚔️🃏🧪 » pour The Witcher 3
// marche (le loup, l'épée, le gwent, les potions) ; « 🎮🕹️👾 » ne marche pour
// aucun jeu. La relecture sert d'abord à écarter le second cas — un modèle de
// langage produit très volontiers des suites génériques qui ne désignent rien.
//
// `gameId` est la clé de vérité : c'est lui qui fait le lien avec le titre, la
// jaquette et la comparaison de réponse (sameGame). `name` n'est qu'un cache
// d'affichage pour l'admin, il peut diverger d'IGDB sans conséquence.
const quizEmojiSchema = new mongoose.Schema(
  {
    // L'index est déclaré plus bas, en unique — le poser aussi ici en ferait
    // deux, dont un inutile.
    gameId: { type: Number, required: true },
    name: { type: String, default: "" },
    // Les emojis, un par entrée du tableau : le client les fait apparaître un
    // à un, et c'est bien plus simple à animer qu'une chaîne à découper (un
    // emoji peut occuper plusieurs unités de code UTF-16).
    emojis: { type: [String], default: [] },
    source: { type: String, enum: ["seed", "gemini", "admin"], default: "seed" },
    difficulty: { type: Number, min: 1, max: 5, default: 3 },
    approved: { type: Boolean, default: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    timesAsked: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Une seule suite d'emojis par jeu : le seed upserte dessus, et deux énigmes
// pour le même titre n'apporteraient rien qu'une redite.
quizEmojiSchema.index({ gameId: 1 }, { unique: true });
quizEmojiSchema.index({ approved: 1 });

export default mongoose.model("QuizEmoji", quizEmojiSchema);
