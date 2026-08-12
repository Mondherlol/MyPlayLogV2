// ======================================================================
//  Les salons de diffusion GBA — en mémoire, et c'est tout
// ======================================================================
// « Untel joue à Zelda sur GBA, viens voir » : une console allumée, des gens
// qui regardent par-dessus l'épaule, et parfois quelqu'un à qui on passe la
// manette. C'est ce que ce fichier tient — la LISTE de qui diffuse quoi et de
// qui regarde, rien d'autre.
//
// -------------------------------------------------------------- rien en base
// Même raisonnement que le statut d'activité (lib/liveStatus.js), et il est
// encore plus net ici : un salon n'existe QUE tant que l'onglet de l'hôte est
// ouvert. La partie, elle, est déjà sauvegardée ailleurs (CollectionSave). Un
// document Mongo par diffusion nous laisserait une collection de salons morts à
// balayer, pour une donnée dont la durée de vie utile est celle d'une session.
// Un redémarrage du serveur coupe les diffusions : c'est exact, elles sont
// coupées — les flux WebRTC passent par le serveur pour se PRÉSENTER, pas pour
// transiter, et l'hôte rouvre son salon d'un clic.
//
// ------------------------------------------------- ce que le serveur ne voit pas
// L'IMAGE NE PASSE PAS PAR ICI. Le serveur ne relaie que des poignées de main
// (SDP, ICE) : la vidéo va d'un navigateur à l'autre en direct. C'est ce qui
// rend la chose tenable sur un petit VPS — sans quoi il faudrait transcoder un
// flux vidéo par spectateur.
//
// ------------------------------------------------------------ le peerId
// On indexe les spectateurs par PEER, pas par utilisateur : le même compte peut
// avoir deux onglets ouverts, et une réponse SDP destinée à l'un ferait
// s'effondrer la connexion de l'autre. `emitTo` s'adresse à un utilisateur (tous
// ses onglets) ; c'est le `peerId` porté par le message qui dit à quel onglet il
// s'adresse vraiment.

// Le plafond de spectateurs. L'hôte tient UNE connexion par personne : à sept,
// c'est sept fois son débit montant, et l'image se dégrade pour tout le monde
// sans qu'il comprenne pourquoi. Au-delà il faudrait un relais (SFU) — un autre
// métier, une autre facture. Le chiffre est aussi côté client (lib/gbaStream.js)
// pour l'affichage, mais c'est ICI qu'il est opposable.
export const MAX_VIEWERS = 6;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1

export function makeCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i += 1)
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// code → salon
const rooms = new Map();
// userId → code, pour qu'un hôte ne tienne jamais deux salons à la fois (un
// deuxième onglet remplacerait le premier, et les spectateurs regarderaient un
// écran mort sans comprendre pourquoi).
const byHost = new Map();

// Un salon dont l'hôte n'a plus donné signe de vie est mort. L'hôte bat toutes
// les 30 secondes (voir le client) ; on laisse passer deux battements ratés.
const TTL = 75_000;

// LES SPECTATEURS BATTENT AUSSI, et pour une raison précise : le « je m'en vais »
// est envoyé au moment où l'onglet se ferme, c'est-à-dire exactement le moment où
// une requête a le plus de chances de ne jamais partir (onglet tué, machine en
// veille, navigateur qui plante). Sans battement, ces absents restaient affichés
// chez l'hôte en « Connexion… » pour toujours, et occupaient une des six places.
const VIEWER_TTL = 75_000;

// Retire les spectateurs qui ne battent plus. Rend `true` si la liste a changé —
// l'appelant s'en sert pour prévenir le salon.
export function pruneViewers(room) {
  const now = Date.now();
  let changed = false;
  for (const [peerId, v] of room.viewers) {
    if (now - v.at <= VIEWER_TTL) continue;
    room.viewers.delete(peerId);
    room.hands.delete(peerId);
    // La manette revient à l'hôte : la laisser à un fantôme bloquerait la
    // console pour tout le monde.
    if (room.controller === peerId) room.controller = null;
    changed = true;
  }
  return changed;
}

// Le battement d'un spectateur : il ne fait que dire « je suis toujours là ».
// C'est volontairement une route À PART de `join` — un `join` prévient l'hôte,
// qui referait une offre toutes les trente secondes.
export function touchViewer(room, peerId) {
  const v = room.viewers.get(peerId);
  if (!v) return false;
  v.at = Date.now();
  return true;
}

export function open({ hostId, host, slug, title, cover, peerId }) {
  close(byHost.get(String(hostId))); // un hôte, un salon
  const code = makeCode();
  const room = {
    code,
    hostId: String(hostId),
    host, // { id, username, avatar } — figé à l'ouverture, ça ne bouge pas
    slug,
    title,
    cover: cover || null,
    hostPeer: peerId,
    at: Date.now(),
    beat: Date.now(),
    viewers: new Map(), // peerId → { userId, username, avatar, at }
    controller: null, // le peerId qui a la manette, s'il y en a un
    hands: new Set(), // les peerId qui l'ont demandée
  };
  rooms.set(code, room);
  byHost.set(String(hostId), code);
  return room;
}

export function get(code) {
  const room = rooms.get(String(code || ""));
  if (!room) return null;
  if (Date.now() - room.beat > TTL) {
    close(room.code);
    return null;
  }
  pruneViewers(room);
  return room;
}

export function beat(code) {
  const room = rooms.get(String(code || ""));
  if (!room) return false;
  room.beat = Date.now();
  return true;
}

export function close(code) {
  const room = rooms.get(String(code || ""));
  if (!room) return null;
  rooms.delete(room.code);
  if (byHost.get(room.hostId) === room.code) byHost.delete(room.hostId);
  return room;
}

export function codeOfHost(hostId) {
  const code = byHost.get(String(hostId));
  return get(code) ? code : null;
}

export function join(room, peerId, user) {
  room.viewers.set(peerId, {
    userId: String(user.id),
    username: user.username,
    avatar: user.avatar || null,
    at: Date.now(),
  });
}

export function leave(room, peerId) {
  room.viewers.delete(peerId);
  room.hands.delete(peerId);
  // LA MANETTE REVIENT À L'HÔTE quand celui qui la tenait s'en va. Sans ça, le
  // salon reste bloqué sur un joueur parti : plus personne ne peut jouer, et
  // l'hôte ne comprend pas pourquoi son propre écran ne répond plus.
  if (room.controller === peerId) room.controller = null;
}

// Ce qu'on rend au client. Les `peerId` en font partie : c'est l'hôte qui doit
// savoir à qui envoyer son offre, et le spectateur qui doit reconnaître la
// sienne.
export function serialize(room, forPeer = null) {
  return {
    code: room.code,
    host: room.host,
    slug: room.slug,
    title: room.title,
    cover: room.cover,
    hostPeer: room.hostPeer,
    startedAt: room.at,
    controller: room.controller,
    hasPad: !!room.controller,
    iHaveThePad: !!forPeer && room.controller === forPeer,
    viewers: [...room.viewers.entries()].map(([peerId, v]) => ({
      peerId,
      userId: v.userId,
      username: v.username,
      avatar: v.avatar,
      hand: room.hands.has(peerId),
      pad: room.controller === peerId,
    })),
  };
}

// Les salons ouverts par un lot de gens (ceux qu'on suit) : c'est ce qui remplit
// la ligne « en direct » du rail d'activité.
export function liveAmong(userIds) {
  const wanted = new Set((userIds || []).map(String));
  const out = [];
  for (const room of rooms.values()) {
    if (!wanted.has(room.hostId)) continue;
    if (Date.now() - room.beat > TTL) continue;
    out.push({
      code: room.code,
      host: room.host,
      title: room.title,
      cover: room.cover,
      slug: room.slug,
      viewers: room.viewers.size,
      startedAt: room.at,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

// Tout le monde dans le salon, hôte compris : la liste à qui rediffuser.
export function everyone(room) {
  const ids = new Set([room.hostId]);
  for (const v of room.viewers.values()) ids.add(v.userId);
  return ids;
}

// Ménage : `get` fait déjà expirer à la lecture, ce balayage ne sert qu'à ne pas
// garder en mémoire les salons que plus personne ne consulte.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()])
    if (now - room.beat > TTL) close(room.code);
}, 60_000);
sweep.unref?.();
