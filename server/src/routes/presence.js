import express from "express";
import Conversation from "../models/Conversation.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong, onlineSince } from "../lib/realtime.js";
import { setStatus, clearStatus, statusOf } from "../lib/liveStatus.js";

// ======================================================================
//  Statut d'activité : « Joue au Mot du jour · 39° »
// ======================================================================
// Les pages de jeu annoncent ici ce qu'elles affichent ; la messagerie le
// répète à côté de la pastille verte. Voir lib/liveStatus.js pour le pourquoi
// du stockage en mémoire et du sens client → serveur.
const router = express.Router();

// On ne prévient QUE les gens avec qui on a une conversation — même règle que
// la pastille verte (routes/chat.js → notifyPresence). Un statut n'est pas
// public : il se lit dans un fil de discussion, pas sur un profil.
async function broadcastStatus(userId, status) {
  try {
    const convs = await Conversation.find({ participants: userId })
      .select("participants")
      .lean();
    const targets = new Set();
    for (const c of convs)
      for (const p of c.participants || []) {
        const id = String(p);
        if (id !== String(userId)) targets.add(id);
      }
    if (targets.size)
      emitTo(targets, "presence", {
        userId: String(userId),
        online: true,
        status,
      });
  } catch {
    /* un statut est un bonus : jamais bloquant */
  }
}

// Rediffusion bornée : un joueur du Mot du jour poste un détail à chaque essai.
// Sans ce frein, chaque essai réveillerait tous ses interlocuteurs. Un
// changement de JEU passe tout de suite (c'est l'information qui compte) ; un
// simple changement de détail attend la fenêtre.
const DETAIL_THROTTLE = 12_000;
const lastSent = new Map(); // userId → { kind, at }

// POST /api/presence  { kind, detail }  — j'entre dans un jeu / je progresse.
// POST /api/presence  { kind: null }    — j'en sors.
router.post("/", requireAuth, async (req, res) => {
  const kind = req.body?.kind ? String(req.body.kind) : null;

  if (!kind) {
    // `was` : l'activité que le client croyait annoncer. Une extinction ne vaut
    // que pour SON propre statut (voir clearStatus) — deux annonceurs coexistent
    // désormais, la page et le mini-lecteur.
    if (clearStatus(req.userId, req.body?.was || null)) {
      lastSent.delete(String(req.userId));
      broadcastStatus(req.userId, null);
    }
    return res.json({ ok: true });
  }

  const changed = setStatus(req.userId, kind, req.body?.detail, req.body?.path);
  if (!changed) return res.json({ ok: true }); // simple battement, rien à dire

  const key = String(req.userId);
  const prev = lastSent.get(key);
  const now = Date.now();
  const isNewGame = !prev || prev.kind !== kind;
  if (isNewGame || now - prev.at >= DETAIL_THROTTLE) {
    lastSent.set(key, { kind, at: now });
    broadcastStatus(req.userId, statusOf(req.userId));
  }
  res.json({ ok: true });
});

// ======================================================================
//  GET /api/presence/following — que font les gens que je suis, LÀ ?
// ======================================================================
// C'est le rail de l'onglet Activité. Le fil raconte ce qui S'EST PASSÉ ; ce
// rail dit ce qui se passe MAINTENANT — qui est devant une partie, une séance,
// un album — et donne le lien pour aller le rejoindre. C'est la seule chose de
// la page qu'on regarde en arrivant plutôt qu'en scrollant.
//
// LA PORTÉE EST « LES GENS QUE JE SUIS », pas « ceux avec qui j'ai une
// conversation » comme la rediffusion de la messagerie. C'est la même portée que
// le fil d'à côté : les deux répondent à la même question sur deux échelles de
// temps, ils n'auraient aucune raison de ne pas parler des mêmes personnes.
//
// EN LECTURE SEULE ET SANS RIEN EN BASE : les statuts vivent en mémoire (voir
// lib/liveStatus.js), la seule requête est celle qui donne la liste des
// abonnements. Le client rappelle cette route toutes les 25 secondes — c'est
// assez pour un rail de présence, et ça évite d'inventer un canal de plus.
router.get("/following", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = (me?.following || []).map(String);
    if (!ids.length)
      return res.json({ people: [], offline: [], onlineCount: 0 });

    // CEUX QUI SONT LÀ, ET CEUX QUI NE LE SONT PAS. Le rail rendait autrefois
    // les seuls connectés ; un rail vide ne disait alors RIEN — ni qui existe,
    // ni depuis quand personne n'est passé. Les absents sont donc rendus aussi,
    // mais à part (`offline`) et avec leur dernier passage : c'est le bas du
    // rail, pas son sujet.
    const online = onlineAmong(ids);
    const live = new Map();
    for (const id of ids) {
      const status = statusOf(id);
      if (status || online.has(id)) live.set(id, status);
    }

    const users = await User.find({ _id: { $in: ids } })
      .select("username avatar lastSeenAt")
      .lean();

    const card = (u) => ({
      id: String(u._id),
      username: u.username,
      avatar: u.avatar || null,
    });

    const people = users
      .filter((u) => live.has(String(u._id)))
      .map((u) => ({
        user: card(u),
        online: online.has(String(u._id)),
        // « En ligne depuis 12 min » : sans ça, quelqu'un qui ne fait rien
        // n'était qu'un avatar muet. Le statut, quand il existe, porte déjà son
        // propre `since` (l'heure où il a lancé CETTE partie) — les deux ne
        // disent pas la même chose et cohabitent.
        since: onlineSince(u._id),
        status: live.get(String(u._id)) || null,
      }));

    // Les absents, du plus récemment vu au plus ancien : « hors ligne depuis
    // 3 h » se lit, « hors ligne depuis 8 mois » est du remplissage. On en rend
    // une trentaine au plus, le client n'en montre qu'une poignée.
    const offline = users
      .filter((u) => !live.has(String(u._id)))
      .map((u) => ({ user: card(u), lastSeenAt: u.lastSeenAt || null }))
      .sort(
        (a, b) =>
          new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0) ||
          a.user.username.localeCompare(b.user.username)
      )
      .slice(0, 30);

    // Ceux qui font quelque chose d'abord, puis les plus récemment arrivés
    // dessus : le haut du rail est toujours ce qu'on peut rejoindre tout de
    // suite.
    people.sort(
      (a, b) =>
        Number(!!b.status) - Number(!!a.status) ||
        (b.status?.since || 0) - (a.status?.since || 0) ||
        a.user.username.localeCompare(b.user.username)
    );

    res.json({ people, offline, onlineCount: online.size });
  } catch (err) {
    console.error("presence following error:", err.message);
    res.status(500).json({ error: "Impossible de lire l'activité en cours." });
  }
});

export default router;
