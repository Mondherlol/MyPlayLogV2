// ======================================================================
//  Les séances d'écoute — « viens, on écoute la même chose »
// ======================================================================
// Une personne lance une OST, d'autres se branchent dessus et entendent la
// MÊME piste, à la MÊME seconde. C'est ce que ce fichier tient : qui diffuse
// quoi, où il en est, et qui écoute avec lui.
//
// -------------------------------------------------------------- rien en base
// Même raisonnement que le statut d'activité (lib/liveStatus.js) et les salons
// GBA (lib/gbaRooms.js) : une séance n'existe que tant que l'onglet de l'hôte
// est ouvert. Un document Mongo par séance nous laisserait une collection de
// salons morts à balayer, pour une donnée dont la durée de vie utile est celle
// d'une écoute.
//
// ------------------------------------------------- le son ne passe pas par ici
// LE SERVEUR NE RELAIE AUCUN AUDIO. Chaque auditeur lit la piste DE SON CÔTÉ
// (même vidéo YouTube, même flux extrait) ; tout ce qui circule, c'est « voici
// la piste, voici la position ». Ça tient en quelques centaines d'octets et
// ça marche à autant de personnes qu'on veut — contrairement à la diffusion
// GBA, qui elle coûte un flux vidéo par spectateur.
//
// ------------------------------------------------------------- la position
// C'EST LE POINT DÉLICAT, et c'est pour lui que le salon garde `sampledAt`.
// L'hôte n'envoie pas sa position en continu (ce serait une requête par
// seconde) : il envoie un REPÈRE — « à cet instant j'étais à 1 min 12 » — et
// tout le monde extrapole. Tant que la lecture continue, la position exacte se
// recalcule sans qu'un seul octet ne circule ; on ne reparle qu'aux vrais
// évènements (changement de piste, pause, saut).
//
// L'horloge de référence est CELLE DU SERVEUR, jamais celle de l'hôte : un
// navigateur dont la montre retarde de deux minutes ferait sinon sauter tous
// ses auditeurs deux minutes plus loin dans la piste.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1

export function makeCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i += 1)
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// code → séance
const rooms = new Map();
// userId → code : un hôte ne tient qu'une séance à la fois (un second onglet
// remplacerait le premier, et les auditeurs suivraient un lecteur mort).
const byHost = new Map();

// L'hôte bat toutes les 20 secondes (voir le client) ; on laisse passer deux
// battements ratés avant de déclarer la séance finie.
const TTL = 65_000;
// Les auditeurs battent aussi : le « je m'en vais » part au moment où l'onglet
// se ferme, c'est-à-dire exactement le moment où une requête a le plus de
// chances de ne jamais partir.
const LISTENER_TTL = 65_000;

// La file transportée est TAILLÉE : une playlist d'OST peut faire deux cents
// pistes, et l'auditeur n'a besoin que de savoir ce qui vient. Au-delà, il
// recevra la suite au changement de piste — l'hôte réémet son état à chaque
// fois.
const MAX_QUEUE = 60;

// Une piste réduite à ce qui se joue et s'affiche. On ne recopie PAS l'objet du
// client tel quel : il y passerait n'importe quoi, et cet objet est ensuite
// rendu à tous les auditeurs.
function cleanTrack(raw) {
  const videoId = String(raw?.videoId || "").slice(0, 20);
  if (!videoId || !/^[\w-]+$/.test(videoId)) return null;
  const str = (v, n) => (v == null ? null : String(v).slice(0, n));
  return {
    id: str(raw.id, 60) || `v-${videoId}`,
    videoId,
    name: str(raw.name, 160) || "Sans titre",
    artist: str(raw.artist, 120) || "",
    artwork: /^https?:\/\//.test(String(raw.artwork || ""))
      ? String(raw.artwork).slice(0, 400)
      : null,
    gameId: raw.gameId == null ? null : str(raw.gameId, 40),
    gameName: str(raw.gameName, 160),
  };
}

function cleanQueue(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_QUEUE).map(cleanTrack).filter(Boolean);
}

// D'où vient la file (« Playlist Zelda »), pour que l'auditeur sache dans quoi
// il vient d'atterrir. Le lien est vérifié comme un chemin interne — sans quoi
// un hôte pourrait afficher chez ses amis un lien vers n'importe où.
function cleanSource(src) {
  if (!src) return null;
  const href = String(src.href || "");
  const ok = href.startsWith("/") && !href.startsWith("//") && href.length <= 120;
  return {
    label: String(src.label || "").slice(0, 80) || "Écoute en cours",
    href: ok ? href : null,
  };
}

// L'état de lecture posé par l'hôte. Rend `true` si quelque chose a changé
// AUTREMENT QUE PAR L'ÉCOULEMENT DU TEMPS — c'est ce qui décide si l'on
// réveille les auditeurs ou si le battement passe en silence.
export function setState(room, { track, queue, index, playing, positionMs, source }) {
  const next = cleanTrack(track);
  const prev = room.track;
  const pos = Math.max(0, Math.min(Number(positionMs) || 0, 24 * 3600 * 1000));
  const isPlaying = !!playing;

  // Là où l'hôte DEVRAIT en être si rien n'avait bougé depuis son dernier
  // repère. Un écart de plus de trois secondes, c'est un saut dans la piste
  // (barre de progression) — donc quelque chose à rattraper chez les autres.
  const expected = positionAt(room, Date.now());
  const jumped = Math.abs(expected - pos) > 3000;

  const changed =
    prev?.videoId !== next?.videoId ||
    room.playing !== isPlaying ||
    jumped;

  room.track = next;
  if (Array.isArray(queue)) room.queue = cleanQueue(queue);
  room.index = Math.max(0, Number(index) || 0);
  room.playing = isPlaying;
  room.positionMs = pos;
  room.sampledAt = Date.now();
  if (source !== undefined) room.source = cleanSource(source);
  room.beat = Date.now();
  return changed;
}

// La position à un instant donné : le repère, plus le temps écoulé depuis —
// mais seulement si ça joue (en pause, l'aiguille ne bouge pas).
export function positionAt(room, now = Date.now()) {
  if (!room?.track) return 0;
  if (!room.playing) return room.positionMs;
  return room.positionMs + (now - room.sampledAt);
}

export function open({ hostId, host, state }) {
  close(byHost.get(String(hostId))); // un hôte, une séance
  const code = makeCode();
  const room = {
    code,
    hostId: String(hostId),
    host, // { id, username, avatar } — figé à l'ouverture
    at: Date.now(),
    beat: Date.now(),
    track: null,
    queue: [],
    index: 0,
    playing: false,
    positionMs: 0,
    sampledAt: Date.now(),
    source: null,
    listeners: new Map(), // userId → { username, avatar, at }
  };
  rooms.set(code, room);
  byHost.set(String(hostId), code);
  setState(room, state || {});
  return room;
}

// Retire les auditeurs qui ne battent plus. Rend `true` si la liste a changé.
export function pruneListeners(room) {
  const now = Date.now();
  let changed = false;
  for (const [id, l] of room.listeners) {
    if (now - l.at <= LISTENER_TTL) continue;
    room.listeners.delete(id);
    changed = true;
  }
  return changed;
}

export function get(code) {
  const room = rooms.get(String(code || ""));
  if (!room) return null;
  if (Date.now() - room.beat > TTL) {
    close(room.code);
    return null;
  }
  pruneListeners(room);
  return room;
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

export function join(room, user) {
  room.listeners.set(String(user.id), {
    username: user.username,
    avatar: user.avatar || null,
    at: Date.now(),
  });
}

export function touch(room, userId) {
  const l = room.listeners.get(String(userId));
  if (!l) return false;
  l.at = Date.now();
  return true;
}

export function leave(room, userId) {
  return room.listeners.delete(String(userId));
}

// Ce qu'on rend au client. La position est calculée À L'INSTANT DE L'ENVOI :
// c'est la seule façon pour l'auditeur de tomber juste, quel que soit le temps
// passé depuis le dernier repère de l'hôte.
export function serialize(room) {
  return {
    code: room.code,
    host: room.host,
    track: room.track,
    queue: room.queue,
    index: room.index,
    playing: room.playing,
    positionMs: positionAt(room),
    source: room.source,
    startedAt: room.at,
    listeners: [...room.listeners.entries()].map(([id, l]) => ({
      id,
      username: l.username,
      avatar: l.avatar,
    })),
  };
}

// Les séances ouvertes par un lot de gens (ceux qu'on suit) : c'est ce qui
// remplit la section « à l'écoute » du rail d'activité.
export function liveAmong(userIds) {
  const wanted = new Set((userIds || []).map(String));
  const out = [];
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!wanted.has(room.hostId)) continue;
    if (now - room.beat > TTL) continue;
    if (!room.track) continue; // une séance sans piste n'a rien à proposer
    out.push({
      code: room.code,
      host: room.host,
      track: room.track,
      playing: room.playing,
      source: room.source,
      listeners: room.listeners.size,
      startedAt: room.at,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

// Tout le monde dans la séance, hôte compris : la liste à qui rediffuser.
export function everyone(room) {
  const ids = new Set([room.hostId]);
  for (const id of room.listeners.keys()) ids.add(id);
  return ids;
}

// Ménage : `get` fait déjà expirer à la lecture, ce balayage ne sert qu'à ne
// pas garder en mémoire les séances que plus personne ne consulte.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()])
    if (now - room.beat > TTL) close(room.code);
}, 60_000);
sweep.unref?.();
