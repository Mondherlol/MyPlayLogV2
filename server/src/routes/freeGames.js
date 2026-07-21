import express from "express";
import { getFreeGames, getFreeGameForIgdbId } from "../lib/freeGames.js";

// Jeux gratuits à récupérer cette semaine (Epic / Steam / GOG / Prime…),
// agrégés depuis GamerPower et mis en cache (voir lib/freeGames.js).
const router = express.Router();

// GET /api/free-games — liste des giveaways de jeux en cours.
router.get("/", async (_req, res) => {
  try {
    const games = await getFreeGames();
    res.json({ games });
  } catch (err) {
    console.error("free-games error:", err.message);
    res.status(502).json({ error: "Impossible de récupérer les jeux gratuits." });
  }
});

// GET /api/free-games/for/:gameId — le giveaway en cours pour CE jeu IGDB
// (banderole de la fiche de jeu). Renvoie { game: null } si rien en cours :
// c'est le cas courant, donc jamais d'erreur.
router.get("/for/:gameId", async (req, res) => {
  try {
    res.json({ game: await getFreeGameForIgdbId(req.params.gameId) });
  } catch {
    res.json({ game: null });
  }
});

export default router;
