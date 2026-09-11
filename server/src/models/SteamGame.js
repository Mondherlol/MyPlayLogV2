import mongoose from "mongoose";

// ======================================================================
//  Un jeu QUI N'EXISTE PAS (encore) CHEZ IGDB, décrit par sa page Steam
// ======================================================================
//
// LE PROBLÈME. Toute l'app est indexée sur un `gameId` IGDB : la bibliothèque,
// les listes, les avis, le feed. Un jeu absent du catalogue IGDB — un jeu
// indépendant qui vient de sortir, une démo, le jeu de tes potes — n'a donc
// AUCUN moyen d'entrer dans une collection. Il est invisible pour nous alors
// qu'il a une page Steam parfaitement renseignée.
//
// LA SOLUTION, ET POURQUOI DES IDENTIFIANTS NÉGATIFS. On fabrique une fiche
// locale à partir de la page Steam, et on lui donne l'identifiant `-appid`.
// C'est volontairement un NOMBRE, du même type que `UserGame.gameId`, pour que
// rien d'autre n'ait à changer : les listes, les avis et les index continuent
// de fonctionner sans savoir que ce jeu n'est pas d'IGDB. Et c'est NÉGATIF
// parce qu'IGDB ne délivre que des identifiants positifs : la collision est
// impossible par construction, et un simple `id < 0` suffit partout à savoir
// qu'on a affaire à une fiche locale (cf. lib/localGame.js).
//
// ET LE JOUR OÙ IGDB L'AJOUTE. `igdbId` est rempli par la synchro
// (lib/steamIgdbSync.js), qui redemande périodiquement à IGDB si l'appid est
// enfin connu. À partir de là, la fiche locale n'est plus qu'une redirection :
// les entrées de bibliothèque sont migrées vers le vrai identifiant, et c'est
// la vraie fiche IGDB qui s'affiche.
const screenshotSchema = new mongoose.Schema(
  { thumb: String, full: String, w: Number, h: Number },
  { _id: false }
);

const steamGameSchema = new mongoose.Schema(
  {
    appid: { type: Number, required: true, unique: true },

    // --- Ce que dit la page Steam ---
    name: { type: String, required: true },
    // Le titre tel qu'affiché par Steam DANS LA LANGUE DEMANDÉE. Le cas qui a
    // motivé tout ça : une page dont le titre s'affichait en japonais était
    // introuvable à la recherche. On garde donc les deux.
    nameOriginal: { type: String, default: null },
    shortDescription: { type: String, default: "" },
    // Le résumé en anglais : uniquement pour le dossier de soumission IGDB,
    // dont le catalogue est anglophone (cf. routes/steamGames.js).
    shortDescriptionEn: { type: String, default: "" },
    description: { type: String, default: "" }, // HTML Steam (detailed_description)
    cover: { type: String, default: null }, // portrait (library_600x900)
    header: { type: String, default: null }, // paysage 460x215
    background: { type: String, default: null }, // fond de page
    screenshots: { type: [screenshotSchema], default: [] },
    videos: { type: [String], default: [] }, // mp4 Steam (pas de YouTube ici)
    developers: { type: [String], default: [] },
    publishers: { type: [String], default: [] },
    genres: { type: [String], default: [] },
    // Systèmes Steam (windows/mac/linux) — pas des plateformes IGDB.
    oses: { type: [String], default: [] },
    website: { type: String, default: null },
    releaseDate: { type: Number, default: null }, // timestamp secondes, comme IGDB
    releaseHuman: { type: String, default: null }, // « 12 mars 2026 », « Bientôt »
    comingSoon: { type: Boolean, default: false },
    isFree: { type: Boolean, default: false },
    // "game" | "dlc" | "demo" | "music"… (champ `type` de Steam). On refuse les
    // DLC à la création : un DLC n'est pas un jeu à ranger à part (cf. les
    // `ownedDlcs` d'une entrée de bibliothèque).
    appType: { type: String, default: "game" },

    // --- Cycle de vie ---
    // Qui a fait entrer ce jeu chez nous (le premier à avoir collé le lien).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Identifiant IGDB dès qu'IGDB connaît enfin ce jeu — la fiche locale
    // devient alors une redirection.
    igdbId: { type: Number, default: null },
    resolvedAt: { type: Date, default: null },
    // Dernier passage de la synchro, et combien de fois elle a demandé pour
    // rien : au-delà d'un certain nombre d'échecs on espace les tentatives
    // (un jeu jamais ajouté à IGDB ne doit pas être redemandé tous les jours
    // pendant des années).
    checkedAt: { type: Date, default: null },
    checks: { type: Number, default: 0 },
    // L'utilisateur a ouvert le formulaire de soumission IGDB depuis la fiche.
    // On ne peut pas savoir s'il est allé au bout (IGDB n'expose aucune API de
    // contribution), mais ça évite de reproposer la démarche indéfiniment.
    submittedAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// La synchro cherche « les fiches pas encore rattachées, les moins récemment
// vérifiées d'abord » : c'est exactement cet index.
steamGameSchema.index({ igdbId: 1, checkedAt: 1 });

export default mongoose.model("SteamGame", steamGameSchema);
