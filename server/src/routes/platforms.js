import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildPlatformProfile, fetchPlatformGamesPage } from "../lib/platformProfile.js";
import { ensureEntityLogos } from "../lib/entityLogos.js";
import { ensurePlatformImages } from "../lib/platformImages.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";

const router = express.Router();

// POST /api/platforms/logos { names:[...] } -> { logos: { name: url|null } }
// Miniatures de consoles (logo IGDB, match exact par nom) pour la carte
// « Console favorite » de l'aperçu et sa modale. Public (profils partageables),
// best-effort + cache EntityLogo (les noms viennent d'IGDB → match par nom OK).
router.post("/logos", async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names)
      ? req.body.names.map((n) => String(n || "").trim()).filter(Boolean).slice(0, 40)
      : [];
    if (!names.length) return res.json({ logos: {} });
    const map = await ensureEntityLogos("platform", names);
    const logos = {};
    for (const [name, url] of map) logos[name] = url;
    res.json({ logos });
  } catch (err) {
    console.error("platform logos error:", err.message);
    res.json({ logos: {} });
  }
});

// POST /api/platforms/images { names:[...] } -> { images: { name: url|null } }
// Vraies photos de consoles (source Wikipedia, comme la fiche console) pour la
// carte « Console favorite » de l'aperçu, qui ne connaît que le nom. Public
// (profils partageables), best-effort + cache EntityLogo (kind platform-photo).
router.post("/images", async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names)
      ? req.body.names.map((n) => String(n || "").trim()).filter(Boolean).slice(0, 40)
      : [];
    if (!names.length) return res.json({ images: {} });
    const map = await ensurePlatformImages(names);
    const base = `${req.protocol}://${req.get("host")}`;
    const images = {};
    for (const [name, file] of map) {
      // `file` = nom de fichier local rapatrié ; on tolère un ancien hotlink http.
      images[name] = file
        ? /^https?:/i.test(file)
          ? file
          : `${base}/uploads/platforms/${file}`
        : null;
    }
    res.json({ images });
  } catch (err) {
    console.error("platform images error:", err.message);
    res.json({ images: {} });
  }
});

// --- Affinité joueur ↔ console ---
// Trois ingrédients (ratios 0..1, moyennés par leurs poids) :
//   • couverture : part du catalogue de la console que je possède
//   • engagement : part de mes jeux de la console réellement joués (pas juste en
//                  wishlist) — récompense le fait d'avoir vraiment vécu la console
//   • coups de cœur : part de mes jeux de la console mis en favori
// Renvoie le score + le détail (pour la modale « nerd »).
function computeAffinity(games) {
  const owned = games.filter((g) => g.mine);
  const played = owned.filter((g) => g.mine.status !== "wishlist");
  const favs = owned.filter((g) => g.mine.favorite);
  const total = games.length;

  const coverage = total ? owned.length / total : 0;
  const engagement = owned.length ? played.length / owned.length : 0;
  const favRatio = owned.length ? favs.length / owned.length : 0;

  const parts = [
    {
      key: "coverage",
      label: "Jeux possédés",
      detail: `${owned.length} sur ${total} du catalogue`,
      ratio: coverage,
      weight: 0.5,
    },
    {
      key: "engagement",
      label: "Jeux joués",
      detail: `${played.length} joué${played.length > 1 ? "s" : ""} sur ${owned.length} possédé${owned.length > 1 ? "s" : ""}`,
      ratio: engagement,
      weight: 0.3,
    },
    {
      key: "favorites",
      label: "Coups de cœur",
      detail: `${favs.length} jeu${favs.length > 1 ? "x" : ""} en favori`,
      ratio: favRatio,
      weight: 0.2,
    },
  ];
  for (const p of parts) p.points = Math.round(100 * p.weight * p.ratio);

  const raw = parts.reduce((s, p) => s + p.weight * p.ratio, 0);
  const score = owned.length ? Math.round(100 * raw) : null;

  return {
    score,
    owned: owned.length,
    played: played.length,
    favorites: favs.length,
    total,
    parts,
  };
}

// GET /api/platforms/:id/profile
// Profil éditorial d'une console (IGDB + Wikipedia + Wikidata, mis en cache),
// croisé avec la bibliothèque du demandeur (jeux possédés, favoris, affinité).
router.get("/:id/profile", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id de plateforme invalide." });

    const profile = await buildPlatformProfile(id);
    if (!profile) return res.status(404).json({ error: "Console introuvable." });

    // Croisement biblio : une requête sur les ids du catalogue.
    const ids = profile.games.map((g) => g.gameId);
    const [mineRows, me] = await Promise.all([
      ids.length
        ? UserGame.find({ user: req.userId, gameId: { $in: ids } })
            .select("gameId status rating favorite")
            .lean()
        : [],
      User.findById(req.userId).select("favoritePlatforms").lean(),
    ]);
    const isFavorite = (me?.favoritePlatforms || []).some(
      (p) => p.platformId === profile.igdbId
    );
    const mineById = new Map(
      mineRows.map((r) => [
        r.gameId,
        { status: r.status, rating: r.rating ?? null, favorite: !!r.favorite },
      ])
    );

    const games = profile.games.map((g) => ({
      gameId: g.gameId,
      name: g.name,
      cover: g.cover,
      year: g.year,
      rating: g.rating,
      ratingCount: g.ratingCount ?? 0,
      publisher: g.publisher ?? null,
      franchise: g.franchise ?? null,
      debut: !!g.debut,
      exclusive: !!g.exclusive,
      mine: mineById.get(g.gameId) || null,
    }));

    const affinity = computeAffinity(games);

    res.json({
      profile: {
        igdbId: profile.igdbId,
        name: profile.name,
        abbr: profile.abbr,
        generation: profile.generation,
        family: profile.family,
        logo: profile.logo,
        image: profile.image,
        manufacturer: profile.manufacturer,
        releaseDate: profile.releaseDate,
        releaseYear: profile.releaseYear,
        discontinuedDate: profile.discontinuedDate,
        unitsSold: profile.unitsSold,
        unitsSoldYear: profile.unitsSoldYear,
        summary: profile.summary,
        description: profile.description,
        descriptionSource: profile.descriptionSource,
        wikiUrl: profile.wikiUrl,
        versions: profile.versions || [],
        related: profile.related || [],
        genres: profile.genres || [],
        publishers: profile.publishers || [],
        isFavorite,
      },
      games,
      stats: {
        total: profile.total || games.length, // vrai total IGDB (>500 possible)
        exclusives: profile.exclusiveCount ?? 0, // count IGDB exact, non plafonné
        catalogSize: games.length, // jeux réellement récupérés (≤ 500)
        inLibrary: affinity.owned,
        played: affinity.played,
        liked: affinity.favorites,
        affinity: affinity.score,
        affinityDetail: affinity,
      },
    });
  } catch (err) {
    console.error("platform profile error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement de la console." });
  }
});

// POST /api/platforms/:id/games
// Page de jeux de la plateforme : recherche (nom) + tri + pagination directement
// dans IGDB (au-delà des 500 du profil). `mineIds` active le filtre « Ma biblio »
// (intersection avec les jeux possédés, envoyés par le client depuis sa map).
router.post("/:id/games", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id de plateforme invalide." });

    const { q, sort, offset, limit, mineIds } = req.body || {};
    const page = await fetchPlatformGamesPage(id, {
      q: typeof q === "string" ? q.trim() : "",
      sort: typeof sort === "string" ? sort : "popularity",
      offset: Math.max(0, Number(offset) || 0),
      limit: Math.min(60, Math.max(12, Number(limit) || 48)),
      mineIds: Array.isArray(mineIds) ? mineIds.map(Number) : undefined,
    });
    res.json(page);
  } catch (err) {
    console.error("platform games error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des jeux." });
  }
});

// POST /api/platforms/:id/favorite
// Épingle / désépingle une console dans les favoris du joueur connecté.
router.post("/:id/favorite", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "id de plateforme invalide." });

    const profile = await buildPlatformProfile(id);
    if (!profile) return res.status(404).json({ error: "Console introuvable." });

    const user = await User.findById(req.userId).select("favoritePlatforms");
    if (!user) return res.status(401).json({ error: "Non authentifié." });

    const list = user.favoritePlatforms || [];
    const idx = list.findIndex((p) => p.platformId === profile.igdbId);
    let favorited;
    if (idx >= 0) {
      list.splice(idx, 1);
      favorited = false;
    } else {
      list.unshift({
        platformId: profile.igdbId,
        name: profile.name,
        logo: profile.logo || null,
        abbr: profile.abbr || null,
        addedAt: new Date(),
      });
      favorited = true;
    }
    user.favoritePlatforms = list;
    await user.save();
    res.json({ favorited, favoritePlatforms: user.favoritePlatforms });
  } catch (err) {
    console.error("platform favorite error:", err.message);
    res.status(500).json({ error: "Impossible de mettre à jour les favoris." });
  }
});

export default router;
