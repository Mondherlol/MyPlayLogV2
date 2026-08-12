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
//
// `family` sert à l'onglet Activité, qui range les amis par nature de ce qu'ils
// font (on joue / on regarde / on lit) plutôt qu'en une liste plate : à dix
// personnes en ligne, « qui joue à quoi » se lit d'un coup d'œil, une liste
// mélangée ne se lit pas du tout.
const ACTIVITIES = {
  mot: { label: "Joue au Mot du jour", family: "play" },
  blindtest: { label: "Joue au Blind Test", family: "play" },
  pixel: { label: "Joue à Pixel Rush", family: "play" },
  geo: { label: "Joue à GeoGamer", family: "play" },
  // Sans cette ligne, `isKnownKind` refuse le statut et la messagerie continue
  // d'afficher « en ligne » pendant qu'on joue.
  quiz: { label: "Joue au Grand Quiz", family: "play" },
  perroquet: { label: "Joue au Perroquet", family: "play" },
  imposteur: { label: "Joue à L'Imposteur", family: "play" },
  arcade: { label: "Traîne à l'arcade", family: "play" },
  gba: { label: "Joue sur Game Boy Advance", family: "play" },
  watchparty: { label: "Regarde une séance", family: "watch" },
  collection: { label: "Regarde", family: "watch" },
  comic: { label: "Lit", family: "read" },
  // « Écoute · Aerith's Theme ». Contrairement aux autres, ce statut n'est pas
  // annoncé par une PAGE mais par le mini-lecteur, qui suit l'utilisateur
  // partout — d'où son rang d'annonce FAIBLE côté client (lib/presence.js) :
  // une partie en cours dit toujours mieux ce qu'on fait qu'une musique de
  // fond, et deux annonceurs concurrents se voleraient la place à tour de rôle.
  listen: { label: "Écoute", family: "listen" },
};

export const FAMILIES = ["play", "watch", "read", "listen"];

// Ce qu'on accepte comme lien de rejointe. Un statut est écrit par le CLIENT :
// sans ce filtre, n'importe qui pourrait faire afficher chez ses amis un bouton
// « Rejoindre » pointant où il veut. Un chemin interne, court, et rien d'autre —
// pas de « // » qui ferait une adresse absolue vers un autre site.
function cleanPath(path) {
  const p = String(path || "");
  if (!p.startsWith("/") || p.startsWith("//")) return "";
  if (!/^\/[\w\-/?=&.%]{0,80}$/.test(p)) return "";
  return p;
}

export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(ACTIVITIES, kind);
}

// Renvoie true si le statut a CHANGÉ de nature (nouvelle activité, nouveau
// détail, nouveau lien) — l'appelant s'en sert pour ne rediffuser que si
// nécessaire.
export function setStatus(userId, kind, detail = "", path = "") {
  const key = String(userId);
  if (!isKnownKind(kind)) return false;
  const clean = String(detail || "").slice(0, 40);
  const link = cleanPath(path);
  const prev = live.get(key);
  // `at` est le dernier battement (c'est lui qui fait expirer), `since` le début
  // de CETTE activité — il ne se remet à zéro qu'en changeant de jeu. Les
  // confondre afficherait « depuis quelques secondes » pour quelqu'un qui joue
  // depuis une heure, puisque le battement retombe toutes les 45 secondes.
  const since = prev?.kind === kind ? prev.since : Date.now();
  live.set(key, { kind, detail: clean, path: link, at: Date.now(), since });
  return !prev || prev.kind !== kind || prev.detail !== clean || prev.path !== link;
}

// « Je m'éteins » — mais seulement si le statut affiché est BIEN LE MIEN.
//
// `was` est l'activité que l'appelant croyait annoncer. Sans ce garde-fou, une
// extinction en retard efface le statut de quelqu'un d'autre… c'est-à-dire de
// soi-même une seconde plus tard : on quitte le mini-lecteur pour entrer dans
// une partie, les deux requêtes se croisent, et le « Joue au Mot du jour » qui
// vient d'être posé disparaît sans que rien ne l'explique. Le cas est devenu
// courant depuis que le lecteur annonce lui aussi (il est monté en permanence,
// donc toujours en concurrence avec la page).
export function clearStatus(userId, was = null) {
  const key = String(userId);
  if (was && live.get(key)?.kind !== String(was)) return false;
  return live.delete(key);
}

export function statusOf(userId) {
  const s = live.get(String(userId));
  if (!s) return null;
  if (Date.now() - s.at > TTL) {
    live.delete(String(userId));
    return null;
  }
  const meta = ACTIVITIES[s.kind];
  return {
    kind: s.kind,
    label: meta.label,
    family: meta.family,
    detail: s.detail,
    path: s.path || "",
    // Depuis quand : « depuis 12 min » vaut mieux qu'un horaire dans une liste
    // qu'on regarde pour savoir qui rejoindre maintenant.
    since: s.since || s.at,
  };
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
