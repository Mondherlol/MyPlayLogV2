import mongoose from "mongoose";

// ======================================================================
//  Collection — les médias « autour du jeu vidéo » (séries, films, animés)
// ======================================================================
// Un document = une jaquette sur l'étagère. Le catalogue est CURÉ : on
// n'accepte que des contenus regardables librement et légalement là où ils
// sont hébergés (chaînes officielles des éditeurs, œuvres tombées dans le
// domaine public, diffusions promotionnelles). D'où le champ `licence`, qui
// se lit comme une pastille sur la jaquette : on assume la provenance.
//
// La lecture passe TOUJOURS par le lecteur de la plateforme d'origine : rien
// n'est rehébergé, seules les métadonnées et les visuels sont copiés chez nous
// (voir lib/collection.js) — sinon l'étagère 3D ne pourrait pas texturer ses
// boîtes (canvas WebGL « souillé » par une image cross-origin).
//
// TROIS LECTEURS, parce que tout ne vit pas sur YouTube :
//
//   • `youtube` — l'API YT.Player : position, pause, volume, chapitrage. C'est
//     le seul qui donne une vraie progression, donc le seul où la reprise à la
//     seconde près fonctionne ;
//   • `file`    — un fichier vidéo servi tel quel (mp4/webm/m3u8) : lu par la
//     balise <video> du navigateur, donc mêmes commandes que YouTube ;
//   • `embed`   — le lecteur d'un tiers dans une iframe. On ne sait alors NI
//     où en est la lecture NI quand elle s'arrête : le poste bascule en mode
//     « on regarde », sans barre de progression, et l'épisode se coche à la
//     main. C'est le prix d'un lecteur qu'on ne pilote pas.
//
// Un épisode en `embed` peut porter plusieurs MIROIRS (le même épisode chez
// deux hébergeurs) : quand l'un tombe, le bouton SOURCE du poste passe au
// suivant sans quitter la lecture.

const mirrorSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" }, // nom d'hôte, affiché sur le poste
    url: { type: String, required: true },
  },
  { _id: false }
);

const episodeSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true }, // position absolue dans la playlist
    season: { type: Number, default: 1 },
    number: { type: Number, default: null }, // numéro dans la saison
    title: { type: String, default: "" },
    synopsis: { type: String, default: "" },

    provider: { type: String, enum: ["youtube", "embed", "file"], default: "youtube" },
    videoId: { type: String, default: null }, // youtube
    url: { type: String, default: "" }, // embed / file
    mirrors: { type: [mirrorSchema], default: [] },

    thumb: { type: String, default: null },
    duration: { type: Number, default: null }, // secondes
    airDate: { type: Date, default: null },
  },
  { _id: false }
);

const castSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // interprète / doubleur
    character: { type: String, default: "" },
    photo: { type: String, default: null },
  },
  { _id: false }
);

const collectionMediaSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    originalTitle: { type: String, default: "" },

    // « series » regroupe séries et animés (l'animation se distingue par
    // `animated`) : ce qui change à l'écran, c'est le nombre d'épisodes.
    kind: { type: String, enum: ["series", "film"], default: "series" },
    animated: { type: Boolean, default: false },

    // Le support physique. Tout est en boîtier DVD : l'interface n'offre plus de
    // choix, mais le champ reste pour le jour où un autre support arrivera
    // (cartouche, Blu-ray…). « vhs » est conservé dans l'énumération pour ne pas
    // faire échouer la validation d'un vieux document non converti.
    format: { type: String, enum: ["dvd", "vhs"], default: "dvd" },

    // Provenance du contenu, affichée telle quelle sur la jaquette.
    licence: {
      type: String,
      enum: ["official", "public-domain", "fan"],
      default: "official",
    },

    year: { type: Number, default: null },
    endYear: { type: Number, default: null },
    synopsis: { type: String, default: "" },
    tagline: { type: String, default: "" },
    genres: { type: [String], default: [] },
    runtime: { type: Number, default: null }, // minutes (film) ou par épisode
    studio: { type: String, default: "" },
    network: { type: String, default: "" },
    country: { type: String, default: "" },
    language: { type: String, default: "" },
    rating: { type: Number, default: null }, // /10
    // Visa d'exploitation français (« Tous publics », « -12 ») : la pastille
    // qui s'imprime au dos d'un boîtier.
    certification: { type: String, default: null },

    // Rattachement à l'univers du jeu : sert aux filtres et, plus tard, aux
    // renvois depuis la fiche du jeu.
    franchise: { type: String, default: "" },
    games: {
      type: [{ igdbId: Number, name: String, _id: false }],
      default: [],
    },

    // Teinte de l'étiquette (jaquette 2D + spine de la boîte 3D).
    color: { type: String, default: "#f2b70b" },

    artwork: {
      poster: { type: String, default: null }, // portrait (jaquette)
      backdrop: { type: String, default: null }, // paysage (bandeau de la fiche)
      thumb: { type: String, default: null },
      // Jaquette COMPLÈTE dépliée, telle qu'on l'imprime : dos | tranche |
      // couverture, de gauche à droite. Quand elle existe, elle habille le
      // boîtier 3D à elle seule (découpée en trois), et rien n'est composé
      // par-dessus — c'est l'artwork qui commande.
      wrap: { type: String, default: null },
    },

    source: {
      // Le lecteur PAR DÉFAUT du titre. Chaque épisode porte le sien (un même
      // boîtier peut mélanger : bande-annonce YouTube + épisodes ailleurs),
      // celui-ci ne sert qu'à savoir comment RAFRAÎCHIR le titre — YouTube se
      // re-scrape, une liste posée à la main ne se réinvente pas.
      provider: { type: String, enum: ["youtube", "embed", "file"], default: "youtube" },
      videoId: { type: String, default: null }, // film / épisode unique
      playlistId: { type: String, default: null }, // série
      channel: { type: String, default: "" },
      channelUrl: { type: String, default: "" },
      url: { type: String, default: "" },
      // Ce qui a été collé dans le panneau d'admin pour les lecteurs tiers :
      // gardé tel quel pour pouvoir rouvrir la liste et la corriger.
      list: { type: String, default: "" },
      // Les pistes réellement disponibles (« vf », « vostfr ») quand la source
      // les annonce. C'est ce qui s'imprime au dos du boîtier, à la place du
      // bloc LANGUES d'un vrai DVD — donc uniquement ce qu'on sait vraiment.
      langs: { type: [String], default: [] },
    },

    episodes: { type: [episodeSchema], default: [] },
    cast: { type: [castSchema], default: [] },

    // La fiche TMDB retenue (« tv:1399 »), pour que « rafraîchir » retombe sur
    // la même plutôt que sur ce que la recherche donnera ce jour-là.
    tmdbRef: { type: String, default: null },

    links: {
      wikipedia: { type: String, default: null },
      imdb: { type: String, default: null },
      tvmaze: { type: String, default: null },
      tmdb: { type: String, default: null },
    },

    // D'où viennent les métadonnées (crédit affiché en bas de fiche).
    sources: { type: [String], default: [] },

    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    enrichedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

collectionMediaSchema.index({ kind: 1, order: 1 });
collectionMediaSchema.index({ franchise: 1 });

export default mongoose.model("CollectionMedia", collectionMediaSchema);
