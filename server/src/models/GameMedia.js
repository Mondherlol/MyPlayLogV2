import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Un média joint à un post : image / vidéo / GIF hébergés, chacun avec son
// propre marqueur spoiler (flou tant qu'on ne clique pas).
const postMediaSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["image", "video", "gif"], required: true },
    url: { type: String, required: true },
    thumbnail: { type: String, default: null }, // poster (vidéo), best-effort
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    spoiler: { type: Boolean, default: false },
  },
  { _id: false }
);

// Mention @user résolue à la création (pour la coloration côté client).
const postMentionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  { _id: false }
);

// Un post du « mur média » d'un jeu, façon fil Twitter : du texte (facultatif),
// plusieurs médias (facultatifs, chacun spoiler ou non), des likes et un fil de
// commentaires (réutilise exactement le schéma des listes). Les liens
// YouTube/X/TikTok collés dans le texte sont transformés en embeds côté client.
const gameMediaSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true }, // id IGDB du jeu
    gameName: { type: String, default: null },
    gameCover: { type: String, default: null }, // jaquette (card du fil d'accueil)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, default: "", maxlength: 1000 },
    media: { type: [postMediaSchema], default: [] },
    mentions: { type: [postMentionSchema], default: [] },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

gameMediaSchema.index({ gameId: 1, createdAt: -1 });

export default mongoose.model("GameMedia", gameMediaSchema);
