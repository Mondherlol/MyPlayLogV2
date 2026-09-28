import mongoose from "mongoose";

// ======================================================================
//  Un échange de cartes entre deux joueurs
// ======================================================================
// `from` propose : il DONNE `give` et DEMANDE `want` à `to`. Tant que c'est
// « pending », rien ne bouge ; à l'acceptation, les cartes changent de
// classeur d'un coup. `seenFrom` : le proposeur a vu l'échange se faire (il
// n'était pas là quand l'autre a accepté — l'animation l'attend).
const cardTradeSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    give: { type: [Number], default: [] },
    want: { type: [Number], default: [] },
    status: {
      type: String,
      enum: ["pending", "accepting", "accepted", "declined", "cancelled", "failed"],
      default: "pending",
    },
    decidedAt: { type: Date, default: null },
    seenFrom: { type: Boolean, default: false },
    // Une proposition peut en REMPLACER une autre : une contre-proposition
    // (« je préfère te donner ça contre ça ») ou ma propre offre retouchée.
    // `replaces` : l'ancienne ; `reply` : c'est une contre-proposition ;
    // `counter` (sur l'ancienne) : celle qui l'a remplacée.
    replaces: { type: mongoose.Schema.Types.ObjectId, default: null },
    reply: { type: Boolean, default: false },
    counter: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false }
);

cardTradeSchema.index({ to: 1, status: 1, createdAt: -1 });
cardTradeSchema.index({ from: 1, status: 1, createdAt: -1 });

export default mongoose.model("CardTrade", cardTradeSchema, "cardtrades");
