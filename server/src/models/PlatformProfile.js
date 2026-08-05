import mongoose from "mongoose";

// Cache éditorial d'une console / plateforme (page /platform/:id), partagé entre
// tous les utilisateurs — même esprit que CompanyProfile. On agrège des sources
// publiques lentes (IGDB + Wikipedia + Wikidata) une fois, puis on sert tout
// depuis Mongo. La partie « ma bibliothèque » (affinité) est recalculée par
// requête et n'est PAS stockée ici.

// Une révision matérielle de la console (PS4 Slim, PS4 Pro, New 3DS…).
const versionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    base: { type: Boolean, default: false }, // modèle par défaut (console de base)
    image: { type: String, default: null }, // photo du modèle (Wikimedia Commons)
    logo: { type: String, default: null }, // logo IGDB de la révision
    summary: { type: String, default: null },
    year: { type: Number, default: null }, // année de sortie de la révision
    cpu: { type: String, default: null },
    memory: { type: String, default: null },
    storage: { type: String, default: null },
    os: { type: String, default: null },
  },
  { _id: false }
);

// Console « sœur » de la même famille (PlayStation, Nintendo, Xbox…).
const relatedSchema = new mongoose.Schema(
  {
    platformId: { type: Number, required: true },
    name: { type: String, required: true },
    abbr: { type: String, default: null },
    logo: { type: String, default: null },
    generation: { type: Number, default: null },
  },
  { _id: false }
);

// Jeu du catalogue de la console (agrégé une fois, croisé avec la biblio par requête).
const catalogGameSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    name: { type: String, required: true },
    cover: { type: String, default: null },
    year: { type: Number, default: null },
    rating: { type: Number, default: null }, // note critique IGDB (0-100)
    ratingCount: { type: Number, default: 0 }, // nb d'avis = popularité
    publisher: { type: String, default: null }, // éditeur principal
    franchise: { type: String, default: null }, // saga IGDB
    debut: { type: Boolean, default: false }, // a débuté sur cette console (exclu/lead)
    exclusive: { type: Boolean, default: false }, // sorti UNIQUEMENT sur cette console
  },
  { _id: false }
);

const platformProfileSchema = new mongoose.Schema(
  {
    // Clé de recherche : l'id IGDB de la plateforme (stable, unique).
    key: { type: String, required: true, unique: true },
    v: { type: Number, default: 1 }, // version du schéma d'agrégation
    igdbId: { type: Number, required: true },
    name: { type: String, required: true },
    abbr: { type: String, default: null }, // abréviation (PS4, SNES…)
    generation: { type: Number, default: null }, // génération de consoles
    family: { type: String, default: null }, // famille (PlayStation, Nintendo…)
    logo: { type: String, default: null }, // logo IGDB
    image: { type: String, default: null }, // image d'en-tête (Wikipedia)

    manufacturer: { type: String, default: null }, // constructeur (Sony, Nintendo…)
    releaseDate: { type: Date, default: null }, // première sortie
    releaseYear: { type: Number, default: null },
    discontinuedDate: { type: Date, default: null }, // arrêt de production
    unitsSold: { type: Number, default: null }, // unités vendues (Wikidata)
    unitsSoldYear: { type: Number, default: null },

    summary: { type: String, default: null }, // résumé IGDB
    description: { type: String, default: null }, // bio (Wikipedia de préférence)
    descriptionSource: { type: String, default: null }, // "wikipedia" | "igdb"
    wikiUrl: { type: String, default: null },

    versions: { type: [versionSchema], default: [] },
    related: { type: [relatedSchema], default: [] },
    genres: {
      // Répartition des genres des jeux sortis dessus (pour le donut).
      type: [{ name: String, count: Number, _id: false }],
      default: [],
    },
    publishers: {
      // Top éditeurs qui ont sorti des gros jeux dessus (avec logo IGDB).
      type: [{ name: String, count: Number, pop: Number, logo: String, _id: false }],
      default: [],
    },
    total: { type: Number, default: 0 }, // taille totale du catalogue IGDB
    exclusiveCount: { type: Number, default: 0 }, // nb de jeux exclusifs (count IGDB, non plafonné)
    games: { type: [catalogGameSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("PlatformProfile", platformProfileSchema);
