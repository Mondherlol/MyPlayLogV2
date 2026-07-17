import mongoose from "mongoose";

// Un post du « mur média » d'un jeu : une capture, un clip, une vidéo YouTube,
// un post X/Twitter, un TikTok… posté par n'importe quel joueur pour partager
// ses screens marrants, clips rigolos, etc. Un document par post (contrairement
// aux commentaires embarqués des listes) : mieux pour la pagination, le tri par
// popularité et le like par post.
const gameMediaSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true }, // id IGDB du jeu
    gameName: { type: String, default: null }, // pour le fil / notifications
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Légende libre (optionnelle) : le média peut se suffire à lui-même.
    caption: { type: String, default: "", maxlength: 600 },
    // Masqué par un flou tant qu'on ne clique pas (choisi par l'auteur).
    spoiler: { type: Boolean, default: false },
    // Le média lui-même. `kind` pilote le rendu :
    //  - image / video / gif : fichier hébergé (url) ou GIF GIPHY
    //  - youtube / twitter / tiktok : embed identifié par `embedId`
    //  - link : repli générique (carte cliquable)
    media: {
      kind: {
        type: String,
        enum: ["image", "video", "gif", "youtube", "twitter", "tiktok", "link"],
        required: true,
      },
      url: { type: String, required: true }, // fichier hébergé OU URL d'origine
      embedId: { type: String, default: null }, // id vidéo YouTube / tweet / tiktok
      thumbnail: { type: String, default: null }, // poster (vidéo) / miniature
      width: { type: Number, default: null },
      height: { type: Number, default: null },
    },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { timestamps: true }
);

// Fil d'un jeu, trié du plus récent au plus ancien (ou par popularité en mémoire).
gameMediaSchema.index({ gameId: 1, createdAt: -1 });

export default mongoose.model("GameMedia", gameMediaSchema);
