import mongoose from "mongoose";

// Résultat du scan PSN d'un utilisateur, RÉCUPÉRÉ par le worker maison et mis en
// cache ici. Rien n'est écrit dans la bibliothèque : ces données alimentent la
// modale « Importer mes jeux », où l'utilisateur valide jeu par jeu (statut,
// console, trophées). Un seul enregistrement par utilisateur (remplacé à chaque
// nouveau scan). `games`/`unmatched` reprennent la forme produite par
// buildPsnImportData (avec la liste complète des trophées de chaque titre).
const psnScanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    games: { type: [mongoose.Schema.Types.Mixed], default: [] },
    unmatched: { type: [mongoose.Schema.Types.Mixed], default: [] },
    gamesCount: { type: Number, default: 0 },
    unmatchedCount: { type: Number, default: 0 },
    scannedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("PsnScan", psnScanSchema);
