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

// Un élément d'une liste : un jeu (IGDB) ou un personnage (pour les tier lists).
const listItemSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["game", "character"], default: "game" },
    // Identifiant : gameId IGDB (jeu) ou id de personnage (igdb-xx / custom).
    refId: { type: String, required: true },
    gameId: { type: Number, default: null }, // jeu parent (pour un personnage)
    gameName: { type: String, default: null }, // d'où vient le personnage
    name: { type: String, required: true },
    image: { type: String, default: null }, // cover ou portrait
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
    // classic = liste simple, ranked = TOP classé, tier = tier list
    type: {
      type: String,
      enum: ["classic", "ranked", "tier"],
      default: "classic",
    },
    // Cette liste contient SOIT des jeux SOIT des personnages (pas les deux),
    // quel que soit son type. Figé après création.
    itemKind: {
      type: String,
      enum: ["game", "character"],
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
  },
  { timestamps: true }
);

listSchema.index({ visibility: 1, updatedAt: -1 });
listSchema.index({ user: 1, updatedAt: -1 });

export default mongoose.model("List", listSchema);
