// ======================================================================
//  Une fiche itch.io, le jour où IGDB connaît le jeu
// ======================================================================
//
// Le pendant de lib/steamIgdbSync.js pour itch.io. IGDB n'a pas d'identifiant
// itch.io à lui, mais il range l'adresse de la page dans les sites du jeu
// (`websites`, type 15). C'est donc par l'ADRESSE qu'on reconnaît le jeu —
// d'où l'adresse canonique gardée dans ItchGame.url.
//
// La fusion elle-même est celle des fiches Steam (`mergeLocalIntoIgdb`) : on
// ne perd rien de ce que le joueur a écrit, et une seule fiche reste.

import mongoose from "mongoose";
import ItchGame from "../models/ItchGame.js";
import { igdbQuery } from "./igdb.js";
import { itchLocalIdOf } from "./localGame.js";
import { mergeLocalIntoIgdb, nextDelay } from "./steamIgdbSync.js";

const HOUR = 60 * 60 * 1000;
const WEBSITE_ITCH = 15;
const IMG = "https://images.igdb.com/igdb/image/upload";

// Une jaquette servie par itch.io (donc posée par la fiche locale).
const isItchImage = (url) => !url || /itch\.zone|itch\.io/i.test(String(url));

// IGDB écrit l'adresse comme le contributeur l'a collée : avec ou sans la
// barre finale, parfois en http. On essaie les quatre.
const variants = (url) => {
  const base = String(url).replace(/\/+$/, "").replace(/^http:/, "https:");
  return [base, `${base}/`, base.replace(/^https:/, "http:"), `${base.replace(/^https:/, "http:")}/`];
};
const norm = (url) => String(url || "").replace(/\/+$/, "").replace(/^http:/, "https:").toLowerCase();

/**
 * Adresse itch.io (canonique) → `{ gameId, name, cover }` pour celles qu'IGDB
 * connaît. Une requête pour les adresses, une pour les noms et jaquettes.
 */
export async function matchItchUrlsToIgdb(urls) {
  const out = new Map();
  const list = [...new Set(urls.filter(Boolean))];
  if (!list.length) return out;
  const gameByUrl = new Map();
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100).flatMap(variants);
    const rows = await igdbQuery(
      "websites",
      `fields url,game; where url = (${part.map((u) => `"${u.replace(/"/g, "")}"`).join(",")}) & type = ${WEBSITE_ITCH}; limit 500;`
    );
    for (const r of rows || []) if (r.game) gameByUrl.set(norm(r.url), r.game);
  }
  const ids = [...new Set(gameByUrl.values())];
  if (!ids.length) return out;
  const games = await igdbQuery(
    "games",
    `fields name,cover.image_id; where id = (${ids.join(",")}); limit ${ids.length};`
  );
  const byId = new Map((games || []).map((g) => [g.id, g]));
  for (const url of list) {
    const gameId = gameByUrl.get(norm(url));
    const g = gameId && byId.get(gameId);
    if (!g) continue;
    out.set(url, {
      gameId,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    });
  }
  return out;
}

/** Recolle la fiche locale d'un jeu itch.io sur le jeu IGDB `igdb.gameId`. */
export async function mergeItchIntoIgdb(itchId, igdb, opts = {}) {
  return mergeLocalIntoIgdb(itchLocalIdOf(itchId), igdb.gameId, igdb, {
    ...opts,
    isSourceImage: isItchImage,
  });
}

async function dueGames(limit) {
  const rows = await ItchGame.find({ igdbId: null })
    .sort({ checkedAt: 1 })
    .limit(limit * 4)
    .lean();
  const now = Date.now();
  return rows
    .filter((d) => !d.checkedAt || now - new Date(d.checkedAt).getTime() >= nextDelay(d.checks || 0))
    .slice(0, limit);
}

/** Un passage de la synchro (tâche de fond, et script admin avec `dryRun`). */
export async function runItchIgdbSync({ dryRun = false, limit = 40 } = {}) {
  const due = await dueGames(limit);
  const log = [];
  if (!due.length) {
    return { summary: "Aucune fiche itch.io à vérifier pour l'instant.", log, resolved: 0 };
  }
  const matches = await matchItchUrlsToIgdb(due.map((d) => d.url)).catch(() => new Map());

  let resolved = 0;
  for (const doc of due) {
    const m = matches.get(doc.url);
    if (!m) {
      if (!dryRun) {
        await ItchGame.updateOne(
          { _id: doc._id },
          { $set: { checkedAt: new Date() }, $inc: { checks: 1 } }
        );
      }
      continue;
    }
    resolved++;
    const moved = await mergeItchIntoIgdb(doc.itchId, m, { dryRun });
    log.push(
      `${doc.name} (itch ${doc.itchId}) → jeu IGDB ${m.gameId} « ${m.name} » : ` +
        `${moved.moved} entrée(s) migrée(s), ${moved.merged} fusionnée(s), ` +
        `${moved.lists} élément(s) de liste, ${moved.other} autre(s)`
    );
    if (!dryRun) {
      await ItchGame.updateOne(
        { _id: doc._id },
        { $set: { igdbId: m.gameId, resolvedAt: new Date(), checkedAt: new Date() }, $inc: { checks: 1 } }
      );
    }
  }
  return {
    resolved,
    summary:
      `${due.length} fiche(s) itch.io vérifiée(s), ${resolved} désormais connue(s) d'IGDB` +
      (dryRun ? " — simulation, rien n'a été écrit." : "."),
    log,
  };
}

// Même rythme que la synchro Steam : toutes les six heures, la première fois
// trois minutes après le démarrage (décalée d'une minute sur celle de Steam).
const SYNC_EVERY = 6 * HOUR;
const FIRST_RUN = 3 * 60 * 1000;

export function startItchIgdbSync() {
  const tick = async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const out = await runItchIgdbSync({});
      if (out.resolved) console.log(`[itch→igdb] ${out.summary}`);
    } catch (err) {
      console.error("itch→igdb sync error:", err.message);
    }
  };
  setTimeout(tick, FIRST_RUN).unref?.();
  setInterval(tick, SYNC_EVERY).unref?.();
}
