// ======================================================================
//  « Que fait ce joueur en ce moment » — statut d'activité éphémère
// ======================================================================
// À côté de la pastille verte « en ligne », la messagerie annonce ce que
// l'interlocuteur est en train de faire : « Joue au Mot du jour · 39° »,
// « Joue à GeoGamer · manche 3/5 ». C'est ce qui donne envie de le rejoindre.
//
// -------------------------------------------------------------- en mémoire
// Rien n'est stocké en base, et c'est délibéré : un statut ne vaut que tant
// qu'on joue, il n'a aucun intérêt une minute plus tard et encore moins
// demain. Le tenir en base coûterait une écriture par essai pour une donnée
// dont la durée de vie utile est celle d'un onglet ouvert. Un redémarrage du
// serveur vide donc tout — et c'est très bien : les clients qui jouent encore
// le réannoncent au battement suivant.
//
// ------------------------------------------------------------- qui écrit ici
// Le CLIENT, pas les routes de jeu. Le serveur ne voit pas tout : entre le
// /start et le /finish d'une partie de Pixel Rush il n'y a AUCUN appel, une
// partie entière passerait donc inaperçue. La page, elle, sait exactement ce
// qu'elle affiche — et c'est aussi elle qui peut formuler le détail juste
// (« 39° », « manche 3/5 »).

// userId → { kind, detail, at }
const live = new Map();

// Au-delà, le statut est considéré comme mort. Le client bat toutes les 45 s
// (cf. useLiveStatus côté client), ce qui laisse la marge d'un battement raté
// avant de faire disparaître le libellé.
const TTL = 110_000;

// Les activités connues. Une clé inconnue est ignorée plutôt que d'afficher un
// libellé brut : le statut d'un ami est visible par lui, il ne doit jamais
// laisser passer une chaîne arbitraire.
const LABELS = {
  mot: "Joue au Mot du jour",
  blindtest: "Joue au Blind Test",
  pixel: "Joue à Pixel Rush",
  geo: "Joue à GeoGamer",
  // Sans cette ligne, `isKnownKind` refuse le statut et la messagerie continue
  // d'afficher « en ligne » pendant qu'on joue.
  quiz: "Joue au Grand Quiz",
  arcade: "Traîne à l'arcade",
  watchparty: "Regarde une séance",
};

export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(LABELS, kind);
}

// Renvoie true si le statut a CHANGÉ de nature (nouvelle activité, ou détail
// différent) — l'appelant s'en sert pour ne rediffuser que si nécessaire.
export function setStatus(userId, kind, detail = "") {
  const key = String(userId);
  if (!isKnownKind(kind)) return false;
  const clean = String(detail || "").slice(0, 40);
  const prev = live.get(key);
  live.set(key, { kind, detail: clean, at: Date.now() });
  return !prev || prev.kind !== kind || prev.detail !== clean;
}

export function clearStatus(userId) {
  return live.delete(String(userId));
}

export function statusOf(userId) {
  const s = live.get(String(userId));
  if (!s) return null;
  if (Date.now() - s.at > TTL) {
    live.delete(String(userId));
    return null;
  }
  return { kind: s.kind, label: LABELS[s.kind], detail: s.detail };
}

// Statuts d'un lot d'utilisateurs → { id: {kind,label,detail} }. Utilisé pour
// garnir la liste des conversations en une passe.
export function statusesAmong(userIds) {
  const out = {};
  for (const id of userIds || []) {
    const s = statusOf(id);
    if (s) out[String(id)] = s;
  }
  return out;
}

// Ménage périodique : sans lui, la Map garderait une entrée par joueur ayant
// joué depuis le démarrage. Toutes les 5 minutes suffisent — `statusOf` fait
// déjà expirer à la lecture, ce balayage ne sert qu'à libérer la mémoire des
// entrées que plus personne ne consulte.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, s] of live) if (now - s.at > TTL) live.delete(key);
}, 5 * 60 * 1000);
sweep.unref?.();
