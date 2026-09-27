import mongoose from "mongoose";

// ======================================================================
//  Une CARTE du set : un jeu, son numéro, sa rareté — figés à la création.
// ======================================================================
// La rareté vient de la popularité du jeu (nombre de votes IGDB), mais elle
// est RELEVÉE UNE FOIS, à la naissance du set, puis ne bouge plus : une carte
// légendaire tirée hier ne doit pas devenir épique demain parce qu'un autre
// jeu a gagné des votes. Les jeux sortis après ce relevé iront dans un set
// suivant (une « extension »), jamais dans celui-ci.
//
// Tout le reste (nom, jaquette, note, genres) est relu en direct dans
// GameFeatures : une jaquette corrigée chez IGDB se corrige aussi sur la carte.
const cardSchema = new mongoose.Schema(
  {
    _id: { type: Number }, // id IGDB du jeu
    set: { type: Number, required: true },
    no: { type: Number, required: true }, // numéro dans le set (1 = le plus populaire)
    rarity: { type: String, required: true },
    // L'illustration de la fenêtre de la carte : un visuel PAYSAGE (key art
    // IGDB, à défaut une capture). La jaquette, portrait, y serait rognée —
    // titre coupé, personnage décapité. `artAt` : quand on l'a cherchée (même
    // sans succès), pour ne pas redemander à IGDB à chaque démarrage.
    art: { type: String, default: null },
    artAt: { type: Date, default: null },
    // Le morceau de jaquette montré dans la fenêtre (fractions { x, y, w, h },
    // cf. lib/cardFocus.js). null = jaquette entière. `focusAt` : calculé.
    focus: { type: mongoose.Schema.Types.Mixed, default: null },
    focusAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

cardSchema.index({ set: 1, no: 1 }, { unique: true });

export default mongoose.model("Card", cardSchema, "cards");
