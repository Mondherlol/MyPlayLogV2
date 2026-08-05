import mongoose from "mongoose";

// ======================================================================
//  Une session à plusieurs du « Mot du jour »
// ======================================================================
// Plusieurs joueurs cherchent LE MÊME mot du jour ensemble, en continu (pas
// chacun son tour) : tout le monde peut proposer à tout moment, et les essais
// s'affichent avec la tête de celui qui les a tapés.
//
// ---------------------------------------------------------------- les essais
// LA RÈGLE QUI GOUVERNE TOUT LE MODÈLE : les essais se CUMULENT et ne se
// décomptent jamais. Rejoindre, c'est apporter ses essais solo à la cagnotte
// commune ; partir, c'est repartir avec le total du groupe.
//
//     j'ai 10 essais en solo, mon ami en a 2 → on fusionne, le groupe est à 12
//     un troisième arrive avec 4            → le groupe est à 16
//     mon ami repart en solo                → le groupe reste à 16, et LUI AUSSI
//
// Ce n'est pas une punition : c'est ce qui empêche de « laver » son compteur en
// faisant tourner les sessions, et ça garde le classement (au nombre d'essais)
// comparable entre une partie solo et une partie à plusieurs.
//
// Les MOTS suivent les essais. Quand on rejoint, ses propres propositions
// rejoignent la liste commune — sinon le groupe afficherait 12 essais pour 2
// mots visibles, et retenterait des mots déjà éliminés.
//
// --------------------------------------------------------------- le temps réel
// Comme la watchparty, tout passe par le flux SSE de la messagerie
// (`lib/realtime.js`), sous UN nom d'évènement, `mot`, dont le `kind` précise la
// nature : guess, members, typing, solved. Un seul tunnel par onglet, déjà
// ouvert, déjà géré par Caddy.
//
// -------------------------------------------------------------- qui peut entrer
// Le code est la clé, comme pour la watchparty : qui l'a peut entrer. Deux
// verrous seulement, et ils viennent des règles du jeu :
//   - on ne rejoint pas si on a DÉJÀ trouvé le mot du jour (rien à y chercher) ;
//   - on ne rejoint plus une session qui a trouvé (elle est close).

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    // Sortie de session. `null` = encore là. On garde la ligne plutôt que de la
    // retirer : le classement doit pouvoir dire qui a participé, et un joueur
    // parti avant la trouvaille ne doit pas réapparaître dans l'équipe.
    leftAt: { type: Date, default: null },
    // Ce que ce joueur a apporté au pot commun, cumulé sur tous ses passages :
    // sert à expliquer le total à l'écran (« +10 essais apportés par Mondher »).
    broughtTries: { type: Number, default: 0 },
    // Marque d'eau : le total du groupe au moment où ce joueur l'a quitté.
    //
    // Sans elle, l'aller-retour se paie deux fois. X part d'un groupe à 16 en
    // emportant 16 essais ; s'il revient, la règle « rejoindre = apporter ses
    // essais » ajouterait 16 à un groupe qui les contient déjà → 32. On ne
    // compte donc à son retour que ce qu'il a joué DEPUIS son départ, soit
    // `mesEssais - sharedTries`. Vaut 0 pour un nouvel arrivant, qui apporte
    // bien la totalité des siens.
    sharedTries: { type: Number, default: 0 },
  },
  { _id: false }
);

const sessionGuessSchema = new mongoose.Schema(
  {
    w: { type: String, required: true },
    sim: { type: Number, required: true },
    temp: { type: Number, required: true },
    rank: { type: Number, default: null },
    // L'auteur : c'est lui qu'on affiche à côté du mot dans la liste.
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const motSessionSchema = new mongoose.Schema(
  {
    // L'adresse de la session, celle qui s'écrit dans le lien qu'on copie.
    code: { type: String, required: true, unique: true },
    date: { type: String, required: true }, // même clé de jour que MotDuJour
    word: { type: String, required: true }, // dénormalisé (jamais envoyé au client)

    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // L'équipe permanente derrière cette table, s'il y en a une (cf.
    // models/MotTeam.js). C'est elle qui fait qu'on retrouve les mêmes joueurs
    // le lendemain sans réinviter personne : la session change tous les jours,
    // l'équipe reste.
    team: { type: mongoose.Schema.Types.ObjectId, ref: "MotTeam", default: null },
    members: { type: [memberSchema], default: [] },
    guesses: { type: [sessionGuessSchema], default: [] },

    // Le pot commun d'essais (cf. l'en-tête). Ne décroît jamais.
    tries: { type: Number, default: 0 },

    solved: { type: Boolean, default: false },
    solvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    solvedAt: { type: Date, default: null },
    startedAt: { type: Date, default: Date.now },
    timeMs: { type: Number, default: null },
    score: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Une session se retrouve par son code (lien, carte d'invitation), et on liste
// celles du jour pour proposer « rejoindre la partie d'un ami ».
motSessionSchema.index({ date: 1, solved: 1 });
// La partie du jour d'une équipe donnée : c'est la question posée à chaque
// ouverture de la page par un membre.
//
// UNIQUE, et c'est essentiel : deux coéquipiers qui cliquent « lancer » à la
// même seconde ouvriraient deux tables pour la même équipe, et se retrouveraient
// chacun sur la sienne à chercher le même mot sans se voir. L'index tranche la
// course — le perdant reçoit une erreur de doublon et rejoint la table gagnante
// (cf. openTeamSession dans routes/mot.js). Partiel, car les parties sans
// équipe (la majorité) ont toutes `team: null`.
motSessionSchema.index(
  { team: 1, date: 1 },
  { unique: true, partialFilterExpression: { team: { $type: "objectId" } } }
);

export default mongoose.model("MotSession", motSessionSchema);
