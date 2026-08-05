import mongoose from "mongoose";
import { commentSchema } from "./List.js";

// Couche sociale GLOBALE d'une vidéo YouTube (un doc par videoId, partagé par
// tous les profils). Les likes & commentaires appartiennent à la VIDÉO, pas à
// la recommandation d'un utilisateur en particulier : liker/commenter depuis
// n'importe quel profil ou depuis le fil d'accueil agit sur la même vidéo, donc
// deux profils qui affichent la même vidéo montrent exactement les mêmes likes
// et commentaires. Les relations personnelles (seen / later / recommended /
// watched / position de reprise) restent dans Documentary (un doc par user).
const videoSocialSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true, unique: true, index: true },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("VideoSocial", videoSocialSchema);
