import mongoose from "mongoose";

// ======================================================================
//  Les cartes d'un joueur : une ligne par (joueur, carte), avec un compteur.
// ======================================================================
// Un doublon n'est pas une nouvelle ligne : `count` monte. On garde les
// doublons tels quels — ce sont eux qui serviront aux échanges plus tard.
const cardOwnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    card: { type: Number, required: true }, // = Card._id = id IGDB du jeu
    count: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    // Pas encore vue dans le classeur : la pastille « NEW ».
    fresh: { type: Boolean, default: true },
  },
  { versionKey: false }
);

cardOwnSchema.index({ user: 1, card: 1 }, { unique: true });

export default mongoose.model("CardOwn", cardOwnSchema, "cardowns");
