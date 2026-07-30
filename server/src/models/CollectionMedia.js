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

// Une page de comic : un fichier extrait de l'archive, et ses dimensions.
// Les dimensions ne servent pas à l'affichage (le navigateur les connaîtra)
// mais au LECTEUR : une planche plus large que haute est une double page, qui
// doit se présenter seule — l'apparier décalerait tout le reste du volume.
const comicPageSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    file: { type: String, required: true },
    // La vignette de 240 px fabriquée à l'import (voir lib/comicArchive.js).
    // Elle ne sert qu'aux planches-contact — la lecture, elle, va toujours
    // chercher `file`. Nulle sur les titres d'avant, et sur ceux dont une
    // planche a résisté à ffmpeg : l'affichage retombe alors sur la planche.
    thumb: { type: String, default: null },
    w: { type: Number, default: null },
    h: { type: Number, default: null },
  },
  { _id: false }
);

// ----------------------------------------------------------------------
//  La cartouche — ce qu'il faut pour qu'un jeu GBA démarre
// ----------------------------------------------------------------------
// Un boîtier de jeu se range comme les autres (même étagère, même vitrine,
// même fiche) mais son contenu n'est ni une liste d'épisodes ni un paquet de
// planches : c'est UN FICHIER, que le navigateur télécharge et fait tourner
// dans un émulateur (voir GbaPlayer côté client).
//
// IL Y A EU UN RAYON NINTENDO DS ICI, ET IL A ÉTÉ RETIRÉ. La leçon vaut d'être
// écrite parce qu'elle ne se voit pas sur le papier : émuler une DS dans un
// navigateur DEMANDE UNE MACHINE, et la moitié des visiteurs n'en a pas — deux
// écrans, un tactile, une puce 3D, le tout recopié image par image, ça se
// traînait à quinze images par seconde sur un portable honnête. La GBA, elle,
// est un système léger : un seul écran, pas de 3D, et mGBA compilé en WebAssembly
// tourne à pleine vitesse jusque sur téléphone. On a échangé de la prouesse
// contre des gens qui jouent vraiment.
//
// Tout ce qui est ici sort de la cartouche elle-même (voir lib/gbaRom.js) : le
// code de jeu, la région, le titre interne. On le garde parce que c'est
// l'identité de l'objet — deux fichiers du même jeu en région différente ne
// sont pas le même jeu, et c'est écrit nulle part ailleurs.
const cartridgeSchema = new mongoose.Schema(
  {
    // La console. « nds » n'est plus proposé nulle part : il reste dans
    // l'énumération pour qu'un document du rayon d'avant ne fasse pas échouer la
    // validation avant d'avoir été purgé (voir scripts/purgeDsGames.js).
    system: { type: String, enum: ["gba", "nds"], default: "gba" },

    file: { type: String, default: null }, // /uploads/roms/rom-<tag>.gba
    bytes: { type: Number, default: 0 },
    // Le nom du fichier tel qu'il a été déposé. Purement documentaire, mais
    // c'est la seule trace de la provenance d'un dump quand on y revient un an
    // plus tard.
    originalName: { type: String, default: "" },

    code: { type: String, default: "" }, // « AXVE »
    region: { type: String, default: "" }, // « Europe », « Japon »…
    internalTitle: { type: String, default: "" },
    version: { type: Number, default: null }, // révision du logiciel (0x0BC)
    players: { type: Number, default: null },

    // La puce de sauvegarde de la cartouche (« Flash 1 Mb », « SRAM 32 Ko »),
    // lue dans le corps de la ROM. Purement informative — nos sauvegardes sont
    // des ÉTATS DE MACHINE et ne dépendent pas d'elle (voir CollectionSave) —
    // mais c'est la seule façon de repérer une ROM qui ne sait pas sauvegarder
    // du tout.
    saveType: { type: String, default: "" },

    // L'en-tête passait-il le contrôle du BIOS (valeur fixe + somme de
    // contrôle) ? Faux ne bloque rien (les homebrews et les traductions de fans
    // passent), mais le panneau d'admin le signale.
    verified: { type: Boolean, default: false },
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

// ----------------------------------------------------------------------
//  Les dimensions du boîtier, quand elles sont SUR MESURE
// ----------------------------------------------------------------------
// Par défaut, tout le monde a le gabarit DVD (voir BOX dans lib/collection.js
// côté client). Mais une jaquette dépliée trouvée en ligne a ses propres
// proportions — un Blu-ray est plus court qu'un DVD, un boîtier de CD est
// presque carré, un coffret est trois fois plus épais. Recadrer ces images dans
// le gabarit DVD, c'était couper la jaquette ET mentir sur l'objet.
//
// L'outil d'alignement fait donc l'inverse : l'admin pose le bandeau de la
// tranche sur SON image, et les trois dimensions se déduisent de ce qui reste,
// à l'échelle donnée par la hauteur réelle du boîtier.
//
//   w / h / d — unités du monde (1 unité ≈ 16 cm), ce que lit la scène 3D ;
//   spineX / spineW — où couper la jaquette, en fraction de la largeur de
//                     l'image. Gardés à part car la tranche n'est pas forcément
//                     au centre (un scan a rarement deux marges égales) et
//                     parce qu'ils permettent de ROUVRIR l'outil sur le réglage
//                     précédent plutôt que de tout refaire.
// `cropX/Y/W/H` — la fenêtre de l'image qui contient VRAIMENT la jaquette, en
// fractions elle aussi. Un PDF d'impression est livré avec du fond perdu et des
// marges de coupe : sans cette fenêtre, ces bords blancs se retrouvaient
// imprimés sur le boîtier, et la hauteur réelle était rapportée à la page
// entière plutôt qu'à l'illustration. Absente = l'image entière.
const boxSchema = new mongoose.Schema(
  {
    w: { type: Number, default: null },
    h: { type: Number, default: null },
    d: { type: Number, default: null },
    spineX: { type: Number, default: null },
    spineW: { type: Number, default: null },
    cropX: { type: Number, default: null },
    cropY: { type: Number, default: null },
    cropW: { type: Number, default: null },
    cropH: { type: Number, default: null },
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
    // « comic » couvre le papier : manga, manhwa, comic book. Ce qui change,
    // c'est qu'on ne le regarde pas mais qu'on le LIT — donc des pages au lieu
    // d'épisodes, un lecteur au lieu d'un téléviseur, et une progression qui
    // compte des planches. Tout le reste (étagère, boîtier 3D, fiche, recherche)
    // est commun : un volume relié EST une boîte habillée d'une jaquette.
    // « game » ferme la série : un boîtier de jeu GBA, qui ne se regarde ni ne
    // se lit mais SE JOUE. Même étagère, même vitrine, même fiche — seule la
    // suite change (un émulateur au lieu d'un lecteur), et c'est bien pour ça
    // qu'il a sa place ici plutôt que dans une page à lui.
    kind: {
      type: String,
      enum: ["series", "film", "comic", "game"],
      default: "series",
    },
    animated: { type: Boolean, default: false },

    // Le support physique. Le rayon vidéo est tout en boîtier DVD ; le papier a
    // son volume broché, le jeu sa boîte de cartouche. « vhs » et « ds » sont
    // conservés dans l'énumération pour ne pas faire échouer la validation d'un
    // vieux document non converti — plus rien ne les propose.
    format: {
      type: String,
      enum: ["dvd", "vhs", "book", "gba", "ds"],
      default: "dvd",
    },

    // CHAMP ABANDONNÉ — plus rien ne le lit.
    //
    // Il a porté le choix du DÉCOR : un poste cathodique à tube pour les séries,
    // un lecteur sobre pour les films, et même un temps une salle de projection
    // avec rideau. Tout cela est retiré. La leçon, écrite ici parce qu'elle a
    // coûté deux décors : ON NE REGARDE PAS UN DÉCOR, ON REGARDE L'IMAGE. Le
    // tube imposait un cadre 4/3 qui rognait les lecteurs tiers, la salle
    // mangeait le film, et les deux demandaient au spectateur de choisir une
    // ambiance là où il voulait juste appuyer sur lecture.
    //
    // Le champ reste déclaré pour qu'un document déjà enregistré ne bloque pas
    // à la sauvegarde. À supprimer le jour d'une vraie migration.
    theater: {
      type: String,
      enum: ["auto", "crt", "cinema", "plain"],
      default: "auto",
    },

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

    // Dimensions sur mesure du boîtier, posées par l'outil d'alignement quand
    // une jaquette complète est fournie. Vide = gabarit DVD standard.
    box: { type: boxSchema, default: () => ({}) },

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

      // L'HÉBERGEUR QU'ON BRANCHE EN PREMIER. Un titre a souvent quatre
      // lecteurs, dont un seul tient la route ce mois-ci : sans ça, chaque
      // spectateur recommence la même recherche — lancer, constater, changer de
      // source, recommencer à l'épisode suivant.
      //
      // C'est un réglage COLLECTIF, et volontairement : n'importe qui peut le
      // poser depuis le lecteur, et il vaut pour tout le monde. Celui qui prend
      // la peine de trouver le lecteur qui marche rend service aux suivants —
      // c'est la même logique que la curation du rayon, en plus modeste.
      //
      // Un nom d'hôte (« uqload.is »), pas une adresse : les liens changent à
      // chaque épisode, l'hébergeur non.
      defaultHost: { type: String, default: "" },
    },

    episodes: { type: [episodeSchema], default: [] },

    // Le dernier passage du VÉRIFICATEUR DE LIENS (voir lib/collectionProbe.js).
    // Un rayon servi par des hébergeurs tiers pourrit tout seul : la trace du
    // dernier contrôle est ce qui distingue, dans une longue liste, le titre
    // qu'on vient de passer au peigne fin de celui qu'on n'a jamais vérifié.
    sourceCheck: {
      at: { type: Date, default: null },
      // Ce que le dernier passage a trouvé de mort, et ce qu'il n'a pas su
      // trancher (hébergeur qui nous bloque, panne) — ces derniers ne sont
      // JAMAIS purgés, mais ils méritent d'être signalés.
      dead: { type: Number, default: 0 },
      unknown: { type: Number, default: 0 },
      removed: { type: Number, default: 0 }, // sources réellement retirées
    },

    // ---- Papier -------------------------------------------------------
    // Les planches, dans l'ordre de lecture, telles que l'archive les a
    // livrées (voir lib/comicArchive.js).
    pages: { type: [comicPageSchema], default: [] },

    // Le sens de lecture. C'est LE réglage qu'il ne faut pas manquer : à
    // l'envers, le lecteur ouvre le volume par la fin. Déduit du pays d'origine
    // à l'enrichissement, corrigeable à la main.
    readDirection: { type: String, enum: ["ltr", "rtl"], default: "ltr" },

    // ---- Cartouche ----------------------------------------------------
    // Le fichier qui se joue, et l'identité que la cartouche donne d'elle-même.
    cartridge: { type: cartridgeSchema, default: () => ({}) },

    // Qui l'a fait. « studio » sert déjà au cinéma ; pour du papier, ce sont
    // des noms d'auteurs, souvent deux (scénario et dessin). Pour un jeu, c'est
    // le développeur, et `publisher` l'éditeur — la même distinction que
    // partout ailleurs dans l'application.
    authors: { type: [String], default: [] },
    publisher: { type: String, default: "" },
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
