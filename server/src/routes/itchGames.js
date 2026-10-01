// ======================================================================
//  Ajouter un jeu à partir de son lien itch.io
// ======================================================================
//
// Le pendant de routes/steamGames.js. Le besoin est plus fort encore qu'avec
// Steam : sur un échantillon de 86 jeux itch.io populaires (octobre 2026),
// 22 n'existaient pas chez IGDB — visual novels, démos, jeux de game jam. Un
// jeu que la recherche ne trouve pas s'ajoute donc par son lien :
//
//   1. IGDB connaît la page (il range les liens itch.io dans les sites d'un
//      jeu) → on ouvre la vraie fiche ;
//   2. sinon on lit la page itch.io et on fabrique une fiche locale
//      (lib/localGame.js, `coreFromItch`), que la synchro recollera sur la
//      vraie le jour où IGDB ajoutera le jeu (lib/itchIgdbSync.js).
//
// Les clients n'appellent qu'une porte : POST /api/steam-games/resolve, qui
// passe ici les liens itch.io (cf. `resolveItchLink`).

import express from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import ItchGame from "../models/ItchGame.js";
import { fetchItchGame, parseItchUrl } from "../lib/itchStore.js";
import { coreFromItch, itchLocalIdOf } from "../lib/localGame.js";
import { matchItchUrlsToIgdb, mergeItchIntoIgdb } from "../lib/itchIgdbSync.js";

const router = express.Router();

/** La forme courte d'une fiche itch.io, celle que les clients affichent. */
export function shortItch(doc) {
  return {
    gameId: itchLocalIdOf(doc.itchId),
    itchId: doc.itchId,
    name: doc.name,
    cover: doc.cover || null,
    year: doc.releaseDate ? new Date(doc.releaseDate * 1000).getFullYear() : null,
    status: doc.status || null,
    developers: doc.authors || [],
    itchUrl: doc.url,
    source: "itch",
  };
}

/**
 * Résout un lien itch.io : `{ kind: "igdb", gameId, … }` ou
 * `{ kind: "local", created, game }`. Lève une erreur (avec `status`) sinon.
 */
export async function resolveItchLink(input, userId) {
  const parsed = parseItchUrl(input);
  if (!parsed) {
    const err = new Error(
      "Ce lien n'est pas une page de jeu itch.io. Colle l'adresse complète, du genre auteur.itch.io/nom-du-jeu."
    );
    err.status = 400;
    throw err;
  }

  // --- 1. Une fiche déjà connue (par son adresse) : déjà rattachée ? ---
  const known = await ItchGame.findOne({ url: parsed.url }).lean();
  if (known?.igdbId) return { kind: "igdb", gameId: known.igdbId, name: known.name };

  // --- 2. IGDB connaît-il cette page ? ---
  const match = (await matchItchUrlsToIgdb([parsed.url]).catch(() => new Map())).get(parsed.url);
  if (match) {
    if (known) {
      // Une fiche locale existait : on la recolle tout de suite.
      await mergeItchIntoIgdb(known.itchId, match).catch(() => null);
      await ItchGame.updateOne(
        { _id: known._id },
        { $set: { igdbId: match.gameId, resolvedAt: new Date(), checkedAt: new Date() } }
      );
    }
    return { kind: "igdb", gameId: match.gameId, name: match.name, cover: match.cover };
  }

  // --- 3. Le jeu n'est nulle part : on lit sa page itch.io. ---
  const details = await fetchItchGame(parsed.url);
  if (!details) {
    const err = new Error(
      "itch.io ne montre rien à cette adresse. La page a peut-être été renommée, retirée, ou réservée aux comptes connectés."
    );
    err.status = 404;
    throw err;
  }

  // Le lien collé a pu rediriger vers la nouvelle adresse du jeu : on retente
  // IGDB avec celle-là, c'est elle qu'il aura.
  if (details.url !== parsed.url) {
    const again = (await matchItchUrlsToIgdb([details.url]).catch(() => new Map())).get(details.url);
    if (again) return { kind: "igdb", gameId: again.gameId, name: again.name, cover: again.cover };
  }

  const before = await ItchGame.findOne({ itchId: details.itchId }).lean();
  if (before?.igdbId) return { kind: "igdb", gameId: before.igdbId, name: before.name };
  const doc = await ItchGame.findOneAndUpdate(
    { itchId: details.itchId },
    { $set: details, $setOnInsert: { createdBy: userId || null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { kind: "local", created: !before, game: shortItch(doc) };
}

// ----------------------------------------------------------------------
//  POST /api/itch-games/resolve   { url }
// ----------------------------------------------------------------------
router.post("/resolve", requireAuth, async (req, res) => {
  try {
    res.json(await resolveItchLink(req.body?.url, req.userId));
  } catch (err) {
    console.error("itch resolve error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la lecture du lien." });
  }
});

// ----------------------------------------------------------------------
//  GET /api/itch-games/:itchId — la fiche locale telle quelle (diagnostic)
// ----------------------------------------------------------------------
router.get("/:itchId", optionalAuth, async (req, res) => {
  const itchId = Number(req.params.itchId);
  if (!itchId) return res.status(400).json({ error: "Identifiant invalide." });
  const doc = await ItchGame.findOne({ itchId }).lean();
  if (!doc) return res.status(404).json({ error: "Fiche inconnue." });
  res.json({ ...shortItch(doc), igdbId: doc.igdbId || null, core: coreFromItch(doc) });
});

// ----------------------------------------------------------------------
//  POST /api/itch-games/:itchId/refresh — relire la page itch.io
// ----------------------------------------------------------------------
// Un jeu en développement change de jaquette, de description et de statut.
router.post("/:itchId/refresh", requireAuth, async (req, res) => {
  try {
    const itchId = Number(req.params.itchId);
    const doc = await ItchGame.findOne({ itchId });
    if (!doc) return res.status(404).json({ error: "Fiche inconnue." });
    const details = await fetchItchGame(doc.url, { fresh: true });
    if (!details) return res.status(502).json({ error: "itch.io n'a rien renvoyé." });
    Object.assign(doc, details);
    await doc.save();
    res.json({ game: shortItch(doc) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Erreur lors du rafraîchissement." });
  }
});

export default router;
