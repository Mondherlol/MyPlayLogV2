import mongoose from "mongoose";

// « Délit de téléchargement » : quand un joueur clique sur un lien de
// téléchargement dans l'onglet Patchs d'une fiche jeu (C411, FitGirl, NxBrew,
// fan-trad…), on journalise l'acte pour l'afficher dans le fil d'actualité sous
// une card humoristique (« X a téléchargé Y depuis Z ») où les autres joueurs
// peuvent le huer / lui jeter une tomate / le traiter de monstre.
//
// Purement pour le fun : aucun lien réel n'est stocké, juste le forfait avoué.
const downloadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gameId: { type: Number, required: true }, // id IGDB du jeu
    gameName: { type: String, required: true },
    gameCover: { type: String, default: null },
    // Section d'où vient le téléchargement (label affiché : « C411 », « FitGirl »,
    // « NxBrew », « une traduction FR »…).
    source: { type: String, required: true },
    // Choisit le texte rigolo de la card (stable pour un même délit).
    variant: { type: Number, default: 0 },
    // Réactions moqueuses : chacune indépendante (on peut huer ET jeter une
    // tomate ET traiter de monstre). type ∈ "boo" | "tomato" | "monster".
    reactions: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          type: { type: String },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Fil : parcours anté-chronologique paginé par joueur.
downloadSchema.index({ user: 1, createdAt: -1 });
// Anti-spam : retrouver un délit récent sur le même jeu/source.
downloadSchema.index({ user: 1, gameId: 1, source: 1, createdAt: -1 });

export default mongoose.model("Download", downloadSchema);
