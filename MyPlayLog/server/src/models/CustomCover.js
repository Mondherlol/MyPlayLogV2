import mongoose from "mongoose";

// Cover uploadée par un utilisateur pour un jeu : réutilisable par les autres.
const customCoverSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, index: true },
    url: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("CustomCover", customCoverSchema);
