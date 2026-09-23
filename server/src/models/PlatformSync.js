import mongoose from "mongoose";

// ======================================================================
//  UNE SYNCHRO DE PLATEFORME — le brouillon, puis la trace
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
//
// ⚠️ UN SEUL MODÈLE POUR STEAM ET PLAYSTATION, et c'est ce qui permet à
// l'application de n'avoir QU'UN écran de récap. Les deux plateformes posent
// la même question (« ces jeux, on en fait quoi ? ») ; ce qui change tient en
// quelques champs — un appid d'un côté, un identifiant de trophées et une
// console de l'autre — et un champ vide ne coûte rien.

const consoleSchema = new mongoose.Schema(
  { label: String, name: String },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    // L'identité du jeu CHEZ LA PLATEFORME, et la clé de tout le reste : c'est
    // elle que l'app renvoie pour cocher, changer un statut ou écarter.
    // Steam : l'appid en toutes lettres. PlayStation : le titre simplifié.
    key: { type: String, required: true },

    // --- Ce que la plateforme en dit ---
    sourceName: { type: String, default: null }, // le nom tel qu'affiché là-bas
    icon: { type: String, default: null },
    playtimeMinutes: { type: Number, default: 0 },
    playtimeHours: { type: Number, default: 0 },
    lastPlayed: { type: Date, default: null },

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

    // wishlist (jamais lancé) | played (joué, absent) | update (déjà là)
    category: { type: String, default: "played" },
    suggestedStatus: { type: String, default: "paused" },
    canImportAchievements: { type: Boolean, default: false },

    // --- Propre à Steam ---
    appid: { type: Number, default: null },

    // --- Propre à PlayStation ---
    npCommunicationId: { type: String, default: null },
    npServiceName: { type: String, default: null },
    trophyProgress: { type: Number, default: null },
    definedTrophies: { type: Number, default: 0 },
    hasPlatinum: { type: Boolean, default: false },
    // Les consoles PS où le jeu est sorti, et celle qu'on propose : un jeu
    // PlayStation entre en bibliothèque AVEC sa console, sinon la fiche ment.
    consoles: { type: [consoleSchema], default: [] },
    suggestedConsole: { type: String, default: null },

    // --- Les choix de l'utilisateur, modifiables jusqu'à la validation ---
    include: { type: Boolean, default: true },
    // ⚠️ ÉCARTÉ N'EST PAS SUPPRIMÉ. Un jeu qu'on ne veut plus voir proposer
    // reste dans le récap, marqué : c'est ce qui permet de le retrouver et de
    // revenir sur un geste définitif sans relancer toute une synchro.
    ignored: { type: Boolean, default: false },
    status: { type: String, default: "wishlist" },
    console: { type: String, default: null }, // console retenue (PlayStation)
    hours: { type: Number, default: null },
    updateHours: { type: Boolean, default: false },
    importAchievements: { type: Boolean, default: true },
  },
  { _id: false }
);

// Un titre que la plateforme connaît mais qu'on n'a pas su relier au
// catalogue : on le montre pour l'honnêteté du récap, on n'en fait rien.
const unmatchedSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, default: null },
    icon: { type: String, default: null },
    playtimeMinutes: { type: Number, default: 0 },
    // Gardés pour PlayStation : un titre relié à la main garde ainsi accès à
    // ses trophées, au lieu d'entrer en bibliothèque les mains vides.
    npCommunicationId: { type: String, default: null },
    npServiceName: { type: String, default: null },
  },
  { _id: false }
);

const platformSyncSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, enum: ["steam", "psn"], required: true },
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
platformSyncSchema.index({ user: 1, platform: 1, state: 1 });
platformSyncSchema.index({ user: 1, platform: 1, createdAt: -1 });

export default mongoose.model("PlatformSync", platformSyncSchema);
