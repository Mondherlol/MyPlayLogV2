import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import { igdbQuery } from "./igdb.js";
import { warmGameMeta } from "./gameMeta.js";
import { recordGameActivity } from "./activity.js";
import { triggerMissionCheck } from "./missions.js";

// ======================================================================
//  « !add <jeu> » — ajouter à sa liste de souhaits depuis Discord
// ======================================================================
// Le geste le plus courant du site (« tiens, ça a l'air bien, je le note »)
// arrive presque toujours pendant qu'on discute — donc sur Discord, et pas
// devant MyPlayLog. D'où cette commande : entre le moment où un copain cite un
// jeu et celui où il est dans la wishlist, il ne doit rien y avoir de plus
// qu'une ligne à taper.
//
// DEUX PRÉCAUTIONS, ET ELLES SE RESSEMBLENT :
//
//   1. ON N'AJOUTE JAMAIS SUR UNE DEVINETTE. La recherche propose, l'humain
//      choisit (des boutons, cf. discordBot.js). Ajouter d'office le premier
//      résultat mettrait « FIFA 14 » dans la wishlist de quelqu'un qui a tapé
//      « fifa », et une liste qu'on doit nettoyer est pire que pas de liste.
//   2. ON NE DÉGRADE JAMAIS UNE ENTRÉE EXISTANTE. Un jeu déjà terminé qui
//      repasserait en « souhait » parce qu'on a retapé son nom dans un salon,
//      c'est de la donnée perdue. On le dit, et on ne touche à rien.
//
// L'ajout refait ici ce que fait PUT /api/library/:gameId (upsert +
// pré-chauffe des métadonnées + carte de fil + missions). C'est une petite
// duplication assumée : la route est une route Express, elle attend une requête
// authentifiée, et la faire appeler par la Gateway aurait demandé de fabriquer
// une fausse requête — plus fragile que ces quinze lignes.

const IMG = "https://images.igdb.com/igdb/image/upload";

// Recherche IGDB. Vrais jeux uniquement, les plus notés d'abord.
//
// UN MOT-CLÉ À LA FOIS, ET C'EST TOUT L'INTÉRÊT. L'explorateur du site cherche
// la sous-chaîne entière (`name ~ *"zelda tears"*`), ce qui marche quand on
// tape dans un champ de recherche en regardant les résultats se filtrer. Dans
// un salon, on tape « zelda tears » — et aucun titre ne contient cette
// sous-chaîne, donc zéro résultat, alors que le jeu existe et que la personne
// l'a parfaitement décrit. On exige donc que CHAQUE mot apparaisse quelque
// part dans le titre, ce qui retrouve « The Legend of Zelda: Tears of the
// Kingdom » sans ramener la moitié du catalogue.
export async function searchGames(term, limit = 5) {
  const safe = String(term || "").replace(/["\\]/g, "").trim().slice(0, 80);
  if (safe.length < 2) return [];

  const words = safe.split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  const terms = words.length ? words : [safe];
  const nameMatch = terms
    .map((w) => `(name ~ *"${w}"* | alternative_names.name ~ *"${w}"*)`)
    .join(" & ");

  const q =
    "fields name,cover.image_id,first_release_date,total_rating_count;" +
    ` where cover != null & version_parent = null & game_type = (0,4,8,9,10,11)` +
    ` & ${nameMatch};` +
    " sort total_rating_count desc; limit " +
    limit +
    ";";
  try {
    const raw = await igdbQuery("games", q);
    return raw.map((g) => ({
      gameId: g.id,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getUTCFullYear()
        : null,
    }));
  } catch (err) {
    console.error("discord search error:", err.message);
    return [];
  }
}

// Un jeu par son identifiant IGDB. Sert au clic sur un bouton : plutôt que de
// garder les résultats de recherche en mémoire (perdus au moindre
// redéploiement, et le bouton devient mort), on ne transporte que l'id dans le
// bouton et on redemande le jeu au moment du clic.
export async function gameById(gameId) {
  try {
    const raw = await igdbQuery(
      "games",
      `fields name,cover.image_id,first_release_date; where id = ${Number(gameId)}; limit 1;`
    );
    const g = raw[0];
    if (!g) return null;
    return {
      gameId: g.id,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getUTCFullYear()
        : null,
    };
  } catch (err) {
    console.error("discord gameById error:", err.message);
    return null;
  }
}

// Le compte du site derrière un identifiant Discord, ou null.
export const userOfDiscord = (discordId) =>
  User.findOne({ "discord.discordId": String(discordId) })
    .select("_id username")
    .lean();

// Ajoute (ou signale) un jeu dans la liste de souhaits.
// Renvoie { ok, already, status, entry } — jamais d'exception : l'appelant est
// un salon Discord, il doit toujours avoir une phrase à afficher.
export async function addToWishlist(userId, game) {
  const prev = await UserGame.findOne({ user: userId, gameId: game.gameId }).lean();
  if (prev) {
    // Déjà dans la bibliothèque : on ne rétrograde rien (cf. précaution n°2).
    return { ok: false, already: true, status: prev.status, name: prev.name };
  }

  const entry = await UserGame.findOneAndUpdate(
    { user: userId, gameId: game.gameId },
    {
      $set: {
        user: userId,
        gameId: game.gameId,
        name: game.name,
        cover: game.cover || null,
        status: "wishlist",
        // Le passage par la wishlist, retenu une fois pour toutes : c'est lui
        // que lit la mission « Souhait exaucé » le jour où le jeu est joué.
        wasWishlisted: true,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Les mêmes suites que sur le site : sans elles, un jeu ajouté depuis
  // Discord n'apparaîtrait pas dans le fil des amis et ne compterait pour
  // aucune mission — il aurait l'air d'être arrivé tout seul.
  warmGameMeta(game.gameId);
  recordGameActivity({
    actor: userId,
    gameId: game.gameId,
    gameName: entry.name,
    gameCover: entry.cover || null,
    changes: [{ kind: "added", status: "wishlist" }],
  });
  triggerMissionCheck(userId);

  return { ok: true, already: false, status: "wishlist", name: entry.name };
}

// Le compte des souhaits, pour dire « et de 12 » après un ajout : un nombre qui
// monte fait plus pour l'habitude qu'un « ajouté ✓ » de plus.
export const wishlistCount = (userId) =>
  UserGame.countDocuments({ user: userId, status: "wishlist" });
