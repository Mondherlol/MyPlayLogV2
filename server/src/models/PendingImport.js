import mongoose from "mongoose";

// Console PS proposée pour un jeu détecté (mêmes libellés que l'import).
const consoleSchema = new mongoose.Schema(
  { label: String, name: String },
  { _id: false }
);

// Un jeu repéré lors d'une synchro plateforme (PSN/Steam) mais PAS encore dans
// la bibliothèque : soit « pending » (en attente que l'utilisateur le valide),
// soit « ignored » (écarté volontairement → on ne le repropose plus).
const pendingImportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    platform: { type: String, enum: ["psn", "steam"], required: true },
    // Identité stable du titre côté plateforme (PSN : nom simplifié) — sert à
    // dédupliquer entre deux synchros et à respecter la liste des ignorés.
    titleKey: { type: String, required: true },
    state: { type: String, enum: ["pending", "ignored"], default: "pending" },

    // --- Données d'origine (plateforme) ---
    psnName: { type: String, default: null }, // nom tel qu'affiché sur PSN
    icon: { type: String, default: null },
    playtimeHours: { type: Number, default: null },
    npCommunicationId: { type: String, default: null },
    npServiceName: { type: String, default: null },
    definedTrophies: { type: Number, default: 0 },
    trophyProgress: { type: Number, default: null },
    hasPlatinum: { type: Boolean, default: false },
    canImportTrophies: { type: Boolean, default: false },

    // --- Suggestion IGDB (null = non reconnu → à lier à la main dans Settings) ---
    gameId: { type: Number, default: null },
    name: { type: String, default: null },
    cover: { type: String, default: null },
    consoles: { type: [consoleSchema], default: [] },
    suggestedConsole: { type: String, default: null },
    suggestedStatus: { type: String, default: "paused" },
  },
  { timestamps: true }
);

// Un seul enregistrement par (utilisateur, plateforme, titre).
pendingImportSchema.index({ user: 1, platform: 1, titleKey: 1 }, { unique: true });

export default mongoose.model("PendingImport", pendingImportSchema);
