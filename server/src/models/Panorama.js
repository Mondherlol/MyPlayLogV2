import mongoose from "mongoose";

// ======================================================================
//  Le catalogue des lieux — la matière première de GeoGamer
// ======================================================================
// Contrairement au blind test et à Pixel Rush, dont les manches se dérivent à
// la volée de la bibliothèque du joueur (OST scrapées, screenshots IGDB), ce
// jeu-ci ne peut PAS improviser : un panorama équirectangulaire ne se fabrique
// pas depuis IGDB, il faut l'avoir. On tient donc un catalogue en base, rempli
// une fois pour toutes par un script d'import (scripts/seedGeoPanoramas.js).
//
// Un document = UN lieu jouable (un panorama), pas un jeu : un même jeu peut
// avoir plusieurs lieux, et c'est même souhaitable (deux manches sur le même
// jeu restent deux manches différentes).

const panoramaSchema = new mongoose.Schema(
  {
    // --- La réponse ---
    // gameId reste `null` tant que le titre n'a pas été rapproché d'IGDB. Un
    // lieu sans gameId n'est JAMAIS tiré : sans identifiant, on ne saurait ni
    // valider la réponse par id, ni lier la fiche du jeu dans le récap.
    gameId: { type: Number, default: null, index: true },
    // Nom canonique IGDB (celui qu'on affiche et qu'on compare).
    gameName: { type: String, default: "" },
    cover: { type: String, default: null },

    // --- L'image ---
    // URL servie au client. Soit locale (`/uploads/panoramas/…`, cas normal),
    // soit distante si on a choisi de ne pas rapatrier le fichier.
    image: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },

    // --- Difficulté ---
    // Note de 1 (évident) à 5 (cauchemar), reprise de la source quand elle en
    // fournit une. Sert à pondérer le tirage et à bonifier le score.
    difficulty: { type: Number, default: 3, min: 1, max: 5 },

    // --- Provenance ---
    // `sourceKey` est l'identité stable du lieu chez la source (ex.
    // "gameguessr:minecraft/1") : c'est la clé d'idempotence de l'import, elle
    // permet de relancer le script sans créer de doublons.
    source: { type: String, default: "gameguessr" },
    sourceKey: { type: String, required: true, unique: true },
    sourceName: { type: String, default: "" }, // le titre BRUT de la source
    // Rapprochement décidé À LA MAIN (--fix). Certains titres ne sont
    // trouvables sous aucune variante automatique : « T.Rex Game (Dinosaur
    // Game) » s'appelle « Chrome Dino » chez IGDB. Ce drapeau protège ces
    // corrections d'un futur --relink-all qui les écraserait.
    manualMatch: { type: Boolean, default: false },
    year: { type: Number, default: null },
    platforms: { type: [String], default: [] },

    // --- Manche bonus « où sur la carte ? » ---
    // 712 des 1177 lieux savent AUSSI où ils se situent sur une carte du jeu.
    // La source livre le point de réponse en pixels bruts (« 588;1035 ») sur
    // l'image de carte : c'est pour ça que leur client calcule la distance sans
    // le moindre appel réseau — il a la réponse depuis le départ.
    mapImage: { type: String, default: null },
    // Chaîne BRUTE de la source, conservée pour la traçabilité. Attention au
    // piège : ce n'est PAS « x;y » en pixels de l'image. La source affiche ses
    // cartes dans un Leaflet en CRS.Simple dont les bornes valent
    // [[0,0],[2100,2100]] — un carré fixe, sans rapport avec la taille du
    // fichier. La valeur est donc « latitude;longitude » dans ce repère, et
    // Leaflet fait croître la latitude VERS LE HAUT.
    mapCoords: { type: String, default: "" },
    // Le point de réponse, normalisé en FRACTIONS [0,1] depuis le coin haut
    // gauche — c'est la seule forme exploitable. L'overlay Leaflet étire
    // l'image dans son carré ; comme un étirement est linéaire, une position
    // fractionnaire reste valable sur l'image d'origine quelles que soient ses
    // proportions. C'est ce qui rend les dimensions du fichier inutiles au
    // calcul (elles ne servent plus qu'à donner son ratio d'affichage).
    mapAnswerX: { type: Number, default: null },
    mapAnswerY: { type: Number, default: null },
    mapWidth: { type: Number, default: null },
    mapHeight: { type: Number, default: null },

    // Interrupteur manuel : un lieu peut être désactivé sans être supprimé
    // (mauvais rapprochement IGDB, panorama moche, jeu en doublon…).
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Le tirage d'une partie ne s'intéresse qu'aux lieux jouables, et filtre
// ensuite sur le jeu (bibliothèque du joueur ou non).
panoramaSchema.index({ active: 1, gameId: 1 });

export default mongoose.model("Panorama", panoramaSchema);
