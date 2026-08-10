import mongoose from "mongoose";

// ======================================================================
//  L'Imposteur — le salon
// ======================================================================
// Trois joueurs minimum. Tout le monde reçoit le même jeu SAUF un, qui en
// reçoit un légèrement différent — et qui l'ignore. Chacun lâche un mot à son
// tour ; à la fin on vote pour celui qu'on croit à côté de la plaque.
//
// ------------------------------------- ce qui le distingue des autres salons
// Les cinq autres versus du site sont des épreuves de CONNAISSANCE : le serveur
// connaît la réponse, la mesure, et classe. Ici il n'y a rien à savoir. Le
// serveur ne juge aucun mot — il distribue une information asymétrique, fait
// tourner la parole, et compte des voix. TOUT le jeu se passe entre les
// joueurs.
//
// Conséquence sur le modèle : aucun barème, aucun `score` par manche calculé à
// partir d'une performance. Les points d'une manche sortent uniquement du vote
// (`votes`) et de son issue (`caught`, `stolen`).
//
// -------------------------------------------------- ce qui NE doit pas fuiter
// `imposteur` et le couple (`gameA`, `gameB`) sont LE secret du mode. La
// sérialisation (routes/imposteur.js) n'envoie à chacun que SON titre, et ne
// révèle le reste qu'en phase `result`. Un salon qui enverrait la manche
// entière à tout le monde — ce que font sans risque les autres versus, où la
// réponse ne se découvre qu'à la fin de toute façon — n'aurait plus de jeu du
// tout : l'onglet réseau du navigateur donnerait l'imposteur en une seconde.
//
// ---------------------------------------------------------------- le direct
// Comme les autres salons : le flux SSE de la messagerie (lib/realtime.js),
// sous le nom d'évènement `imposteur`, `kind` précisant la nature (lobby,
// card, turn, typing, vote, result, done).
//
// Une chose N'EST PAS ICI et n'a rien à y faire : la frappe en direct. Voir
// pourquoi dans routes/imposteur.js — elle ne touche jamais la base.

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 3;

// Les temps du salon. Ils sont serrés exprès : le mode vit de l'urgence, un
// joueur qui a trente secondes pour trouver un mot en trouve un parfait, et un
// mot parfait ne fait rire personne.
export const CARD_SEC = 8;    // on découvre son jeu, seul devant sa carte
export const TURN_SEC = 25;   // le temps d'un joueur pour lâcher son mot
export const VOTE_SEC = 35;   // le vote, tout le monde en même temps
export const STEAL_SEC = 20;  // la dernière chance de l'imposteur démasqué
export const RESULT_SEC = 18; // la révélation — le moment du jeu

const clueSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    word: { type: String, default: "" },
    turn: { type: Number, default: 0 },
    // La fenêtre est passée sans rien : la ligne existe quand même. Un trou
    // dans le tableau des indices se lirait comme un bug, alors qu'un silence
    // est une information — et souvent un aveu.
    missed: { type: Boolean, default: false },
  },
  { _id: false }
);

const voteSchema = new mongoose.Schema(
  {
    voter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    // Le jeu de la majorité, et celui de l'imposteur. Lequel des deux titres de
    // la paire atterrit où est tiré à pile ou face à chaque manche.
    gameA: { type: String, default: "" },
    gameB: { type: String, default: "" },
    // La jaquette et l'identifiant IGDB des deux titres, résolus au tirage
    // (routes/imposteur.js). On est un site de JEUX VIDÉO : afficher « Tomodachi
    // Life » en texte à quelqu'un qui ne connaît pas, c'est lui demander de
    // bluffer sur un mot. Avec la jaquette il voit tout de suite de quoi il
    // parle — et l'identifiant lui ouvre la fiche complète sans quitter la
    // partie.
    gameACover: { type: String, default: "" },
    gameBCover: { type: String, default: "" },
    gameAId: { type: Number, default: null },
    gameBId: { type: Number, default: null },
    imposteur: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // L'ordre de parole, mélangé à chaque manche. Fixe pendant la manche : sans
    // ordre stable, personne ne saurait quand vient son tour, et le mode repose
    // entièrement sur le fait de voir arriver le sien.
    order: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // Position dans l'ordre APLATI (tour * nbJoueurs + rang). Un seul nombre
    // pour dire à la fois « quel tour » et « qui parle » : deux compteurs
    // séparés finiraient par se désynchroniser à la première déconnexion.
    cursor: { type: Number, default: 0 },

    clues: { type: [clueSchema], default: [] },
    // Ceux qui ont demandé à voter tout de suite. À la majorité, on coupe court.
    voteCalls: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    votes: { type: [voteSchema], default: [] },

    // Le plus voté (null en cas d'égalité : personne n'est démasqué).
    accused: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    caught: { type: Boolean, default: false },

    // La dernière chance : démasqué, l'imposteur tente de reconnaître le jeu
    // des autres parmi quatre titres. C'est ce qui empêche une manche perdue
    // d'être une humiliation muette.
    stealOptions: { type: [String], default: [] },
    stealPick: { type: String, default: "" },
    stolen: { type: Boolean, default: false },

    // Ce que la manche a rapporté, par joueur : affiché tel quel à la
    // révélation. Recalculer ces points côté client à partir des votes
    // dupliquerait le barème à deux endroits, et ils divergeraient.
    gains: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          points: { type: Number, default: 0 },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, default: 0 },
    // Combien de fois ce joueur a été l'imposteur : sert à ne pas retomber
    // toujours sur les mêmes (cf. le tirage dans routes/imposteur.js).
    imposteurCount: { type: Number, default: 0 },
    // Manches gagnées dans le rôle d'imposteur — la seule statistique dont on
    // se vante à la fin.
    escapes: { type: Number, default: 0 },
    // « Je suis prêt » : un signal des INVITÉS vers l'hôte, et rien d'autre. Il
    // ne bloque pas le départ — l'hôte reste maître de sa partie, et un joueur
    // parti chercher à boire ne doit pas pouvoir la retenir indéfiniment.
    ready: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
  },
  { _id: false }
);

const imposteurSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    players: { type: [playerSchema], default: [] },
    rounds: { type: [roundSchema], default: [] },
    roundCount: { type: Number, default: 3 },
    // Combien de mots chacun donne par manche. DEUX, ET CE N'EST PLUS RÉGLABLE :
    // c'était une option de l'hôte, retirée parce qu'elle n'avait pas de bon
    // choix. À un mot le vote se joue à pile ou face ; à trois l'imposteur ne
    // survit jamais. Une option dont une seule valeur est jouable n'est pas une
    // option, c'est un piège pour l'hôte. Le champ reste ici (les salons en
    // base le portent, et deux manches de rythme différent resteraient
    // lisibles) mais plus rien ne l'écrit.
    turnCount: { type: Number, default: 2 },

    // Les paires déjà sorties dans CE salon (index dans la banque) : on ne
    // rejoue pas deux fois la même en une soirée.
    usedPairs: { type: [Number], default: [] },

    // lobby → card → clue → vote → (steal) → result → (manche suivante) → done
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

// Un salon ne survit pas à la soirée (même règle que les autres versus).
imposteurSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: 60 * 60 * 6 });

export default mongoose.model("Imposteur", imposteurSchema);
