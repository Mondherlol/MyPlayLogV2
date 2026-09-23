import mongoose from "mongoose";

// ======================================================================
//  Un PC relié au compte par le compagnon MyPlayLog
// ======================================================================
// Le compagnon (companion/ à la racine du dépôt) tourne dans la barre des
// tâches Windows : il lit les fichiers des émulateurs de succès et compte le
// temps passé dans les jeux hors boutique, puis les remonte ici.
//
// Il ne reçoit PAS le jeton de connexion du joueur : on lui donne le sien,
// qui ne sert qu'aux routes du compagnon (succès, temps de jeu) et qu'on peut
// révoquer depuis l'app sans toucher au reste. On n'en garde que l'empreinte
// (SHA-256) : une fuite de la base ne donne aucun jeton utilisable.
const companionDeviceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    name: { type: String, default: "PC", maxlength: 80 },
    lastSeenAt: { type: Date, default: null },
    // Les derniers envois de temps de jeu déjà comptés : un envoi rejoué après
    // une coupure réseau ne doit pas compter deux fois.
    recentIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

companionDeviceSchema.index({ user: 1 });

export default mongoose.model("CompanionDevice", companionDeviceSchema);
