import mongoose from "mongoose";

// ======================================================================
//  Le Grand Quiz VERSUS — le plateau à plusieurs
// ======================================================================
// Quatrième salon « versus » du site, après GeoGamer, le blind test et Pixel
// Rush, et il reprend leur machinerie sans discuter (lib/versusRoom.js : file
// d'attente par salon, horloge serveur, code d'invitation).
//
// Ce qui le distingue des trois autres tient en une phrase : LES MANCHES NE SE
// JOUENT PAS TOUTES PAREIL. Les autres salons enchaînent N fois la même
// épreuve, ce qui leur permet de figer un schéma de manche et un barème. Ici
// une partie traverse sept registres — un QCM, une pile à trier en trente
// secondes, un duel de cartes à déposer — et chacun a sa façon de marquer.
//
// Trois conséquences de structure :
//
// 1. `payload` EN MIXED. Même raison qu'en solo (cf. models/QuizGame.js) :
//    sept sous-schémas à faire évoluer de concert, pour une donnée qu'on relit
//    en bloc, ça ne s'entretient pas.
//
// 2. LE BUZZER N'EST PAS UNIVERSEL. Sur un QCM ou une devinette (emoji), le
//    premier qui trouve clôt la manche : c'est le buzzer des trois autres
//    salons. Mais sur le swipe ou le duel, TOUT LE MONDE joue en même temps
//    pendant toute la manche, et on compte les points de chacun à la fin —
//    s'arrêter au premier finisseur ne récompenserait plus que la vitesse de
//    lecture. `mode` (« buzzer » | « parallel ») porte cette différence, et
//    c'est routes/quizVersus.js qui décide quand une manche peut se clore.
//
// 3. LES RÉPONSES NE SORTENT JAMAIS AVANT LA RÉVÉLATION. Même règle que Pixel
//    Rush (ni gameName ni cover avant la fin) mais élargie : l'index de la
//    bonne proposition d'un QCM, la cible de chaque carte d'un duel, le
//    verdict de chaque jeu d'une pile de swipe — tout ça reste au serveur. La
//    sérialisation qui filtre vit dans la route ; ce modèle stocke la vérité
//    entière.

const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // La réponse dans la forme de l'épreuve (index de QCM, nom de jeu proposé,
    // table des cartes déposées…).
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    correct: { type: Boolean, default: false },
    // Réussite partielle 0→1 pour les épreuves qui se marquent au détail.
    ratio: { type: Number, default: 0 },
    atMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const resultSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    correct: { type: Boolean, default: false },
    ratio: { type: Number, default: 0 },
    timeMs: { type: Number, default: null },
    misses: { type: Number, default: 0 },
    // Rang d'arrivée sur une manche en buzzer (1 = a raflé la manche).
    order: { type: Number, default: null },
    points: { type: Number, default: 0 },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    // « buzzer » : le premier bon clôt la manche. « parallel » : tout le monde
    // joue jusqu'au bout du chrono. Voir l'en-tête, point 2.
    mode: { type: String, enum: ["buzzer", "parallel"], default: "buzzer" },
    durationSec: { type: Number, default: 20 },

    // L'énigme + sa solution. La route ne laisse partir que la part publique.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    attempts: { type: [attemptSchema], default: [] },
    results: { type: [resultSchema], default: [] },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    ready: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    // Jokers : voir JOKERS plus bas.
    jokers: { type: Number, default: 2 },
    // Série de bonnes réponses en cours — le multiplicateur du plateau.
    streak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
  },
  { _id: false }
);

const quizVersusSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    roundCount: { type: Number, default: 8 },
    // Les épreuves retenues pour cette partie (l'hôte peut en décocher).
    types: { type: [String], default: [] },

    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },

    // lobby → cue → round → reveal → (cue…) → done
    //
    // `cue` annonce l'épreuve à venir (« Épreuve 3 · Emojis ») avant de la
    // lancer. Il compte davantage ici que dans les autres salons : on ne joue
    // pas deux manches de suite de la même façon, il faut le temps de
    // comprendre à quoi on va jouer avant que le chrono parte.
    phase: {
      type: String,
      enum: ["lobby", "cue", "round", "reveal", "done"],
      default: "lobby",
    },
    index: { type: Number, default: 0 },
    phaseStartsAt: { type: Number, default: 0 },
    phaseEndsAt: { type: Number, default: 0 },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Les salons morts s'effacent tout seuls deux heures après la dernière manche.
quizVersusSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 2 * 3600 });

export const MAX_PLAYERS = 6;
// Vies par manche sur les épreuves à saisie libre (emoji, studio) : on peut se
// tromper deux fois avant d'être sorti de la manche.
export const LIVES = 3;
// Jokers par joueur et par partie : sur un QCM, il retire deux mauvaises
// propositions. C'est le pendant des tomates de Pixel Rush — sauf qu'ici il
// aide celui qui le lance au lieu de gêner les autres. Un quiz de culture se
// joue contre la question, pas contre le voisin : lui coller une tomate sur
// l'écran pendant qu'il lit un énoncé de trois lignes ne serait pas drôle,
// juste illisible.
export const JOKERS = 2;

export default mongoose.model("QuizVersus", quizVersusSchema);
