import mongoose from "mongoose";

// Une notification pour un utilisateur (mention, réponse, like, etc.).
const notificationSchema = new mongoose.Schema(
  {
    // Destinataire.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "mention", // mentionné dans un commentaire
        "comment_reply", // réponse à ton commentaire
        "comment_like", // like sur ton commentaire
        "list_comment", // commentaire sur ta liste
        "list_like", // like sur ta liste
        "playlist_listen", // quelqu'un a écouté ta playlist d'OST
        "review_comment", // réponse à ta review
        "review_comment_reply", // réponse à ton commentaire sous une review
        "review_comment_like", // like sur ton commentaire sous une review
        "ost_comment", // commentaire sur ton OST favorite
        "repost_comment", // commentaire sur ta republication (fan art)
        "repost_like", // like sur ta republication
        "video_comment", // commentaire sur une vidéo que tu as recommandée
        "recommendation", // on t'a recommandé un jeu
        "recommendation_boost", // on a fait +1 sur une reco que tu as faite
        "recommendation_comment", // on a commenté une reco (reçue/faite)
      ],
      required: true,
    },
    // Qui a déclenché la notif.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Cible « liste » (pour les notifs de listes/commentaires). Optionnel.
    list: { type: mongoose.Schema.Types.ObjectId, ref: "List", default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Cible « OST » (commentaires d'OST) : propriétaire du profil dont vient
    // l'OST, combiné au champ `game` (gameId) pour reconstruire le lien.
    ostOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Cible « repost » (interactions sur une republication de fan art) :
    // propriétaire du feed concerné, pour le lien /u/…?tab=feed.
    repostOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Cible « vidéo » (commentaires sur une reco vidéo) : propriétaire de la
    // recommandation, pour le lien /u/…?tab=videos.
    videoOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Cible « jeu » (pour les recommandations).
    game: { type: Number, default: null }, // id IGDB
    gameName: { type: String, default: "" },
    snippet: { type: String, default: "" }, // extrait pour l'affichage
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });

export default mongoose.model("Notification", notificationSchema);
