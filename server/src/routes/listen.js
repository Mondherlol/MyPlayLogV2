import express from "express";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo } from "../lib/realtime.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import {
  open,
  get,
  setState,
  cleanProposal,
  close,
  codeOfHost,
  join,
  touch,
  leave,
  pruneListeners,
  serialize,
  liveAmong,
  everyone,
} from "../lib/listenRooms.js";

// ======================================================================
//  Écouter à plusieurs — la même piste, à la même seconde
// ======================================================================
// Quelqu'un lance une OST depuis le mini-lecteur, ouvre sa séance, et ses
// abonnés voient dans l'onglet Activité « untel écoute ça » avec un bouton
// pour se brancher dessus. Une fois branché, on suit : changement de piste,
// pause, saut dans la barre — tout arrive tel quel.
//
// ------------------------------------------------- ce que le serveur transporte
// PAS UN OCTET D'AUDIO. Chaque auditeur lit la piste de son côté (c'est la
// même vidéo YouTube, ou le même flux extrait par /api/audio) ; le serveur ne
// fait circuler qu'un repère : « piste X, position Y, ça joue ». C'est ce qui
// rend la chose gratuite à l'échelle — contrairement à la diffusion GBA, où
// l'hôte paie un flux vidéo par spectateur.
//
// ---------------------------------------------------- un seul nom d'évènement
// Tout passe par le flux SSE déjà ouvert (lib/realtime.js), sous l'évènement
// `listen`, avec le `kind` dans la charge — même économie que la watchparty et
// les salons de versus :
//
//   kind: state     la lecture a changé (piste, pause, saut) → à rattraper ;
//   kind: room      la liste des auditeurs (ou le réglage de file) a bougé ;
//   kind: add       une piste proposée, POUR L'HÔTE SEUL — c'est lui qui
//                   l'ajoute à sa file, le serveur n'en tient pas ;
//   kind: added     la même nouvelle, pour tout le monde (accusé de réception) ;
//   kind: end       l'hôte a fermé la séance.
//
// ------------------------------------------------------------ qui mène
// L'HÔTE, ET LUI SEUL. Un auditeur qui pourrait mettre en pause chez les autres
// serait une bonne idée sur le papier et un cauchemar à trois personnes : on ne
// saurait jamais qui vient d'arrêter la musique. Ici la règle tient en une
// phrase — c'est sa séance, il choisit ; les autres suivent ou s'en vont.
//
// LA FILE EST LA SEULE EXCEPTION, et elle se demande : l'hôte peut l'ouvrir aux
// invités (`openQueue`), qui PROPOSENT alors des morceaux — ajoutés à la fin,
// jamais à la place de ce qui joue. Proposer la suite n'est pas prendre le
// volant, et c'est précisément la nuance qui rend la chose vivable.

const router = express.Router();

// ----------------------------------------------------------------------
//  GET /:code/preview — ce qu'on peut dire d'une séance SANS être connecté
// ----------------------------------------------------------------------
// AVANT `requireAuth`, et c'est tout l'intérêt : le lien d'une séance se colle
// dans un salon Discord, donc il tombe entre les mains de gens qui n'ont pas
// de compte. Leur répondre 401 ferait une page morte ; on leur montre ce qui
// se joue et l'invitation à ouvrir un compte pour écouter.
//
// On ne rend QUE le nécessaire à cet aperçu : l'hôte, la piste, l'état. Ni la
// file, ni la position, ni la liste des auditeurs — un lien transféré ne donne
// pas le droit de savoir qui écoute.
router.get("/:code/preview", (req, res) => {
  const room = get(req.params.code);
  if (!room || !room.track) return res.json({ state: "gone" });
  res.json({
    state: "live",
    code: room.code,
    host: room.host,
    track: {
      name: room.track.name,
      artist: room.track.artist,
      artwork: room.track.artwork,
      gameName: room.track.gameName,
    },
    playing: room.playing,
    listeners: room.listeners.size,
    startedAt: room.at,
  });
});

router.use(requireAuth);

const toRoom = (room, kind, payload = {}) =>
  emitTo(everyone(room), "listen", { code: room.code, kind, ...payload });

// `requireAuth` ne pose que `req.userId` : le nom et l'avatar se lisent en base.
async function whoami(req) {
  const u = await User.findById(req.userId).select("username avatar").lean();
  return {
    id: String(req.userId),
    username: u?.username || "?",
    avatar: u?.avatar || null,
  };
}

// ----------------------------------------------------------------------
//  POST /  — j'ouvre ma séance
// ----------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    // ON PRÉVIENT L'ANCIENNE SÉANCE. Un hôte qui recharge sa page en rouvre une
    // neuve (`open` referme la précédente) : sans ce mot, ceux qui écoutaient
    // resteraient branchés sur un salon mort jusqu'à l'expiration du battement,
    // sans comprendre pourquoi la piste ne change plus.
    const previous = get(codeOfHost(req.userId));
    if (previous)
      emitTo(everyone(previous), "listen", { code: previous.code, kind: "end" });

    const host = await whoami(req);
    const room = open({ hostId: req.userId, host, state: req.body || {} });
    if (!room.track) {
      close(room.code);
      return res.status(400).json({ error: "Lance une piste avant d'ouvrir la séance." });
    }
    res.json({ room: serialize(room) });
  } catch (err) {
    console.error("listen open error:", err.message);
    res.status(500).json({ error: "La séance n'a pas pu s'ouvrir." });
  }
});

// ----------------------------------------------------------------------
//  POST /:code/state — voilà où j'en suis
// ----------------------------------------------------------------------
// C'est À LA FOIS le battement de l'hôte et son fil d'annonces. Les deux au
// même endroit, et c'est délibéré : le client envoie de toute façon un repère
// toutes les vingt secondes pour rester en vie, autant qu'il porte la position
// — et `setState` sait distinguer un simple écoulement du temps d'un vrai
// changement. Résultat : les auditeurs ne sont réveillés que quand il se passe
// quelque chose.
router.post("/:code/state", (req, res) => {
  const room = get(req.params.code);
  if (!room || room.hostId !== String(req.userId))
    return res.status(404).json({ error: "Séance fermée." });

  const changed = setState(room, req.body || {});
  // La piste est tombée à rien (le lecteur a été fermé) : la séance n'a plus
  // d'objet, on l'éteint plutôt que de laisser des gens branchés sur du vide.
  if (!room.track) {
    toRoom(room, "end", {});
    close(room.code);
    return res.json({ ok: true, ended: true });
  }
  if (pruneListeners(room)) toRoom(room, "room", { room: serialize(room) });
  if (changed) toRoom(room, "state", { room: serialize(room) });
  res.json({ room: serialize(room) });
});

// ----------------------------------------------------------------------
//  GET /live — qui écoute quoi, parmi les gens que je suis
// ----------------------------------------------------------------------
router.get("/live", async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    res.json({ rooms: liveAmong(me?.following || []) });
  } catch (err) {
    console.error("listen live error:", err.message);
    res.status(500).json({ error: "Impossible de lire les séances d'écoute." });
  }
});

router.get("/:code", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette séance est terminée." });
  res.json({ room: serialize(room) });
});

// ----------------------------------------------------------------------
//  POST /:code/join — je me branche
// ----------------------------------------------------------------------
// La réponse porte l'état complet, position comprise : c'est avec ça que le
// lecteur de l'arrivant démarre AU BON ENDROIT de la piste, et pas au début.
router.post("/:code/join", async (req, res) => {
  try {
    const room = get(req.params.code);
    if (!room) return res.status(404).json({ error: "Cette séance est terminée." });
    // L'hôte n'est pas auditeur de sa propre séance : il s'y retrouverait dans
    // sa propre liste, et son lecteur essaierait de se suivre lui-même.
    if (room.hostId === String(req.userId))
      return res.json({ room: serialize(room), host: true });

    const me = await whoami(req);
    join(room, me);
    toRoom(room, "room", { room: serialize(room), joined: me });
    res.json({ room: serialize(room) });
  } catch (err) {
    console.error("listen join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre la séance." });
  }
});

// Le battement d'un auditeur. À PART du `join`, qui lui prévient tout le monde :
// un `join` toutes les vingt secondes ferait clignoter la liste des auditeurs.
router.post("/:code/ping", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette séance est terminée." });
  if (pruneListeners(room)) toRoom(room, "room", { room: serialize(room) });
  if (!touch(room, req.userId))
    return res.status(409).json({ error: "Tu n'es plus dans la séance." });
  res.json({ ok: true });
});

router.post("/:code/leave", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.json({ ok: true });
  if (leave(room, req.userId)) toRoom(room, "room", { room: serialize(room) });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/open-queue — l'hôte ouvre (ou referme) sa file
// ----------------------------------------------------------------------
// DEUX DÉCISIONS SÉPARÉES, et il fallait qu'elles le restent : ouvrir une
// séance, c'est accepter qu'on écoute ce que je choisis ; ouvrir la FILE, c'est
// accepter qu'on choisisse à ma place. La seconde ne doit jamais être un effet
// de bord de la première — d'où ce réglage à part, fermé par défaut.
router.post("/:code/open-queue", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette séance est terminée." });
  if (room.hostId !== String(req.userId))
    return res.status(403).json({ error: "Seul l'hôte ouvre sa file." });
  room.openQueue = req.body?.open !== false;
  toRoom(room, "room", { room: serialize(room) });
  res.json({ ok: true, openQueue: room.openQueue });
});

// ----------------------------------------------------------------------
//  POST /:code/queue — un invité propose une piste
// ----------------------------------------------------------------------
// LE SERVEUR NE TIENT PAS LA FILE, et c'est délibéré : la file EST celle du
// lecteur de l'hôte (son navigateur), la seule qui joue vraiment. En tenir une
// copie ici ferait deux vérités à réconcilier — celle qui décide et celle qui
// croit décider — pour le plaisir d'avoir un état de plus à maintenir.
//
// On se contente donc de FAIRE PASSER la demande à l'hôte, qui l'ajoute à sa
// file et la rediffuse dans son prochain repère (kind: state). Ce qu'on vérifie
// ici, c'est le droit : être dans la séance, et que l'hôte ait ouvert sa file.
router.post("/:code/queue", async (req, res) => {
  try {
    const room = get(req.params.code);
    if (!room) return res.status(404).json({ error: "Cette séance est terminée." });

    const me = String(req.userId);
    const isHost = room.hostId === me;
    if (!isHost && !room.listeners.has(me))
      return res.status(403).json({ error: "Rejoins la séance pour proposer une piste." });
    if (!isHost && !room.openQueue)
      return res
        .status(403)
        .json({ error: "L'hôte n'a pas ouvert sa file aux invités." });

    const track = cleanProposal(req.body?.track);
    if (!track) return res.status(400).json({ error: "Piste illisible." });
    if ((room.queue || []).some((t) => t.videoId === track.videoId))
      return res.status(409).json({ error: "Déjà dans la file." });

    const who = room.listeners.get(me);
    const by = {
      id: me,
      username: isHost ? room.host?.username || "" : who?.username || "",
    };
    // À L'HÔTE POUR QU'IL L'AJOUTE, à tout le monde pour que ça se voie. Les
    // deux messages partent ensemble : l'ajout réel n'arrivera qu'au repère
    // suivant, et sans le second, celui qui vient de proposer resterait devant
    // un bouton qui n'a rien répondu.
    emitTo([room.hostId], "listen", { code: room.code, kind: "add", track, by });
    toRoom(room, "added", { track, by });
    res.json({ ok: true });
  } catch (err) {
    console.error("listen queue error:", err.message);
    res.status(500).json({ error: "Proposition non transmise." });
  }
});

// ----------------------------------------------------------------------
//  POST /:code/invite — « viens écouter ça »
// ----------------------------------------------------------------------
// Deux destinations d'un seul geste, comme les invitations de versus : des
// personnes (carte en message privé) et des groupes de discussion (carte dans
// le fil commun). On ne peut écrire qu'à ses abonnés — c'est la règle de la
// messagerie, pas une règle de l'écoute.
//
// LA CARTE EST REMPLIE ICI, jamais par le client : c'est le serveur qui sait
// ce qui passe dans la séance à la seconde où l'invitation part, et une carte
// est du contenu que d'autres vont lire.
router.post("/:code/invite", async (req, res) => {
  try {
    const room = get(req.params.code);
    if (!room) return res.status(404).json({ error: "Cette séance est terminée." });
    // Inviter chez quelqu'un d'autre, non : on n'invite qu'à une séance dont on
    // fait partie (la sienne, ou celle qu'on écoute).
    const inside =
      room.hostId === String(req.userId) || room.listeners.has(String(req.userId));
    if (!inside)
      return res.status(403).json({ error: "Rejoins la séance avant d'inviter." });

    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [
      ...new Set((req.body?.conversationIds || []).map(String)),
    ].slice(0, 10);
    if (!userIds.length && !conversationIds.length)
      return res.status(400).json({ error: "Personne à inviter." });

    const targets = await User.find({ _id: { $in: userIds } })
      .select("username following")
      .lean();

    const card = {
      code: room.code,
      hostName: room.host?.username || "",
      trackName: room.track?.name || "",
      artist: room.track?.artist || "",
      artwork: room.track?.artwork || null,
      gameName: room.track?.gameName || "",
      people: room.listeners.size,
    };
    const text = String(req.body?.text || "").slice(0, 300);

    const sent = [];
    const skipped = [];
    for (const target of targets) {
      const allowed = (target.following || []).some(
        (id) => String(id) === String(req.userId)
      );
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await deliverCard({ fromId: req.userId, toId: target._id, text, listen: card });
      sent.push({ id: String(target._id), username: target.username });
    }
    const groups = [];
    for (const cid of conversationIds) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await deliverCardToConversation({
        fromId: req.userId,
        conversationId: cid,
        text,
        listen: card,
      });
      if (ok) groups.push(cid);
    }

    res.json({ sent, skipped, groups });
  } catch (err) {
    console.error("listen invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

router.post("/:code/end", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.json({ ok: true });
  if (room.hostId !== String(req.userId))
    return res.status(403).json({ error: "Seul l'hôte ferme la séance." });
  toRoom(room, "end", {});
  close(room.code);
  res.json({ ok: true });
});

export default router;
