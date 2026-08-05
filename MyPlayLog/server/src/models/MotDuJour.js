import mongoose from "mongoose";

// ======================================================================
//  Un jour de jeu du « Mot du jour ».
// ======================================================================
// Un seul mot pour TOUS les joueurs, de minuit à minuit (heure de Paris). C'est
// ce qui distingue ce mini-jeu des trois autres : le Blind Test et Pixel Rush
// piochent dans la bibliothèque de chacun, donc leurs scores ne sont pas
// vraiment comparables. Ici, tout le monde a exactement la même énigme — le
// classement du jour veut enfin dire quelque chose.
//
// Ce document est volontairement MAIGRE. Le calibrage et les 1000 mots les plus
// proches n'y sont PAS stockés : ils se recalculent en 30 ms à partir du mot
// (lib/mots.js → calibrate) et vivent dans un cache mémoire côté route. Trois
// bonnes raisons :
//
//   - 30 Ko par jour de voisins, ça ferait 11 Mo par an pour des données
//     entièrement dérivées d'un seul champ ;
//   - le calcul est DÉTERMINISTE : deux instances du serveur trouvent le même
//     résultat sans se coordonner ;
//   - si le dictionnaire est reconstruit un jour, rien ne devient périmé.
const motDuJourSchema = new mongoose.Schema(
  {
    // Clé du jour : « 2026-07-30 » sur le fuseau Europe/Paris.
    date: { type: String, required: true, unique: true },
    word: { type: String, required: true },

    // L'anecdote « En parlant de {mot}… », révélée à la victoire.
    //
    // C'est le SEUL endroit du jeu où l'on appelle Gemini, et c'est un usage où
    // son indéterminisme est sans conséquence : un appel par jour, hors du
    // chemin critique, mis en cache pour toujours. S'il ne répond pas, la
    // partie se déroule normalement et on retentera plus tard — d'où le
    // compteur `tries` qui borne les tentatives.
    anecdote: {
      title: { type: String, default: "" },
      text: { type: String, default: "" },
      // Le jeu cité, enrichi côté IGDB (jaquette cliquable dans la révélation).
      game: {
        name: { type: String, default: "" },
        igdbId: { type: Number, default: null },
        cover: { type: String, default: null },
        year: { type: Number, default: null },
      },
      tries: { type: Number, default: 0 }, // tentatives Gemini déjà faites
      at: { type: Date, default: null }, // date d'obtention (null = pas encore)
    },

    // Compteurs dénormalisés, mis à jour à chaque partie terminée : ils
    // alimentent le « 47 joueurs ont trouvé aujourd'hui » sans agrégation.
    stats: {
      players: { type: Number, default: 0 },
      solved: { type: Number, default: 0 },
      bestTries: { type: Number, default: null },
      totalTries: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// L'archive se lit du plus récent au plus ancien.
motDuJourSchema.index({ date: -1 });

export default mongoose.model("MotDuJour", motDuJourSchema);
