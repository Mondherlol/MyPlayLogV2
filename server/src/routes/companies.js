import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildCompanyProfile } from "../lib/companyProfile.js";
import UserGame from "../models/UserGame.js";

const router = express.Router();

// Un jeu est « aimé » s'il est en favori ou noté au-dessus de ce seuil.
const LIKE_THRESHOLD = 70;

// GET /api/companies/:name/profile
// Profil éditorial d'un studio / éditeur (IGDB + Wikipedia, mis en cache),
// croisé avec la bibliothèque du demandeur : quels jeux je possède, lesquels
// j'aime, et mon taux d'affinité avec le studio.
router.get("/:name/profile", requireAuth, async (req, res) => {
  try {
    const name = req.params.name;
    const profile = await buildCompanyProfile(name);
    if (!profile) {
      return res.status(404).json({ error: "Studio ou éditeur introuvable." });
    }

    // Croisement avec ma bibliothèque (une seule requête sur les ids du catalogue)
    const ids = profile.games.map((g) => g.gameId);
    const mineRows = ids.length
      ? await UserGame.find({ user: req.userId, gameId: { $in: ids } })
          .select("gameId status rating favorite")
          .lean()
      : [];
    const mineById = new Map(
      mineRows.map((r) => [
        r.gameId,
        { status: r.status, rating: r.rating ?? null, favorite: !!r.favorite },
      ])
    );

    const games = profile.games.map((g) => ({
      ...g,
      mine: mineById.get(g.gameId) || null,
    }));

    // Affinité : parmi les jeux du studio auxquels J'AI JOUÉ (hors wishlist),
    // la part de ceux que j'aime (favori ou note ≥ seuil).
    const played = games.filter((g) => g.mine && g.mine.status !== "wishlist");
    const liked = played.filter(
      (g) => g.mine.favorite || (g.mine.rating != null && g.mine.rating >= LIKE_THRESHOLD)
    );
    const inLibrary = games.filter((g) => g.mine).length;

    res.json({
      profile: {
        name: profile.name,
        logo: profile.logo,
        country: profile.country,
        startYear: profile.startYear,
        description: profile.description,
        descriptionSource: profile.descriptionSource,
        wikiUrl: profile.wikiUrl,
        image: profile.image,
        people: profile.people,
        igdbId: profile.igdbId,
      },
      games,
      stats: {
        total: games.length,
        inLibrary,
        played: played.length,
        liked: liked.length,
        affinity: played.length
          ? Math.round((liked.length / played.length) * 100)
          : null,
      },
    });
  } catch (err) {
    console.error("company profile error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du studio." });
  }
});

export default router;
