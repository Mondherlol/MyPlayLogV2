import mongoose from "mongoose";

// ======================================================================
//  UNE SYNCHRO STEAM — le brouillon, puis la trace
// ======================================================================
//
// ⚠️ UNE SYNCHRO N'ÉCRIT RIEN TOUTE SEULE. Elle se dépose ici à l'état
// « pending » : c'est un RÉCAP que l'utilisateur ouvre, modifie et valide
// quand il veut. Tant qu'il ne l'a pas validée, sa bibliothèque n'a pas
// bougé d'un pouce, et le récap l'attend dans ses réglages — y compris s'il
// ferme l'app au milieu (d'où le stockage en base plutôt qu'en mémoire).
//
// Une fois validée (ou annulée), le même document devient la ligne
// d'historique : ce qu'on a trouvé, ce qu'on a appliqué, et quand.

// Un jeu de la bibliothèque Steam, tel qu'il a été trouvé au moment du scan —
// et ce que l'utilisateur a décidé d'en faire.
const itemSchema = new mongoose.Schema(
  {
    // --- Ce que Steam en dit ---
    appid: { type: Number, required: true },
    steamName: { type: String, default: null },
    steamIcon: { type: String, default: null },
    playtimeMinutes: { type: Number, default: 0 },
    playtimeHours: { type: Number, default: 0 },

    // --- Le jeu IGDB derrière (toujours présent : les non reconnus vivent
    //     dans `unmatched`, pas ici) ---
    gameId: { type: Number, required: true },
    name: { type: String, required: true },
    cover: { type: String, default: null },
    endless: { type: Boolean, default: false },

    // --- L'état de la bibliothèque MyPlayLog au moment du scan ---
    inLibrary: { type: Boolean, default: false },
    currentStatus: { type: String, default: null },
    currentHours: { type: Number, default: null },

    // wishlist (jamais lancé) | played (joué, absent) | update (déjà là) | synced (rien à faire)
    category: { type: String, default: "wishlist" },
    suggestedStatus: { type: String, default: "wishlist" },
    canImportAchievements: { type: Boolean, default: false },

    // --- Les choix de l'utilisateur, modifiables jusqu'à la validation ---
    include: { type: Boolean, default: true },
    status: { type: String, default: "wishlist" },
    hours: { type: Number, default: null },
    updateHours: { type: Boolean, default: false },
    importAchievements: { type: Boolean, default: true },
  },
  { _id: false }
);

// Un titre que Steam connaît mais qu'on n'a pas su relier au catalogue : on le
// montre pour l'honnêteté du récap, on n'en fait rien.
const unmatchedSchema = new mongoose.Schema(
  {
    appid: { type: Number, required: true },
    name: { type: String, default: null },
    icon: { type: String, default: null },
    playtimeMinutes: { type: Number, default: 0 },
  },
  { _id: false }
);

const steamSyncSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // pending : le récap attend la validation — applied / cancelled : historique.
    state: {
      type: String,
      enum: ["pending", "applied", "cancelled"],
      default: "pending",
    },
    // first : la toute première synchro (on importe la bibliothèque) —
    // refresh : les suivantes (on met à jour heures et succès).
    kind: { type: String, enum: ["first", "refresh"], default: "first" },

    items: { type: [itemSchema], default: [] },
    unmatched: { type: [unmatchedSchema], default: [] },

    counts: {
      wishlist: { type: Number, default: 0 },
      played: { type: Number, default: 0 },
      update: { type: Number, default: 0 },
      synced: { type: Number, default: 0 },
      unmatched: { type: Number, default: 0 },
      ignored: { type: Number, default: 0 }, // écartés d'avance (liste des ignorés)
    },

    result: {
      added: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      hoursUpdated: { type: Number, default: 0 },
      achievements: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 }, // décochés au moment de valider
    },

    appliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Le récap en cours se cherche à chaque ouverture des réglages.
steamSyncSchema.index({ user: 1, state: 1 });
steamSyncSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("SteamSync", steamSyncSchema);
