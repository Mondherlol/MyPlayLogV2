import mongoose from "mongoose";

// La partie d'UN joueur sur UN jour du « Mot du jour ».
//
// Il n'y a pas de session en mémoire ici, contrairement au Blind Test et à
// Pixel Rush (cf. la Map `sessions` de routes/pixel.js) : une partie peut durer
// toute la journée, s'interrompre et reprendre depuis un autre appareil. L'état
// vit donc en base, et chaque essai y est ajouté au fil de l'eau.
const guessSchema = new mongoose.Schema(
  {
    w: { type: String, required: true }, // forme canonique du dictionnaire
    // Similarité cosinus brute : conservée pour pouvoir re-trier ou recalibrer
    // l'affichage sans avoir à rejouer la partie.
    sim: { type: Number, required: true },
    temp: { type: Number, required: true }, // température affichée (0-100)
    rank: { type: Number, default: null }, // rang parmi les 1000 plus proches
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const motPlaySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true }, // même clé que MotDuJour.date
    word: { type: String, default: "" }, // dénormalisé pour l'archive

    guesses: { type: [guessSchema], default: [] },
    solved: { type: Boolean, default: false },
    gaveUp: { type: Boolean, default: false },
    tries: { type: Number, default: 0 },
    // Temps écoulé entre le PREMIER essai et la trouvaille — pas depuis minuit :
    // ouvrir le jeu à 8 h ou à 23 h ne doit rien changer au classement.
    timeMs: { type: Number, default: null },
    startedAt: { type: Date, default: Date.now },
    solvedAt: { type: Date, default: null },

    score: { type: Number, default: 0 },
    // Garde-fou d'idempotence : les points ne sont crédités qu'une fois, même si
    // deux requêtes de victoire arrivaient en parallèle.
    pointsGranted: { type: Boolean, default: false },

    // --- Partie à plusieurs (models/MotSession.js) ---
    // La session où je joue EN CE MOMENT. `null` = je joue en solo. Sortir d'une
    // session la remet à null tout en conservant les essais et les mots gagnés
    // en commun : c'est ce qui permet de repartir en solo là où le groupe en
    // était.
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MotSession",
      default: null,
    },
    // La session AVEC LAQUELLE j'ai trouvé le mot. Renseignée seulement en cas
    // de victoire collective — c'est elle qui permet au classement du jour de
    // regrouper les vainqueurs en une seule ligne d'équipe au lieu d'en
    // afficher trois avec le même nombre d'essais.
    wonWith: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MotSession",
      default: null,
    },
  },
  { timestamps: true }
);

// Une seule partie par joueur et par jour : c'est la règle du jeu, et l'index
// unique la fait respecter par la base plutôt que par la route.
motPlaySchema.index({ user: 1, date: 1 }, { unique: true });
// Classement du jour, et cumul par joueur.
motPlaySchema.index({ date: 1, solved: 1, score: -1 });
motPlaySchema.index({ user: 1, score: -1 });

export default mongoose.model("MotPlay", motPlaySchema);
