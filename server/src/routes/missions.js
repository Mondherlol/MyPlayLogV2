import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { optionalAuth } from "../middleware/auth.js";
import {
  badgeHolders,
  claimMission,
  recordMissionFlag,
  setEquippedBadge,
} from "../lib/missions.js";

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

// PUT /api/missions/equipped — épingler (ou retirer) le badge affiché à côté
// du pseudo. `{ key: null }` retire. Le serveur refuse un badge non décroché.
router.put("/equipped", requireAuth, async (req, res) => {
  try {
    const badge = await setEquippedBadge(req.userId, req.body?.key ?? null);
    res.json({ badge });
  } catch (err) {
    if (!err.status) console.error("equip badge error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// GET /api/missions/:key/holders — les joueurs qui ont ce badge, ceux que
// l'on suit en tête. Visible sans compte (la liste est alors simplement
// classée par date d'obtention).
router.get("/:key/holders", optionalAuth, async (req, res) => {
  try {
    res.json(await badgeHolders(req.params.key, req.userId));
  } catch (err) {
    if (!err.status) console.error("badge holders error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

export default router;
