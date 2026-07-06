import mongoose from "mongoose";

// OST masquées par un utilisateur pour un jeu (retirées "pour de bon",
// y compris des prochaines recherches). Un doc par (user, game).
const hiddenOstSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true },
    hidden: { type: [String], default: [] }, // ids de pistes masquées
  },
  { timestamps: true }
);

hiddenOstSchema.index({ user: 1, gameId: 1 }, { unique: true });

export default mongoose.model("HiddenOst", hiddenOstSchema);
