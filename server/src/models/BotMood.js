import mongoose from "mongoose";

// ======================================================================
//  L'humeur imposée à Gérard
// ======================================================================
// L'humeur ordinaire est TIRÉE (date + serveur, cf. lib/botMood.js) et ne
// coûte donc aucun stockage. Celle-ci est l'exception : quelqu'un a tapé
// « !humeur en colère » et le bot doit rester en colère pendant les heures qui
// suivent — y compris après un redéploiement, sinon la blague tombe au premier
// `docker compose up` et personne ne comprend pourquoi il est redevenu normal.
//
// UNE LIGNE PAR « SCOPE » (un serveur Discord, un tête-à-tête sur le site) :
// c'est la même unité que le tirage du jour, pour que deux salons du même
// serveur voient le même bonhomme.
//
// L'INDEX TTL FAIT LE MÉNAGE TOUT SEUL. `expireAfterSeconds: 0` sur `until`
// veut dire « supprime le document quand cette date est passée » : aucune
// tâche planifiée à écrire, et la collection ne contient jamais que les
// humeurs en cours.
const botMoodSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, unique: true },
    // Le texte tel qu'il a été tapé (« excité par Mondher »). C'est lui qu'on
    // remet dans le prompt : le reformuler, c'est perdre exactement ce qui
    // rendait la demande drôle.
    label: { type: String, required: true },
    // La consigne d'humeur, RÉÉCRITE À LA DEUXIÈME PERSONNE au moment où on la
    // pose (voir writeMoodBrief, lib/bot.js). On la garde plutôt que de la
    // refabriquer à chaque message : c'est un appel au modèle, et surtout deux
    // rédactions différentes donneraient deux Gérard différents dans la même
    // soirée. Vide = on retombe sur le gabarit générique.
    prompt: { type: String, default: "" },
    // Sa façon à lui de dire dans quel état il est (« !humeur » sans argument).
    quip: { type: String, default: "" },
    // Cette humeur insulte-t-elle encore ? Voir le drapeau `mean` de botMood.js.
    mean: { type: Boolean, default: true },
    until: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    by: { type: String, default: "" },
    // Le « béguin » de la roue des couples (`!roue`) : quand le bot se tire
    // lui-même, il tombe amoureux de quelqu'un et il faut savoir DE QUI pour
    // mettre des cœurs sous ses messages et lui sauter dessus quand on lui
    // parle mal. Ça vit ici plutôt que dans un coin à part parce que c'est la
    // MÊME chose que l'humeur : ça commence et ça finit en même temps.
    crush: {
      id: { type: String, default: "" },
      name: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export default mongoose.model("BotMood", botMoodSchema);
