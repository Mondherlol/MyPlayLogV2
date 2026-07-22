import mongoose from "mongoose";

// Journal d'activité sociale : une entrée par action (commentaire, réponse,
// like, réaction, mais aussi action de bibliothèque, abonnement, liste créée…).
// Alimente le fil d'accueil ET l'onglet Feed du profil (cf. routes/feed.js).
// C'est la source de vérité du fil : on n'infère plus rien des updatedAt.
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
        "playlist_listen", // écoute d'une playlist d'OST (une entrée par auditeur)
        "review_comment", // commentaire (racine) sous un avis
        "review_comment_reply", // réponse à un commentaire d'avis
        "review_comment_like", // like d'un commentaire d'avis
        "review_react", // réaction (cœur/bravo/rigolo) sur un avis
        "gamemedia_comment", // commentaire (racine) sur un post du mur média
        "gamemedia_comment_reply", // réponse à un commentaire d'un post du mur média
        "recommendation", // a recommandé un jeu à un joueur (target = destinataire)
        "recommendation_boost", // +1 sur une recommandation faite à target
        "recommendation_comment", // commentaire sous une recommandation faite à target
        // Actions « premières » (pas des interactions) :
        "game_update", // action(s) sur une entrée de bibliothèque — les
        // changements réels (statut, note, review, OST…) sont dans
        // meta.changes, fusionnés si rapprochés dans le temps
        "list_create", // création d'une liste publique
        "list_items", // ajout d'éléments à une liste (meta.added, fusionné)
        "follow", // abonnement à un joueur (target)
        "blindtest", // a terminé un blind test musical (meta = score/manches/défi)
        "pixel", // a terminé une partie de Pixel Rush (meta = score/manches/défi)
        "case_open", // a ouvert une caisse de l'arcade (meta = lot obtenu)
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
    game: { type: Number, default: null }, // id IGDB (avis ou entrée de bibliothèque)
    gameName: { type: String, default: "" },
    gameCover: { type: String, default: null }, // jaquette (cards game_update)
    // Extrait affiché (texte commenté / liké, ou type de réaction).
    snippet: { type: String, default: "" },
    // Détails structurés selon le type :
    //  gamemedia_* → { postId } (post du mur média visé)
    //  game_update → { changes: [{ kind: "added"|"status"|"rating"|"review"|
    //                  "favorite"|"ost"|"character"|"time"|"bundle", ... }] }
    //                 ("bundle" = jeux d'un bundle cochés terminés :
    //                  { done, total, names: [noms nouvellement finis] })
    //  list_items  → { added: n }
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Fil d'accueil : activité émise par les joueurs suivis, du plus récent au plus ancien.
activitySchema.index({ actor: 1, createdAt: -1 });
// Fusion des actions rapprochées sur un même jeu / une même liste.
activitySchema.index({ actor: 1, type: 1, game: 1, createdAt: -1 });

export default mongoose.model("Activity", activitySchema);
