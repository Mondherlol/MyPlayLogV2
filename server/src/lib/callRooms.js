import * as voice from "./voiceRooms.js";

// ======================================================================
//  Les appels de la messagerie — la sonnerie et le fil de l'appel
// ======================================================================
// lib/voiceRooms.js tient DÉJÀ « qui est connecté à quoi » : ce fichier ne
// refait pas ce travail, il ajoute la seule chose qu'un appel de messagerie a
// de plus qu'un appel de salon de jeu — LA SONNERIE. C'est-à-dire un état
// intermédiaire qui n'existe pas dans le Perroquet : quelqu'un a décroché, les
// autres ne savent pas encore s'ils viennent.
//
// ------------------------------------------------- une clé, deux univers
// Le registre de pairs est partagé avec les salons de versus. Les clés y sont
// donc préfixées : `dm:<id de conversation>` ici, le code du salon là-bas. Sans
// ce préfixe, rien ne casserait aujourd'hui (les formats ne se croisent pas)
// mais la première clé numérique qu'on ajouterait quelque part créerait un
// mélange de deux appels — une panne qu'on ne trouverait jamais.
export const keyOf = (convId) => `dm:${String(convId)}`;

// Combien de temps ça sonne dans le vide. Trente secondes, c'est trop court
// pour aller chercher son casque ; deux minutes, c'est un téléphone qui sonne
// dans une pièce vide et qu'on finit par détester. Quarante-cinq.
export const RING_MS = 45_000;

// ======================================================================
//  RACCROCHER N'EST PAS DISPARAÎTRE
// ======================================================================
// Deux façons de quitter un appel, et elles n'appellent pas la même réaction :
//
//   RACCROCHER   un geste délibéré. En privé, l'appel est fini pour les deux —
//                laisser l'autre seul devant une tonalité d'attente n'a aucun
//                sens, il n'y a plus personne à attendre.
//   DISPARAÎTRE  un onglet qui plante, un tunnel qui saute, un métro. La
//                personne veut revenir, et souvent en quelques secondes. Couper
//                immédiatement obligerait à tout relancer pour une coupure de
//                réseau de trois secondes.
//
// D'où ce SURSIS : quand quelqu'un disparaît sans raccrocher, sa place est
// gardée et son état passe à « connexion en attente » chez les autres. S'il
// n'est pas revenu au bout de trente secondes, on considère qu'il est parti.
export const GRACE_MS = 30_000;

// Ce que la messagerie ne peut pas faire elle-même : elle sait qu'un flux s'est
// fermé, pas ce que ça implique pour un appel. Les routes d'appel (routes/
// calls.js) déposent ici ce qu'il faut faire — un registre plutôt qu'un import
// direct, sinon `chat.js` importerait `calls.js` qui importe `chat.js`.
let hooks = { onAway: null, onBack: null, onGone: null };
export function onPresenceChange(next) {
  hooks = { ...hooks, ...next };
}

// conversationId → Map(userId → minuteur)
const graces = new Map();

const graceOf = (convId) => {
  const key = String(convId);
  if (!graces.has(key)) graces.set(key, new Map());
  return graces.get(key);
};

// Qui est en sursis dans cette conversation.
export const awayIn = (convId) => [...(graces.get(String(convId))?.keys() || [])];

// Le flux temps réel de quelqu'un vient de se fermer (dernier onglet). S'il est
// dans un appel, sa place est gardée — pour l'instant.
export function noteOffline(userId) {
  const id = String(userId);
  for (const session of sessions.values()) {
    const inCall = voice
      .peers(keyOf(session.conversationId))
      .some((p) => p.userId === id);
    if (!inCall) continue;

    const convId = session.conversationId;
    const map = graceOf(convId);
    clearTimeout(map.get(id));
    const timer = setTimeout(() => {
      map.delete(id);
      // On retire toutes ses connexions : il n'est plus là pour de bon.
      for (const p of voice.peers(keyOf(convId)))
        if (p.userId === id) voice.leave(keyOf(convId), p.peerId);
      hooks.onGone?.(convId, id);
    }, GRACE_MS);
    timer.unref?.();
    map.set(id, timer);
    hooks.onAway?.(convId, id);
  }
}

// Il est revenu avant la fin du sursis.
export function noteOnline(userId) {
  const id = String(userId);
  for (const [convId, map] of graces) {
    if (!map.has(id)) continue;
    clearTimeout(map.get(id));
    map.delete(id);
    hooks.onBack?.(convId, id);
  }
}

// conversationId → session
const sessions = new Map();

export function get(convId) {
  return sessions.get(String(convId)) || null;
}

// Combien de monde est effectivement DANS l'appel (pas en train de sonner).
export const size = (convId) => voice.peers(keyOf(convId)).length;

// Ouvre la session si elle n'existe pas. Rend `{ session, fresh }` — `fresh`
// dit s'il faut faire sonner, et c'est toute la différence entre « j'appelle »
// et « je rejoins un appel déjà en cours ». Sans ce booléen, arriver dans un
// appel de groupe déjà commencé referait sonner tout le monde, y compris les
// deux personnes qui parlent depuis dix minutes.
export function open(convId, starter) {
  const id = String(convId);
  const existing = sessions.get(id);
  if (existing) {
    existing.everJoined.add(String(starter.id));
    return { session: existing, fresh: false };
  }
  const session = {
    conversationId: id,
    startedAt: Date.now(),
    startedBy: { ...starter, id: String(starter.id) },
    // Ceux à qui l'on n'a pas encore de réponse. Un décrochage ou un refus les
    // en retire : c'est ce qui éteint la sonnerie chez les autres onglets de la
    // même personne.
    ringing: new Set(),
    declined: new Set(),
    // Qui est passé par là, même une seconde. Sert à distinguer un appel
    // manqué d'un appel qui a eu lieu, au moment d'écrire la ligne dans le fil.
    everJoined: new Set([String(starter.id)]),
    timer: null,
  };
  sessions.set(id, session);
  return { session, fresh: true };
}

export function answered(convId, userId) {
  const s = sessions.get(String(convId));
  if (!s) return;
  s.ringing.delete(String(userId));
  s.declined.delete(String(userId));
  s.everJoined.add(String(userId));
}

export function declined(convId, userId) {
  const s = sessions.get(String(convId));
  if (!s) return;
  s.ringing.delete(String(userId));
  s.declined.add(String(userId));
}

// Fermer : la session disparaît, le minuteur avec elle. Rend la session pour
// que l'appelant sache quoi écrire dans le fil (durée, appel manqué).
export function close(convId) {
  const id = String(convId);
  const s = sessions.get(id);
  if (!s) return null;
  clearTimeout(s.timer);
  // Les sursis en cours meurent avec la session : sans ça, un minuteur se
  // réveille trente secondes plus tard pour retirer quelqu'un d'un appel qui
  // n'existe plus, et rediffuse un état à des gens qui sont passés à autre chose.
  for (const t of graces.get(id)?.values() || []) clearTimeout(t);
  graces.delete(id);
  sessions.delete(id);
  // Le registre de pairs se vide avec : un onglet resté accroché à une session
  // fermée continuerait sinon à battre dans une salle qui n'existe plus.
  for (const p of voice.peers(keyOf(id))) voice.leave(keyOf(id), p.peerId);
  return s;
}

// Les appels en cours parmi une liste de conversations : c'est ce qui remplit
// le bandeau « appel en cours, rejoindre » de chaque fil.
export function among(convIds) {
  const out = [];
  for (const id of convIds || []) {
    const s = sessions.get(String(id));
    if (!s) continue;
    out.push(view(s));
  }
  return out;
}

export function view(session) {
  return {
    conversationId: session.conversationId,
    startedAt: session.startedAt,
    startedBy: session.startedBy,
    ringing: [...session.ringing],
    // Ceux dont on garde la place le temps qu'ils reviennent. L'écran les
    // affiche « connexion en attente » plutôt que de les faire disparaître.
    away: awayIn(session.conversationId),
    participants: voice.peers(keyOf(session.conversationId)).map((p) => ({
      peerId: p.peerId,
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      muted: p.muted,
    })),
  };
}
