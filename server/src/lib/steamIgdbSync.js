// ======================================================================
//  Le jour où IGDB finit par connaître le jeu
// ======================================================================
//
// Une fiche locale (lib/localGame.js) est une SOLUTION D'ATTENTE. Le jeu des
// potes qui vient de sortir sur Steam finira, tôt ou tard, par être ajouté au
// catalogue IGDB — par son auteur, par un contributeur, ou par nous. À partir
// de ce moment-là il existe DEUX fiches pour le même jeu : la nôtre (`-appid`)
// et la vraie (`id` IGDB). Laisser les deux vivre, c'est couper la communauté
// en deux — des avis d'un côté, des avis de l'autre, aucun des deux ne voyant
// ceux de l'autre.
//
// Ce fichier fait donc deux choses :
//   1. il redemande périodiquement à IGDB si l'appid est enfin connu ;
//   2. le jour où il l'est, il RECOLLE tout ce qui pointait vers la fiche
//      locale sur la vraie fiche, puis marque la locale comme résolue.
//
// ⚠️ LA FUSION EST LE SEUL ENDROIT DÉLICAT, et c'est à cause d'un cas précis :
// un joueur peut avoir LES DEUX entrées — il avait ajouté la fiche locale, puis
// a ajouté le vrai jeu quand il est apparu. Renommer bêtement le `gameId` de la
// locale violerait l'index unique `{ user, gameId }` et ferait tout échouer. On
// fusionne donc les deux entrées en une, en ne perdant rien de ce que le joueur
// avait écrit.

import mongoose from "mongoose";
import SteamGame from "../models/SteamGame.js";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import Repost from "../models/Repost.js";
import Activity from "../models/Activity.js";
import GameAchievements from "../models/GameAchievements.js";
import GameText from "../models/GameText.js";
import GameTime from "../models/GameTime.js";
import CustomCover from "../models/CustomCover.js";
import { matchAppsToIgdb } from "./steam.js";
import { localIdOf } from "./localGame.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Une jaquette servie par Valve (donc posée par la fiche locale), par
// opposition à celle que le joueur aurait choisie lui-même.
const isSteamImage = (url) =>
  !url || /(?:steamstatic|steampowered|akamai\.steamstatic)\.com/i.test(String(url));

/**
 * Combien attendre avant de redemander à IGDB, selon le nombre d'échecs déjà
 * essuyés. Un jeu qui vient de sortir est ajouté au catalogue dans les jours
 * qui suivent : on regarde souvent au début. Un jeu qu'IGDB ignore depuis six
 * mois ne sera probablement jamais ajouté tout seul : on se calme, sans jamais
 * abandonner tout à fait (quelqu'un finira par le soumettre).
 */
export function nextDelay(checks) {
  if (checks < 7) return 12 * HOUR; // la première semaine
  if (checks < 20) return 2 * DAY; // le premier mois
  if (checks < 40) return 7 * DAY;
  return 30 * DAY;
}

/** Les fiches locales qu'il est temps de revérifier. */
async function dueGames(limit) {
  const rows = await SteamGame.find({ igdbId: null })
    .sort({ checkedAt: 1 })
    .limit(limit * 4) // on en lit plus qu'il n'en faut : beaucoup ne sont pas dues
    .lean();
  const now = Date.now();
  return rows
    .filter((d) => !d.checkedAt || now - new Date(d.checkedAt).getTime() >= nextDelay(d.checks || 0))
    .slice(0, limit);
}

/**
 * Recolle sur le jeu IGDB `igdbId` tout ce qui pointait vers la fiche locale de
 * `appid`. Rend le détail de ce qui a bougé.
 *
 * `igdb` porte le nom et la jaquette officiels : les entrées migrées les
 * adoptent. Garder le titre Steam serait pire que tout — c'est précisément le
 * titre japonais qu'on ne retrouvait pas.
 */
export async function mergeIntoIgdb(appid, igdbId, igdb = {}, { dryRun = false } = {}) {
  const localId = localIdOf(appid);
  const out = { moved: 0, merged: 0, lists: 0, other: 0 };

  const locals = await UserGame.find({ gameId: localId });
  if (!locals.length && dryRun) return out;

  for (const local of locals) {
    const existing = await UserGame.findOne({ user: local.user, gameId: igdbId });

    if (!existing) {
      out.moved++;
      if (dryRun) continue;
      local.gameId = igdbId;
      if (igdb.name) local.name = igdb.name;
      // La jaquette officielle remplace celle de Steam — mais PAS une jaquette
      // que le joueur a choisie lui-même. On les distingue à leur adresse :
      // une image Steam vient des serveurs de Valve.
      if (igdb.cover && isSteamImage(local.cover)) local.cover = igdb.cover;
      local.steamAppId = appid;
      await local.save();
      continue;
    }

    // --- Les deux entrées existent : on fusionne dans celle qui reste. ---
    out.merged++;
    if (dryRun) continue;

    // Règle : l'entrée IGDB gagne sur ce qu'elle a déjà rempli, et hérite de la
    // locale sur tout ce qu'elle a laissé vide. Autrement dit on ne perd RIEN
    // de ce que le joueur a écrit, et on n'écrase rien de plus récent.
    const inherit = [
      "review",
      "rating",
      "note",
      "playtimeHours",
      "startedAt",
      "finishedAt",
      "platform",
      "store",
    ];
    for (const f of inherit) {
      const cur = existing[f];
      const isEmpty = cur === null || cur === undefined || cur === "" || cur === 0;
      if (isEmpty && local[f] !== null && local[f] !== undefined && local[f] !== "") {
        existing[f] = local[f];
      }
    }
    // L'entrée qui reste n'avait pas de jaquette (elle a pu être créée par un
    // import sans image) : on lui donne l'OFFICIELLE, pas celle de Steam — on
    // vient justement de rejoindre la vraie fiche.
    if (!existing.cover && igdb.cover) existing.cover = igdb.cover;
    if (!existing.reviewMedia?.length && local.reviewMedia?.length)
      existing.reviewMedia = local.reviewMedia;
    if (!existing.pros?.length && local.pros?.length) existing.pros = local.pros;
    if (!existing.cons?.length && local.cons?.length) existing.cons = local.cons;
    if (!existing.reviewedAt && local.reviewedAt) existing.reviewedAt = local.reviewedAt;
    if (!existing.favorite && local.favorite) existing.favorite = true;
    if (!existing.platinum && local.platinum) existing.platinum = true;
    if (local.wasWishlisted) existing.wasWishlisted = true;
    // Un statut « souhait » sur l'entrée IGDB alors que la locale dit « en
    // cours » : c'est la locale qui a raison, c'est celle sur laquelle il
    // jouait réellement.
    if (existing.status === "wishlist" && local.status !== "wishlist")
      existing.status = local.status;
    existing.steamAppId = appid;

    await existing.save();
    await local.deleteOne();
  }

  if (dryRun) {
    out.lists = await List.countDocuments({ "items.refId": String(localId) });
    return out;
  }

  // --- Les listes : l'élément porte l'identifiant en TEXTE (`refId`). ---
  const listRes = await List.updateMany(
    { "items.refId": String(localId) },
    {
      $set: {
        "items.$[it].refId": String(igdbId),
        ...(igdb.name ? { "items.$[it].name": igdb.name } : {}),
        ...(igdb.cover ? { "items.$[it].image": igdb.cover } : {}),
      },
    },
    { arrayFilters: [{ "it.refId": String(localId) }] }
  );
  out.lists = listRes.modifiedCount || 0;

  // --- Tout le reste : un simple changement d'identifiant. ---
  // ⚠️ `GameAchievements` et `GameTime` sont volontairement ABSENTS des
  // renommages en masse : ils portent un index unique par (jeu, joueur) et
  // pourraient déjà avoir une ligne sur le jeu IGDB. On les traite après, en
  // ne gardant que celles qui ne font doublon avec rien.
  const simple = [
    [Repost, { gameId: localId }, { gameId: igdbId }],
    [Activity, { game: localId }, { game: igdbId }],
    [GameText, { gameId: localId }, { gameId: igdbId }],
    [CustomCover, { gameId: localId }, { gameId: igdbId }],
  ];
  for (const [Model, filter, set] of simple) {
    const r = await Model.updateMany(filter, { $set: set }).catch(() => null);
    out.other += r?.modifiedCount || 0;
  }

  for (const [Model, field] of [
    [GameAchievements, "gameId"],
    [GameTime, "gameId"],
  ]) {
    const rows = await Model.find({ [field]: localId }).catch(() => []);
    for (const row of rows) {
      // `GameAchievements` est unique par (joueur, jeu, plateforme),
      // `GameTime` par jeu seul : on cherche le jumeau avec les clés que le
      // modèle possède réellement, sinon on croirait toujours n'en avoir aucun.
      const twin = await Model.findOne({
        [field]: igdbId,
        ...(row.user ? { user: row.user } : {}),
        ...(row.platform ? { platform: row.platform } : {}),
      });
      // Une ligne existe déjà côté IGDB : la locale n'a plus rien à dire.
      if (twin) await row.deleteOne();
      else {
        row[field] = igdbId;
        await row.save().catch(() => row.deleteOne());
      }
      out.other++;
    }
  }

  return out;
}

/**
 * Un passage de la synchro : on demande à IGDB, pour les fiches locales qu'il
 * est temps de revérifier, si leur appid Steam est enfin au catalogue.
 *
 * Utilisé par la tâche de fond ET par le script admin (même code, `dryRun` en
 * plus) : c'est le contrat des scripts de maintenance (cf. lib/adminScripts.js).
 */
export async function runSteamIgdbSync({ dryRun = false, limit = 40 } = {}) {
  const due = await dueGames(limit);
  const log = [];
  if (!due.length) {
    return { summary: "Aucune fiche locale à vérifier pour l'instant.", log, resolved: 0 };
  }

  // UNE seule requête IGDB pour tout le lot (external_games accepte une liste).
  const matches = await matchAppsToIgdb(due.map((d) => d.appid)).catch(() => new Map());

  let resolved = 0;
  for (const doc of due) {
    const m = matches.get(doc.appid);
    if (!m) {
      if (!dryRun) {
        await SteamGame.updateOne(
          { _id: doc._id },
          { $set: { checkedAt: new Date() }, $inc: { checks: 1 } }
        );
      }
      continue;
    }

    resolved++;
    const moved = await mergeIntoIgdb(doc.appid, m.gameId, m, { dryRun });
    log.push(
      `${doc.name} (appid ${doc.appid}) → jeu IGDB ${m.gameId} « ${m.name} » : ` +
        `${moved.moved} entrée(s) migrée(s), ${moved.merged} fusionnée(s), ` +
        `${moved.lists} élément(s) de liste, ${moved.other} autre(s)`
    );

    if (!dryRun) {
      await SteamGame.updateOne(
        { _id: doc._id },
        { $set: { igdbId: m.gameId, resolvedAt: new Date(), checkedAt: new Date() }, $inc: { checks: 1 } }
      );
    }
  }

  return {
    resolved,
    summary:
      `${due.length} fiche(s) locale(s) vérifiée(s), ${resolved} désormais connue(s) d'IGDB` +
      (dryRun ? " — simulation, rien n'a été écrit." : "."),
    log,
  };
}

// ----------------------------------------------------------------------
//  La tâche de fond
// ----------------------------------------------------------------------
// Toutes les six heures, et une première fois deux minutes après le démarrage
// (pas AU démarrage : le serveur a mieux à faire que d'appeler IGDB pendant que
// les premières pages se chargent).
const SYNC_EVERY = 6 * HOUR;
const FIRST_RUN = 2 * 60 * 1000;

export function startSteamIgdbSync() {
  const tick = async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const out = await runSteamIgdbSync({});
      if (out.resolved) console.log(`[steam→igdb] ${out.summary}`);
    } catch (err) {
      console.error("steam→igdb sync error:", err.message);
    }
  };
  setTimeout(tick, FIRST_RUN).unref?.();
  setInterval(tick, SYNC_EVERY).unref?.();
}
