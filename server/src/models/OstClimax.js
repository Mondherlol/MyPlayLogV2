import mongoose from "mongoose";

// ======================================================================
//  Le climax d'une piste d'OST
// ======================================================================
// Où commence le meilleur passage d'un morceau — celui qu'on ferait écouter à
// quelqu'un pour qu'il reconnaisse le jeu.
//
// POURQUOI CE MODÈLE EXISTE : le blind test tirait son extrait à un endroit AU
// HASARD entre 5 % et 50 % de la piste. Sur une OST de jeu, ça tombe très
// souvent dans une intro atmosphérique, un silence, ou une nappe de cordes qui
// ne dit rien à personne — alors que le thème reconnaissable arrive trente
// secondes plus tard. Un blind test injouable n'est pas difficile, il est juste
// raté.
//
// La mesure est une analyse de LOUDNESS (ffmpeg `ebur128`, la norme de mesure
// du volume perçu à la radio et au cinéma) : on relève le volume perçu toutes
// les 100 ms, puis on cherche la fenêtre de la durée d'un extrait dont la
// moyenne est la plus haute. Ce n'est pas « le refrain » au sens musical, mais
// c'est le passage le plus plein — orchestration complète, percussions, thème
// principal — et sur une bande-son de jeu les deux coïncident presque toujours.
//
// L'analyse coûte un téléchargement + un décodage complet : elle ne peut donc
// PAS se faire pendant qu'un joueur attend. Elle tourne en tâche de fond
// (lib/ostClimax.js) et ce document est son cache — permanent, car le contenu
// d'un videoId ne change jamais.
const ostClimaxSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true, unique: true, index: true },
    // Durée réelle du morceau, mesurée (et non plus devinée depuis la page de
    // la playlist) : elle sert à borner le point de départ.
    durationSec: { type: Number, default: null },
    // Le début du meilleur passage, en secondes.
    startSec: { type: Number, default: null },
    // Volume perçu moyen de la fenêtre retenue (LUFS, donc négatif) et de tout
    // le morceau. L'écart entre les deux dit si la piste a vraiment un relief
    // ou si elle est plate — utile pour comprendre un mauvais choix après coup.
    peakLufs: { type: Number, default: null },
    meanLufs: { type: Number, default: null },
    // `false` = analyse tentée et échouée (vidéo bloquée, indisponible,
    // ffmpeg en échec). On garde la trace pour ne pas la retenter en boucle,
    // et le blind test retombe alors sur son estimation.
    ok: { type: Boolean, default: false },
    error: { type: String, default: null },
    analyzedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("OstClimax", ostClimaxSchema);
