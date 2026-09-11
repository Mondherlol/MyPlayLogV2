// ======================================================================
//  Importer une bibliothèque Backloggd
// ======================================================================
//
// Deux temps, comme les imports Steam et PSN : un APERÇU qui ne touche à rien
// et montre ce qu'on a trouvé, puis un IMPORT qui n'applique que ce que
// l'utilisateur a coché. On n'écrit jamais sur la foi d'un scraping seul.
//
// ⚠️ LE RAPPROCHEMENT DES JEUX EST GRATUIT, ET C'EST LA BONNE SURPRISE.
// Backloggd s'appuie sur le MÊME catalogue que nous : l'attribut `game_id` de
// ses pages EST l'identifiant IGDB. Aucun rapprochement par titre, donc aucune
// erreur de rapprochement — le fléau habituel de ce genre d'import.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import UserGame from "../models/UserGame.js";
import { parseUsername, scrapeLibrary } from "../lib/backloggd.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { createTtlCache } from "../lib/ttlCache.js";

const router = express.Router();

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

// Les libellés de plateforme de Backloggd sont presque ceux d'IGDB — presque.
// On ne traduit QUE ceux qui diffèrent : le reste passe tel quel, et un
// libellé inconnu vaut mieux que pas de plateforme du tout.
const PLATFORM_FR = {
  "Windows PC": "PC (Microsoft Windows)",
  PC: "PC (Microsoft Windows)",
  Mac: "Mac",
  "Xbox Series X/S": "Xbox Series X|S",
};

// Une moisson coûte une dizaine de requêtes chez Backloggd et cinq secondes.
// Rejouer l'aperçu (l'utilisateur revient en arrière, recharge la page) ne doit
// pas les refaire : on garde le résultat un quart d'heure, par profil.
const previewCache = createTtlCache({
  name: "backloggd:preview",
  max: 30,
  ttl: 15 * 60 * 1000,
});

// ----------------------------------------------------------------------
//  POST /api/backloggd/preview   { url }
// ----------------------------------------------------------------------
// `url` : l'adresse du profil, ou le pseudo tout court.
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const username = parseUsername(req.body?.url);
    if (!username) {
      return res.status(400).json({
        error:
          "Ce n'est pas un profil Backloggd. Colle l'adresse de ta page, du genre backloggd.com/u/TonPseudo/games/.",
      });
    }

    const data = await previewCache.remember(username.toLowerCase(), () =>
      scrapeLibrary(username)
    );

    if (data.empty) {
      return res.status(422).json({
        error:
          "Ce profil ne montre aucun jeu. Vérifie le pseudo, et que la bibliothèque est bien publique.",
      });
    }

    // Ce qui est DÉJÀ chez nous : on ne le propose pas comme une nouveauté, et
    // on montre ce qui changerait.
    const ids = data.games.map((g) => g.igdbId);
    const mine = await UserGame.find({ user: req.userId, gameId: { $in: ids } })
      .select("gameId status rating review")
      .lean();
    const byId = new Map(mine.map((e) => [e.gameId, e]));

    const games = data.games.map((g) => {
      const existing = byId.get(g.igdbId) || null;
      return {
        ...g,
        platform: PLATFORM_FR[g.platform] || g.platform,
        inLibrary: !!existing,
        currentStatus: existing?.status || null,
        // Une review déjà écrite CHEZ NOUS ne se fait pas écraser sans le dire.
        wouldOverwriteReview: !!(existing?.review && g.review),
        wouldOverwriteRating: !!(existing?.rating != null && g.rating != null),
      };
    });

    res.json({
      username,
      counts: { ...data.counts, alreadyHere: mine.length },
      games,
    });
  } catch (err) {
    console.error("backloggd preview error:", err.message);
    res
      .status(err.status || 502)
      .json({ error: err.message || "Impossible de lire ce profil Backloggd." });
  }
});

// ----------------------------------------------------------------------
//  POST /api/backloggd/import   { items }
// ----------------------------------------------------------------------
// N'applique QUE ce que le client renvoie : l'utilisateur a décoché ce qu'il ne
// voulait pas, et ce qui n'est pas dans la liste n'est pas touché.
router.post("/import", requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ added: 0, updated: 0 });

    // Ce que l'utilisateur accepte d'écraser sur les entrées existantes.
    const overwriteRatings = req.body?.overwriteRatings === true;
    const overwriteReviews = req.body?.overwriteReviews === true;

    let added = 0;
    let updated = 0;

    for (const it of items) {
      const gameId = Number(it.igdbId);
      if (!gameId || !it.title) continue;

      const status = STATUSES.includes(it.status) ? it.status : "finished";
      const rating =
        it.rating != null && Number.isFinite(Number(it.rating))
          ? Math.max(0, Math.min(100, Number(it.rating)))
          : null;
      const review = typeof it.review === "string" ? it.review.trim() : "";
      // La date du log Backloggd : la seule qu'ils donnent, et elle ne veut dire
      // « terminé le » que sur un jeu terminé.
      const loggedAt = it.finishedAt ? new Date(it.finishedAt) : null;
      const finishedAt =
        status === "finished" && loggedAt && !Number.isNaN(loggedAt.getTime())
          ? loggedAt
          : null;

      const existing = await UserGame.findOne({ user: req.userId, gameId });

      if (!existing) {
        await UserGame.create({
          user: req.userId,
          gameId,
          name: it.title,
          cover: it.cover || null,
          status,
          rating,
          review,
          reviewedAt: review ? new Date() : null,
          platinum: !!it.platinum,
          platform: it.platform || null,
          finishedAt,
          wasWishlisted: status === "wishlist",
        });
        added++;
        warmGameMeta(gameId);
        continue;
      }

      // --- L'entrée existe : on complète, on n'écrase que sur demande. ---
      const set = {};
      // Le statut de Backloggd fait foi : c'est ce qu'on est venu chercher.
      if (status !== existing.status) set.status = status;
      if (rating != null && (existing.rating == null || overwriteRatings))
        set.rating = rating;
      if (review && (!existing.review || overwriteReviews)) {
        set.review = review;
        set.reviewedAt = new Date();
      }
      if (it.platinum && !existing.platinum) set.platinum = true;
      if (it.platform && !existing.platform) set.platform = it.platform;
      if (finishedAt && !existing.finishedAt) set.finishedAt = finishedAt;

      if (Object.keys(set).length) {
        await UserGame.updateOne({ _id: existing._id }, { $set: set });
        updated++;
      }
    }

    triggerMissionCheck(req.userId);
    res.json({ added, updated });
  } catch (err) {
    console.error("backloggd import error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

export default router;
