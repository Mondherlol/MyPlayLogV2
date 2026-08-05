import mongoose from "mongoose";

// Un jeu de départ de la découverte de pépites (affiché dans le fil).
const seedSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    name: { type: String, required: true },
    cover: { type: String, default: null },
  },
  { _id: false }
);

// Une pépite obtenue (affichée dans la modale « ses pépites » du fil).
const resultSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    name: { type: String, required: true },
    cover: { type: String, default: null },
    rating: { type: Number, default: null },
    year: { type: Number, default: null },
    genres: { type: [String], default: [] },
  },
  { _id: false }
);

// Journal « découverte de pépites indés » pour le fil des abonnés : une seule
// carte par utilisateur et par jour (mise à jour à chaque nouvelle fournée),
// pour ne pas inonder le feed quand on relance la recherche plusieurs fois.
const gemDiscoverySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // "YYYY-MM-DD"
    seeds: { type: [seedSchema], default: [] }, // les 3 jeux de la dernière fournée
    games: { type: [resultSchema], default: [] }, // les pépites de la dernière fournée
    count: { type: Number, default: 0 }, // nb de fournées ce jour-là
  },
  { timestamps: true }
);

gemDiscoverySchema.index({ user: 1, day: 1 }, { unique: true });
gemDiscoverySchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model("GemDiscovery", gemDiscoverySchema);
