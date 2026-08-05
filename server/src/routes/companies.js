import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildCompanyProfile } from "../lib/companyProfile.js";
import { igdbQuery } from "../lib/igdb.js";
import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { triggerMissionCheck } from "../lib/missions.js";

const router = express.Router();

const normName = (s) => String(s).trim().toLowerCase();
const IGDB_IMG = "https://images.igdb.com/igdb/image/upload";

// GET /api/companies/search?q= — recherche légère de studios/éditeurs (IGDB) pour
// épingler des studios dans la carte « Studios favoris » de l'aperçu. Renvoie
// juste nom + logo (rendu direct, pas de build de profil complet).
// NB : la clause `search` d'IGDB ne renvoie RIEN sur l'endpoint /companies —
// on filtre donc par nom (`name ~ *"…"*`, contient, insensible à la casse) puis
// on classe la pertinence côté serveur (IGDB ne trie pas par score).
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

router.get("/search", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ companies: [] });
    const esc = q.replace(/["\\*]/g, "");
    const rows = await igdbQuery(
      "companies",
      `fields name,logo.image_id; where name ~ *"${esc}"*; limit 50;`
    );
    const nq = norm(q);
    // Suffixes « corporate » : « Rockstar Games », « CD Projekt Red », « Ubisoft
    // Entertainment »… = la maison mère, à privilégier sur les studios régionaux.
    const CORP = /^(games?|entertainment|interactive|studios?|productions?|inc|corp|company|sa|ltd|red|montreal|the game)$/;
    // Score de pertinence : correspondance exacte > maison mère > préfixe > contient ;
    // à égalité, le nom le plus court et la présence d'un logo priment.
    const score = (name, hasLogo) => {
      const n = norm(name);
      let s;
      if (n === nq) s = 1000;
      else if (n.startsWith(nq)) {
        const rest = n.slice(nq.length).replace(/^[\s\-·|:.]+/, "").trim();
        s = !rest ? 900 : CORP.test(rest) ? 720 : 600;
      } else if (new RegExp(`\\b${nq.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(n)) s = 400;
      else s = 200;
      s -= Math.min(n.length, 120); // à score égal, préférer le nom court
      if (hasLogo) s += 40;
      return s;
    };
    const seen = new Set();
    const companies = [];
    for (const c of rows || []) {
      if (!c.name) continue;
      const key = c.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push({
        name: c.name,
        logo: c.logo?.image_id ? `${IGDB_IMG}/t_logo_med/${c.logo.image_id}.png` : null,
      });
    }
    companies.sort((a, b) => score(b.name, !!b.logo) - score(a.name, !!a.logo));
    res.json({ companies: companies.slice(0, 12) });
  } catch (err) {
    console.error("company search error:", err.message);
    res.status(502).json({ error: "Recherche de studios indisponible." });
  }
});

// --- Affinité joueur ↔ studio ---
// Trois ingrédients, chacun un ratio 0..1, moyennés par leurs poids :
//   • couverture  : part du catalogue que je possède (joué OU wishlist)
//   • licences    : part de leurs sagas dont j'ai touché ≥ 1 jeu (récompense
//                   l'exploration : inutile d'avoir fini TOUTE une licence)
//   • coups de cœur: part de mes jeux du studio mis en favori (bonus de passion)
// Si le studio n'a pas de licences identifiées, le poids « licences » repart
// sur la couverture. Renvoie le score + le détail (pour la modale « nerd »).
function computeAffinity(games) {
  const owned = games.filter((g) => g.mine);
  const played = owned.filter((g) => g.mine.status !== "wishlist");
  const favs = owned.filter((g) => g.mine.favorite);
  const total = games.length;

  const catalogFranchises = new Set(
    games.filter((g) => g.franchise).map((g) => g.franchise)
  );
  const touched = new Set(
    owned.filter((g) => g.franchise).map((g) => g.franchise)
  );
  const fTotal = catalogFranchises.size;
  const fTouched = touched.size;

  const coverage = total ? owned.length / total : 0;
  const franchiseReach = fTotal ? fTouched / fTotal : 0;
  const favRatio = owned.length ? favs.length / owned.length : 0;

  let wCov = 0.35;
  let wFran = 0.45;
  const wFav = 0.2;
  if (!fTotal) {
    wCov += wFran;
    wFran = 0;
  }

  const parts = [
    {
      key: "coverage",
      label: "Jeux possédés",
      detail: `${owned.length} sur ${total} du catalogue`,
      ratio: coverage,
      weight: wCov,
    },
    {
      key: "franchise",
      label: "Licences explorées",
      detail: `${fTouched} sur ${fTotal} sagas`,
      ratio: franchiseReach,
      weight: wFran,
    },
    {
      key: "favorites",
      label: "Coups de cœur",
      detail: `${favs.length} jeu${favs.length > 1 ? "x" : ""} en favori`,
      ratio: favRatio,
      weight: wFav,
    },
  ].filter((p) => p.weight > 0);
  for (const p of parts) p.points = Math.round(100 * p.weight * p.ratio);

  const raw = parts.reduce((s, p) => s + p.weight * p.ratio, 0);
  const score = owned.length ? Math.round(100 * raw) : null;

  return {
    score,
    owned: owned.length,
    played: played.length,
    favorites: favs.length,
    total,
    franchisesTotal: fTotal,
    franchisesTouched: fTouched,
    parts,
  };
}

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
    const [mineRows, me] = await Promise.all([
      ids.length
        ? UserGame.find({ user: req.userId, gameId: { $in: ids } })
            .select("gameId status rating favorite")
            .lean()
        : [],
      User.findById(req.userId).select("favoriteCompanies").lean(),
    ]);
    const isFavorite = (me?.favoriteCompanies || []).some(
      (c) => normName(c.name) === normName(profile.name)
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
      franchise: g.franchise ?? null,
      role: g.role,
      mine: mineById.get(g.gameId) || null,
    }));

    const affinity = computeAffinity(games);

    res.json({
      profile: {
        name: profile.name,
        logo: profile.logo,
        country: profile.country,
        startYear: profile.startYear,
        startDate: profile.startDate,
        statusActive: profile.statusActive,
        employees: profile.employees,
        employeesYear: profile.employeesYear,
        engines: profile.engines || [],
        genres: profile.genres || [],
        description: profile.description,
        descriptionSource: profile.descriptionSource,
        wikiUrl: profile.wikiUrl,
        image: profile.image,
        people: profile.people,
        franchises: profile.franchises || [],
        igdbId: profile.igdbId,
        isFavorite,
      },
      games,
      stats: {
        total: games.length,
        inLibrary: affinity.owned,
        played: affinity.played,
        liked: affinity.favorites,
        affinity: affinity.score,
        affinityDetail: affinity,
      },
    });
  } catch (err) {
    console.error("company profile error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du studio." });
  }
});

// POST /api/companies/:name/favorite
// Épingle / désépingle un studio dans les favoris du joueur connecté. On
// (re)construit le profil pour figer un nom d'affichage + logo + pays propres.
router.post("/:name/favorite", requireAuth, async (req, res) => {
  try {
    const profile = await buildCompanyProfile(req.params.name);
    if (!profile) {
      return res.status(404).json({ error: "Studio ou éditeur introuvable." });
    }
    const user = await User.findById(req.userId).select("favoriteCompanies");
    if (!user) return res.status(401).json({ error: "Non authentifié." });

    const list = user.favoriteCompanies || [];
    const idx = list.findIndex(
      (c) => normName(c.name) === normName(profile.name)
    );
    let favorited;
    if (idx >= 0) {
      list.splice(idx, 1);
      favorited = false;
    } else {
      list.unshift({
        name: profile.name,
        logo: profile.logo || null,
        country: profile.country || null,
        addedAt: new Date(),
      });
      favorited = true;
    }
    user.favoriteCompanies = list;
    await user.save();
    if (favorited) triggerMissionCheck(req.userId); // mission « Fidèle au studio »
    res.json({ favorited, favoriteCompanies: user.favoriteCompanies });
  } catch (err) {
    console.error("company favorite error:", err.message);
    res.status(500).json({ error: "Impossible de mettre à jour les favoris." });
  }
});

export default router;
