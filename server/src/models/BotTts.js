import mongoose from "mongoose";

// ======================================================================
//  Un message vocal du bot, en attente de livraison
// ======================================================================
// « TTS @machin salut gros con » : le bot va le DIRE à voix haute dans le
// navigateur de la cible. Si elle est connectée, ça part tout de suite par le
// flux temps réel et rien n'est écrit ici.
//
// CE MODÈLE N'EXISTE QUE POUR LES ABSENTS. C'est tout l'intérêt de la
// fonctionnalité : insulter quelqu'un qui n'est pas là et savoir que ça lui
// tombera dessus à sa prochaine connexion. Sans cette file, un message envoyé
// à 3 h du matin serait perdu — c'est-à-dire la moitié des messages.
//
// La file est purgée automatiquement au bout d'une semaine : une vanne qui
// arrive dix jours après n'a plus de sens, et personne ne veut retrouver
// quarante messages en rentrant de vacances.
const botTtsSchema = new mongoose.Schema(
  {
    // À qui ça doit être dit.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Qui l'a commandé (pour l'affichage et pour retrouver un abus).
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    fromName: { type: String, default: "" },

    // Ce qui sera PRONONCÉ, entièrement composé au moment de l'envoi (nom de
    // l'expéditeur compris). On ne recompose rien à la livraison : si
    // l'expéditeur change de pseudo entre-temps, le message reste celui qui a
    // été commandé.
    text: { type: String, required: true, maxlength: 400 },
    // La remarque du bot, quand il y en a une (une fois sur deux).
    remark: { type: String, default: "" },

    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Purge automatique après 7 jours (index TTL de MongoDB).
botTtsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
// La file d'un utilisateur, dans l'ordre d'arrivée.
botTtsSchema.index({ user: 1, deliveredAt: 1, createdAt: 1 });

export default mongoose.model("BotTts", botTtsSchema);
