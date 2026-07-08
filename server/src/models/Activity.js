import mongoose from "mongoose";

// Journal d'activité sociale : une entrée par action (commentaire, réponse,
// like, réaction) sur une liste ou un avis. Alimente le fil d'accueil
// (cf. routes/feed.js).
//
// Différences volontaires avec les Notification :
//  - on enregistre AUSSI les actions sur son propre contenu (un abonné qui
//    répond à son propre avis est une activité légitime du fil) ;
//  - une action = une seule entrée (pas de doublon par destinataire), donc
//    aucune dédup côté fil ;
//  - les likes/réactions (qui n'ont pas d'horodatage dans leurs tableaux) sont
//    ici datés, ce qui permet de les paginer comme le reste.
const activitySchema = new mongoose.Schema(
  {
    // Qui agit.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "list_comment", // commentaire (racine) sur une liste
        "comment_reply", // réponse à un commentaire de liste
        "list_like", // like d'une liste
        "comment_like", // like d'un commentaire de liste
        "review_comment", // commentaire (racine) sous un avis
        "review_comment_reply", // réponse à un commentaire d'avis
        "review_comment_like", // like d'un commentaire d'avis
        "review_react", // réaction (cœur/bravo/rigolo) sur un avis
      ],
      required: true,
    },
    // À qui appartient le contenu visé (propriétaire de la liste, auteur de
    // l'avis, auteur du commentaire répondu / liké) → affichage « … de X ».
    target: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Contexte « liste » ou « avis (jeu) ».
    list: { type: mongoose.Schema.Types.ObjectId, ref: "List", default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, default: null },
    game: { type: Number, default: null }, // id IGDB (avis)
    gameName: { type: String, default: "" },
    // Extrait affiché (texte commenté / liké, ou type de réaction).
    snippet: { type: String, default: "" },
  },
  { timestamps: true }
);

// Fil d'accueil : activité émise par les joueurs suivis, du plus récent au plus ancien.
activitySchema.index({ actor: 1, createdAt: -1 });

export default mongoose.model("Activity", activitySchema);
