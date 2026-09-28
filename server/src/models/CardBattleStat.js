import mongoose from "mongoose";

// ======================================================================
//  Le palmarès d'un joueur aux combats de cartes
// ======================================================================
// Victoires, défaites, série en cours et niveau du bot (il monte quand on
// gagne, redescend quand on perd). `day`/`dayGames` comptent les parties du
// jour : au-delà d'une dizaine, elles rapportent moins.
const cardBattleStatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    best: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    day: { type: String, default: "" },
    dayGames: { type: Number, default: 0 },
    // La passe : saison, étoiles gagnées, paliers dont le booster est récupéré.
    passSeason: { type: Number, default: 1 },
    passStars: { type: Number, default: 0 },
    passClaimed: { type: [Number], default: [] },
    // Les duels entre joueurs : un palmarès à part (le niveau du bot et la
    // série n'y bougent pas).
    pvpWins: { type: Number, default: 0 },
    pvpLosses: { type: Number, default: 0 },
    pvpDraws: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export default mongoose.model("CardBattleStat", cardBattleStatSchema, "cardbattlestats");
