import mongoose from "mongoose";

// ======================================================================
//  Un classeur perso : une liste de cartes à réunir
// ======================================================================
// « Ace Attorney », « Mes Zelda », « Les jeux de mon enfance »… Le classeur
// liste des cartes, qu'on les AIT ou non : celles qui manquent s'affichent en
// creux, et la barre dit où on en est. `source` : la série IGDB dont il a
// été rempli (franchise ou collection), s'il y en a une.
const cardBinderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, default: "gold" },
    cards: { type: [Number], default: [] },
    source: {
      type: new mongoose.Schema({ key: String, name: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

cardBinderSchema.index({ user: 1, createdAt: 1 });

export default mongoose.model("CardBinder", cardBinderSchema, "cardbinders");
