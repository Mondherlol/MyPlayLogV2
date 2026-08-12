import express from "express";
import Conversation from "../models/Conversation.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo } from "../lib/realtime.js";
import { pushToUsers } from "../lib/push.js";
import { pushSystem } from "./chat.js";
import * as voice from "../lib/voiceRooms.js";
import * as calls from "../lib/callRooms.js";

// ======================================================================
//  S'appeler — en privé et en groupe
// ======================================================================
// Le même maillage WebRTC que l'appel du Perroquet (lib/voiceRooms.js,
// client/src/lib/voiceCall.js) : LA VOIX NE PASSE PAS PAR LE SERVEUR, qui ne
// relaie que les poignées de main. Ce qui s'ajoute ici, c'est la SONNERIE —
// l'état intermédiaire qui n'existe pas dans un salon de jeu : quelqu'un a
// décroché, les autres ne savent pas encore s'ils viennent.
//
// ------------------------------------------- pourquoi ça ne sonne qu'une fois
// La sonnerie part À LA CRÉATION de la session, jamais à l'arrivée d'un
// participant. C'est ce qui distingue « j'appelle » de « je rejoins » : dans un
// groupe où deux personnes discutent depuis dix minutes, une troisième qui
// entre ne doit pas faire sonner les téléphones des deux premières.
//
// Corollaire assumé : un appel de groupe qu'on rate ne re-sonne pas. Ce n'est
// pas un oubli, c'est le remplacement — le fil porte un bandeau « appel en
// cours · rejoindre » tant que la session vit, ce qui vaut mieux qu'une
// sonnerie qui reviendrait toutes les deux minutes.
//
// --------------------------------------------------- ce qu'il reste après
// Un appel laisse UNE LIGNE dans la conversation, comme un téléphone laisse un
// journal : « Appel · 4 min », ou « Appel manqué » si personne n'a décroché.
// Sans elle, un appel raté ne laisse absolument aucune trace — on ne saurait
// même pas qu'on a été appelé.

const router = express.Router();
router.use(requireAuth);

const peerOf = (req) => String(req.body?.peerId || req.query?.peerId || "").slice(0, 40);

const idsOf = (conv) => (conv.participants || []).map((p) => String(p._id || p));

// Membre de la conversation ? Vérifié en base à l'ENTRÉE dans l'appel, une
// fois. Le reste du bavardage (offres, candidats, battements) se contente du
// registre en mémoire — sinon chaque candidat ICE coûterait une requête Mongo.
async function convOf(convId, userId) {
  const conv = await Conversation.findById(convId).populate(
    "participants",
    "username avatar"
  );
  if (!conv) return null;
  return idsOf(conv).includes(String(userId)) ? conv : null;
}

const toRoom = (convId, kind, payload = {}) =>
  emitTo(voice.listeners(calls.keyOf(convId)), "call", {
    // `code` en plus de `conversationId` : le hook de maillage est partagé avec
    // le Perroquet et reconnaît ses messages à ce champ-là. Deux noms pour la
    // même chose, c'est le prix d'un client commun — et c'est moins cher qu'un
    // second hook.
    code: String(convId),
    conversationId: String(convId),
    kind,
    ...payload,
  });

const toAll = (conv, kind, payload = {}) =>
  emitTo(idsOf(conv), "call", {
    code: String(conv._id),
    conversationId: String(conv._id),
    kind,
    ...payload,
  });

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min`;
};

// ----------------------------------------------------------------------
//  Raccrocher pour de bon
// ----------------------------------------------------------------------
// Appelé quand le dernier participant s'en va, et par le minuteur de sonnerie.
// C'est ici, et NULLE PART AILLEURS, que la ligne du fil s'écrit : une session
// se ferme par trois chemins différents (le dernier qui raccroche, le refus du
// seul destinataire, la sonnerie qui expire) et trois copies de cette logique
// donneraient trois libellés légèrement différents.
async function hangUp(convId, conv = null) {
  const session = calls.close(convId);
  if (!session) return;
  const document = conv || (await Conversation.findById(convId).populate("participants", "username avatar"));
  if (!document) return;

  emitTo(idsOf(document), "call", {
    code: String(convId),
    conversationId: String(convId),
    kind: "ended",
  });

  // Personne d'autre que celui qui appelait n'est jamais entré : c'est un appel
  // manqué, et il compte pour non lu — c'est tout l'intérêt.
  const missed = session.everJoined.size < 2;
  await pushSystem(document, session.startedBy.id, "call", {
    missed,
    duration: missed ? "" : mmss(Date.now() - session.startedAt),
    group: !!document.isGroup,
  }).catch(() => {
    /* la ligne du fil est un confort : son échec ne doit pas laisser une
       session ouverte derrière elle, or elle est déjà fermée */
  });
}

// ----------------------------------------------------------------------
//  POST /:convId/join — je décroche (ou j'appelle)
// ----------------------------------------------------------------------
router.post("/:convId/join", async (req, res) => {
  try {
    const convId = String(req.params.convId);
    const peerId = peerOf(req);
    if (!peerId) return res.status(400).json({ error: "Onglet non identifié." });
    const conv = await convOf(convId, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    const me = await User.findById(req.userId).select("username avatar").lean();
    const starter = {
      id: String(req.userId),
      username: me?.username || "?",
      avatar: me?.avatar || null,
    };

    const { session, fresh } = calls.open(convId, starter);
    const others = voice.join(calls.keyOf(convId), peerId, starter);
    if (!others) {
      if (fresh) calls.close(convId);
      return res.status(409).json({ error: "L'appel est complet." });
    }
    calls.answered(convId, req.userId);

    if (fresh) {
      // ÇA SONNE. Chez tous les autres, sur tous leurs onglets — c'est le
      // serveur qui décide qui est appelé, pas le client : un appelant ne
      // choisit pas de faire sonner quelqu'un qui n'est pas dans la
      // conversation.
      const targets = idsOf(conv).filter((id) => id !== String(req.userId));
      for (const id of targets) session.ringing.add(id);
      emitTo(targets, "call", {
        code: convId,
        conversationId: convId,
        kind: "ring",
        from: starter,
        group: !!conv.isGroup,
        title: conv.isGroup ? conv.name || "Groupe" : starter.username,
        avatar: conv.isGroup ? conv.avatar || null : starter.avatar,
        members: idsOf(conv).length,
      });

      // Le téléphone posé sur la table, app fermée : sans notification, un
      // appel n'atteint que les gens qui regardaient déjà leur écran.
      pushToUsers(targets, {
        title: conv.isGroup ? conv.name || "Groupe" : starter.username,
        body: conv.isGroup ? `${starter.username} lance un appel` : "Appel entrant",
        data: { type: "call", conversationId: convId },
      }).catch(() => {
        /* best-effort : ça sonne déjà chez les onglets ouverts */
      });

      // La sonnerie dans le vide a une fin. Sans ce minuteur, un appel lancé
      // par erreur reste « en cours » pour toujours dans la conversation, avec
      // son bandeau et son bouton « rejoindre » qui ne mènent à personne.
      session.timer = setTimeout(() => {
        // Toujours seul au bout de 45 secondes : on raccroche pour lui.
        if (calls.size(convId) <= 1) hangUp(convId).catch(() => {});
      }, calls.RING_MS);
      session.timer.unref?.();
    } else {
      // On a décroché : la sonnerie s'éteint chez MES AUTRES ONGLETS, et les
      // gens déjà dans l'appel voient arriver une tête de plus.
      clearTimeout(session.timer);
      emitTo([String(req.userId)], "call", {
        code: convId,
        conversationId: convId,
        kind: "dismiss",
      });
      toRoom(convId, "joined", {
        peerId,
        peer: { peerId, ...starter, userId: starter.id, muted: false },
      });
    }

    toAll(conv, "live", { call: calls.view(session) });
    res.json({ peers: others, call: calls.view(session), me: peerId });
  } catch (err) {
    console.error("call join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre l'appel." });
  }
});

// ----------------------------------------------------------------------
//  POST /:convId/decline — je ne réponds pas
// ----------------------------------------------------------------------
// Le refus est RENDU VISIBLE à l'appelant : une sonnerie qui s'arrête sans rien
// dire laisse croire à un bug de plus. En groupe il ne ferme rien — les autres
// peuvent encore décrocher.
router.post("/:convId/decline", async (req, res) => {
  try {
    const convId = String(req.params.convId);
    const session = calls.get(convId);
    if (!session) return res.json({ ok: true });
    const conv = await convOf(convId, req.userId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable." });

    calls.declined(convId, req.userId);
    const me = (conv.participants || []).find((p) => String(p._id) === String(req.userId));
    toRoom(convId, "declined", {
      userId: String(req.userId),
      username: me?.username || "",
    });
    // Mes autres onglets arrêtent de sonner.
    emitTo([String(req.userId)], "call", {
      code: convId,
      conversationId: convId,
      kind: "dismiss",
    });

    // Plus personne à attendre et l'appelant est seul : ça ne sert à rien de
    // laisser sonner dans le vide jusqu'au bout du minuteur.
    if (!session.ringing.size && calls.size(convId) <= 1) await hangUp(convId, conv);
    res.json({ ok: true });
  } catch (err) {
    console.error("call decline error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ----------------------------------------------------------------------
//  Le battement, le micro, la poignée de main
// ----------------------------------------------------------------------
// Strictement la même mécanique que les salons du Perroquet : voir
// routes/perroquetVersus.js pour le détail du raisonnement.
router.post("/:convId/ping", (req, res) => {
  const convId = String(req.params.convId);
  const key = calls.keyOf(convId);
  for (const gone of voice.prune(key)) toRoom(convId, "left", { peerId: gone });
  if (!voice.touch(key, peerOf(req)))
    return res.status(409).json({ error: "Tu n'es plus dans l'appel." });
  res.json({ peers: voice.peers(key) });
});

router.post("/:convId/mute", (req, res) => {
  const convId = String(req.params.convId);
  const key = calls.keyOf(convId);
  const peerId = peerOf(req);
  const p = voice.peerOf(key, peerId);
  if (!p || p.userId !== String(req.userId))
    return res.status(403).json({ error: "Hors de l'appel." });
  voice.setMuted(key, peerId, req.body?.muted !== false);
  toRoom(convId, "peers", { peers: voice.peers(key) });
  res.json({ ok: true });
});

router.post("/:convId/signal", (req, res) => {
  const convId = String(req.params.convId);
  const key = calls.keyOf(convId);
  const from = peerOf(req);
  const to = String(req.body?.to || "").slice(0, 40);
  const mine = voice.peerOf(key, from);
  if (!mine || mine.userId !== String(req.userId))
    return res.status(403).json({ error: "Hors de l'appel." });
  const target = voice.peerOf(key, to);
  if (!target) return res.status(404).json({ error: "Ce participant a raccroché." });

  emitTo([target.userId], "call", {
    code: convId,
    conversationId: convId,
    kind: "signal",
    from,
    to,
    data: req.body?.data ?? null,
  });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------
//  POST /:convId/leave — je raccroche
// ----------------------------------------------------------------------
router.post("/:convId/leave", async (req, res) => {
  try {
    const convId = String(req.params.convId);
    const key = calls.keyOf(convId);
    const peerId = peerOf(req);
    const p = voice.peerOf(key, peerId);
    if (!p || p.userId !== String(req.userId)) return res.json({ ok: true });

    // Le mot part AVANT le retrait : après, l'expéditeur ne serait plus dans la
    // liste des destinataires et n'apprendrait pas son propre départ.
    toRoom(convId, "left", { peerId });
    voice.leave(key, peerId);

    const session = calls.get(convId);
    // Le dernier éteint la lumière. « Dernier » se juge sur les gens DANS
    // l'appel, pas sur ceux à qui ça sonne encore : un appel où il ne reste
    // qu'une sonnerie sans personne au bout n'est plus un appel.
    if (session && !voice.peers(key).length) {
      await hangUp(convId);
    } else if (session) {
      const conv = await Conversation.findById(convId).select("participants").lean();
      if (conv) toAll({ _id: convId, participants: conv.participants }, "live", {
        call: calls.view(session),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("call leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ----------------------------------------------------------------------
//  GET /active — les appels en cours dans mes conversations
// ----------------------------------------------------------------------
// Interrogé une fois à l'ouverture de l'app. Le reste du temps, l'état arrive
// par le direct — mais quelqu'un qui recharge sa page au milieu d'un appel de
// groupe doit retrouver son bandeau « rejoindre » sans attendre le prochain
// évènement, qui pourrait ne jamais venir.
router.get("/active", async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.userId })
      .select("_id")
      .lean();
    res.json({ calls: calls.among(convs.map((c) => c._id)) });
  } catch (err) {
    console.error("call active error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
