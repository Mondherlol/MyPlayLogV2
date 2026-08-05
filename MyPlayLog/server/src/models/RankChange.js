import mongoose from "mongoose";

// Changement de rang classé sur une SESSION de jeu (Marvel Rivals…). Détecté au
// fil des synchros (cf. routes/trackers.syncMarvelRivals) : quand le niveau de
// rang d'un joueur change d'une partie classée à l'autre, on ouvre/étend un
// document de session. Sert de card de fil « X est passé Grandmaster 2 » (montée)
// ou « X est descendu … » (descente), avec des réactions pour féliciter / soutenir.
//
// Une session = suite de parties classées rapprochées (< SESSION_GAP). Tant que
// la session reste ouverte, on met à jour newLevel/newScore en place (le doc
// grandit, son id reste stable → la card et ses réactions ne se dédoublent pas).
const rankChangeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    provider: {
      type: String,
      required: true,
      enum: ["marvel-rivals", "league-of-legends"],
    },
    // Compte d'origine : slot du GameTracker (0 = principal, 1..3 = smurfs) +
    // pseudo du compte (badge « Smurf » de la card). Les sessions sont suivies
    // par compte : un smurf n'étend jamais la session du compte principal.
    slot: { type: Number, default: 0 },
    accountName: { type: String, default: null },

    // Rang de DÉPART (avant la 1re partie de la session ayant changé le rang).
    oldLevel: { type: Number, required: true },
    oldScore: { type: Number, default: null },
    oldTier: { type: String, default: null }, // libellé « Gold 3 »
    oldImage: { type: String, default: null },

    // Rang ACTUEL (fin de session, mis à jour à chaque nouvelle partie classée).
    newLevel: { type: Number, required: true },
    newScore: { type: Number, default: null },
    newTier: { type: String, default: null },
    newImage: { type: String, default: null },

    // "up" (montée) | "down" (descente) — dérivé de new vs old, recalculé à chaque MAJ.
    direction: { type: String, enum: ["up", "down"], required: true },

    // Héros le plus joué de la session (vignette de la card).
    hero: {
      name: { type: String, default: null },
      thumb: { type: String, default: null },
    },

    // Fenêtre temporelle de la session + parties concernées (anti-doublon).
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    matchUids: { type: [String], default: [] },

    // Réactions « féliciter / soutenir » (toggle par type, cf. cards review).
    // type ∈ "heart" | "clap" | "fire".
    reactions: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          type: { type: String },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Fil : parcours anté-chronologique par joueur.
rankChangeSchema.index({ user: 1, lastAt: -1 });
// Extension de session : retrouver la session ouverte la plus récente d'un joueur.
rankChangeSchema.index({ user: 1, provider: 1, lastAt: -1 });

export default mongoose.model("RankChange", rankChangeSchema);
