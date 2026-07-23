import mongoose from "mongoose";

// Aperçu du dernier message, dénormalisé sur la conversation : la liste des
// discussions se dessine sans jamais relire la collection Message.
const previewSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    authorName: { type: String, default: "" },
    // text | image | gif | system — le client choisit l'icône de l'aperçu.
    kind: { type: String, default: "text" },
    at: { type: Date, default: null },
  },
  { _id: false }
);

// État de lecture d'un participant. `unread` est tenu à jour à l'ENVOI
// (un $inc sur les autres participants) plutôt que recompté à l'affichage :
// la liste des conversations reste en O(1), même avec un gros historique.
const readSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: null }, // dernier « vu » (accusés de lecture)
    unread: { type: Number, default: 0 },
  },
  { _id: false }
);

// Une conversation : à deux (DM) ou en groupe.
const conversationSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: "", maxlength: 60 }, // groupes uniquement
    avatar: { type: String, default: null }, // photo du groupe (upload)
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Clé de déduplication des conversations à DEUX : les deux ids triés et
    // joints par « : ». Index unique creux (`sparse`) → impossible d'ouvrir
    // deux fils avec la même personne, et les groupes (sans clé) l'ignorent.
    dmKey: { type: String, unique: true, sparse: true },

    reads: { type: [readSchema], default: [] },
    // Conversations en sourdine : plus de son ni de pop-up (le badge reste).
    muted: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    lastMessage: { type: previewSchema, default: () => ({}) },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Liste des conversations d'un utilisateur, les plus récentes d'abord.
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
