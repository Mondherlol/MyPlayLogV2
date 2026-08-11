import mongoose from "mongoose";

// ======================================================================
//  Blind test VERSUS — le même extrait, en même temps, à plusieurs
// ======================================================================
// Deux à cinq joueurs écoutent le MÊME morceau au MÊME moment. Chacun cherche
// dans son coin : on voit qui a trouvé (et à quelle place), on voit les cœurs
// des autres tomber, mais jamais le titre qu'ils ont proposé.
//
// UN SEUL MODE, et c'est le BUZZER : le premier qui trouve arrête la manche et
// rafle la mise, les autres n'ont rien. C'est le format du blind test de
// plateau — on se jette sur le buzzer, et se faire souffler la réponse d'une
// demi-seconde fait partie du jeu.
//
// Conséquence assumée : une manche peut durer quatre secondes, et les battus
// n'auront presque rien écouté. C'est le prix du format, et c'est ce qui rend
// chaque note du début décisive. Les trois vies sont là pour que se tromper ne
// mette pas hors course d'un coup.
//
// ------------------------------------------------------------- d'où vient le son
// L'extrait sort de l'iframe YouTube, comme en solo.
//
// CE N'A PAS TOUJOURS ÉTÉ LE CAS, et le revirement mérite d'être connu avant
// d'y retoucher. En solo, charger la vidéo donne son titre au client — « Zelda
// BOTW OST – Hyrule Field » — mais tricher n'y lèse que soi. En versus, ça
// donne la réponse à qui ouvre la console. L'extrait passait donc par NOTRE
// serveur, en audio pur, sous une adresse muette (`/clip/:index`) : rien à lire
// nulle part avant la révélation.
//
// Ce chemin repose sur yt-dlp, et depuis l'IP d'un datacenter YouTube le bloque
// en permanence (cf. l'en-tête de routes/audio.js). En prod, toute piste absente
// du cache disque renvoyait 502 et la manche partait MUETTE — pendant que le
// solo, sur la même piste, retombait sur l'iframe et jouait très bien. Un mode
// inviolable et silencieux ne vaut pas un mode jouable : le `videoId` part
// maintenant dès le sas, et la triche à la console est un risque assumé.
const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, default: null },
    name: { type: String, default: "" },
    correct: { type: Boolean, default: false },
    atMs: { type: Number, default: 0 },
  },
  { _id: false }
);

const resultSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    correct: { type: Boolean, default: false },
    timeMs: { type: Number, default: null },
    misses: { type: Number, default: 0 },
    order: { type: Number, default: null },
    points: { type: Number, default: 0 },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    gameId: { type: Number, default: null },
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },
    // La piste. `videoId` part au client dès le sas — l'iframe en a besoin
    // (cf. l'en-tête). Le nom du jeu, lui, reste au chaud jusqu'à la révélation.
    videoId: { type: String, default: "" },
    ostName: { type: String, default: "" },
    // Où commencer dans le morceau — sur le climax quand il a été mesuré
    // (models/OstClimax.js), sinon une estimation.
    startFrac: { type: Number, default: 0.4 },
    climaxed: { type: Boolean, default: false },
    // Indices dévoilés au fil de l'extrait (année → plateformes → studio → qui
    // y a joué). Recopiés ici : ils sont envoyés AVEC la manche, ce sont eux le
    // vrai jeu d'information avant la révélation.
    //
    // Le dernier, `players`, est propre au versus : la liste des joueurs de la
    // table qui ont ce jeu en bibliothèque (`[{ id, favorite }]`), vide quand
    // c'est un piège que personne n'a joué. C'est l'indice le plus fort du
    // mode — il ne dit pas le titre, il dit à qui le demander.
    hints: { type: mongoose.Schema.Types.Mixed, default: null },

    attempts: { type: [attemptSchema], default: [] },
    results: { type: [resultSchema], default: [] },
    // Celui qui a bouclé la manche. `null` = personne n'a trouvé.
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
  },
  { _id: false }
);

const blindTestVersusSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    roundCount: { type: Number, default: 8 },
    durationSec: { type: Number, default: 35 },

    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },

    // lobby → cue → round → reveal → (cue…) → done
    //
    // `cue` est le sas : le temps que l'extrait soit prêt CHEZ TOUT LE MONDE.
    // Il est plus important encore qu'à GeoGamer, parce que le serveur doit
    // parfois extraire l'audio avant de pouvoir le servir — le sas s'allonge
    // alors tout seul jusqu'à ce que la piste soit disponible (voir
    // routes/blindtestVersus.js), sinon les rapides partiraient avec deux
    // secondes d'avance sur les autres.
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
blindTestVersusSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 2 * 3600 });

export const MAX_PLAYERS = 5;
export const LIVES = 3;

export default mongoose.model("BlindTestVersus", blindTestVersusSchema);
