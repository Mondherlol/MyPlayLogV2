import express from "express";

import List from "../models/List.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";

// ============================================================
//  GET /api/stats — les chiffres de la page d'accueil publique
// ============================================================
// ⚠️ PUBLIQUE, ET C'EST TOUT L'INTÉRÊT. La page d'accueil des visiteurs non
// connectés ne peut taper aucune des autres routes : elles exigent toutes un
// jeton. Elle affichait donc des promesses (« track, note, partage ») là où
// des CHIFFRES VRAIS disent la même chose en mieux — « 1 284 jeux suivis » se
// vérifie d'un coup d'œil, « la meilleure plateforme pour les joueurs » ne se
// vérifie pas du tout.
//
// ⚠️ AUCUNE DONNÉE PERSONNELLE NE SORT D'ICI. Que des totaux, et des jaquettes
// de jeux — des images de catalogue, déjà publiques partout ailleurs. Pas un
// pseudo, pas un avatar, pas une note.
//
// ⚠️ ET C'EST CACHÉ DIX MINUTES. C'est la page la plus exposée du site (chaque
// visiteur y passe, et les robots d'indexation aussi) : sans ce cache, chaque
// passage déclencherait un `distinct` et deux agrégations sur la collection la
// plus lourde. Les chiffres n'ont pas besoin d'être à la seconde — ils ont
// besoin d'être vrais, ce qui n'est pas la même chose.

const router = express.Router();

const TTL = 10 * 60 * 1000;
const cache = { at: 0, data: null };

// Le nombre de jaquettes envoyées au bandeau. Il en faut assez pour que la
// boucle ne se remarque pas, pas assez pour que la page pèse : les trois rangées
// se partagent le lot et chacune repart au début à un endroit différent.
const COVERS = 30;

router.get("/", async (_req, res) => {
  try {
    if (cache.data && Date.now() - cache.at < TTL) {
      return res.json(cache.data);
    }

    const [games, players, lists, osts, characters, hoursAgg, covers] =
      await Promise.all([
        // Le catalogue tel qu'il est VRAIMENT utilisé ici : un jeu compte s'il
        // est dans la bibliothèque de quelqu'un. Annoncer les 300 000 fiches
        // d'IGDB serait le chiffre de quelqu'un d'autre.
        UserGame.distinct("gameId").then((ids) => ids.length),
        User.estimatedDocumentCount(),
        List.countDocuments({ visibility: "public" }),
        UserGame.countDocuments({ "favoriteOst.name": { $nin: [null, ""] } }),
        UserGame.countDocuments({ "favoriteCharacter.name": { $nin: [null, ""] } }),
        UserGame.aggregate([
          { $group: { _id: null, h: { $sum: "$playtimeHours" } } },
        ]),
        // Les jaquettes du bandeau : les jeux les plus présents dans les
        // bibliothèques. Aucun appel IGDB — on ne relit que ce qu'on a déjà.
        UserGame.aggregate([
          { $match: { cover: { $nin: [null, ""] } } },
          { $group: { _id: "$gameId", n: { $sum: 1 }, cover: { $first: "$cover" } } },
          { $sort: { n: -1 } },
          { $limit: COVERS },
          { $project: { _id: 0, id: "$_id", cover: 1 } },
        ]),
      ]);

    const data = {
      games,
      players,
      lists,
      osts,
      characters,
      hours: Math.round(hoursAgg?.[0]?.h || 0),
      covers,
    };
    cache.at = Date.now();
    cache.data = data;
    res.json(data);
  } catch (err) {
    console.error("stats error:", err.message);
    // ⚠️ UN 200 AVEC DES ZÉROS, PAS UN 500. Ces chiffres décorent une page
    // d'accueil : s'ils manquent, la page doit s'afficher quand même. Le client
    // masque simplement la ligne (cf. client/src/pages/Landing.jsx).
    res.json({ games: 0, players: 0, lists: 0, osts: 0, characters: 0, hours: 0, covers: [] });
  }
});

export default router;
