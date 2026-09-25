import express from "express";
import { optionalAuth, requireAdmin, requireAuth } from "../middleware/auth.js";
import { recommendForUser, similarGames } from "../lib/recoEngine.js";
import { getRecoCatalogState, runRecoCatalogSync } from "../lib/recoCatalog.js";
import { getCoPlayState } from "../lib/recoCoPlay.js";

// ======================================================================
//  /api/reco — les recommandations calculées (lib/recoEngine.js)
// ======================================================================
// À ne pas confondre avec /api/recommendations, qui sont les jeux qu'un AMI
// t'a conseillés. Ici, c'est la machine.

const router = express.Router();

// 503 tant que le catalogue n'est pas synchronisé : le client sait alors qu'il
// doit se rabattre sur autre chose, plutôt que d'afficher des rayons vides.
const notReady = (res) =>
  res.status(503).json({ error: "Le catalogue de recommandations n'est pas encore prêt." });

// GET /api/reco — tes rayons : pour toi, parce que tu as adoré X, pépites, à venir.
router.get("/", requireAuth, async (req, res) => {
  try {
    const out = await recommendForUser(req.userId);
    if (!out) return notReady(res);
    res.json(out);
  } catch (err) {
    console.error("reco:", err);
    res.status(500).json({ error: "Impossible de calculer tes recommandations." });
  }
});

// GET /api/reco/similar/:id — les jeux qui ressemblent à celui-ci.
router.get("/similar/:id", optionalAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Jeu invalide." });
  try {
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 20));
    const games = await similarGames(id, { userId: req.userId || null, limit });
    if (!games) return notReady(res);
    res.json({ games });
  } catch (err) {
    console.error("reco similar:", err);
    res.status(500).json({ error: "Impossible de trouver des jeux similaires." });
  }
});

// GET /api/reco/status — l'état du catalogue et du co-jeu (admin).
router.get("/status", requireAuth, requireAdmin, async (req, res) => {
  const [catalog, coPlay] = await Promise.all([getRecoCatalogState(), getCoPlayState()]);
  res.json({ ...catalog, coPlay });
});

// POST /api/reco/sync — force un passage complet (admin). Répond tout de suite :
// le passage prend deux minutes, l'état se suit sur /status.
router.post("/sync", requireAuth, requireAdmin, async (req, res) => {
  runRecoCatalogSync().catch(() => {});
  res.json({ started: true });
});

export default router;
