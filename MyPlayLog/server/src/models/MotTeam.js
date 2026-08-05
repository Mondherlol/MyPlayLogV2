import mongoose from "mongoose";

// ======================================================================
//  Une équipe du « Mot du jour » — la table qui survit à minuit
// ======================================================================
// Une MotSession ne vit qu'un jour : elle porte le mot du jour, et meurt avec
// lui. L'ÉQUIPE, elle, est la liste des gens avec qui on cherche — et celle-là
// n'a aucune raison de se dissoudre chaque nuit. Sans ce modèle, il fallait
// réinviter les mêmes personnes tous les matins, une par une.
//
// Le partage des rôles :
//   MotTeam     qui joue ensemble        (permanent, un code stable)
//   MotSession  ce qu'ils ont proposé    (un jour, un mot, un pot d'essais)
//
// LE CODE EST STABLE, et c'est tout l'intérêt : le lien d'invitation
// (/mot?t=CODE) et la carte déposée dans la messagerie ouvrent la partie DU
// JOUR, quel que soit le jour où on clique. Une carte d'équipe ne périme pas,
// contrairement à une carte de session (/mot?s=CODE), qui ne vaut que pour son
// mot.
//
// Rejoindre l'équipe n'engage à rien : c'est le carnet d'adresses de la table,
// pas la table elle-même. Tant qu'on n'a pas cliqué « jouer ensemble », les
// essais restent strictement personnels — la fusion des essais reste l'affaire
// de MotSession (cf. son en-tête).
const teamMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    addedAt: { type: Date, default: Date.now },
    // Qui a fait entrer cette personne : sert à formuler « invité par X » et à
    // ne pas laisser une équipe grossir de façon inexplicable.
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const motTeamSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, default: "", maxlength: 60 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [teamMemberSchema], default: [] },

    // Le groupe de discussion d'où vient l'équipe, quand elle a été invitée en
    // bloc depuis la messagerie. C'est là que part le rappel du jour : dans le
    // fil que ces gens ont déjà, plutôt qu'en messages privés séparés.
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },

    // Dernier jour où l'équipe a ouvert une partie : sert à trier les équipes et
    // à afficher « vous avez joué ensemble hier ».
    lastDate: { type: String, default: "" },
    // Le rappel « l'équipe cherche le mot du jour » ne part qu'UNE fois par
    // jour, même si trois personnes cliquent sur « jouer ensemble » à la suite.
    pingedDate: { type: String, default: "" },
  },
  { timestamps: true }
);

// « Mes équipes », en tête du rail à chaque visite.
motTeamSchema.index({ "members.user": 1, lastDate: -1 });

export default mongoose.model("MotTeam", motTeamSchema);
