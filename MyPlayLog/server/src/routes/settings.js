import express from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { FEATURES, readFeatures, setFeature } from "../lib/features.js";

// ======================================================================
//  Réglages de l'app — les pages qu'on allume et qu'on éteint
// ======================================================================
// Le client lit ces drapeaux au démarrage (ils arrivent avec /auth/me) et sait
// alors quoi montrer dans la barre latérale. Cette route sert pour le RESTE :
// le panneau d'admin, qui bascule un interrupteur et veut la réponse tout de
// suite, sans rechargement.
//
// La barrière réelle n'est pas ici : chaque section éteinte refuse elle-même
// ses requêtes (requireFeature). Cacher un lien n'a jamais empêché personne
// d'appeler l'API.

const router = express.Router();

// GET /api/settings — l'état des drapeaux (tout compte connecté).
router.get("/", requireAuth, async (_req, res) => {
  res.json({ features: await readFeatures() });
});

// GET /api/settings/features — la même chose, avec le libellé et l'intention
// de chaque drapeau : de quoi dessiner le panneau d'admin sans recopier la
// liste côté client.
router.get("/features", requireAuth, requireAdmin, async (_req, res) => {
  const state = await readFeatures();
  res.json({
    features: Object.entries(FEATURES).map(([key, def]) => ({
      key,
      label: def.label,
      hint: def.hint,
      default: def.default,
      enabled: state[key],
    })),
  });
});

// PATCH /api/settings/features/:key — allume ou éteint.
router.patch("/features/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const features = await setFeature(
      req.params.key,
      req.body?.enabled === true,
      req.userId
    );
    res.json({ features });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
