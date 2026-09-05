import express from "express";
import mongoose from "mongoose";

import Activity from "../models/Activity.js";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ======================================================================
//  « Mon Play Log » — le journal de bord d'UN jeu
// ======================================================================
// ⚠️ ON NE CRÉE AUCUNE DONNÉE NOUVELLE ICI, ET C'EST TOUT L'INTÉRÊT.
//
// L'application enregistre DÉJÀ chaque geste posé sur un jeu : l'ajout, les
// changements de statut, les heures ajoutées, la note, l'avis, le coup de
// cœur. C'est ce qui alimente le fil social (cf. lib/activity, type
// « game_update »). Mais ces traces n'étaient lisibles que dispersées dans le
// fil de tout le monde, mélangées à trois cents autres jeux, et elles
// disparaissaient dès qu'on descendait un peu.
//
// Les relire par JEU et par ORDRE CHRONOLOGIQUE, c'est l'histoire de sa partie :
// « ajouté en liste d'envies en mars, commencé en juin, mis en pause deux mois,
// repris, fini en septembre après 42 h ». La donnée était là depuis le début ;
// il manquait la lecture.
//
// UN MOMENT = UNE ACTIVITÉ. Les gestes rapprochés sont déjà fusionnés en une
// seule entrée par `recordGameActivity` (une heure de fenêtre) : c'est la
// bonne maille. Régler une note puis écrire un avis dans la foulée, ce n'est
// pas deux moments dans une vie de joueur, c'est une soirée.

// Les natures de changement qu'on sait écrire à la main. Les autres (avis,
// coup de cœur, OST, personnage, bundle) restent LISIBLES dans le journal mais
// ne s'y ajoutent pas : elles ont chacune leur écran, et un journal n'est pas
// un formulaire de saisie de plus.
const MANUAL_KINDS = ["status", "time", "note"];
const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

const isId = (v) => mongoose.isValidObjectId(v);

function serialize(a) {
  return {
    id: String(a._id),
    at: a.createdAt,
    changes: a.meta?.changes || [],
    // Une entrée posée à la main se retire sans scrupule ; une trace
    // automatique aussi, mais le client peut vouloir les distinguer.
    manual: !!a.meta?.manual,
  };
}

// ============================================================
//  GET /api/journal/:gameId — l'histoire de ma partie
// ============================================================
router.get("/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });

    const [entry, rows] = await Promise.all([
      UserGame.findOne({ user: req.userId, gameId }).lean(),
      Activity.find({ actor: req.userId, type: "game_update", game: gameId })
        // Du plus ANCIEN au plus récent : un journal se lit dans le sens où on
        // l'a vécu. C'est le client qui décidera de le retourner s'il veut.
        .sort({ createdAt: 1 })
        .limit(300)
        .lean(),
    ]);

    if (!entry) return res.status(404).json({ error: "Ce jeu n'est pas dans ta bibliothèque." });

    res.json({
      entry: {
        gameId: entry.gameId,
        name: entry.name,
        cover: entry.cover,
        status: entry.status,
        playtimeHours: entry.playtimeHours,
        platform: entry.platform,
        rating: entry.rating,
        favorite: !!entry.favorite,
        platinum: !!entry.platinum,
        wasWishlisted: !!entry.wasWishlisted,
        // Les deux dates DÉCLARÉES, qui ne sont pas des traces mais des faits
        // que le joueur affirme (« je l'ai fini en 2009 » sur un jeu ajouté
        // hier). Le journal les épingle à part.
        startedAt: entry.startedAt || null,
        finishedAt: entry.finishedAt || null,
        addedAt: entry.createdAt,
      },
      events: rows.map(serialize),
    });
  } catch (err) {
    console.error("journal read error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du journal." });
  }
});

// ============================================================
//  POST /api/journal/:gameId — ajouter un moment
// ============================================================
// Ce que la trace automatique ne peut pas savoir : les sessions d'avant
// l'application, les week-ends passés dessus il y a trois ans, la fois où on
// l'a repris sans penser à changer le statut.
router.post("/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });

    const entry = await UserGame.findOne({ user: req.userId, gameId }).lean();
    if (!entry) return res.status(404).json({ error: "Ce jeu n'est pas dans ta bibliothèque." });

    const b = req.body || {};
    const at = b.at ? new Date(b.at) : new Date();
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: "Date invalide." });
    // ⚠️ PAS DE MOMENT DANS LE FUTUR. Un journal raconte ce qui a eu lieu ; une
    // entrée datée de la semaine prochaine remonterait en tête du fil social de
    // tout le monde et y resterait coincée jusqu'à ce que le temps la rattrape.
    if (at.getTime() > Date.now() + 60000)
      return res.status(400).json({ error: "On ne peut pas dater un moment dans le futur." });

    const kind = MANUAL_KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: "Type de moment invalide." });

    const change = { kind, manual: true };
    if (kind === "status") {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: "Statut invalide." });
      change.to = b.status;
      change.from = null;
    } else if (kind === "time") {
      const hours = Number(b.hours);
      if (!Number.isFinite(hours) || hours < 0)
        return res.status(400).json({ error: "Durée invalide." });
      change.hours = Math.round(hours * 10) / 10;
    }
    const note = String(b.note || "").trim().slice(0, 280);
    if (note) change.note = note;

    // On écrit par le driver natif : `createdAt` est immuable côté Mongoose, et
    // c'est précisément la date qu'on veut choisir (cf. lib/activity, qui fait
    // déjà ce détour pour re-dater une carte fusionnée).
    const doc = {
      actor: new mongoose.Types.ObjectId(String(req.userId)),
      type: "game_update",
      game: gameId,
      gameName: String(entry.name || "").slice(0, 160),
      gameCover: entry.cover || null,
      snippet: "",
      meta: { changes: [change], manual: true },
      createdAt: at,
      updatedAt: new Date(),
    };
    const { insertedId } = await Activity.collection.insertOne(doc);
    res.status(201).json({ event: serialize({ ...doc, _id: insertedId }) });
  } catch (err) {
    console.error("journal create error:", err.message);
    res.status(500).json({ error: "Impossible d'ajouter ce moment." });
  }
});

// ============================================================
//  PATCH /api/journal/:gameId/:eventId — corriger un moment
// ============================================================
// Uniquement la DATE et la note : le reste (« tu as mis ce jeu en pause ») est
// une trace de ce qui s'est passé, pas un champ de formulaire. Se tromper de
// jour, en revanche, arrive tout le temps — surtout quand on rattrape des
// sessions après coup.
router.patch("/:gameId/:eventId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!isId(req.params.eventId)) return res.status(400).json({ error: "Moment introuvable." });

    const found = await Activity.findOne({
      _id: req.params.eventId,
      // ⚠️ L'ACTEUR EST DANS LE FILTRE, PAS VÉRIFIÉ APRÈS COUP. Sans lui, un
      // identifiant deviné laisserait réécrire le journal de quelqu'un d'autre.
      actor: req.userId,
      type: "game_update",
      game: gameId,
    }).lean();
    if (!found) return res.status(404).json({ error: "Moment introuvable." });

    const set = { updatedAt: new Date() };
    if (req.body?.at !== undefined) {
      const at = new Date(req.body.at);
      if (Number.isNaN(at.getTime())) return res.status(400).json({ error: "Date invalide." });
      if (at.getTime() > Date.now() + 60000)
        return res.status(400).json({ error: "On ne peut pas dater un moment dans le futur." });
      set.createdAt = at;
    }
    if (req.body?.note !== undefined) {
      const note = String(req.body.note || "").trim().slice(0, 280);
      const changes = (found.meta?.changes || []).map((c, i) =>
        i === 0 ? { ...c, ...(note ? { note } : { note: undefined }) } : c
      );
      set.meta = { ...(found.meta || {}), changes };
    }

    await Activity.collection.updateOne({ _id: found._id }, { $set: set });
    const fresh = await Activity.findById(found._id).lean();
    res.json({ event: serialize(fresh) });
  } catch (err) {
    console.error("journal update error:", err.message);
    res.status(500).json({ error: "Impossible de modifier ce moment." });
  }
});

// ============================================================
//  DELETE /api/journal/:gameId/:eventId
// ============================================================
router.delete("/:gameId/:eventId", requireAuth, async (req, res) => {
  try {
    if (!isId(req.params.eventId)) return res.json({ ok: true });
    await Activity.deleteOne({
      _id: req.params.eventId,
      actor: req.userId,
      type: "game_update",
      game: Number(req.params.gameId),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("journal delete error:", err.message);
    res.status(500).json({ error: "Impossible de retirer ce moment." });
  }
});

export default router;
