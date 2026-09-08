import express from "express";

import { requireAuth } from "../middleware/auth.js";
import { resolveIgdbGame } from "../lib/gameSeasons.js";
import * as valorant from "../lib/valorantStore.js";

const router = express.Router();

// ============================================================
//  GET /api/game-store/:gameId — la boutique du jour, s'il y en a une
// ============================================================
// ⚠️ C'EST LE SERVEUR QUI DÉCIDE SI CETTE FICHE A UNE BOUTIQUE, PAS LE CLIENT.
// Le téléphone ne connaît qu'un id IGDB ; savoir que 126459 est Valorant
// demande de résoudre le jeu, ce que le serveur fait déjà pour les saisons
// (cf. lib/gameSeasons, `resolveIgdbGame`). Mettre cette table dans l'app,
// c'est la figer dans une version installée : le jour où l'id change ou où un
// deuxième jeu s'ajoute, il faudrait une mise à jour du store pour une
// constante.
//
// La réponse est donc TOUJOURS `{ store: … }` — `null` quand ce jeu n'a rien à
// montrer, quand la clé n'est pas configurée, ou quand la source est en panne.
// La fiche n'affiche alors simplement pas la section (cf. le composant
// ValorantStore côté mobile), jamais un bloc vide ni une erreur.
//
// ⚠️ ET CE N'EST PAS « TON » SHOP. La boutique servie ici est la VITRINE
// mondiale, la même pour tout le monde. Les quatre offres quotidiennes d'un
// joueur sont liées à son compte Riot et ne sont accessibles qu'avec ses
// identifiants, par des endpoints internes que Riot n'autorise pas — la raison
// longue est en tête de lib/valorantStore.
router.get("/:gameId", requireAuth, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (!Number.isFinite(gameId)) return res.status(400).json({ error: "Jeu invalide." });

    if (!valorant.isConfigured()) return res.json({ store: null });

    const valo = await resolveIgdbGame("Valorant");
    if (!valo || valo.id !== gameId) return res.json({ store: null });

    const store = await valorant.featuredStore().catch(() => null);
    res.json({ store: store ? { game: "valorant", ...store } : null });
  } catch (err) {
    console.error("game store error:", err.message);
    // Une boutique indisponible n'est pas une fiche cassée : on rend « rien à
    // montrer » plutôt qu'un 500 qui ferait rougir l'écran du jeu.
    res.json({ store: null });
  }
});

export default router;
