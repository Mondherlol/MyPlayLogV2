import mongoose from "mongoose";

// Une notification push écrite à la main depuis le panel admin et envoyée à
// tout le monde (ou à une sélection).
//
// Pourquoi un modèle plutôt que le journal du serveur : ServerLog s'efface au
// bout de 14 jours et ne retient qu'une phrase. Ici on veut relire ce qui a été
// annoncé il y a des mois, et surtout pouvoir renvoyer le même texte sans le
// réécrire. Les envois de TEST (l'admin s'écrit à lui-même) ne sont pas
// enregistrés : ce sont des brouillons, pas des annonces.
const broadcastSchema = new mongoose.Schema(
  {
    title: { type: String, default: "MyPlayLog" },
    body: { type: String, required: true },
    // Destination ouverte au tap, côté app mobile (« /notifications », « /chat »).
    // Vide = la notification ouvre simplement l'app.
    path: { type: String, default: "" },

    audience: { type: String, enum: ["all", "selected"], default: "all" },
    // Sélection nominative, pour pouvoir la rejouer telle quelle.
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // Compte rendu de l'envoi, figé au moment où il a eu lieu.
    devices: { type: Number, default: 0 }, // appareils visés
    accepted: { type: Number, default: 0 }, // acceptés par Expo
    failed: { type: Number, default: 0 },
    // Motifs de refus regroupés. Pas nommé `errors` : Mongoose réserve ce nom
    // sur les documents et le prévient explicitement.
    failures: { type: [{ reason: String, count: Number, _id: false }], default: [] },

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

broadcastSchema.index({ createdAt: -1 });

export default mongoose.model("Broadcast", broadcastSchema);
