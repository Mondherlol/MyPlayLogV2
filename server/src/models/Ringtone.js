import mongoose from "mongoose";

// ======================================================================
//  Les sonneries proposées
// ======================================================================
// La banque de sonneries « maison », déposées depuis le panel admin. Elle ne
// contient QUE les sonneries proposées à tout le monde : celle qu'un joueur
// téléverse pour lui-même vit sur son propre document (`User.ringtone`), parce
// qu'elle n'a rien à faire dans une liste que les autres parcourent.
//
// ------------------------------------------- pourquoi une collection, et pas
// ------------------------------------------- un dossier de fichiers
// On aurait pu poser trois mp3 dans `public/` et les lister en dur. Mais alors
// ajouter une sonnerie demande un déploiement, et en retirer une casse le
// réglage de ceux qui l'avaient choisie sans qu'on s'en aperçoive. En base,
// `active` retire une sonnerie de la liste SANS la supprimer : ceux qui l'ont
// déjà la gardent, personne ne se retrouve muet du jour au lendemain.
const ringtoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    url: { type: String, required: true },
    // Mesurée à l'envoi (ffprobe). Sert à l'affichage et à refuser les fichiers
    // qui n'ont rien d'une sonnerie — un album entier passerait la limite de
    // taille en mp3 très compressé.
    duration: { type: Number, default: 0 },
    // Décochée = plus proposée, mais toujours jouée chez ceux qui l'ont.
    active: { type: Boolean, default: true },
    // LA sonnerie de l'app : celle qu'entendent tous ceux qui n'ont rien choisi.
    // Une seule à la fois (la route en désigne une et démarque les autres). Sans
    // elle, un compte neuf n'a aucune sonnerie du tout — il n'y a plus de repli
    // synthétisé derrière.
    isDefault: { type: Boolean, default: false },
    // L'ordre d'affichage, décidé par l'admin. Sans lui, la liste suit la date
    // d'ajout et la sonnerie la plus réussie finit en bas.
    order: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ringtoneSchema.index({ active: 1, order: 1 });

export default mongoose.model("Ringtone", ringtoneSchema);
