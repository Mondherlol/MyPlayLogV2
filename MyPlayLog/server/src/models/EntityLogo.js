import mongoose from "mongoose";

// Cache des logos IGDB des studios/éditeurs (companies) et consoles
// (platforms), partagé entre tous les utilisateurs — même pattern que
// GameMeta. Les absences sont aussi mémorisées (image: null) pour ne pas
// réinterroger IGDB à chaque affichage des stats.
const entityLogoSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["company", "platform", "platform-photo"], required: true },
    name: { type: String, required: true },
    image: { type: String, default: null }, // URL complète du logo, ou null
  },
  { timestamps: true }
);

entityLogoSchema.index({ kind: 1, name: 1 }, { unique: true });

export default mongoose.model("EntityLogo", entityLogoSchema);
