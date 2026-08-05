import mongoose from "mongoose";

// Personnage ajouté par un utilisateur pour un jeu (quand IGDB n'en a pas),
// réutilisable par les autres.
const customCharacterSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, index: true },
    name: { type: String, required: true },
    image: { type: String, default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("CustomCharacter", customCharacterSchema);
