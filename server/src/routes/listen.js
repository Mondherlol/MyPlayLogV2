import express from "express";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo } from "../lib/realtime.js";
import {
  open,
  get,
  setState,
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
//   kind: room      la liste des auditeurs a bougé ;
//   kind: end       l'hôte a fermé la séance.
//
// ------------------------------------------------------------ qui mène
// L'HÔTE, ET LUI SEUL. Un auditeur qui pourrait mettre en pause chez les autres
// serait une bonne idée sur le papier et un cauchemar à trois personnes : on ne
// saurait jamais qui vient d'arrêter la musique. Ici la règle tient en une
// phrase — c'est sa séance, il choisit ; les autres suivent ou s'en vont.

const router = express.Router();
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
