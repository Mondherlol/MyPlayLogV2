import mongoose from "mongoose";

// ======================================================================
//  Un jeu d'un catalogue d'abonnement (Xbox Game Pass, GeForce NOW)
// ======================================================================
//
// Les deux services publient leur catalogue du MOMENT, et rien d'autre : ni
// date d'arrivée, ni trace de ce qui est parti. On en garde donc une photo à
// chaque relevé (cf. lib/catalogs.js) :
//   - `firstSeen` : le premier relevé où le jeu était là ;
//   - `leftAt`    : le premier relevé où il n'y était plus (null tant qu'il y est).
// C'est ce qui permet de dire « arrivé cette semaine » et « a été dans le Game
// Pass » — à partir du premier relevé seulement : `baseline` marque les jeux
// déjà présents ce jour-là, dont on ne connaît pas la date d'arrivée.
const catalogEntrySchema = new mongoose.Schema(
  {
    service: { type: String, enum: ["gamepass", "geforcenow"], required: true },
    // L'identifiant chez le service : le « BigId » du Microsoft Store, ou l'id
    // de la liste GeForce NOW.
    key: { type: String, required: true },
    title: { type: String, default: "" },
    // Le titre nettoyé et réduit (cf. catalogKey) : le repli pour reconnaître
    // un jeu que le rattachement à IGDB n'a pas trouvé.
    simple: { type: String, default: "" },
    image: { type: String, default: null },
    steamAppId: { type: Number, default: null },
    // GeForce NOW : la boutique où le jeu doit être possédé (Steam, Epic…).
    store: { type: String, default: null },
    // Game Pass : les listes où le jeu figure (pc, console, popular, recent,
    // coming, leaving, ea) et son rang dans les listes ordonnées.
    lists: { type: [String], default: [] },
    rank: { type: Number, default: null },

    // --- Le jeu IGDB derrière ---
    gameId: { type: Number, default: null },
    name: { type: String, default: null },
    cover: { type: String, default: null },
    popularity: { type: Number, default: 0 },
    matchedAt: { type: Date, default: null },

    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    baseline: { type: Boolean, default: false },
  },
  { timestamps: true }
);

catalogEntrySchema.index({ service: 1, key: 1 }, { unique: true });
catalogEntrySchema.index({ gameId: 1, service: 1 });
catalogEntrySchema.index({ service: 1, simple: 1 });

export default mongoose.model("CatalogEntry", catalogEntrySchema);
