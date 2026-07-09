import mongoose from "mongoose";

// Un média joint à une review (image uploadée ou GIF GIPHY), même format
// que les médias de commentaires.
const reviewMediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["gif", "image"], required: true },
    url: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

// Réaction d'un autre utilisateur à cette review (une seule par utilisateur).
const reviewReactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["heart", "clap", "funny"], required: true },
  },
  { _id: false }
);

// Mention @user résolue à la création (coloration / lien).
const reviewMentionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  { _id: false }
);

// Réponse (commentaire) sous une review — fil à un niveau, façon commentaires de liste.
const reviewCommentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, default: "", trim: true, maxlength: 300 },
    media: { type: [reviewMediaSchema], default: [] },
    mentions: { type: [reviewMentionSchema], default: [] },
    parent: { type: mongoose.Schema.Types.ObjectId, default: null },
    likes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { _id: true, timestamps: true }
);

// Une entrée de bibliothèque : le lien entre un utilisateur et un jeu IGDB.
const userGameSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gameId: { type: Number, required: true }, // id IGDB
    name: { type: String, required: true },
    cover: { type: String, default: null }, // url (peut être une cover custom)

    // "wishlist" = je veux y jouer ; les autres = j'y ai joué.
    // "endless" = jeu sans fin (multi/service : Rocket League, Overwatch…) —
    // il ne compte ni comme terminé ni comme abandonné dans le backlog.
    status: {
      type: String,
      enum: ["wishlist", "playing", "finished", "paused", "dropped", "endless"],
      default: "wishlist",
    },
    platform: { type: String, default: null },
    // Format d'achat sur console : dématérialisé ou boîte physique.
    format: { type: String, enum: ["digital", "physical"], default: "digital" },
    playtimeHours: { type: Number, default: null },
    note: { type: String, default: "" }, // (déprécié) où je me suis arrêté
    review: { type: String, default: "" }, // texte de review
    reviewMedia: { type: [reviewMediaSchema], default: [] }, // GIF / images joints
    spoiler: { type: Boolean, default: false }, // la review dévoile l'intrigue
    favorite: { type: Boolean, default: false },
    rating: { type: Number, min: 0, max: 100, default: null }, // note en %
    pros: { type: [String], default: [] },
    cons: { type: [String], default: [] },
    favoriteCharacter: {
      name: { type: String },
      image: { type: String },
    },
    favoriteOst: {
      name: { type: String },
      artist: { type: String },
      preview: { type: String },
      artwork: { type: String },
      youtube: { type: Boolean },
      url: { type: String },
    },
    // Réactions des autres joueurs sur cette review (cœur / bravo / rigolo).
    reactions: { type: [reviewReactionSchema], default: [] },
    // Réponses (commentaires) des autres joueurs sous cette review.
    comments: { type: [reviewCommentSchema], default: [] },
  },
  { timestamps: true }
);

// Un seul enregistrement par (utilisateur, jeu)
userGameSchema.index({ user: 1, gameId: 1 }, { unique: true });

export default mongoose.model("UserGame", userGameSchema);
