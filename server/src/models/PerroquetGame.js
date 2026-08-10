import mongoose from "mongoose";

// Une partie de Perroquet : N sons à imiter, un enregistrement par manche.
//
// ON GARDE LES TENTATIVES. C'est délibéré et c'est même le point : le score est
// l'excuse, le plaisir est de se réécouter (et surtout d'écouter les autres).
// Le récap de fin de partie et la carte du fil rejouent ces fichiers — sans eux
// il ne resterait qu'un nombre, et un nombre n'a jamais fait rire personne.
const roundSchema = new mongoose.Schema(
  {
    clip: { type: mongoose.Schema.Types.ObjectId, ref: "SoundClip", required: true },
    // Copiés au moment de la partie : un clip peut être renommé ou désactivé
    // plus tard, le récap doit rester lisible tel qu'il a été joué.
    label: { type: String, default: "" },
    game: { type: String, default: "" },
    clipUrl: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    // Le pseudo du joueur qui a déposé ce son, s'il vient d'une librairie
    // personnelle. Vide pour les sons officiels.
    addedBy: { type: String, default: "" },

    // L'enregistrement du joueur (/uploads/perroquet/…). Null si la manche a
    // été passée.
    attemptUrl: { type: String, default: null },

    // Le détail du barème (cf. lib/soundContour.js). On stocke les trois
    // composantes et pas seulement le total : c'est ce qui permet d'afficher
    // « ta mélodie était bonne, c'est le rythme qui a lâché ».
    score: { type: Number, default: 0 },
    pitchScore: { type: Number, default: 0 },
    energyScore: { type: Number, default: 0 },
    durationScore: { type: Number, default: 0 },
    band: { type: String, default: "miss" },

    // Le contour de la tentative, pour redessiner les deux courbes superposées
    // dans le récap sans redécoder l'audio.
    contour: { type: mongoose.Schema.Types.Mixed, default: null },
    skipped: { type: Boolean, default: false },
  },
  { _id: false }
);

const perroquetGameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Somme des scores de manche (0..100 chacun).
    score: { type: Number, default: 0 },
    // Moyenne, c'est elle qu'on montre : « 71 de moyenne » se compare d'une
    // partie à l'autre même si le nombre de manches change.
    average: { type: Number, default: 0 },
    roundCount: { type: Number, default: 0 },
    bestBand: { type: String, default: "miss" },
    finished: { type: Boolean, default: false },

    // Défi : cette partie rejoue le set d'un autre joueur, comme le blind test.
    challengeOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PerroquetGame",
      default: null,
    },
    challengedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    challengedScore: { type: Number, default: null },

    rounds: { type: [roundSchema], default: [] },
  },
  { timestamps: true }
);

perroquetGameSchema.index({ user: 1, score: -1 });
perroquetGameSchema.index({ createdAt: -1 });

export default mongoose.model("PerroquetGame", perroquetGameSchema);
