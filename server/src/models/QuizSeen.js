import mongoose from "mongoose";

// ======================================================================
//  QuizSeen — « cette question, tu l'as déjà eue »
// ======================================================================
// Cousin de GeoSeen, mais avec une règle plus souple. Un panorama ne se
// redécouvre pas : une fois qu'on l'a vu, il est brûlé pour toujours. Une
// question de culture générale, si — la revoir six mois plus tard, c'est même
// tout l'intérêt d'apprendre quelque chose.
//
// D'où le TTL : une question ressort de la réserve du joueur au bout d'un
// certain temps (cf. SEEN_TTL_DAYS). Ça évite deux écueils symétriques :
//
//   • sans mémoire du tout, la même question tombe trois parties de suite,
//     surtout au début quand la banque est petite ;
//   • avec une mémoire définitive, un joueur assidu épuise la banque et se
//     retrouve devant un « plus de questions » au bout de quelques semaines —
//     exactement le mur que GeoGamer assume (il n'a pas le choix, ses lieux
//     sont finis) mais qu'un quiz n'a aucune raison de subir.
//
// On y range AUSSI les jeux vus dans les épreuves qui n'en sont pas (emoji,
// pixel, duel…) : `ref` porte soit un id de QuizQuestion, soit un gameId IGDB
// préfixé, et `kind` dit lequel. Une seule collection, un seul TTL, une seule
// requête d'exclusion au démarrage d'une partie.
const SEEN_TTL_DAYS = 45;

const quizSeenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // « q:<ObjectId> » pour une question de la banque, « g:<gameId> » pour un
    // jeu déjà servi en emoji / pixel / fill. Une chaîne plutôt que deux
    // champs : c'est une clé d'exclusion, on ne requête jamais dessus autrement
    // qu'en « est-ce que cet ensemble contient ça ».
    ref: { type: String, required: true },
    kind: { type: String, enum: ["question", "game"], default: "question" },
    // L'épreuve où c'est tombé : un jeu vu en emoji peut resservir en pixel
    // sans que ce soit une redite, alors qu'en emoji ce serait la même énigme.
    type: { type: String, default: "" },
  },
  { timestamps: true }
);

// Un seul enregistrement par (joueur, référence, épreuve) : le /finish
// upserte dessus.
quizSeenSchema.index({ user: 1, ref: 1, type: 1 }, { unique: true });
// La péremption : passé le délai, la question redevient tirable.
quizSeenSchema.index({ createdAt: 1 }, { expireAfterSeconds: SEEN_TTL_DAYS * 86400 });

export { SEEN_TTL_DAYS };
export default mongoose.model("QuizSeen", quizSeenSchema);
