// ======================================================================
//  Les appels vocaux de salon — en mémoire, et rien d'autre
// ======================================================================
// « On est tous dans le même appel » : la liste de qui a décroché dans un
// salon donné, indexée par onglet. C'est tout ce que ce fichier tient.
//
// -------------------------------------------------------------- rien en base
// Même raisonnement que lib/gbaRooms.js, et il est encore plus net ici : un
// appel n'existe QUE tant que des onglets sont ouverts. Un document Mongo par
// appel nous laisserait une collection de conversations mortes à balayer, pour
// une donnée dont la durée de vie utile est celle d'une soirée. Un redémarrage
// du serveur raccroche tout le monde : c'est exact, et chacun re-décroche d'un
// clic — la partie, elle, continue sans rien perdre (elle, est en base).
//
// -------------------------------------------- ce que le serveur n'entend PAS
// LA VOIX NE PASSE PAS PAR ICI. On ne relaie que les poignées de main (SDP,
// ICE) : le son va d'un navigateur à l'autre en direct. Un VPS qui mélangerait
// six flux audio en temps réel, c'est un autre métier (un SFU/MCU) et une autre
// facture ; le relais de signalisation, lui, coûte quelques centaines d'octets
// par paire, une seule fois.
//
// ------------------------------------------------- pourquoi un MAILLAGE ici
// La diffusion GBA est une ÉTOILE (un hôte, des spectateurs) parce qu'un seul
// navigateur a l'image. Un appel n'a pas de centre : tout le monde parle, donc
// chacun tient une connexion vers chacun. À six, c'est cinq connexions montantes
// par personne — de la voix, quelques dizaines de kilobits chacune, ce qui tient
// largement sur une ligne domestique. C'est ce qui plafonne la salle plus bas
// qu'une visio ne le ferait, et c'est assumé : au-delà, il faudrait un relais.
//
// ------------------------------------------------------------ le peerId
// On indexe par ONGLET, pas par compte : deux onglets du même joueur se
// voleraient leurs poignées de main. `emitTo` s'adresse à un utilisateur (donc à
// tous ses onglets) ; c'est le `peerId` porté par le message qui dit auquel il
// s'adresse vraiment.

// Le plafond de participants. Il colle à MAX_PLAYERS des salons de versus : on
// ne veut pas d'un appel plus grand que la table.
export const MAX_IN_CALL = 6;

// Un onglet qui ne bat plus a raccroché sans le dire (onglet tué, machine en
// veille, navigateur qui plante). Le « je raccroche » part au moment où l'onglet
// se ferme, c'est-à-dire exactement le moment où une requête a le plus de
// chances de ne jamais partir — d'où le battement, toutes les 30 secondes côté
// client, et deux battements ratés de tolérance.
const TTL = 75_000;

// code du salon → Map(peerId → participant)
const calls = new Map();

// Retire les onglets muets depuis trop longtemps. Rend la liste des peerId
// tombés : l'appelant doit prévenir les autres, sinon leur écran garde un
// fantôme en « Connexion… » pour toujours.
export function prune(code) {
  const call = calls.get(String(code || ""));
  if (!call) return [];
  const now = Date.now();
  const dropped = [];
  for (const [peerId, p] of call) {
    if (now - p.at <= TTL) continue;
    call.delete(peerId);
    dropped.push(peerId);
  }
  if (!call.size) calls.delete(String(code));
  return dropped;
}

export function peers(code) {
  prune(code);
  const call = calls.get(String(code || ""));
  if (!call) return [];
  return [...call.entries()].map(([peerId, p]) => ({
    peerId,
    userId: p.userId,
    username: p.username,
    avatar: p.avatar,
    muted: !!p.muted,
  }));
}

export function has(code, peerId) {
  prune(code);
  return !!calls.get(String(code || ""))?.has(peerId);
}

export function peerOf(code, peerId) {
  return calls.get(String(code || ""))?.get(peerId) || null;
}

// Décrocher. Rend `null` si la salle est pleine — l'appelant en fait un 409
// plutôt que d'entasser une septième voix que personne n'entendra bien.
//
// Le retour donne LES AUTRES, et c'est le cœur du protocole : c'est l'arrivant
// qui fait les offres, à chacun de ceux qui étaient déjà là. Les anciens ne font
// que répondre. Si les deux côtés offraient, deux offres se croiseraient sur la
// même paire (le « glare » de WebRTC) et la connexion ne s'établirait jamais.
export function join(code, peerId, user) {
  prune(code);
  const key = String(code);
  let call = calls.get(key);
  if (!call) {
    call = new Map();
    calls.set(key, call);
  }
  const others = [...call.entries()]
    .filter(([id]) => id !== peerId)
    .map(([id, p]) => ({
      peerId: id,
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      muted: !!p.muted,
    }));
  if (!call.has(peerId) && call.size >= MAX_IN_CALL) return null;

  call.set(peerId, {
    userId: String(user.id),
    username: user.username,
    avatar: user.avatar || null,
    muted: !!user.muted,
    at: Date.now(),
  });
  return others;
}

export function touch(code, peerId) {
  const p = calls.get(String(code || ""))?.get(peerId);
  if (!p) return false;
  p.at = Date.now();
  return true;
}

// Le micro coupé volontairement. C'est un état PARTAGÉ, pas un réglage privé :
// voir la pastille barrée de quelqu'un évite les trente secondes classiques où
// l'on parle à un micro fermé pendant que les autres répètent « on t'entend
// plus ».
export function setMuted(code, peerId, muted) {
  const p = calls.get(String(code || ""))?.get(peerId);
  if (!p) return false;
  p.muted = !!muted;
  return true;
}

export function leave(code, peerId) {
  const key = String(code || "");
  const call = calls.get(key);
  if (!call) return false;
  const had = call.delete(peerId);
  if (!call.size) calls.delete(key);
  return had;
}

// À qui rediffuser : les comptes présents dans l'appel. Dédoublonnés, parce
// qu'un joueur à deux onglets est UN destinataire pour `emitTo`.
export function listeners(code) {
  const call = calls.get(String(code || ""));
  if (!call) return [];
  return [...new Set([...call.values()].map((p) => p.userId))];
}

// Ménage : les lectures font déjà expirer au passage, ce balayage ne sert qu'à
// ne pas garder en mémoire les appels que plus personne ne consulte.
const sweep = setInterval(() => {
  for (const code of [...calls.keys()]) prune(code);
}, 60_000);
sweep.unref?.();
