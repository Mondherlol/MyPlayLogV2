import mongoose from "mongoose";

// Piste d'OST ajoutée par un utilisateur (lien YouTube), partagée pour ce jeu.
const customOstSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    artist: { type: String, default: null },
    url: { type: String, required: true },
    videoId: { type: String, required: true },
    artwork: { type: String, default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("CustomOst", customOstSchema);
