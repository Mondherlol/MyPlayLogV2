import mongoose from "mongoose";

// ======================================================================
//  Le Perroquet — le mode VERSUS
// ======================================================================
// Deux à six joueurs, le même son, en même temps. Chacun crie dans son coin,
// puis on écoute tout le monde.
//
// ------------------------------------- ce qui le distingue des autres versus
// GeoGamer, le blind test et Pixel Rush sont des COURSES : le premier qui
// trouve rafle la mise, et toute la machinerie du salon sert à départager des
// millisecondes. Ici, personne ne court. Tout le monde enregistre pendant la
// même fenêtre, et c'est un barème qui tranche après coup.
//
// Conséquence directe sur le modèle : pas d'`attempts` horodatés, pas d'ordre
// d'arrivée, pas de vies. Une manche est close quand la fenêtre se ferme ou
// quand tout le monde a rendu sa copie — jamais « en avance parce que
// quelqu'un a gagné ».
//
// ------------------------------------------------------ où est le plaisir
// PAS DANS LE SCORE, et le modèle est construit autour de ça. La phase qui
// compte est `reveal` : on y rejoue les six enregistrements, du pire au
// meilleur. C'est pour elle qu'on garde `attemptUrl` et `contour` par joueur et
// par manche — sans eux il ne resterait qu'un tableau de nombres, et un tableau
// de nombres n'a jamais fait rire personne.
//
// C'est aussi pourquoi la phase de révélation est LONGUE (voir REVEAL_SEC) :
// c'est le moment du jeu, pas une transition.
//
// ---------------------------------------------------------------- le direct
// Comme les autres salons, tout passe par le flux SSE de la messagerie
// (lib/realtime.js) sous un seul nom d'évènement — `pqversus` — dont le `kind`
// précise la nature (lobby, round, took, reveal, done).

export const MAX_PLAYERS = 6;

// Les trois temps d'une manche. Ils sont ce qui fait qu'on joue ENSEMBLE : sans
// fenêtre commune, chacun enregistrerait quand il veut et le mode ne serait
// qu'un solo avec un tableau à la fin.
export const LISTEN_SEC = 5;  // on écoute le son, micro fermé
export const RECORD_SEC = 12; // la fenêtre d'enregistrement, commune à tous
export const REVEAL_SEC = 18; // on réécoute tout le monde — LE moment du jeu

const takeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    attemptUrl: { type: String, default: null },
    score: { type: Number, default: 0 },
    pitchScore: { type: Number, default: 0 },
    energyScore: { type: Number, default: 0 },
    durationScore: { type: Number, default: 0 },
    band: { type: String, default: "miss" },
    // Le contour de la tentative : sert à dessiner les courbes superposées de
    // la révélation sans redécoder l'audio de six personnes.
    contour: { type: mongoose.Schema.Types.Mixed, default: null },
    // A rendu une copie (même ratée) plutôt que d'avoir laissé passer la
    // fenêtre. La nuance change le message affiché, pas le score.
    submitted: { type: Boolean, default: false },
    rank: { type: Number, default: null },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    clip: { type: mongoose.Schema.Types.ObjectId, ref: "SoundClip", required: true },
    label: { type: String, default: "" },
    game: { type: String, default: "" },
    clipUrl: { type: String, default: "" },
    difficulty: { type: Number, default: 2 },
    takes: { type: [takeSchema], default: [] },
  },
  { _id: false }
);

const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, default: 0 },   // somme des scores de manche
    wins: { type: Number, default: 0 },    // manches remportées
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    // Le micro est-il prêt ? On l'exige AVANT de lancer : découvrir au premier
    // son que deux joueurs sur six n'ont pas autorisé le micro gâche la partie
    // pour tout le monde, et il n'y a pas de rattrapage possible une fois la
    // fenêtre ouverte.
    armed: { type: Boolean, default: false },
  },
  { _id: false }
);

const perroquetVersusSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },
    roundCount: { type: Number, default: 5 },

    // lobby → listen → record → reveal → (manche suivante) → done
    phase: { type: String, default: "lobby" },
    index: { type: Number, default: 0 },
    phaseStartsAt: { type: Date, default: null },
    phaseEndsAt: { type: Date, default: null },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Les salons ne survivent pas à la journée : ils durent dix minutes et
// n'intéressent personne ensuite. Le TTL évite d'avoir à faire le ménage.
perroquetVersusSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 60 * 60 * 6 });

export default mongoose.model("PerroquetVersus", perroquetVersusSchema);
