import mongoose from "mongoose";

// Cache des temps "how long to beat" récupérés en fallback (HowLongToBeat),
// UNE seule fois par jeu si IGDB ne les a pas. source: hltb | none | pending.
const gameTimeSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    hastily: { type: Number, default: null }, // heures
    normally: { type: Number, default: null },
    completely: { type: Number, default: null },
    source: { type: String, default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("GameTime", gameTimeSchema);
