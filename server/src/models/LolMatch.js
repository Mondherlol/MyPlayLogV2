import mongoose from "mongoose";

// Cache serveur du détail d'une partie League of Legends (scoreboard complet)
// pour la pagination « Voir plus » de l'onglet Tracking. Le détail d'une partie
// terminée est IMMUABLE : une fois lu depuis l'API Riot, on le stocke ici et on
// ne re-tape plus Riot pour cette partie. Clé = (utilisateur, matchUid), car la
// forme normalisée dépend du point de vue du joueur (badges MVP/ACE, « moi »…).
const lolMatchSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    matchUid: { type: String, required: true }, // id Riot de la partie
    playedAt: { type: Date, required: true },
    // Charge utile complète (sortie de normMatch) servie telle quelle au client.
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

// Anti-doublon : une partie cachée une seule fois par joueur.
lolMatchSchema.index({ user: 1, matchUid: 1 }, { unique: true });
// Purge automatique du cache après 30 jours (borne la taille de la collection).
lolMatchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("LolMatch", lolMatchSchema);
