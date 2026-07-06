import mongoose from "mongoose";

// Un « recommandeur » : un utilisateur qui a recommandé ce jeu au destinataire
// (chacun vaut +1). Message optionnel.
const recommenderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, default: "", maxlength: 280 },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Un commentaire sur une recommandation.
const recCommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: true }
);

// Une recommandation = un jeu recommandé à UN destinataire. Plusieurs personnes
// peuvent le recommander (chacune +1) ; d'autres peuvent « +1 » sans recommander
// (boosters). Score total = recommandeurs + boosters.
const recommendationSchema = new mongoose.Schema(
  {
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: Number, required: true }, // id IGDB
    name: { type: String, required: true },
    cover: { type: String, default: null },

    recommenders: { type: [recommenderSchema], default: [] },
    boosters: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [recCommentSchema], default: [] },
  },
  { timestamps: true }
);

// Une seule carte par (destinataire, jeu).
recommendationSchema.index({ to: 1, gameId: 1 }, { unique: true });
recommendationSchema.index({ to: 1, updatedAt: -1 });
recommendationSchema.index({ "recommenders.user": 1 });

export default mongoose.model("Recommendation", recommendationSchema);
