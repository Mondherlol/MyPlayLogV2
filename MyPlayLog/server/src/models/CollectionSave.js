import mongoose from "mongoose";

// ======================================================================
//  Les sauvegardes de jeu — chez NOUS, pas dans le navigateur
// ======================================================================
// C'EST LE POINT QUI CHANGE TOUT PAR RAPPORT AU RAYON DS. Là, la sauvegarde
// vivait dans l'IndexedDB du navigateur : elle disparaissait avec un nettoyage
// d'historique, ne suivait pas d'un ordinateur au téléphone, et le modèle de
// progression disait tranquillement « rien à reprendre ». Autrement dit : on
// laissait le joueur perdre sa partie, et on l'écrivait en commentaire.
//
// Une partie est maintenant un document ici, et son état un fichier sur notre
// disque. On la retrouve donc partout où l'on se connecte, exactement comme la
// position dans un épisode ou la planche d'un manga.
//
// UN ÉTAT DE MACHINE, PAS UNE PILE DE SAUVEGARDE. Ce qu'on garde n'est pas la
// pile de la cartouche (le fichier .sav, écrit par le jeu quand IL le décide)
// mais l'état complet de la console à un instant donné : processeur, mémoire,
// écran. C'est ce qui permet de reprendre AU PIXEL où l'on s'est arrêté, même au
// milieu d'un combat, et sans dépendre du bon vouloir du jeu.
//
// LE PRIX À PAYER, ET IL EST RÉEL : UN ÉTAT APPARTIENT À SON CŒUR. Un état écrit
// par mGBA ne se relit pas dans VBA — la disposition de la mémoire n'est pas la
// même, et le charger quand même donnerait une bouillie ou un plantage. D'où le
// champ `core`, et le refus explicite côté route : on préfère dire « cette
// sauvegarde a été faite avec mGBA » que rendre une partie corrompue.

// L'emplacement 0 est L'AUTOMATIQUE : la console y écrit toute seule, par
// tranches et à l'extinction. C'est lui qui fait la promesse de la rangée
// « Reprendre » — les autres sont ceux que le joueur pose lui-même, avant un
// boss ou pour garder un embranchement.
export const AUTO_SLOT = 0;
export const MANUAL_SLOTS = 6;

// Un état de GBA pèse quelques centaines de kilo-octets ; le plafond est là pour
// arrêter un envoi qui part en vrille, pas pour arbitrer.
export const STATE_MAX = 16 * 1024 * 1024;

const collectionSaveSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    media: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CollectionMedia",
      required: true,
    },

    slot: { type: Number, required: true }, // 0 = automatique, 1..6 = manuels

    file: { type: String, default: null }, // /uploads/saves/<user>-<media>-<slot>.state
    bytes: { type: Number, default: 0 },

    // LA VIGNETTE FAIT LE TIROIR. Une liste de « Emplacement 3 — 14:22 » ne dit
    // rien de ce qu'on va retrouver ; l'écran figé de la console, lui, se
    // reconnaît en un coup d'œil. C'est un JPEG de 240 × 160 pris au moment de la
    // sauvegarde, soit le contenu exact de l'écran.
    thumb: { type: String, default: null },

    // Le cœur qui a écrit l'état. Sans lui, changer de moteur d'émulation
    // rendrait toutes les sauvegardes silencieusement illisibles.
    core: { type: String, default: "" },

    // Le temps de jeu cumulé au moment de la sauvegarde. Ce n'est pas un doublon
    // de CollectionProgress.playSeconds : celui-ci est FIGÉ dans l'état, et c'est
    // ce qui permet d'écrire « 3 h 12 de jeu » sous une vignette vieille d'un
    // mois.
    playSeconds: { type: Number, default: 0 },

    // Ce que le joueur a tapé, s'il a tapé quelque chose. Vide sur
    // l'automatique : il n'a pas de nom, il a une heure.
    label: { type: String, default: "" },
  },
  { timestamps: true }
);

// Un seul document par (joueur, jeu, emplacement) : écrire dans un emplacement
// occupé l'ÉCRASE, c'est le geste attendu d'un emplacement de sauvegarde.
collectionSaveSchema.index({ user: 1, media: 1, slot: 1 }, { unique: true });

export default mongoose.model("CollectionSave", collectionSaveSchema);
