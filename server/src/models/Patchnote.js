import mongoose from "mongoose";

// Une entrée (nouveauté) d'un patch note : un titre, une description, une icône
// lucide optionnelle, et des images (ex. avant/après pour le responsive).
const itemSchema = new mongoose.Schema(
  {
    icon: { type: String, default: "Sparkles" }, // nom d'icône lucide-react
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    images: { type: [String], default: [] }, // URLs (0, 1 ou 2 pour avant/après)
  },
  { _id: false }
);

// Un patch note = une version de l'app. Tant qu'il n'est pas "published", il
// reste un brouillon invisible pour les utilisateurs (édition côté admin).
const patchnoteSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, unique: true, trim: true }, // ex. "1.1"
    title: { type: String, required: true, trim: true },
    intro: { type: String, default: "", trim: true },
    items: { type: [itemSchema], default: [] },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

patchnoteSchema.methods.toClient = function () {
  return {
    id: this._id,
    version: this.version,
    title: this.title,
    intro: this.intro,
    items: this.items,
    published: this.published,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model("Patchnote", patchnoteSchema);
