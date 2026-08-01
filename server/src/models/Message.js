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

// Carte « invitation à une watchparty » : le lien vers la salle, avec de quoi
// donner envie d'y entrer (le titre et son affiche). C'est le SEUL morceau
// d'une séance qui survit à la soirée — le fil de chat de la salle, lui, reste
// dans la salle (voir models/WatchParty.js).
const partyCardSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    poster: { type: String, default: null },
    hostName: { type: String, default: "" },
  },
  { _id: false }
);

// Carte « rejoins ma partie du Mot du jour » : le code de la session, et de quoi
// décider sans l'ouvrir (qui joue, combien d'essais déjà brûlés). Même logique
// que la carte de watchparty ci-dessus — l'invitation survit à la partie, la
// partie non.
//
// Quand la carte porte une ÉQUIPE (models/MotTeam.js), elle cesse justement
// d'être périssable : le code d'équipe ouvre la partie du jour, quel que soit
// le jour où on clique. C'est le même message qui sert d'invitation permanente.
const motCardSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    date: { type: String, default: "" }, // le jour concerné : une invitation d'hier est morte
    hostName: { type: String, default: "" },
    players: { type: Number, default: 1 },
    tries: { type: Number, default: 0 },
    // Code de l'équipe permanente, et son nom : présents, le lien ne périme
    // plus et la carte parle de « ton équipe » plutôt que d'une partie.
    team: { type: String, default: "" },
    teamName: { type: String, default: "" },
    // Rappel automatique du matin (« l'équipe cherche le mot du jour ») par
    // opposition à une invitation envoyée à la main.
    daily: { type: Boolean, default: false },
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
    party: { type: partyCardSchema, default: null },
    mot: { type: motCardSchema, default: null },

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
