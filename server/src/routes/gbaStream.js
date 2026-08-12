import express from "express";
import User from "../models/User.js";
import CollectionMedia from "../models/CollectionMedia.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeature } from "../lib/features.js";
import { emitTo } from "../lib/realtime.js";
import {
  MAX_VIEWERS,
  open,
  get,
  pruneViewers,
  touchViewer,
  beat,
  close,
  codeOfHost,
  join,
  leave,
  serialize,
  liveAmong,
  everyone,
} from "../lib/gbaRooms.js";

// ======================================================================
//  « Viens voir » — diffuser sa partie GBA, et passer la manette
// ======================================================================
// C'est la watchparty appliquée à la console : quelqu'un joue, les autres
// regardent en direct, et l'hôte peut PASSER LA MANETTE à un spectateur.
//
// ------------------------------------------------- ce que ce serveur fait, et
// ------------------------------------------------- surtout ce qu'il ne fait pas
// IL NE VOIT JAMAIS L'IMAGE. La vidéo va d'un navigateur à l'autre (WebRTC) ;
// ici on ne relaie que les POIGNÉES DE MAIN — une offre SDP, une réponse, des
// candidats ICE — plus quelques ordres de salon. C'est ce qui rend la chose
// tenable : un VPS qui relaierait un flux vidéo par spectateur tomberait à la
// troisième personne, alors qu'un relais de signalisation coûte quelques
// centaines d'octets par connexion, une seule fois.
//
// TOUT PASSE PAR LE FLUX SSE DÉJÀ OUVERT (lib/realtime.js), sous UN seul nom
// d'évènement, `gbastream`, avec le `kind` dans la charge — même économie que la
// watchparty et les salons de versus :
//
//   kind: signal    une offre / réponse / candidat ICE, adressée à un peer ;
//   kind: joined    quelqu'un est entré (l'hôte doit lui faire une offre) ;
//   kind: left      quelqu'un est parti ;
//   kind: room      l'état du salon a changé (manette, mains levées) ;
//   kind: input     un appui de bouton du spectateur qui tient la manette ;
//   kind: end       l'hôte a éteint.
//
// ------------------------------------------------------------ la manette
// LE CHEMIN D'ENTRÉE EXISTAIT DÉJÀ, et c'est ce qui rend ce mode presque
// gratuit : côté client, TOUTE commande passe déjà par une seule fonction
// (`pressButton` → `gameManager.simulateInput`), qu'elle vienne du clavier ou de
// la manette à l'écran. Un appui distant emprunte exactement la même porte.
//
// SEUL CELUI QUI TIENT LA MANETTE EST ÉCOUTÉ, et c'est vérifié ICI, pas chez
// l'hôte : un client peut être trafiqué, et sans ce contrôle n'importe quel
// spectateur pourrait appuyer sur START pendant le combat final de quelqu'un
// d'autre.

const router = express.Router();
// Le rayon vidéo et ses diffusions s'allument ensemble : diffuser une cartouche
// n'a de sens que si la collection est ouverte.
router.use(requireAuth, requireFeature("collection"));

// Les index de boutons acceptés : ceux de libretro pour une GBA (voir
// client/src/lib/gbaInput.js). Tout le reste est refusé — on ne laisse pas un
// client choisir un index arbitraire dans l'API du cœur d'émulation.
const BUTTONS = new Set([0, 2, 3, 4, 5, 6, 7, 8, 10, 11]);

const toRoom = (room, kind, payload = {}) =>
  emitTo(everyone(room), "gbastream", { code: room.code, kind, ...payload });

// `requireAuth` ne pose que `req.userId` : le nom et l'avatar se lisent en base.
// Une requête de plus à l'entrée d'un salon, et une seule fois — l'identité est
// ensuite figée dans le salon (en mémoire), pas relue à chaque évènement.
async function whoami(req) {
  const u = await User.findById(req.userId).select("username avatar").lean();
  return {
    id: String(req.userId),
    username: u?.username || "?",
    avatar: u?.avatar || null,
  };
}

// Le peer qui parle : un onglet, pas un compte. Sans lui, deux onglets du même
// spectateur se voleraient leurs poignées de main.
const peerOf = (req) => String(req.body?.peerId || req.query?.peerId || "").slice(0, 40);

// ----------------------------------------------------------------------
//  POST /  — j'allume, et j'ouvre les portes
// ----------------------------------------------------------------------
router.post("/", async (req, res) => {
  try {
    const peerId = peerOf(req);
    if (!peerId) return res.status(400).json({ error: "Onglet non identifié." });
    const slug = String(req.body?.slug || "");
    // On lit le titre EN BASE plutôt que de croire le client : c'est le libellé
    // que verront tous les abonnés de l'hôte dans leur rail d'activité.
    const media = await CollectionMedia.findOne({ slug }).select("title cover slug").lean();
    if (!media) return res.status(404).json({ error: "Cartouche inconnue." });

    // ON PRÉVIENT L'ANCIENNE SALLE. Un hôte qui recharge sa page rouvre un salon
    // neuf (`open` referme le précédent) : sans ce mot, ceux qui regardaient
    // resteraient devant une image figée jusqu'à l'expiration du battement,
    // sans comprendre que la diffusion a simplement changé d'adresse.
    const previous = get(codeOfHost(req.userId));
    if (previous) emitTo(everyone(previous), "gbastream", { code: previous.code, kind: "end" });

    const user = await User.findById(req.userId).select("username avatar").lean();
    const room = open({
      hostId: req.userId,
      host: {
        id: String(req.userId),
        username: user?.username || "?",
        avatar: user?.avatar || null,
      },
      slug: media.slug,
      title: media.title,
      cover: media.cover || null,
      peerId,
    });
    res.json({ room: serialize(room, peerId) });
  } catch (err) {
    console.error("gba stream open error:", err.message);
    res.status(500).json({ error: "La diffusion n'a pas pu s'ouvrir." });
  }
});

// Le battement de l'hôte : tant qu'il bat, le salon vit. C'est la seule chose
// qui distingue une diffusion en cours d'un onglet fermé brutalement.
router.post("/:code/beat", (req, res) => {
  const room = get(req.params.code);
  if (!room || room.hostId !== String(req.userId))
    return res.status(404).json({ error: "Salon fermé." });
  beat(room.code);
  res.json({ room: serialize(room, peerOf(req)) });
});

// ----------------------------------------------------------------------
//  GET /live — qui diffuse, parmi les gens que je suis
// ----------------------------------------------------------------------
// Sert la ligne « en direct » du rail d'activité. Même portée que le reste de
// cet onglet : les gens que JE SUIS.
router.get("/live", async (req, res) => {
  try {
    const meDoc = await User.findById(req.userId).select("following").lean();
    res.json({ rooms: liveAmong(meDoc?.following || []) });
  } catch (err) {
    console.error("gba stream live error:", err.message);
    res.status(500).json({ error: "Impossible de lire les diffusions." });
  }
});

// ----------------------------------------------------------------------
//  GET /:code — l'état du salon
// ----------------------------------------------------------------------
router.get("/:code", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
  res.json({ room: serialize(room, peerOf(req)) });
});

// ----------------------------------------------------------------------
//  POST /:code/join — j'entre, et je me fais annoncer à l'hôte
// ----------------------------------------------------------------------
// C'EST L'HÔTE QUI FAIT L'OFFRE, jamais le spectateur : c'est lui qui a le flux,
// et c'est le seul qui sait quand son écran est prêt à être partagé. Le
// spectateur ne fait qu'entrer et attendre.
router.post("/:code/join", async (req, res) => {
  try {
    const room = get(req.params.code);
    if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
    const peerId = peerOf(req);
    if (!peerId) return res.status(400).json({ error: "Onglet non identifié." });
    // L'hôte qui recharge sa propre page n'entre pas dans son salon en
    // spectateur : il se retrouverait à se regarder lui-même, et son écran
    // apparaîtrait dans sa propre liste de gens à qui envoyer une offre.
    if (room.hostId === String(req.userId) && peerId === room.hostPeer)
      return res.json({ room: serialize(room, peerId) });

    if (!room.viewers.has(peerId) && room.viewers.size >= MAX_VIEWERS)
      return res
        .status(409)
        .json({ error: "Cette diffusion est complète — réessaie dans un moment." });

    const viewer = await whoami(req);
    join(room, peerId, viewer);
    toRoom(room, "joined", { peerId, viewer });
    toRoom(room, "room", { room: serialize(room) });
    res.json({ room: serialize(room, peerId) });
  } catch (err) {
    console.error("gba stream join error:", err.message);
    res.status(500).json({ error: "Impossible d'entrer dans la diffusion." });
  }
});

// Le battement d'un spectateur. À PART de `join`, qui lui prévient l'hôte : un
// `join` toutes les trente secondes referait une offre toutes les trente
// secondes. Ici on ne fait que dire « je suis toujours là ».
router.post("/:code/ping", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
  // `get` a déjà fait le ménage : s'il a emporté quelqu'un, le salon doit
  // l'apprendre — c'est le seul moment où l'on repasse régulièrement par ici.
  if (pruneViewers(room)) toRoom(room, "room", { room: serialize(room) });
  if (!touchViewer(room, peerOf(req)))
    return res.status(409).json({ error: "Tu n'es plus dans le salon." });
  res.json({ ok: true });
});

router.post("/:code/leave", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.json({ ok: true });
  const peerId = peerOf(req);
  leave(room, peerId);
  toRoom(room, "left", { peerId });
  toRoom(room, "room", { room: serialize(room) });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/signal — la poignée de main, relayée telle quelle
// ----------------------------------------------------------------------
// On ne lit pas le contenu (c'est du SDP, ça ne nous regarde pas), mais on
// vérifie DEUX choses : que celui qui parle est dans le salon, et que le
// destinataire y est aussi. Sans quoi le salon deviendrait un relais de messages
// arbitraires entre comptes.
router.post("/:code/signal", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });

  const from = peerOf(req);
  const to = String(req.body?.to || "").slice(0, 40);
  const isHost = room.hostId === String(req.userId);
  const isViewer = room.viewers.has(from);
  if (!isHost && !isViewer) return res.status(403).json({ error: "Hors du salon." });

  // L'hôte parle à un spectateur, un spectateur ne parle qu'à l'hôte : une
  // étoile, pas un maillage. Deux spectateurs n'ont rien à se dire, et le
  // permettre ouvrirait un canal libre entre comptes.
  const target = isHost ? room.viewers.get(to) : null;
  if (isHost && !target) return res.status(404).json({ error: "Spectateur parti." });
  const toUser = isHost ? target.userId : room.hostId;
  const toPeer = isHost ? to : room.hostPeer;

  emitTo([toUser], "gbastream", {
    code: room.code,
    kind: "signal",
    from,
    to: toPeer,
    data: req.body?.data ?? null,
  });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/hand — « je peux essayer ? »
// ----------------------------------------------------------------------
router.post("/:code/hand", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
  const peerId = peerOf(req);
  if (!room.viewers.has(peerId)) return res.status(403).json({ error: "Hors du salon." });
  if (req.body?.up === false) room.hands.delete(peerId);
  else room.hands.add(peerId);
  toRoom(room, "room", { room: serialize(room) });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/pad — l'hôte passe (ou reprend) la manette
// ----------------------------------------------------------------------
// UN SEUL À LA FOIS. Deux manettes sur une GBA, ce n'est pas du multijoueur,
// c'est deux personnes qui se battent pour la croix.
router.post("/:code/pad", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
  if (room.hostId !== String(req.userId))
    return res.status(403).json({ error: "Seul l'hôte passe la manette." });

  const to = req.body?.peer ? String(req.body.peer).slice(0, 40) : null;
  if (to && !room.viewers.has(to))
    return res.status(404).json({ error: "Ce spectateur est parti." });
  room.controller = to;
  if (to) room.hands.delete(to);
  toRoom(room, "room", { room: serialize(room) });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/input — un appui de bouton, à distance
// ----------------------------------------------------------------------
// LE CONTRÔLE EST ICI, pas chez l'hôte : un client trafiqué pourrait sinon
// appuyer sur START pendant le combat final de quelqu'un d'autre.
//
// PAS DE FILE D'ATTENTE, PAS D'ACCUSÉ : un appui qui arrive en retard ne sert
// plus à rien, le renvoyer serait pire. On l'envoie, ou on le perd.
router.post("/:code/input", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.status(404).json({ error: "Cette diffusion est terminée." });
  const peerId = peerOf(req);
  if (room.controller !== peerId)
    return res.status(403).json({ error: "Tu n'as pas la manette." });

  const index = Number(req.body?.index);
  if (!BUTTONS.has(index)) return res.status(400).json({ error: "Bouton inconnu." });

  emitTo([room.hostId], "gbastream", {
    code: room.code,
    kind: "input",
    from: peerId,
    index,
    down: !!req.body?.down,
  });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:code/end — j'éteins
// ----------------------------------------------------------------------
router.post("/:code/end", (req, res) => {
  const room = get(req.params.code);
  if (!room) return res.json({ ok: true });
  if (room.hostId !== String(req.userId))
    return res.status(403).json({ error: "Seul l'hôte ferme la diffusion." });
  toRoom(room, "end", {});
  close(room.code);
  res.json({ ok: true });
});

export default router;

// L'hôte qui rouvre la même page retrouve son salon plutôt que d'en ouvrir un
// second (voir `open`, qui referme le précédent). Exporté pour les tests
// manuels et la lisibilité de l'intention.
export { codeOfHost };
