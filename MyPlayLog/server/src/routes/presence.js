import express from "express";
import Conversation from "../models/Conversation.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo } from "../lib/realtime.js";
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
    if (clearStatus(req.userId)) {
      lastSent.delete(String(req.userId));
      broadcastStatus(req.userId, null);
    }
    return res.json({ ok: true });
  }

  const changed = setStatus(req.userId, kind, req.body?.detail);
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

export default router;
