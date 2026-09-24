import mongoose from "mongoose";

// Un jeu que le compagnon PC a vu passer : un dossier de sauvegarde d'émulateur
// (appid Steam), un dossier de la bibliothèque de jeux du PC (D:\Games\…), ou
// un jeu lancé. RIEN n'atteint le profil tant que le joueur ne l'a pas validé
// sur le site (routes/companion.js, « À valider ») :
//
//   pending   détecté, en attente : ses succès et ses heures patientent dans
//             des CompanionEvent « pending » ;
//   approved  validé (jeu IGDB confirmé) : ce qui arrive ensuite s'applique
//             tout seul si le joueur a choisi le mode automatique, sinon
//             attend aussi sa validation ;
//   ignored   « pas un jeu » / « ne plus suivre » : le compagnon ne le compte
//             plus, et ce qui arrive est jeté.
const companionGameSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Identité stable côté PC : "steam:<appid>" si un appid a été trouvé, sinon
    // "dir:<nom de dossier simplifié>".
    key: { type: String, required: true },
    appid: { type: Number, default: null },
    rawName: { type: String, default: "" }, // nom du dossier tel quel
    folder: { type: String, default: null }, // chemin sur le PC (affichage)
    emulator: { type: String, default: null }, // RUNE, GSE, Ubisoft…
    device: { type: mongoose.Schema.Types.ObjectId, ref: "CompanionDevice", default: null },
    state: { type: String, enum: ["pending", "approved", "ignored"], default: "pending" },

    // Le jeu IGDB proposé (puis confirmé à la validation). null = non reconnu,
    // le joueur le choisit à la main.
    gameId: { type: Number, default: null },
    name: { type: String, default: null },
    cover: { type: String, default: null },
    matchTried: { type: Boolean, default: false },

    // Succès déjà reçus (apiName) : un succès annulé ne revient pas au
    // prochain envoi, un succès rejeté non plus.
    seen: { type: [String], default: [] },
    // L'entrée de bibliothèque a été créée par le compagnon (et peut donc être
    // retirée quand on annule tout).
    entryCreated: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    lastPlayedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

companionGameSchema.index({ user: 1, key: 1 }, { unique: true });
companionGameSchema.index({ user: 1, state: 1 });

export default mongoose.model("CompanionGame", companionGameSchema);
