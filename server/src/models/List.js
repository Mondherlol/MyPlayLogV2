import mongoose from "mongoose";

// Un média joint (un seul par entrée) : GIF (GIPHY) ou image. Partagé par les
// annotations d'items et les commentaires.
const commentMediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["gif", "image"], required: true },
    url: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

// Un élément d'une liste : un jeu (IGDB), un personnage (tier lists) ou une
// piste d'OST (playlists).
const listItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["game", "character", "track"], default: "game" },
    // Identifiant : gameId IGDB (jeu), id de personnage (igdb-xx / custom) ou
    // id de piste (yt-xx, cf. CustomOst).
    refId: { type: String, required: true },
    gameId: { type: Number, default: null }, // jeu parent (perso / piste)
    gameName: { type: String, default: null }, // d'où vient le perso / la piste
    name: { type: String, required: true },
    image: { type: String, default: null }, // cover, portrait ou artwork
    // Piste d'OST uniquement : lecture YouTube + infos enrichies (iTunes).
    videoId: { type: String, default: null },
    url: { type: String, default: null },
    artist: { type: String, default: null }, // compositeur / artiste
    releaseYear: { type: Number, default: null },
    durationSec: { type: Number, default: null }, // durée (iTunes, best-effort)
    note: { type: String, default: "" }, // commentaire de l'auteur (texte)
    // Médias joints à l'annotation (GIF / images), comme les commentaires.
    media: { type: [commentMediaSchema], default: [] },
    // Conservé pour compat des anciennes données ; plus édité côté UI.
    rating: { type: Number, min: 0, max: 100, default: null },
    // Tier list uniquement : id du palier (null = non classé, dans le vivier).
    tier: { type: String, default: null },
  },
  { _id: true, timestamps: false }
);

// Élément posé sur une pochette personnalisée (image : avatar, artwork, jaquette).
// Coordonnées et taille normalisées (0→1) par rapport à la pochette carrée.
const coverElementSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["avatar", "image"], default: "image" },
    src: { type: String, required: true, maxlength: 600 },
    x: { type: Number, default: 0.5 },
    y: { type: Number, default: 0.5 },
    size: { type: Number, default: 0.3 },
    rot: { type: Number, default: 0 },
    shape: { type: String, enum: ["circle", "rounded", "square"], default: "rounded" },
  },
  { _id: false }
);

// Design d'une pochette générée & personnalisée (alternative à `cover` image).
const coverDesignSchema = new mongoose.Schema(
  {
    bg1: { type: String, default: "#f2b70b", maxlength: 32 },
    bg2: { type: String, default: "#b26a00", maxlength: 32 },
    angle: { type: Number, default: 150 },
    motif: {
      type: String,
      enum: ["none", "rings", "dots", "stripes", "grid"],
      default: "rings",
    },
    motifOpacity: { type: Number, default: 1 },
    titleShow: { type: Boolean, default: true },
    titlePos: { type: String, enum: ["top", "center", "bottom"], default: "center" },
    titleColor: { type: String, default: "#ffffff", maxlength: 32 },
    mark: { type: Boolean, default: true },
    elements: { type: [coverElementSchema], default: [] },
  },
  { _id: false }
);

// Définition d'un palier de tier list.
const tierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: "" },
    color: { type: String, default: "#f2b70b" },
  },
  { _id: false }
);

// Mention @user résolue à la création (pour la coloration et, plus tard, les notifs).
const commentMentionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  { _id: false }
);

// Version précédente d'un commentaire (conservée à chaque modification).
const commentVersionSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    media: { type: [commentMediaSchema], default: [] },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Le texte n'est plus obligatoire : un message peut n'être que des médias.
    text: { type: String, default: "", trim: true, maxlength: 300 },
    // Jusqu'à 4 médias par message (GIF et/ou images).
    media: { type: [commentMediaSchema], default: [] },
    // Utilisateurs mentionnés (@pseudo existants) dans le texte.
    mentions: { type: [commentMentionSchema], default: [] },
    // Édition : max 2 fois, on garde les versions précédentes.
    editCount: { type: Number, default: 0 },
    editedAt: { type: Date, default: null },
    history: { type: [commentVersionSchema], default: [] },
    // Réponse à un autre commentaire (fil à un niveau) : id du parent.
    parent: { type: mongoose.Schema.Types.ObjectId, default: null },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { _id: true, timestamps: true }
);

// Réutilisé par le fil de commentaires des OST de profil (même structure).
export { commentSchema };

const listSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 2000 },
    // Image de couverture (URL servie par le serveur), optionnelle.
    cover: { type: String, default: null },
    // Pochette générée & personnalisée (playlists), utilisée quand `cover` est
    // vide. null = pochette générée par défaut (dérivée du titre).
    coverDesign: { type: coverDesignSchema, default: null },
    // classic = liste simple, ranked = TOP classé, tier = tier list,
    // playlist = playlist d'OST (écoutable dans le mini-lecteur)
    type: {
      type: String,
      enum: ["classic", "ranked", "tier", "playlist"],
      default: "classic",
    },
    // Cette liste contient SOIT des jeux SOIT des personnages SOIT des OST
    // (pas de mélange), quel que soit son type. Figé après création.
    itemKind: {
      type: String,
      enum: ["game", "character", "ost"],
      default: "game",
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    items: { type: [listItemSchema], default: [] },
    tiers: { type: [tierSchema], default: [] },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    comments: { type: [commentSchema], default: [] },
    // Playlists : nombre d'écoutes (incrémenté à chaque lecture par un tiers,
    // 1× par visite — cf. POST /lists/:id/listen). Le propriétaire ne compte pas.
    listenCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

listSchema.index({ visibility: 1, updatedAt: -1 });
listSchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model("List", listSchema);
