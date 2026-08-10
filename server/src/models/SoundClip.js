import mongoose from "mongoose";

// ======================================================================
//  La banque de sons du Perroquet
// ======================================================================
// Un clip = un son court et iconique qu'on va demander d'imiter à la voix.
//
// CE QUI FAIT UN BON CLIP, et c'est plus étroit qu'il n'y paraît :
//   - court (0,3 à 2 s) — au-delà, personne ne retient la mélodie ;
//   - VOCAL ou au moins mélodique — un bruit de pas, une explosion ou un
//     cliquetis n'ont pas de hauteur, donc rien à imiter avec sa gorge, et le
//     barème de lib/soundContour.js n'aurait littéralement rien à mesurer ;
//   - reconnaissable — la moitié du plaisir est de savoir ce qu'on imite.
// Les cris de Pokémon, le « wahoo » de Mario, Yoshi, Kirby et le « hyah » de
// Link sont les archétypes. Un fracas de caisse ne l'est pas.
//
// Le CONTOUR est calculé une seule fois, à l'insertion (routes/perroquetAdmin.js
// — l'onglet « Perroquet » du panneau d'admin, seul chemin par lequel la banque
// se garnit), et stocké ici. C'est ce qui fait qu'une manche ne
// redécode jamais le son de référence : on compare la tentative du joueur à une
// centaine de nombres déjà en base. Sans ça, chaque manche paierait un ffmpeg
// de plus pour recalculer une valeur qui ne change jamais.
const contourSchema = new mongoose.Schema(
  {
    pitch: { type: [Number], default: [] },  // 64 demi-tons relatifs
    energy: { type: [Number], default: [] }, // 64 valeurs 0..1
    durationMs: { type: Number, default: 0 },
    voicedRatio: { type: Number, default: 0 },
  },
  { _id: false }
);

const soundClipSchema = new mongoose.Schema(
  {
    // La réponse affichée après coup : « Yoshi », « Pikachu », « Mario saute ».
    label: { type: String, required: true, trim: true },
    // D'où ça vient, pour la ligne de contexte et le lien vers la fiche.
    game: { type: String, default: "" },
    gameId: { type: Number, default: null }, // IGDB, si on l'a
    // Le fichier servi au navigateur (/uploads/perroquet/…).
    url: { type: String, required: true },
    contour: { type: contourSchema, default: () => ({}) },

    // 1 (facile à imiter : une note, deux syllabes) → 5 (mélodie tordue).
    // Sert à composer une partie qui monte en difficulté plutôt qu'à tirer
    // cinq monstres d'affilée.
    difficulty: { type: Number, default: 2, min: 1, max: 5 },

    // Éteint = ne sort plus au tirage, mais les parties déjà jouées gardent
    // leur référence. On ne supprime pas un clip qui est dans un historique.
    active: { type: Boolean, default: true },

    // ---------------------------------------------------- les sons de la commu
    // `owner` vide = son officiel, déposé depuis le panneau d'admin : il fait
    // partie du tirage de tout le monde, tout le temps.
    //
    // `owner` renseigné = son déposé par un joueur depuis SA librairie. Il ne
    // sort JAMAIS d'office : il n'entre dans le tirage que si la partie a activé
    // les sons personnalisés, et uniquement pour les joueurs présents (cf.
    // routes/perroquetSounds.js). C'est ce qui permet d'ouvrir le dépôt à tout
    // le monde sans que la banque commune parte à la dérive : un son bancal ne
    // gêne que la table qui a choisi de le jouer.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Le pseudo au moment du dépôt : sert à afficher « proposé par … » à la
    // révélation sans peupler un utilisateur par manche.
    ownerName: { type: String, default: "" },

    // Statistiques de tirage, pour repérer les clips injouables : un son que
    // personne ne dépasse jamais 30 est soit mal découpé, soit pas imitable.
    timesPlayed: { type: Number, default: 0 },
    scoreSum: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Le tirage d'une manche filtre sur `active` puis échantillonne par difficulté.
soundClipSchema.index({ active: 1, difficulty: 1 });
// La librairie d'un joueur, et le tirage « sons des joueurs présents ».
soundClipSchema.index({ owner: 1, createdAt: -1 });

export default mongoose.model("SoundClip", soundClipSchema);
