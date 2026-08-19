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
    until: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    by: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("BotMood", botMoodSchema);
