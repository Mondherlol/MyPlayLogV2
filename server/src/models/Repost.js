import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Fan art republié par un utilisateur (bouton « republier » du feed d'un jeu).
// L'image est TÉLÉCHARGÉE sur le serveur au moment du repost (`image` = nom du
// fichier dans uploads/reposts) : le feed du profil s'affiche ensuite sans
// toucher aux APIs externes (Safebooru/Tumblr/DeviantArt) et survit à la
// suppression du post original. On garde quand même l'URL d'origine en trace.
const repostSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    itemId: { type: String, required: true }, // id source du fan art ("sb-123", "da-…", "tb-…")
    source: { type: String, required: true }, // DeviantArt | Safebooru | Tumblr
    author: { type: String, default: "" },
    url: { type: String, default: "" }, // lien vers le post original
    originalImage: { type: String, default: "" }, // URL distante d'origine (trace)
    image: { type: String, required: true }, // nom du fichier local (uploads/reposts)
    w: { type: Number, default: null },
    h: { type: Number, default: null },
    gameId: { type: Number, required: true }, // id IGDB du jeu
    gameName: { type: String, required: true },
    gameCover: { type: String, default: null },
    // Interactions sociales sur la republication elle-même : likes + fil de
    // commentaires (même schéma que les listes / OST).
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

// Un même fan art ne peut être republié qu'une fois par utilisateur.
repostSchema.index({ user: 1, itemId: 1 }, { unique: true });
// Feed du profil : parcours anté-chronologique paginé.
repostSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Repost", repostSchema);
