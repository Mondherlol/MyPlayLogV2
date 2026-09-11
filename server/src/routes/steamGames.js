// ======================================================================
//  Ajouter un jeu à partir de son lien Steam
// ======================================================================
//
// LE BESOIN, EN DEUX CAS RÉELS.
//
//   1. Le jeu EST chez IGDB, mais on ne le trouve pas. La page Steam s'affiche
//      en japonais, on cherche ce titre-là chez nous, et la recherche ne rend
//      rien — alors que la fiche existe, sous son titre occidental. Coller le
//      lien Steam règle ça d'un coup : l'appid, lui, ne dépend d'aucune langue.
//
//   2. Le jeu N'EST PAS chez IGDB. Un jeu indépendant qui vient de sortir n'y
//      entre pas tout seul : quelqu'un doit l'y ajouter, à la main, et la
//      modération prend des jours. En attendant, le jeu n'existe pas chez nous.
//      On fabrique donc une fiche locale (lib/localGame.js) pour qu'il puisse
//      entrer dans une collection tout de suite, et la synchro
//      (lib/steamIgdbSync.js) la recolle sur la vraie fiche le jour venu.
//
// ⚠️ ET NON, ON NE PEUT PAS SOUMETTRE LE JEU À IGDB AUTOMATIQUEMENT. L'API v4
// d'IGDB est en LECTURE SEULE : tous ses points d'entrée sont des requêtes de
// recherche, il n'en existe aucun pour contribuer. L'ajout passe uniquement par
// le formulaire du site, avec un compte connecté et une modération humaine.
// Ce qu'on fait à la place (`GET /:appid/submission`) : on prépare le dossier
// complet — tout ce que le formulaire demande, déjà rempli et prêt à coller —
// pour que la soumission prenne trente secondes au lieu de dix minutes.

import express from "express";
import { requireAuth, optionalAuth, requireStaff } from "../middleware/auth.js";
import SteamGame from "../models/SteamGame.js";
import UserGame from "../models/UserGame.js";
import { parseAppId, fetchAppDetails, storeUrl } from "../lib/steamStore.js";
import { matchAppsToIgdb } from "../lib/steam.js";
import { coreFromSteam, localIdOf } from "../lib/localGame.js";
import { mergeIntoIgdb } from "../lib/steamIgdbSync.js";

const router = express.Router();

// Les types d'applications Steam qu'on refuse de transformer en jeu.
//
// ⚠️ UN DLC N'EST PAS UN JEU À RANGER À PART, et c'est une décision déjà prise
// ailleurs : une extension est une case cochée sur le jeu de base (les `dlcs`
// d'une entrée de bibliothèque), pas une entrée à elle. Lui fabriquer une fiche
// locale créerait exactement le doublon qu'on a voulu éviter.
const REFUSED = {
  dlc: "C'est un contenu additionnel (DLC). Ajoute le jeu de base : son DLC se coche ensuite sur sa fiche.",
  music: "C'est une bande-son, pas un jeu.",
  video: "C'est une vidéo, pas un jeu.",
  hardware: "C'est du matériel, pas un jeu.",
};

/** La forme courte d'une fiche locale, celle que l'app affiche en résultat. */
function shortLocal(doc) {
  return {
    gameId: localIdOf(doc.appid),
    appid: doc.appid,
    name: doc.name,
    nameOriginal: doc.nameOriginal || null,
    cover: doc.cover || doc.header || null,
    year: doc.releaseDate ? new Date(doc.releaseDate * 1000).getFullYear() : null,
    releaseHuman: doc.releaseHuman || null,
    comingSoon: !!doc.comingSoon,
    developers: doc.developers || [],
    steamUrl: storeUrl(doc.appid),
    submitted: !!doc.submittedAt,
  };
}

// ----------------------------------------------------------------------
//  POST /api/steam-games/resolve   { url }
// ----------------------------------------------------------------------
// Le point d'entrée unique de la fonctionnalité : on colle un lien, on reçoit
// de quoi ouvrir une fiche. Trois réponses possibles, et l'app n'a qu'à lire
// `kind` puis naviguer vers `/game/${gameId}` dans les deux premiers cas.
router.post("/resolve", requireAuth, async (req, res) => {
  try {
    const appid = parseAppId(req.body?.url);
    if (!appid) {
      return res.status(400).json({
        error:
          "Ce lien n'est pas une page de jeu Steam. Colle l'adresse complète, du genre store.steampowered.com/app/3101040/.",
      });
    }

    // --- 1. IGDB connaît-il déjà cet appid ? C'est le cas le plus fréquent. ---
    const match = (await matchAppsToIgdb([appid]).catch(() => new Map())).get(appid);
    if (match?.gameId) {
      // Une fiche locale avait été créée avant qu'IGDB n'ajoute le jeu : c'est
      // le moment de la recoller, sans attendre le prochain passage de la
      // synchro — l'utilisateur est justement en train de demander ce jeu.
      const stale = await SteamGame.findOne({ appid, igdbId: null });
      if (stale) {
        await mergeIntoIgdb(appid, match.gameId, match).catch(() => null);
        await SteamGame.updateOne(
          { _id: stale._id },
          { $set: { igdbId: match.gameId, resolvedAt: new Date(), checkedAt: new Date() } }
        );
      }
      return res.json({
        kind: "igdb",
        gameId: match.gameId,
        name: match.name,
        cover: match.cover,
        appid,
      });
    }

    // --- 2. Une fiche locale déjà résolue : on redirige vers le vrai jeu. ---
    const known = await SteamGame.findOne({ appid }).lean();
    if (known?.igdbId) {
      return res.json({ kind: "igdb", gameId: known.igdbId, name: known.name, appid });
    }

    // --- 3. Le jeu n'est nulle part : on lit sa page Steam. ---
    const details = await fetchAppDetails(appid);
    if (!details) {
      return res.status(404).json({
        error:
          "Steam ne répond rien pour ce jeu. Sa page est peut-être privée, retirée, ou réservée à une région.",
      });
    }
    if (REFUSED[details.appType]) {
      return res.status(422).json({ error: REFUSED[details.appType] });
    }

    const created = !known;
    const doc = await SteamGame.findOneAndUpdate(
      { appid },
      {
        $set: details,
        $setOnInsert: { createdBy: req.userId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ kind: "local", created, game: shortLocal(doc) });
  } catch (err) {
    console.error("steam resolve error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la lecture du lien." });
  }
});

// ----------------------------------------------------------------------
//  GET /api/steam-games/:appid — la fiche locale telle quelle
// ----------------------------------------------------------------------
// Sert surtout au diagnostic et à l'app mobile : la fiche EST déjà servie par
// /api/games/:id/full (avec un id négatif), comme n'importe quel autre jeu.
router.get("/:appid", optionalAuth, async (req, res) => {
  const appid = Number(req.params.appid);
  if (!appid) return res.status(400).json({ error: "appid invalide." });
  const doc = await SteamGame.findOne({ appid }).lean();
  if (!doc) return res.status(404).json({ error: "Fiche inconnue." });
  res.json({
    ...shortLocal(doc),
    igdbId: doc.igdbId || null,
    core: coreFromSteam(doc),
  });
});

// ----------------------------------------------------------------------
//  POST /api/steam-games/:appid/refresh — relire la page Steam
// ----------------------------------------------------------------------
// Un jeu en accès anticipé change de jaquette, de description et de date. La
// fiche locale, elle, est figée au jour où on l'a créée.
router.post("/:appid/refresh", requireAuth, async (req, res) => {
  try {
    const appid = Number(req.params.appid);
    const doc = await SteamGame.findOne({ appid });
    if (!doc) return res.status(404).json({ error: "Fiche inconnue." });

    const details = await fetchAppDetails(appid);
    if (!details) return res.status(502).json({ error: "Steam n'a rien renvoyé." });

    Object.assign(doc, details);
    await doc.save();
    res.json({ game: shortLocal(doc) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Erreur lors du rafraîchissement." });
  }
});

// ----------------------------------------------------------------------
//  GET /api/steam-games/:appid/submission — le dossier pour IGDB
// ----------------------------------------------------------------------
// Tout ce que le formulaire d'ajout d'IGDB demande, déjà rassemblé. L'app en
// fait un bloc à copier et un bouton qui ouvre le formulaire.
router.get("/:appid/submission", requireAuth, async (req, res) => {
  const appid = Number(req.params.appid);
  const doc = await SteamGame.findOne({ appid }).lean();
  if (!doc) return res.status(404).json({ error: "Fiche inconnue." });

  const url = storeUrl(appid);
  // IGDB attend une date ISO dans son formulaire ; « Bientôt » n'en est pas une.
  const releaseIso = doc.releaseDate
    ? new Date(doc.releaseDate * 1000).toISOString().slice(0, 10)
    : null;

  const fields = {
    name: doc.name,
    alternativeName: doc.nameOriginal || null,
    // L'anglais d'abord : IGDB est un catalogue anglophone.
    summary: doc.shortDescriptionEn || doc.shortDescription || "",
    storyline: doc.description ? doc.description.slice(0, 2000) : "",
    releaseDate: releaseIso,
    releaseHuman: doc.releaseHuman || null,
    developers: doc.developers || [],
    publishers: doc.publishers || [],
    genres: doc.genres || [],
    platforms: (doc.oses || []).map(
      (os) => ({ windows: "PC (Microsoft Windows)", mac: "Mac", linux: "Linux" })[os] || os
    ),
    websites: [url, ...(doc.website ? [doc.website] : [])],
    cover: doc.cover || doc.header || null,
    screenshots: (doc.screenshots || []).slice(0, 6).map((s) => s.full).filter(Boolean),
  };

  // Le bloc prêt à coller. Le formulaire IGDB n'accepte aucun pré-remplissage
  // par URL — c'est donc l'utilisateur qui colle, champ par champ, et ce texte
  // est rangé dans le même ordre que le formulaire pour que ça aille vite.
  const clipboard = [
    `Name: ${fields.name}`,
    fields.alternativeName ? `Alternative name: ${fields.alternativeName}` : null,
    `Summary: ${fields.summary}`,
    fields.releaseDate ? `Release date: ${fields.releaseDate}` : `Release date: ${fields.releaseHuman || "TBA"}`,
    fields.developers.length ? `Developer: ${fields.developers.join(", ")}` : null,
    fields.publishers.length ? `Publisher: ${fields.publishers.join(", ")}` : null,
    fields.genres.length ? `Genres: ${fields.genres.join(", ")}` : null,
    fields.platforms.length ? `Platforms: ${fields.platforms.join(", ")}` : null,
    `Websites: ${fields.websites.join(" | ")}`,
    fields.cover ? `Cover: ${fields.cover}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  res.json({
    appid,
    steamUrl: url,
    // Le formulaire d'ajout d'IGDB. Il exige d'être connecté : l'app le dit
    // avant d'ouvrir l'onglet, sinon on tombe sur une page de connexion sans
    // comprendre pourquoi.
    formUrl: "https://www.igdb.com/games/new",
    fields,
    clipboard,
    submitted: !!doc.submittedAt,
  });
});

// L'utilisateur dit être allé au bout de la soumission. On ne peut pas le
// vérifier (IGDB n'expose rien), mais ça évite de reproposer la démarche à tout
// le monde sur une fiche déjà soumise.
router.post("/:appid/submitted", requireAuth, async (req, res) => {
  const appid = Number(req.params.appid);
  const doc = await SteamGame.findOneAndUpdate(
    { appid, submittedAt: null },
    { $set: { submittedAt: new Date(), submittedBy: req.userId } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: "Fiche inconnue ou déjà soumise." });
  res.json({ ok: true, submitted: true });
});

// ----------------------------------------------------------------------
//  GET /api/steam-games — l'inventaire des fiches locales (staff)
// ----------------------------------------------------------------------
// Qui attend quoi : combien de joueurs ont ce jeu en collection, depuis quand
// la fiche existe, a-t-elle été soumise à IGDB. C'est la liste des jeux qu'il
// reste à faire entrer au catalogue.
router.get("/", requireAuth, requireStaff, async (req, res) => {
  const pending = req.query.all === "1" ? {} : { igdbId: null };
  const docs = await SteamGame.find(pending).sort({ createdAt: -1 }).limit(200).lean();

  const counts = await UserGame.aggregate([
    { $match: { gameId: { $in: docs.map((d) => localIdOf(d.appid)) } } },
    { $group: { _id: "$gameId", n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [c._id, c.n]));

  res.json({
    games: docs.map((d) => ({
      ...shortLocal(d),
      igdbId: d.igdbId || null,
      checks: d.checks || 0,
      checkedAt: d.checkedAt || null,
      createdAt: d.createdAt,
      owners: byId.get(localIdOf(d.appid)) || 0,
    })),
  });
});

export default router;
