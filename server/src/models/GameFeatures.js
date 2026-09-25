import mongoose from "mongoose";

// ======================================================================
//  Le catalogue local des recommandations — un jeu, ses traits, rien d'autre
// ======================================================================
//
// Recommander, c'est comparer un jeu à des dizaines de milliers d'autres. On ne
// peut pas le faire en posant la question à IGDB (4 requêtes par seconde) :
// on garde donc ici une copie MINIMALE de chaque jeu utile — ce qui sert à dire
// « ces deux jeux se ressemblent » et « celui-ci vaut le coup », et rien de ce
// qui sert à afficher une fiche (résumé, images, vidéos restent dans GameCache).
//
// Deux sortes de lignes :
//   - `pool: true`  → le jeu fait partie du catalogue RECOMMANDABLE (il a au
//     moins une note ou de la hype chez IGDB : ~45 000 jeux sur 320 000 — le
//     reste est du bruit qu'on ne veut de toute façon pas proposer) ;
//   - `pool: false` → le jeu n'est là que parce qu'il est dans la bibliothèque
//     de quelqu'un : il sert de POINT DE DÉPART (« tu as adoré X »), jamais de
//     proposition.
//
// La synchro vit dans lib/recoCatalog.js, le moteur dans lib/recoEngine.js.
// Les identifiants des listes (genres, mots-clés…) sont ceux d'IGDB ; leurs
// noms sont dans IgdbTerm.
const gameFeaturesSchema = new mongoose.Schema(
  {
    _id: { type: Number }, // id IGDB
    name: { type: String, required: true },
    fr: { type: String, default: null }, // titre français (alternative_names)
    slug: { type: String, default: null },
    cover: { type: String, default: null }, // image_id IGDB
    date: { type: Number, default: null }, // first_release_date (secondes)
    type: { type: Number, default: 0 }, // game_type IGDB
    parent: { type: Number, default: null }, // parent_game (remake, remaster, portage…)
    genres: { type: [Number], default: [] },
    themes: { type: [Number], default: [] },
    keywords: { type: [Number], default: [] },
    modes: { type: [Number], default: [] },
    persp: { type: [Number], default: [] }, // player_perspectives
    franchises: { type: [Number], default: [] },
    collections: { type: [Number], default: [] }, // les « séries » IGDB
    devs: { type: [Number], default: [] }, // sociétés développeuses
    pubs: { type: [Number], default: [] }, // éditeurs
    platforms: { type: [Number], default: [] },
    rating: { type: Number, default: null }, // total_rating (0-100)
    ratingCount: { type: Number, default: 0 },
    hypes: { type: Number, default: 0 },
    steam: { type: Number, default: null }, // appid Steam (phase collaborative)
    pool: { type: Boolean, default: false },
    igdbUpdatedAt: { type: Number, default: null },
    // Le dernier passage de synchro qui a VU ce jeu dans le catalogue : un jeu
    // du pool qu'un passage complet n'a plus vu en sort (supprimé, fusionné,
    // requalifié en DLC…).
    seenAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, minimize: false }
);

gameFeaturesSchema.index({ pool: 1 });
gameFeaturesSchema.index({ steam: 1 }, { sparse: true });

export default mongoose.model("GameFeatures", gameFeaturesSchema, "gamefeatures");
