import { Router } from "express";
import SwitchPatchCache from "../models/SwitchPatchCache.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// Gestion des patchs FR Switch. Le scraping ne se fait plus sur le serveur
// (IP datacenter bloquée par Cloudflare) mais dans une app locale à IP
// résidentielle (AUTRES/nxbrew-manager) :
//   - un utilisateur clique « Demander » sur la fiche jeu → POST .../request
//   - l'app locale liste les demandes (GET /switch/requests, admin)
//   - l'app locale scrape puis pousse les données (POST /switch/:gameId, admin)

// --- Un utilisateur demande le scrape d'un jeu Switch ---
router.post("/switch/:gameId/request", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });
    const name = String(req.body?.name || "").trim().slice(0, 300);

    const doc = await SwitchPatchCache.findOne({ gameId });
    // Si un patch est déjà présent, une « demande » vaut re-scrape (MAJ) : on
    // pose quand même le drapeau, sans effacer les données existantes.
    await SwitchPatchCache.updateOne(
      { gameId },
      {
        $set: { requested: true, requestedAt: new Date(), ...(name ? { name } : {}) },
        $setOnInsert: { data: doc ? undefined : null },
      },
      { upsert: true }
    );
    res.json({ ok: true, requested: true });
  } catch (err) {
    console.error("switch patch request error:", err.message);
    res.status(500).json({ error: "Erreur lors de la demande." });
  }
});

// --- L'app locale récupère les demandes en attente (admin) ---
router.get("/switch/requests", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const docs = await SwitchPatchCache.find({ requested: true })
      .sort({ requestedAt: 1 })
      .lean();
    res.json({
      requests: docs.map((d) => ({
        gameId: d.gameId,
        name: d.name || "",
        requestedAt: d.requestedAt,
        hasData: !!d.data,
      })),
    });
  } catch (err) {
    console.error("switch patch requests error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liste complète (demandés + déjà scrapés) pour l'app locale (admin) ---
router.get("/switch/list", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const docs = await SwitchPatchCache.find({}).sort({ updatedAt: -1 }).lean();
    res.json({
      items: docs.map((d) => ({
        gameId: d.gameId,
        name: d.name || "",
        requested: !!d.requested,
        requestedAt: d.requestedAt,
        hasData: !!d.data,
        sections: d.data?.sections?.length || 0,
        size: d.data?.size || null,
        updateVersion: d.data?.updateVersion || null,
        pageUrl: d.data?.pageUrl || null,
        at: d.at,
      })),
    });
  } catch (err) {
    console.error("switch patch list error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- L'app locale pousse les données scrapées (admin) ---
// body: { name, data } — data = patch normalisé, ou null si « rien trouvé ».
router.post("/switch/:gameId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!gameId) return res.status(400).json({ error: "gameId invalide." });
    const name = String(req.body?.name || "").trim().slice(0, 300);
    const data = req.body?.data ?? null;

    await SwitchPatchCache.updateOne(
      { gameId },
      {
        $set: {
          data,
          ...(name ? { name } : {}),
          at: new Date(),
          requested: false,
          requestedAt: null,
        },
      },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("switch patch push error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

export default router;
