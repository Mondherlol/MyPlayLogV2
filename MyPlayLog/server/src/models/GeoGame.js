import mongoose from "mongoose";

// Une manche de GeoGamer : on est lâché dans un panorama 360° d'un jeu, sans
// pouvoir se déplacer, et on doit nommer le jeu. Même forme que PixelGame —
// c'est volontaire : les trois mini-jeux partagent le contrat de classement
// (`bestScore` / `score`) et de défi, donc l'arcade les affiche sans savoir
// duquel elle parle.
const roundSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true }, // le VRAI jeu (la réponse)
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },
    // Le lieu joué. On garde l'URL en dur EN PLUS de la référence : si un
    // panorama est retiré du catalogue plus tard, le récap d'une vieille partie
    // (et le défi qui la rejoue) doit continuer de montrer la bonne image.
    panorama: { type: mongoose.Schema.Types.ObjectId, ref: "Panorama", default: null },
    image: { type: String, default: "" },
    difficulty: { type: Number, default: 3 },

    // Difficulté relative au joueur de CETTE partie (cf. PixelGame) :
    owned: { type: Boolean, default: false },
    playtimeHours: { type: Number, default: null },
    rating: { type: Number, default: null },

    // Réponse du joueur :
    guessedGameId: { type: Number, default: null },
    guessedName: { type: String, default: "" },
    correct: { type: Boolean, default: false },
    timeMs: { type: Number, default: null },
    points: { type: Number, default: 0 },

    // --- Manche bonus « où sur la carte ? » ---
    // Proposée uniquement quand le lieu dispose d'une carte ET d'un point de
    // réponse, et uniquement si le jeu a été trouvé : c'est une récompense, pas
    // une seconde chance. Tout est figé ici (image, dimensions, point) pour que
    // le récap d'une vieille partie reste lisible même si le catalogue bouge.
    mapImage: { type: String, default: null },
    mapWidth: { type: Number, default: null },
    mapHeight: { type: Number, default: null },
    mapAnswerX: { type: Number, default: null },
    mapAnswerY: { type: Number, default: null },
    // Le clic du joueur, dans le repère de la carte d'ORIGINE (le client
    // reconvertit depuis sa taille d'affichage).
    mapGuessX: { type: Number, default: null },
    mapGuessY: { type: Number, default: null },
    // Distance en FRACTION DE DIAGONALE, pas en pixels : c'est la seule mesure
    // comparable entre des cartes de 928×928 et de 2402×1914.
    mapDistance: { type: Number, default: null },
    mapPoints: { type: Number, default: 0 },
  },
  { _id: false }
);

const geoGameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, default: 0 },
    roundCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    durationSec: { type: Number, default: 45 },
    challengeOf: { type: mongoose.Schema.Types.ObjectId, ref: "GeoGame", default: null },
    challengedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    challengedScore: { type: Number, default: null },
    rounds: { type: [roundSchema], default: [] },
  },
  { timestamps: true }
);

geoGameSchema.index({ user: 1, score: -1 });
geoGameSchema.index({ createdAt: -1 });

export default mongoose.model("GeoGame", geoGameSchema);
