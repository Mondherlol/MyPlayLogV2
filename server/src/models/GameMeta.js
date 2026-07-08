import mongoose from "mongoose";

// Cache des métadonnées IGDB d'un jeu (genres, studios, franchise, année…),
// partagé entre tous les utilisateurs — même pattern que GameTime/VnCache.
// Rempli une seule fois par jeu (re-rafraîchi passé 30 jours, best-effort) :
// les stats de profil se calculent ensuite 100 % depuis Mongo, sans IGDB.
const gameMetaSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    name: { type: String, default: "" },
    genres: { type: [String], default: [] }, // noms déjà traduits en FR
    developers: { type: [String], default: [] },
    publishers: { type: [String], default: [] },
    franchise: { type: String, default: null },
    year: { type: Number, default: null }, // année de première sortie
    rating: { type: Number, default: null }, // total_rating IGDB arrondi
  },
  { timestamps: true }
);

export default mongoose.model("GameMeta", gameMetaSchema);
