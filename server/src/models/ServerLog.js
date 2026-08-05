import mongoose from "mongoose";

// ======================================================================
//  Le journal du serveur — ce qui s'est passé, par qui, quand
// ======================================================================
// Une ligne par évènement notable : une connexion, une action qui écrit en
// base, une erreur. C'est la matière de l'onglet « Logs » du panel admin, et
// la seule façon de répondre à « qu'est-ce qui s'est passé à 3 h du matin ».
//
// ------------------------------------------------------------- ce qu'on garde
// PAS TOUT, et c'est délibéré. Les lectures (GET) ne sont enregistrées que
// lorsqu'elles échouent : un fil d'accueil qui se rafraîchit toutes les
// trente secondes chez trente joueurs noierait le journal sous des milliers de
// lignes sans intérêt, et il n'y a rien à surveiller dans une lecture réussie.
// Ce qui compte, ce sont les ÉCRITURES (qui a changé quoi) et les ÉCHECS.
// La liste des exceptions (frappe en cours, accusés de lecture, synchro de
// lecture vidéo…) vit dans lib/audit.js, au plus près du filtre.
//
// ---------------------------------------------------------------- la durée
// Un journal qui grossit sans fin finit par peser plus lourd que l'app. Les
// entrées s'effacent donc toutes seules au bout de LOGS_TTL_DAYS jours (14 par
// défaut), via l'index TTL de Mongo : rien à purger à la main, rien à
// planifier. C'est un journal d'exploitation, pas une archive.
//
// -------------------------------------------------------------- les noms
// `actorName` double `actor` exprès : un compte supprimé ne doit pas rendre
// illisibles les six mois de journal qui parlent de lui. La référence sert aux
// filtres et à l'avatar, le nom recopié sert à la lecture.

const LOG_KINDS = [
  "auth", // connexion, inscription, échec de mot de passe
  "presence", // ouverture / fermeture du flux temps réel (en ligne, hors ligne)
  "action", // une écriture en base (le gros du journal)
  "message", // un message privé envoyé
  "admin", // une action d'administration (y compris la lecture des MP)
  "error", // une requête qui a échoué (4xx / 5xx)
  "system", // démarrage du serveur, tâches planifiées
];

const serverLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: LOG_KINDS, default: "action" },
    // Phrase lisible, déjà écrite en français : « a envoyé un message ». C'est
    // elle qui s'affiche ; le couple méthode/chemin reste en dessous pour qui
    // veut le détail technique.
    label: { type: String, default: "" },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: "" },
    // La personne CONCERNÉE quand l'action en vise une autre (un abonnement, un
    // message privé, une sanction d'admin).
    target: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    targetName: { type: String, default: "" },

    method: { type: String, default: "" },
    path: { type: String, default: "" },
    status: { type: Number, default: null },
    ms: { type: Number, default: null }, // durée de la requête
    ip: { type: String, default: "" },
    ua: { type: String, default: "" },

    // Ce qui ne rentre dans aucune colonne : l'erreur renvoyée, l'aperçu d'un
    // message, l'identifiant d'une conversation…
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false }
);

// Le journal se lit toujours à l'envers du temps, et se filtre par personne,
// par nature d'évènement ou par les deux.
const TTL_DAYS = Math.max(1, Number(process.env.LOGS_TTL_DAYS) || 14);
serverLogSchema.index({ at: -1 });
serverLogSchema.index({ actor: 1, at: -1 });
serverLogSchema.index({ kind: 1, at: -1 });
serverLogSchema.index({ at: 1 }, { expireAfterSeconds: TTL_DAYS * 86400 });

export { LOG_KINDS };
export default mongoose.model("ServerLog", serverLogSchema);
