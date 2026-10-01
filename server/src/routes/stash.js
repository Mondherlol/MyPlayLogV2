// ======================================================================
//  Importer une bibliothèque Stash
// ======================================================================
//
// Quatre temps, et c'est le parcours qui se voit à l'écran :
//
//   1. PROFIL  — on tape un pseudo, on reçoit la photo, le nom et les
//      compteurs du profil Stash : « c'est bien toi ? ». Rien n'est lu au-delà.
//   2. APERÇU  — confirmé, on lit toute la bibliothèque. Ça prend de 3 à 20 s
//      selon sa taille : la lecture tourne EN TÂCHE DE FOND et l'écran la suit
//      (rayons lus, avis lus, jaquettes trouvées) en reposant la même question.
//   3. IMPORT  — n'applique que ce que l'utilisateur a coché.
//   4. ANNULER — l'import entier se défait d'un geste, le temps d'une heure.
//
// ⚠️ ON N'ÉCRIT JAMAIS SUR LA FOI D'UNE LECTURE SEULE : l'aperçu ne touche à
// rien, et l'import garde de quoi revenir en arrière (cf. `batches`).

import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import UserGame from "../models/UserGame.js";
import GemSkip from "../models/GemSkip.js";
import { fetchProfile, parseUsername, scrapeLibrary } from "../lib/stash.js";
import { ensureGameMeta } from "../lib/gameMeta.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { createTtlCache } from "../lib/ttlCache.js";

const router = express.Router();

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

// Le profil se redemande à chaque « non, c'est pas moi » : dix minutes de
// mémoire suffisent à ne pas le relire pour rien.
const profileCache = createTtlCache({ name: "stash:profile", max: 200, ttl: 10 * 60 * 1000 });

// ----------------------------------------------------------------------
//  Les lectures en cours
// ----------------------------------------------------------------------
// Une par profil Stash (clé : pseudo en minuscules). Le serveur n'a qu'un
// processus : la mémoire suffit, et c'est ce qui permet à l'écran de suivre la
// lecture page après page.
//
// ⚠️ UN RÉSULTAT SE GARDE UN QUART D'HEURE. Revenir en arrière dans l'aperçu,
// rouvrir la fenêtre : rien ne doit relancer vingt pages de lecture chez Stash.
const jobs = new Map(); // clé -> { state, progress, result, error, status, at }
const DONE_TTL = 15 * 60 * 1000;
const ERROR_TTL = 30 * 1000;
// Au-delà, on demande de patienter : chaque lecture tient Stash occupé
// plusieurs secondes, et on reste un visiteur poli.
const MAX_RUNNING = 4;

function pruneJobs() {
  const now = Date.now();
  for (const [key, j] of jobs) {
    if (j.state === "running") continue;
    if (now - j.at > (j.state === "error" ? ERROR_TTL : DONE_TTL)) jobs.delete(key);
  }
}

function startJob(username) {
  const key = username.toLowerCase();
  const job = {
    state: "running",
    progress: { step: "shelves", shelf: "want", shelves: {}, reviews: 0, covers: [] },
    at: Date.now(),
  };
  jobs.set(key, job);
  scrapeLibrary(username, (p) => {
    job.progress = p;
  })
    .then((result) => Object.assign(job, { state: "done", result, at: Date.now() }))
    .catch((err) => {
      console.error("stash scrape error:", err.message);
      Object.assign(job, {
        state: "error",
        error: err.message || "Impossible de lire ce profil Stash.",
        status: err.status || 502,
        at: Date.now(),
      });
    });
  return job;
}

// ----------------------------------------------------------------------
//  Les imports qu'on peut défaire
// ----------------------------------------------------------------------
// Ce qu'un import a créé, ce qu'il a modifié (avec les valeurs d'avant), ce
// qu'il a écarté. Une heure : c'est le temps de remarquer qu'on s'est trompé
// — après, la bibliothèque a vécu et un retour en arrière en bloc ferait plus
// de dégâts qu'il n'en répare.
const batches = createTtlCache({ name: "stash:undo", max: 500, ttl: 60 * 60 * 1000 });

// ----------------------------------------------------------------------
//  GET /api/stash/profile?u=Pseudo
// ----------------------------------------------------------------------
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const typed = parseUsername(req.query.u);
    if (!typed) {
      return res.status(400).json({ error: "Tape ton pseudo Stash, ou colle le lien de ton profil." });
    }
    // `undefined` plutôt que `null` : un profil introuvable ne se garde pas
    // en mémoire (il peut naître dans la minute).
    const profile = await profileCache.remember(typed, () =>
      fetchProfile(typed).then((p) => p || undefined)
    );
    if (!profile) {
      return res.status(404).json({
        // ⚠️ LES MAJUSCULES COMPTENT chez Stash, et le site n'a pas de
        // recherche d'utilisateurs : « mitosilver » ne trouve pas « MitoSilver ».
        // Le pseudo s'affiche sous la photo dans leur appli, et le lien du
        // profil (Partager) marche toujours.
        error: `Aucun profil Stash « ${typed} ». Recopie ton pseudo tel qu'il s'affiche dans l'appli Stash, majuscules comprises, ou colle le lien de ton profil.`,
      });
    }
    res.json({ profile });
  } catch (err) {
    console.error("stash profile error:", err.message);
    res.status(err.status || 502).json({ error: err.message || "Stash ne répond pas." });
  }
});

// ----------------------------------------------------------------------
//  POST /api/stash/preview   { username }
// ----------------------------------------------------------------------
// Lance la lecture si elle n'existe pas, et rend son état. Le client repose
// la question jusqu'à `state: "done"` : c'est la même requête, idempotente.
router.post("/preview", requireAuth, async (req, res) => {
  try {
    pruneJobs();
    const username = parseUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: "Pseudo Stash manquant." });
    const key = username.toLowerCase();

    let job = jobs.get(key);
    if (!job) {
      const running = [...jobs.values()].filter((j) => j.state === "running").length;
      if (running >= MAX_RUNNING) {
        return res
          .status(429)
          .json({ error: "Beaucoup d'imports en cours. Réessaie dans une minute." });
      }
      job = startJob(username);
    }

    if (job.state === "running") {
      return res.json({ state: "running", progress: job.progress });
    }
    if (job.state === "error") {
      // L'erreur se dit une fois ; la tentative suivante relance une lecture.
      jobs.delete(key);
      return res.status(job.status || 502).json({ error: job.error });
    }

    const data = job.result;
    if (!data.games.length) {
      return res.status(422).json({
        error: "Ce profil ne montre aucun jeu. Vérifie qu'il est bien public.",
      });
    }

    // Ce qui est DÉJÀ chez nous : on ne le propose pas comme une nouveauté, et
    // on montre ce qui changerait.
    const ids = data.games.map((g) => g.igdbId);
    const [mine, skipped] = await Promise.all([
      UserGame.find({ user: req.userId, gameId: { $in: ids } })
        .select("gameId status rating review platinum")
        .lean(),
      GemSkip.find({
        user: req.userId,
        gameId: { $in: data.games.filter((g) => g.status === "notInterested").map((g) => g.igdbId) },
      })
        .select("gameId")
        .lean(),
    ]);
    const byId = new Map(mine.map((e) => [e.gameId, e]));
    const skippedIds = new Set(skipped.map((s) => s.gameId));

    const games = data.games.map((g) => {
      const e = byId.get(g.igdbId) || null;
      // Rien de neuf : même statut, et rien à compléter. Ces jeux-là partent
      // décochés — les recocher ne ferait rien.
      const upToDate = e
        ? g.status === "notInterested" ||
          (e.status === g.status &&
            (g.rating == null || e.rating != null) &&
            (!g.review || !!e.review) &&
            (!g.platinum || e.platinum))
        : g.status === "notInterested" && skippedIds.has(g.igdbId);
      return {
        ...g,
        inLibrary: !!e,
        currentStatus: e?.status || null,
        upToDate,
        // Une note ou un avis déjà écrits CHEZ NOUS ne s'écrasent pas sans le dire.
        wouldOverwriteReview: !!(e?.review && g.review && e.review.trim() !== g.review.trim()),
        wouldOverwriteRating: !!(e?.rating != null && g.rating != null && e.rating !== g.rating),
      };
    });

    res.json({
      state: "done",
      username,
      counts: { ...data.counts, alreadyHere: mine.length },
      games,
      unmatched: data.unmatched,
    });
  } catch (err) {
    console.error("stash preview error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Impossible de lire ce profil Stash." });
  }
});

// ----------------------------------------------------------------------
//  POST /api/stash/import   { items, overwriteRatings, overwriteReviews }
// ----------------------------------------------------------------------
// N'applique QUE ce que le client renvoie : ce qui n'est pas dans la liste
// n'est pas touché. Écrit en lot (une bibliothèque Stash dépasse vite les
// mille jeux : un aller-retour par jeu se compterait en dizaines de secondes).
router.post("/import", requireAuth, async (req, res) => {
  try {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 10000);
    if (!items.length) return res.json({ added: 0, updated: 0, notInterested: 0 });

    const overwriteRatings = req.body?.overwriteRatings === true;
    const overwriteReviews = req.body?.overwriteReviews === true;

    const clean = [];
    const seen = new Set();
    for (const it of items) {
      const gameId = Number(it?.igdbId);
      if (!Number.isInteger(gameId) || gameId <= 0 || seen.has(gameId) || !it.title) continue;
      seen.add(gameId);
      const rating =
        it.rating != null && Number.isFinite(Number(it.rating))
          ? Math.max(0, Math.min(100, Math.round(Number(it.rating))))
          : null;
      const reviewedAt = it.reviewedAt ? new Date(it.reviewedAt) : null;
      clean.push({
        gameId,
        title: String(it.title).slice(0, 300),
        cover: typeof it.cover === "string" ? it.cover : null,
        status:
          it.status === "notInterested"
            ? "notInterested"
            : STATUSES.includes(it.status)
              ? it.status
              : "finished",
        rating,
        review: typeof it.review === "string" ? it.review.trim().slice(0, 5000) : "",
        reviewedAt: reviewedAt && !Number.isNaN(reviewedAt.getTime()) ? reviewedAt : null,
        platinum: !!it.platinum,
      });
    }

    const existing = await UserGame.find({
      user: req.userId,
      gameId: { $in: clean.map((c) => c.gameId) },
    })
      .select("gameId status rating review reviewedAt platinum wasWishlisted")
      .lean();
    const byId = new Map(existing.map((e) => [e.gameId, e]));

    const docs = [];
    const ops = [];
    const undoUpdates = [];
    const skipIds = [];

    for (const it of clean) {
      const e = byId.get(it.gameId);

      // « Pas intéressé » : écarté des recommandations, pas ajouté. Un jeu
      // déjà dans la bibliothèque y reste tel quel.
      if (it.status === "notInterested") {
        if (!e) skipIds.push(it.gameId);
        continue;
      }

      if (!e) {
        docs.push({
          user: req.userId,
          gameId: it.gameId,
          name: it.title,
          cover: it.cover,
          status: it.status,
          rating: it.rating,
          review: it.review,
          reviewedAt: it.review ? it.reviewedAt || new Date() : null,
          platinum: it.platinum,
          wasWishlisted: it.status === "wishlist",
          stashImported: true,
        });
        continue;
      }

      // --- L'entrée existe : on complète, on n'écrase que sur demande. ---
      const set = {};
      // Le statut de Stash fait foi : c'est ce qu'on est venu chercher.
      if (it.status !== e.status) set.status = it.status;
      if (it.rating != null && (e.rating == null || overwriteRatings) && it.rating !== e.rating)
        set.rating = it.rating;
      if (it.review && (!e.review || overwriteReviews) && it.review !== e.review) {
        set.review = it.review;
        set.reviewedAt = it.reviewedAt || new Date();
      }
      if (it.platinum && !e.platinum) set.platinum = true;
      if (it.status === "wishlist" && !e.wasWishlisted) set.wasWishlisted = true;
      if (!Object.keys(set).length) continue;

      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: set } } });
      undoUpdates.push({
        id: e._id,
        prev: Object.fromEntries(Object.keys(set).map((k) => [k, e[k] ?? null])),
      });
    }

    // --- Écriture ---
    let created = [];
    if (docs.length) {
      try {
        created = await UserGame.insertMany(docs, { ordered: false });
      } catch (err) {
        // Un doublon (deux imports lancés en même temps) n'arrête pas le reste.
        created = err.insertedDocs || [];
        if (err.code !== 11000 && !err.writeErrors) throw err;
      }
    }
    if (ops.length) await UserGame.bulkWrite(ops, { ordered: false });

    // Les « pas intéressé » : seulement ceux qui ne l'étaient pas déjà, pour
    // qu'annuler ne retire pas un refus antérieur à l'import.
    let skipped = [];
    if (skipIds.length) {
      const already = new Set(
        (await GemSkip.find({ user: req.userId, gameId: { $in: skipIds } }).select("gameId").lean()).map(
          (s) => s.gameId
        )
      );
      const fresh = skipIds.filter((id) => !already.has(id));
      if (fresh.length) {
        await GemSkip.insertMany(
          fresh.map((gameId) => ({ user: req.userId, gameId })),
          { ordered: false }
        ).catch(() => {});
        skipped = fresh;
      }
    }

    const createdIds = created.map((d) => d.gameId);
    if (createdIds.length) ensureGameMeta(createdIds).catch(() => {});
    triggerMissionCheck(req.userId);

    const batchId = crypto.randomUUID();
    batches.set(batchId, {
      user: String(req.userId),
      created: created.map((d) => d._id),
      updated: undoUpdates,
      skipped,
    });

    res.json({
      added: createdIds.length,
      updated: undoUpdates.length,
      notInterested: skipped.length,
      batchId,
    });
  } catch (err) {
    console.error("stash import error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

// ----------------------------------------------------------------------
//  POST /api/stash/undo   { batchId }
// ----------------------------------------------------------------------
// Défait un import : retire ce qu'il a ajouté, remet ce qu'il a modifié dans
// l'état d'avant, et rend leur chance aux jeux qu'il avait écartés.
router.post("/undo", requireAuth, async (req, res) => {
  try {
    const batch = batches.get(String(req.body?.batchId || ""));
    if (!batch || batch.user !== String(req.userId)) {
      return res.status(410).json({ error: "Cet import ne peut plus être annulé." });
    }
    batches.delete(String(req.body.batchId));

    const [removed] = await Promise.all([
      batch.created.length
        ? UserGame.deleteMany({ _id: { $in: batch.created }, user: req.userId, stashImported: true })
        : { deletedCount: 0 },
      batch.updated.length
        ? UserGame.bulkWrite(
            batch.updated.map((u) => ({
              updateOne: { filter: { _id: u.id, user: req.userId }, update: { $set: u.prev } },
            })),
            { ordered: false }
          )
        : null,
      batch.skipped.length
        ? GemSkip.deleteMany({ user: req.userId, gameId: { $in: batch.skipped } })
        : null,
    ]);

    res.json({ removed: removed.deletedCount || 0, restored: batch.updated.length });
  } catch (err) {
    console.error("stash undo error:", err.message);
    res.status(500).json({ error: "Impossible d'annuler l'import." });
  }
});

export default router;
