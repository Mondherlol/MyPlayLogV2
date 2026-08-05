import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { claimMission, recordMissionFlag } from "../lib/missions.js";

// Missions & badges : la récupération des récompenses et les gestes que seul
// le client peut constater. La LECTURE du catalogue vit avec le profil
// (GET /api/users/:username/missions).
const router = express.Router();

// POST /api/missions/:key/claim — encaisser la récompense d'une mission
// accomplie. Idempotent par construction : la seconde tentative répond 409.
router.post("/:key/claim", requireAuth, async (req, res) => {
  try {
    const { mission, balance } = await claimMission(req.userId, req.params.key);
    res.json({ mission, balance, claimed: true });
  } catch (err) {
    if (!err.status) console.error("mission claim error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// POST /api/missions/event — signaler un geste invisible en base (passage au
// thème sombre…). Le client l'appelle une fois ; le drapeau est dédoublonné.
router.post("/event", requireAuth, async (req, res) => {
  try {
    await recordMissionFlag(req.userId, String(req.body?.flag || ""));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

export default router;
