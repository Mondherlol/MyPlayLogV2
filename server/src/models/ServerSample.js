import mongoose from "mongoose";

// ======================================================================
//  Un relevé de la santé du serveur, toutes les 5 minutes
// ======================================================================
// C'est la matière des courbes « Serveur » de l'onglet Statistiques du panel
// admin : l'onglet Système ne montre qu'un instantané, ceci en garde l'histoire.
// Les compteurs (requêtes, erreurs, joueurs) portent sur les 5 minutes écoulées
// depuis le relevé précédent. Effacés tout seuls au bout de 90 jours.
const serverSampleSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    cpu: { type: Number, default: null }, // charge de la machine, % des cœurs
    proc: { type: Number, default: null }, // CPU consommé par l'API, % d'un cœur
    mem: { type: Number, default: null }, // mémoire vive de la machine, % utilisé
    rss: { type: Number, default: null }, // mémoire de l'API, octets
    lag: { type: Number, default: null }, // retard de la boucle d'évènements (p99, ms)
    req: { type: Number, default: 0 }, // requêtes API servies
    err: { type: Number, default: 0 }, // réponses 5xx
    err4: { type: Number, default: 0 }, // réponses 4xx
    p50: { type: Number, default: null }, // temps de réponse médian (ms)
    p95: { type: Number, default: null },
    users: { type: Number, default: 0 }, // joueurs distincts qui ont fait une requête
    online: { type: Number, default: 0 }, // joueurs connectés au temps réel à l'instant du relevé
  },
  { versionKey: false }
);

serverSampleSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 86400 });

export default mongoose.model("ServerSample", serverSampleSchema, "serversamples");
