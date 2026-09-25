import mongoose from "mongoose";

// Le nom d'un identifiant IGDB utilisé par le catalogue de recommandations
// (models/GameFeatures.js) : un genre, un thème, un mot-clé, une société, une
// série… GameFeatures ne garde que des numéros ; c'est ici qu'on retrouve de
// quoi écrire « parce que tu aimes les metroidvania ».
//
// `kind` : genre, theme, keyword, mode, persp, platform, franchise, collection,
// company. `abbr` ne sert qu'aux plateformes (PS5, NSW…).
const igdbTermSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    id: { type: Number, required: true },
    name: { type: String, required: true },
    abbr: { type: String, default: null },
  },
  { versionKey: false }
);

igdbTermSchema.index({ kind: 1, id: 1 }, { unique: true });

export default mongoose.model("IgdbTerm", igdbTermSchema);
