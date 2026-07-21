import express from "express";
import { getFreeGames } from "../lib/freeGames.js";

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

export default router;
