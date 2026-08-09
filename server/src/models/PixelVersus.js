import mongoose from "mongoose";

// ======================================================================
//  Pixel Rush VERSUS — la même capture, en même temps, à plusieurs
// ======================================================================
// Le troisième salon « versus » du site, après GeoGamer et le blind test, et il
// leur emprunte tout ce qui peut l'être : la machinerie de salon
// (lib/versusRoom.js), le rail des joueurs, le « 3, 2, 1 », et LE BUZZER — le
// premier qui trouve arrête la manche et rafle la mise, trois vies chacun.
//
// ------------------------------------------------------- ce qui lui est propre
// 1. LA RÉPONSE NE SORT JAMAIS AVANT LA RÉVÉLATION. Comme le blind test cache
//    le videoId (qui donnerait le titre de la vidéo YouTube), on ne transmet
//    ici ni `gameId`, ni `gameName`, ni jaquette avant la fin de la manche —
//    seulement l'URL de la capture, qui est l'énigme elle-même.
//
// 2. LA DÉFINITION EST CELLE DU SERVEUR. En solo, elle remonte avec le chrono
//    local du joueur. Ici, elle se calcule à partir de `phaseStartsAt`, l'heure
//    commune : à un instant donné, tout le monde voit exactement les mêmes
//    gros pixels. Sans ça, un joueur en retard d'une seconde jouerait une image
//    plus floue que les autres — sur une manche de trente secondes, c'est le
//    genre d'écart qui décide d'un buzzer.
//
// 3. LES TOMATES. Chaque joueur en a trois par partie et peut en jeter une à un
//    adversaire : son écran se retrouve éclaboussé pendant deux secondes, il ne
//    voit plus rien (il peut toujours taper). C'est bruyant, c'est injuste, et
//    c'est exactement ce qu'on veut d'un mode à plusieurs — une manière de
//    ralentir celui qui est en train de trouver, sans jamais lui voler ses
//    points. Le stock est en base (`ammo`) : c'est une ressource de partie, pas
//    un geste gratuit.
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
    // La capture (une seule, cf. routes/pixel.js). Seule donnée de la manche
    // qui parte au client avant la révélation.
    shots: { type: [String], default: [] },
    // L'angle laissé net. Tiré au serveur pour que toute la table ait le même :
    // deux joueurs avec des coins libres différents ne joueraient pas la même
    // énigme.
    clearCorner: { type: String, default: "tl" },
    // Indices dévoilés au fil de la manche (année → plateformes → studio → qui
    // y a joué). Le dernier, `players`, vaut `[{ id, favorite }]` et ne liste
    // que des joueurs de CETTE table.
    hints: { type: mongoose.Schema.Types.Mixed, default: null },

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
    // Tomates restantes. Remises à neuf à chaque partie (`/start`, `/again`).
    ammo: { type: Number, default: 3 },
  },
  { _id: false }
);

const pixelVersusSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    roundCount: { type: Number, default: 8 },
    durationSec: { type: Number, default: 30 },

    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },

    // lobby → cue → round → reveal → (cue…) → done
    //
    // `cue` est le « 3, 2, 1 » : le temps que la capture soit chargée chez tout
    // le monde. Il est court (l'image vient du CDN d'IGDB, il n'y a rien à
    // extraire côté serveur, contrairement au blind test).
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
pixelVersusSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 2 * 3600 });

export const MAX_PLAYERS = 5;
export const LIVES = 3;
// Tomates par joueur et par partie, et durée de l'éclaboussure.
export const AMMO = 3;
export const SPLAT_MS = 2200;

export default mongoose.model("PixelVersus", pixelVersusSchema);
