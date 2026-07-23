import mongoose from "mongoose";

// Une image / un GIF joint à un message (mêmes sources que les commentaires :
// upload maison ou GIPHY).
const messageMediaSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["image", "gif"], default: "image" },
    url: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { _id: false }
);

// Mention @user résolue à l'envoi (pour la coloration côté client).
const messageMentionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
  },
  { _id: false }
);

// Réaction émoji : une ligne par (émoji, personne) — regroupée à la lecture.
const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false }
);

// Carte « jeu recommandé » : un message peut porter la jaquette + le nom d'un
// jeu (recommandation envoyée depuis la fiche du jeu → arrive dans le DM).
const gameCardSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true },
    name: { type: String, default: "" },
    cover: { type: String, default: null },
  },
  { _id: false }
);

// Carte « OST partagée » : une piste envoyée depuis le mini-lecteur, jouable
// directement dans le fil (on garde de quoi la relancer : videoId / url).
const ostCardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    artist: { type: String, default: "" },
    artwork: { type: String, default: null },
    videoId: { type: String, default: null },
    url: { type: String, default: null },
    gameId: { type: Number, default: null },
    gameName: { type: String, default: null },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    text: { type: String, default: "", maxlength: 2000 },
    media: { type: [messageMediaSchema], default: [] },
    mentions: { type: [messageMentionSchema], default: [] },
    // Réponse à un message du même fil (bulle citée au-dessus).
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: { type: [reactionSchema], default: [] },

    // Cartes riches : recommandation de jeu / partage d'OST. Un message peut
    // n'être QUE une carte (sans texte ni média).
    game: { type: gameCardSchema, default: null },
    ost: { type: ostCardSchema, default: null },

    // Message de service (« X a créé le groupe », « Y a rejoint »…) : rendu en
    // ligne centrée, sans bulle. `author` reste l'acteur, `systemData` porte
    // les noms concernés pour composer la phrase côté client.
    system: { type: String, default: null },
    systemData: { type: mongoose.Schema.Types.Mixed, default: null },

    editedAt: { type: Date, default: null },
    // Suppression douce : la bulle reste à sa place, en « message supprimé ».
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Pagination d'un fil (on remonte le temps par pages de 30).
messageSchema.index({ conversation: 1, createdAt: -1 });

export default mongoose.model("Message", messageSchema);
