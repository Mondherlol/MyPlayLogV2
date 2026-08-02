// Familles de cartes du fil d'accueil : ce que la page Paramètres > « Fil
// d'accueil » permet de couper.
//
// Ce fichier ne connaît QUE les familles fines (les feuilles). Le regroupement
// en domaines (« Arcade », « Mini-jeux »…) et les libellés vivent côté client
// (FEED_GROUPS dans client/src/pages/Settings.jsx) : couper un domaine entier
// revient à masquer toutes ses feuilles, ce qui évite au serveur d'avoir à
// arbitrer entre un domaine coupé et une de ses familles rallumée.
//
// On enregistre chez l'utilisateur ce qui est MASQUÉ (User.feedHidden), pas ce
// qui est gardé : les comptes existants n'ont rien à migrer, et une famille
// ajoutée ici plus tard s'affiche d'office chez tout le monde.
//
// Une famille coupe à trois endroits, du plus tôt au plus tard :
//  - `activity` : types d'Activity écartés dès la requête Mongo. Écarter à ce
//    niveau (plutôt qu'après coup) garde les pages PLEINES — sinon une famille
//    très bavarde viderait la page et le fil s'arrêterait en plein milieu ;
//  - `sources`  : collections interrogées à part, qu'on ne lit alors pas du tout ;
//  - `cards`    : filet de sécurité sur les cartes déjà construites (les cartes
//    groupées y figurent aussi, même si couper la source suffit à les empêcher
//    de se former).
export const FEED_CATEGORIES = [
  // --- Bibliothèque & avis ---
  {
    key: "games",
    activity: ["game_update"],
    cards: ["game", "gamegroup"],
  },
  {
    key: "lists",
    activity: [
      "list_create",
      "list_items",
      "list_comment",
      "comment_reply",
      "list_like",
      "comment_like",
      "playlist_listen",
    ],
    cards: ["list", "listadd"],
  },
  {
    key: "trackers",
    sources: ["tracker"],
    cards: ["trackermatch", "trackermatchgroup", "rankchange"],
  },

  // --- Social ---
  // Les familles ci-dessous n'ont pas de `cards` : elles partagent toutes la
  // carte « interaction », qui sert AUSSI les interactions de liste. Le tri se
  // fait par type d'activité, qui lui est sans ambiguïté.
  {
    key: "follows",
    activity: ["follow"],
    cards: ["follow"],
  },
  {
    key: "reactions",
    activity: [
      "review_comment",
      "review_comment_reply",
      "review_comment_like",
      "review_react",
    ],
  },
  {
    key: "recos",
    activity: ["recommendation", "recommendation_boost", "recommendation_comment"],
  },

  // --- Pages de jeux ---
  {
    key: "media",
    activity: ["gamemedia_comment", "gamemedia_comment_reply"],
    sources: ["gamemedia"],
    cards: ["gamemediapost", "gamemediacomment"],
  },
  {
    key: "fanarts",
    sources: ["repost"],
    cards: ["repost"],
  },
  {
    key: "downloads",
    sources: ["download"],
    cards: ["download"],
  },

  // --- Mini-jeux ---
  {
    key: "blindtest",
    activity: ["blindtest", "btversus"],
    cards: ["blindtest", "blindtestgroup", "btversus"],
  },
  {
    key: "pixel",
    activity: ["pixel"],
    cards: ["pixel", "pixelgroup"],
  },
  {
    key: "geo",
    activity: ["geo", "geoversus"],
    cards: ["geo", "geogroup", "geoversus"],
  },
  {
    key: "mot",
    activity: ["mot"],
    cards: ["mot"],
  },

  // --- Arcade ---
  {
    key: "cases",
    activity: ["case_open"],
    cards: ["caseopen", "caseopengroup"],
  },
  // La machine à capsules est à l'arcade, même si le boîtier gagné atterrit
  // dans la collection : la carte raconte le TIRAGE, elle est rangée avec le
  // reste de l'arcade.
  {
    key: "drops",
    activity: ["collection_drop"],
    cards: ["collectiondrop", "collectiondropgroup"],
  },

  // --- Collection ---
  {
    key: "collectiontalk",
    activity: [
      "collection_comment",
      "collection_comment_reply",
      "collection_comment_like",
    ],
    cards: ["collectioncomment"],
  },

  // --- Découverte ---
  {
    key: "videos",
    sources: ["documentary"],
    cards: ["video", "videoact", "videoactgroup"],
  },
  {
    key: "gems",
    sources: ["gem"],
    cards: ["gems"],
  },
];

export const FEED_KEYS = FEED_CATEGORIES.map((c) => c.key);

// Traduit les familles masquées en filtres exploitables par buildTimeline().
// Un type d'activité qu'aucune famille ne réclame n'est jamais coupé : le
// filtre Mongo est un `$nin` de ce qui est explicitement listé ici.
export function feedFilters(hidden) {
  const off = new Set(hidden || []);
  const cut = FEED_CATEGORIES.filter((c) => off.has(c.key));
  return {
    activityOff: cut.flatMap((c) => c.activity || []),
    sourceOff: new Set(cut.flatMap((c) => c.sources || [])),
    cardOff: new Set(cut.flatMap((c) => c.cards || [])),
  };
}
