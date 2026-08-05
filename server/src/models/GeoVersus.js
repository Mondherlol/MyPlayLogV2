import mongoose from "mongoose";

// ======================================================================
//  GeoGamer — le mode VERSUS
// ======================================================================
// Jusqu'ici GeoGamer était un jeu solitaire : on tirait des lieux inédits, on
// les gardait pour soi (models/GeoSeen.js), et « défier » voulait dire rejouer
// en différé la partie d'un autre. Ici, non : deux à cinq joueurs sont dans LE
// MÊME panorama, EN MÊME TEMPS.
//
// ------------------------------------------------------------- deux façons
//   classic  Chacun cherche dans son coin. On ne voit RIEN de ce que tapent
//            les autres — seulement qu'ils ont trouvé. L'ordre d'arrivée fait
//            le score : le premier rafle 300, le dernier en récupère 130.
//   buzzer   Tout le monde voit tout : ce que les autres tapent lettre à
//            lettre, leurs mauvaises réponses. Le premier bon jeu ARRÊTE la
//            manche et rafle la mise. Trois vies chacun pour tenter le coup.
//
// -------------------------------------------------------- pourquoi le serveur
// LA RÈGLE ABSOLUE DE CE MODÈLE : la réponse ne quitte jamais le serveur avant
// la révélation. C'est la différence de fond avec le solo, où routes/geo.js
// envoie `gameName` avec la manche (le client révèle tout seul, et tricher n'y
// lèse personne d'autre que soi). Ici une réponse connue d'avance, c'est un
// buzz instantané volé aux autres — donc le client envoie sa proposition, et
// c'est le serveur qui dit oui ou non.
//
// C'est aussi pour ça que le document porte le déroulé complet (`attempts`) :
// il est l'arbitre, pas un miroir de ce que les navigateurs veulent bien
// raconter.
//
// ---------------------------------------------------------------- le direct
// Comme la watchparty et le mot du jour, tout passe par le flux SSE de la
// messagerie (`lib/realtime.js`), sous un seul nom d'évènement — `geoversus` —
// dont le `kind` précise la nature (lobby, round, guess, typing, map, reveal,
// done). Un seul tunnel par onglet, déjà ouvert, déjà géré par Caddy.

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN = 6;

// Plus court que le code de watchparty (10) : celui-ci se dicte à voix haute
// dans un vocal pendant qu'on lance la partie, il doit tenir dans une phrase.
export function makeCode() {
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1)
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// Cinq joueurs : l'hôte plus les quatre invités annoncés. Au-delà, la liste des
// têtes du HUD déborde et une manche de 45 s ne laisse plus voir qui fait quoi.
export const MAX_PLAYERS = 5;
export const LIVES = 3;

// ------------------------------------------------------------------ un essai
// Toutes les tentatives de la manche, bonnes ou mauvaises, dans l'ordre. C'est
// la source de tout : les vies restantes s'en déduisent (trois moins les
// ratés), l'ordre d'arrivée aussi, et en buzzer c'est ce fil qu'on rediffuse
// aux autres pour qu'ils voient les fausses pistes tomber.
const attemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, default: null },
    name: { type: String, default: "" },
    correct: { type: Boolean, default: false },
    // Millisecondes depuis le départ de la manche : c'est la mesure qui
    // départage, et elle doit rester lisible sans recalculer des dates.
    atMs: { type: Number, default: 0 },
  },
  { _id: false }
);

// -------------------------------------------------- le résultat d'un joueur
// Ce qui est ARRÊTÉ pour un joueur sur une manche, une fois qu'elle est jouée.
const resultSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    correct: { type: Boolean, default: false },
    timeMs: { type: Number, default: null },
    misses: { type: Number, default: 0 },
    // Rang de découverte (1 = premier à avoir trouvé). `null` = n'a pas trouvé.
    // C'est LUI qui fait le score en classique, pas le chrono : « arriver
    // deuxième » se comprend d'un coup d'œil, « 12,4 s » ne se compare à rien.
    order: { type: Number, default: null },
    points: { type: Number, default: 0 },

    // Manche carte. En classique elle récompense qui a trouvé le jeu (barème
    // absolu, comme en solo) ; en buzzer TOUT LE MONDE y participe et c'est le
    // classement des distances qui paie — d'où `mapRank`, sans équivalent solo.
    //
    // QUAND elle se joue diffère aussi, et c'est ce qui explique qu'une ligne
    // de résultat puisse exister avant la fin d'une manche : en buzzer c'est
    // une phase commune qui suit la manche, en classique ça se passe PENDANT,
    // sur le temps restant de celui qui vient de trouver (routes/geoVersus.js,
    // en-tête d'`endRound`).
    mapX: { type: Number, default: null },
    mapY: { type: Number, default: null },
    mapDistance: { type: Number, default: null },
    mapRank: { type: Number, default: null },
    mapPoints: { type: Number, default: 0 },
  },
  { _id: false }
);

// ------------------------------------------------------------- une manche
// Le lieu ET sa réponse. Recopiés depuis le catalogue (models/Panorama.js)
// plutôt que référencés : une partie enregistrée doit rester lisible même si
// le panorama est retiré du catalogue ensuite.
const roundSchema = new mongoose.Schema(
  {
    panorama: { type: mongoose.Schema.Types.ObjectId, ref: "Panorama", default: null },
    gameId: { type: Number, default: null },
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },
    image: { type: String, default: "" },
    difficulty: { type: Number, default: 3 },

    mapImage: { type: String, default: null },
    mapWidth: { type: Number, default: null },
    mapHeight: { type: Number, default: null },
    mapAnswerX: { type: Number, default: null },
    mapAnswerY: { type: Number, default: null },

    attempts: { type: [attemptSchema], default: [] },
    results: { type: [resultSchema], default: [] },
    // Buzzer : celui qui a arrêté la manche. `null` = personne n'a trouvé.
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    // Parti en cours de route. On garde la ligne : le tableau final doit
    // pouvoir dire qui était là, et ses points restent acquis.
    leftAt: { type: Date, default: null },
    ready: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const geoVersusSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    mode: { type: String, enum: ["classic", "buzzer"], default: "classic" },
    roundCount: { type: Number, default: 8 },
    durationSec: { type: Number, default: 45 },

    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },

    // lobby → cue → round → map → reveal → (cue…) → done
    //
    // `cue` est le sas de chargement : un panorama pèse plusieurs mégaoctets et
    // en solo on attend simplement qu'il s'affiche (`panoReady`). À plusieurs
    // c'est impossible — attendre le plus lent, c'est offrir le décor en avance
    // aux autres. On annonce donc l'image ET l'heure du départ quelques
    // secondes plus tard : chacun charge dans son coin, tout le monde part
    // ensemble sur le même « 3, 2, 1 ».
    phase: {
      type: String,
      enum: ["lobby", "cue", "round", "map", "reveal", "done"],
      default: "lobby",
    },
    index: { type: Number, default: 0 },
    // Bornes de la phase courante, en millisecondes d'horloge murale. Le client
    // en déduit son chrono sans jamais faire autorité : c'est le serveur qui
    // clôt la manche, même si tous les onglets sont fermés.
    phaseStartsAt: { type: Number, default: 0 },
    phaseEndsAt: { type: Number, default: 0 },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Les salons morts ne s'accumulent pas : Mongo les efface deux heures après le
// dernier signe de vie. Une partie dure une dizaine de minutes — au-delà, le
// salon est de toute façon abandonné (même logique que models/WatchParty.js,
// avec un délai plus court : il n'y a rien à relire dans une partie finie que
// le tableau des scores, déjà porté par les cartes du fil).
geoVersusSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 2 * 3600 });

export default mongoose.model("GeoVersus", geoVersusSchema);
