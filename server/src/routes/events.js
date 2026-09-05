import express from "express";

import GameEvent from "../models/GameEvent.js";
import List from "../models/List.js";
import { requireAuth } from "../middleware/auth.js";
import { upcomingFilter } from "../lib/eventCalendar.js";
import { eventFamily } from "../lib/gameEvents.js";

const router = express.Router();

// Ce que l'accueil affiche : quelques cartes, pas un agenda complet. Au-delà,
// on ne fait plus attendre personne, on remplit un écran.
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;

function serialize(ev, userId) {
  const mine = (ev.interested || []).some((id) => String(id) === String(userId));
  return {
    id: String(ev._id),
    name: ev.name,
    subtitle: ev.subtitle || "",
    startsAt: ev.startsAt,
    endsAt: ev.endsAt || null,
    // Le client en a besoin pour choisir entre « J-3 » et un vrai décompte :
    // sans ça il inventerait des heures que la source ne donne pas.
    precision: ev.precision || "day",
    kind: ev.kind || "showcase",
    description: ev.description || "",
    location: ev.location || "",
    durationMin: ev.durationMin || null,
    brand: ev.brand || null,
    logo: ev.logo || null,
    liveUrl: ev.liveUrl || null,
    sourceUrl: ev.sourceUrl || null,
    source: ev.source,
    gameIds: ev.gameIds || [],
    interested: mine,
    interestedCount: (ev.interested || []).length,
  };
}

// ============================================================
//  GET /api/events/upcoming — les prochains rendez-vous
// ============================================================
// ⚠️ LA BORNE BASSE N'EST PAS « MAINTENANT ». Un Direct diffusé à 15 h ne doit
// pas disparaître de l'accueil à 15 h 01 : c'est justement le moment où l'on
// vient voir ce qui a été annoncé. Et la borne n'est pas la même selon qu'on
// connaît l'heure ou seulement le jour — c'est `upcomingFilter` qui tranche
// (cf. lib/eventCalendar).
router.get("/upcoming", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
    // `kind=showcase` pour l'accueil (ce qui se regarde), rien du tout pour
    // l'agenda complet (qui montre aussi les salons).
    const kind = ["showcase", "conference"].includes(req.query.kind) ? req.query.kind : null;

    const events = await GameEvent.find({
      hidden: { $ne: true },
      ...(kind ? { kind } : null),
      ...upcomingFilter(),
    })
      .sort({ startsAt: 1 })
      .limit(limit)
      .lean();

    res.json({ events: events.map((e) => serialize(e, req.userId)) });
  } catch (err) {
    console.error("events upcoming error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des événements." });
  }
});

// ============================================================
//  GET /api/events/:id — la fiche d'un rendez-vous
// ============================================================
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const ev = await GameEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });
    res.json({ event: serialize(ev, req.userId) });
  } catch (err) {
    res.status(404).json({ error: "Événement introuvable." });
  }
});

// ============================================================
//  GET /api/events/:id/editions — « et la dernière fois, ça a donné quoi ? »
// ============================================================
// ⚠️ CETTE ROUTE NE CRÉE AUCUNE DONNÉE : ELLE EN RELIE DEUX QUI S'IGNORAIENT.
//
// D'un côté, le calendrier annonce « Nintendo Direct, jeudi 14 h ». De l'autre,
// la synchro des listes officielles (cf. lib/eventSync) tient DÉJÀ, pour chaque
// conférence passée, la liste des jeux qui y ont été montrés — soixante-douze
// pour le Direct de juin — avec la rediffusion. Les deux vivaient côte à côte
// sans se connaître.
//
// Le lien, c'est la FAMILLE de l'événement (cf. lib/gameEvents) : ce qui relie
// « Nintendo Direct - September » à « Nintendo Direct — 9 juin 2026 ». On rend
// donc les éditions passées, la plus récente d'abord, chacune avec ses
// premières jaquettes : « voilà ce qui est sorti du dernier ».
router.get("/:id/editions", requireAuth, async (req, res) => {
  try {
    const ev = await GameEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });

    const family = eventFamily(ev.name);
    if (!family) return res.json({ family: null, editions: [] });

    // On ne peut pas interroger Mongo « par motif de nom d'événement » : le
    // motif est une expression régulière de NOTRE côté. On charge donc les
    // listes d'événements passées (il y en a quelques dizaines, jamais plus) et
    // on les trie ici.
    const lists = await List.find({
      "event.igdbId": { $ne: null },
      "event.startTime": { $lt: new Date(), $ne: null },
    })
      .sort({ "event.startTime": -1 })
      .select("title cover items event")
      .limit(200)
      .lean();

    const editions = lists
      .filter((l) => eventFamily(l.event?.name) === family)
      .slice(0, 6)
      .map((l) => ({
        listId: String(l._id),
        title: l.title,
        name: l.event?.name || "",
        startTime: l.event?.startTime || null,
        videoId: l.event?.videoId || null,
        cover: l.cover || null,
        gameCount: (l.items || []).length,
        // Les premières jaquettes seulement : la fiche en montre un rail, pas
        // une grille de soixante-douze.
        games: (l.items || []).slice(0, 12).map((i) => ({
          id: Number(i.gameId) || null,
          name: i.name,
          cover: i.image || null,
        })),
      }));

    res.json({ family, editions });
  } catch (err) {
    console.error("event editions error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des éditions." });
  }
});

// ============================================================
//  POST /api/events/:id/interest — « ça m'intéresse », et l'inverse
// ============================================================
// Une bascule, pas deux routes : le client dit ce qu'il veut être (`interested`
// dans le corps), le serveur y va directement. Deux appuis rapides sur la même
// carte ne peuvent donc pas se croiser et laisser l'inverse de ce qu'on voit —
// ce qui arriverait avec un « inverse l'état actuel » côté serveur.
router.post("/:id/interest", requireAuth, async (req, res) => {
  try {
    const want = req.body?.interested !== false;
    const update = want
      ? { $addToSet: { interested: req.userId } }
      : { $pull: { interested: req.userId } };

    const ev = await GameEvent.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!ev) return res.status(404).json({ error: "Événement introuvable." });

    res.json({
      interested: want,
      interestedCount: (ev.interested || []).length,
    });
  } catch (err) {
    console.error("event interest error:", err.message);
    res.status(500).json({ error: "Impossible d'enregistrer ton choix." });
  }
});

export default router;
