import mongoose from "mongoose";

// Cache éditorial d'un studio / éditeur (page /company/:name), partagé entre
// tous les utilisateurs — même esprit que GameMeta / EntityLogo. On agrège des
// sources publiques lentes (IGDB + Wikipedia + Wikidata) une fois, puis on sert
// tout depuis Mongo. La partie « ma bibliothèque » (affinité, badges) est
// recalculée par requête et n'est PAS stockée ici.
const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, default: null }, // « Fondateur », « PDG », …
    image: { type: String, default: null }, // photo (Wikidata/Wikipedia)
    url: { type: String, default: null }, // lien Wikipedia
  },
  { _id: false }
);

const catalogGameSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    name: { type: String, required: true },
    cover: { type: String, default: null },
    year: { type: Number, default: null },
    rating: { type: Number, default: null }, // note critique IGDB (0-100)
    ratingCount: { type: Number, default: 0 }, // nb d'avis = popularité
    franchise: { type: String, default: null }, // saga IGDB
    role: { type: String, enum: ["developer", "publisher", "both"], default: "developer" },
  },
  { _id: false }
);

// Licence phare : une saga développée par le studio (Resident Evil, Mega Man…).
const franchiseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    count: { type: Number, default: 0 }, // nb de jeux développés dans la saga
    cover: { type: String, default: null }, // jaquette du jeu le plus connu
  },
  { _id: false }
);

const companyProfileSchema = new mongoose.Schema(
  {
    // Clé de recherche : nom normalisé (minuscules, trim) — les noms viennent
    // d'IGDB (via GameMeta) donc le match par nom est fiable.
    key: { type: String, required: true, unique: true },
    v: { type: Number, default: 1 }, // version du schéma d'agrégation
    name: { type: String, required: true }, // nom d'affichage (casse d'origine)
    igdbId: { type: Number, default: null },
    logo: { type: String, default: null }, // URL logo IGDB
    country: { type: String, default: null }, // nom de pays FR
    startYear: { type: Number, default: null }, // année de création
    startDate: { type: Date, default: null }, // date de création précise
    statusActive: { type: Boolean, default: null }, // studio encore en activité ?
    employees: { type: Number, default: null }, // effectif (Wikidata)
    employeesYear: { type: Number, default: null }, // année de l'effectif
    engines: { type: [String], default: [] }, // moteurs employés (Source…)
    genres: {
      // Répartition des genres développés (pour le donut de stats)
      type: [{ name: String, count: Number, _id: false }],
      default: [],
    },
    description: { type: String, default: null }, // bio (Wikipedia de préférence)
    descriptionSource: { type: String, default: null }, // "wikipedia" | "igdb"
    wikiUrl: { type: String, default: null },
    image: { type: String, default: null }, // image d'en-tête (Wikipedia)
    people: { type: [personSchema], default: [] },
    franchises: { type: [franchiseSchema], default: [] },
    games: { type: [catalogGameSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("CompanyProfile", companyProfileSchema);
