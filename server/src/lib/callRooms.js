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
    participants: voice.peers(keyOf(session.conversationId)).map((p) => ({
      peerId: p.peerId,
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      muted: p.muted,
    })),
  };
}
