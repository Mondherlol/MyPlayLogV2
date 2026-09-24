// ======================================================================
//  Compagnon PC — ce qui arrive, ce qui s'applique, ce qui s'annule
// ======================================================================
//
// Le compagnon (companion/ à la racine du dépôt) signale des JEUX (dossiers
// d'émulateurs, dossiers de la bibliothèque de jeux du PC), des SUCCÈS et du
// TEMPS DE JEU. Rien de tout ça ne touche le profil directement : chaque envoi
// devient un CompanionEvent, appliqué seulement quand le joueur l'a validé
// sur le site (ou tout seul, s'il a choisi le mode automatique ET que le jeu
// est déjà validé). Tout ce qui a été appliqué se défait (undoEvent).
//
// ⚠️ APPLIQUER ET ANNULER DOIVENT RESTER SYMÉTRIQUES. Un succès appliqué entre
// dans GameAchievements (plateforme `local`), du temps s'ajoute à
// UserGame.playtimeHours, un jeu entre dans la bibliothèque. Annuler retire
// exactement ça, sur le jeu IGDB où ça avait été appliqué (appliedGameId) —
// pas sur celui qu'on aurait choisi depuis.

import CompanionEvent from "../models/CompanionEvent.js";
import CompanionGame from "../models/CompanionGame.js";
import GameAchievements from "../models/GameAchievements.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import { getAchievementSchema, matchAppsToIgdb } from "./steam.js";
import { matchNamesToIgdb, simplifyName } from "./psn.js";
import { createTtlCache } from "./ttlCache.js";

// Deux envois du même jeu à moins de 30 min d'écart = la même ligne.
const MERGE_GAP = 30 * 60 * 1000;

// ----------------------------------------------------------------------
//  Reconnaître le jeu
// ----------------------------------------------------------------------
// Groupes de la scène et repackers : retirés SEULEMENT en suffixe
// (« Jeu-RUNE », « Jeu.v1.2-TENOKE ») — « Rune Factory » garde son nom.
const GROUPS =
  "rune|codex|tenoke|skidrow|empress|flt|razor1911|plaza|goldberg|elamigos|dodi|fitgirl|gog|p2p|doge|anadius|onlinefix|repack";

/** Nom de dossier → nom cherchable : sans étiquettes de repack ni versions. */
export function cleanFolderName(raw) {
  return String(raw || "")
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(new RegExp(`[-._ ]+(?:${GROUPS})\\s*$`, "i"), "")
    .replace(/\bv(?:er(?:sion)?)?\s?\d+(?:[._]\d+)+[a-z]?\b/gi, " ")
    .replace(/\bbuild[\s._]?\d+\b/gi, " ")
    .replace(/[_.\-–—]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Clé stable d'un jeu côté PC : l'appid s'il y en a un, sinon le nom. */
export function keyOf(appid, rawName) {
  if (Number(appid) > 0) return `steam:${Number(appid)}`;
  const k = simplifyName(cleanFolderName(rawName));
  return k ? `dir:${k}` : null;
}

// appid → jeu IGDB. Un jour de cache : ça ne bouge pas.
const apps = createTtlCache({ name: "companion:apps", max: 3000, ttl: 24 * 60 * 60 * 1000 });
export async function gameOfApp(appid) {
  const hit = apps.get(appid);
  if (hit !== undefined) return hit;
  const map = await matchAppsToIgdb([appid]).catch(() => new Map());
  const g = map.get(appid) || null;
  apps.set(appid, g);
  return g;
}

/**
 * Propose un jeu IGDB : par l'appid Steam d'abord, sinon par le nom (celui du
 * dossier, ou à défaut celui que Steam donne à l'appid). Modifie `g` sans
 * l'enregistrer.
 */
export async function matchGame(g) {
  let m = null;
  if (g.appid) {
    m = await gameOfApp(g.appid);
    if (!m && !g.rawName) {
      const schema = await getAchievementSchema(g.appid).catch(() => null);
      if (schema?.gameName) g.rawName = schema.gameName;
    }
  }
  const q = cleanFolderName(g.rawName);
  // Second essai, les mots collés décollés : « SolCesto » → « Sol Cesto ».
  const tries = [...new Set([q, q.replace(/([a-z])([A-Z])/g, "$1 $2")])].filter(Boolean);
  for (const t of tries) {
    if (m) break;
    const map = await matchNamesToIgdb([t]).catch(() => new Map());
    m = map.get(simplifyName(t)) || null;
  }
  g.matchTried = true;
  if (m) {
    g.gameId = m.gameId;
    g.name = m.name;
    g.cover = m.cover || null;
  }
  return g;
}

/**
 * Le CompanionGame d'un jeu signalé par le PC (créé et rapproché d'IGDB au
 * premier signalement). `info` : { appid, name, folder, emulator }.
 */
export async function upsertGame(userId, deviceId, info) {
  const appid = Number(info.appid) > 0 ? Number(info.appid) : null;
  const rawName = String(info.name || "").trim().slice(0, 200);
  const key = keyOf(appid, rawName);
  if (!key) return null;
  const folder = info.folder ? String(info.folder).slice(0, 400) : null;
  const emulator = info.emulator ? String(info.emulator).slice(0, 40) : null;

  let g = await CompanionGame.findOne({ user: userId, key });
  if (!g) {
    g = new CompanionGame({ user: userId, key, appid, rawName, folder, emulator, device: deviceId || null, lastSeenAt: new Date() });
    await matchGame(g);
    try {
      await g.save();
    } catch (err) {
      if (err.code === 11000) return CompanionGame.findOne({ user: userId, key });
      throw err;
    }
    return g;
  }
  let dirty = false;
  if (folder && folder !== g.folder) (g.folder = folder), (dirty = true);
  if (emulator && emulator !== g.emulator) (g.emulator = emulator), (dirty = true);
  if (rawName && !g.rawName) (g.rawName = rawName), (dirty = true);
  if (deviceId && String(g.device) !== String(deviceId)) (g.device = deviceId), (dirty = true);
  if (!g.lastSeenAt || Date.now() - g.lastSeenAt.getTime() > 60 * 60 * 1000) (g.lastSeenAt = new Date()), (dirty = true);
  if (!g.matchTried && g.state === "pending") (await matchGame(g)), (dirty = true);
  if (dirty) await g.save();
  return g;
}

export async function autoOf(userId) {
  const u = await User.findById(userId).select("companionAuto").lean();
  return !!u?.companionAuto;
}

// ----------------------------------------------------------------------
//  Recevoir
// ----------------------------------------------------------------------
async function mergeTarget(game, type, status) {
  return CompanionEvent.findOne({
    game: game._id,
    type,
    status,
    to: { $gte: new Date(Date.now() - MERGE_GAP) },
  }).sort({ to: -1 });
}

function canAutoApply(game, auto) {
  return auto && game.state === "approved" && !!game.gameId;
}

/**
 * Des succès débloqués. Rend { event, fresh } — fresh : les succès NOUVEAUX
 * pour le serveur (nom, icône), pour la notification du compagnon.
 */
export async function recordAchievements(userId, game, unlocks, auto) {
  const seen = new Set(game.seen || []);
  const fresh = [];
  for (const u of unlocks) {
    const name = String(u?.name || "").trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const at = Number(u?.at);
    fresh.push({ apiName: name, at: at > 946684800 ? new Date(at * 1000) : new Date() });
  }
  if (!fresh.length) return { event: null, fresh: [] };

  // Noms et icônes lisibles (le fichier de l'émulateur n'a que les apiName).
  const schema = game.appid
    ? await getAchievementSchema(game.appid, new Map(fresh.map((f) => [f.apiName, f.at]))).catch(() => null)
    : null;
  const byName = new Map((schema?.achievements || []).map((a) => [a.apiName, a]));
  const details = fresh.map((f) => ({
    apiName: f.apiName,
    name: byName.get(f.apiName)?.name || f.apiName,
    icon: byName.get(f.apiName)?.icon || null,
    at: f.at,
  }));
  await CompanionGame.updateOne(
    { _id: game._id },
    { $addToSet: { seen: { $each: fresh.map((f) => f.apiName) } } }
  );
  game.seen = [...seen];

  // Un jeu écarté : on garde la trace, refusée d'office (rétablissable).
  const status = game.state === "ignored" ? "rejected" : canAutoApply(game, auto) ? "applied" : "pending";
  let ev = await mergeTarget(game, "achievements", status);
  if (ev) {
    ev.achievements.push(...details);
    ev.to = new Date();
  } else {
    ev = new CompanionEvent({ user: userId, game: game._id, type: "achievements", status, achievements: details });
  }
  if (status === "applied") {
    await applyAchievements(userId, game, game.gameId, details);
    ev.appliedGameId = game.gameId;
    ev.appliedAt = new Date();
  }
  await ev.save();
  return { event: ev, fresh: details };
}

/** Un morceau de temps de jeu (identifié : un renvoi ne compte pas double). */
export async function recordPlaytime(userId, game, seconds, chunkId, auto) {
  if (game.state === "ignored") return null;
  const status = canAutoApply(game, auto) ? "applied" : "pending";
  let ev = await mergeTarget(game, "playtime", status);
  if (ev) {
    ev.seconds += seconds;
    ev.to = new Date();
  } else {
    ev = new CompanionEvent({
      user: userId,
      game: game._id,
      type: "playtime",
      status,
      seconds,
      from: new Date(Date.now() - seconds * 1000),
    });
  }
  if (chunkId) ev.chunkIds = [...(ev.chunkIds || []), chunkId].slice(-200);
  if (status === "applied") {
    await applyPlaytime(userId, game, game.gameId, seconds);
    ev.appliedGameId = game.gameId;
    ev.appliedAt = new Date();
  }
  await ev.save();
  await CompanionGame.updateOne({ _id: game._id }, { $set: { lastPlayedAt: new Date() } });
  return ev;
}

// ----------------------------------------------------------------------
//  Appliquer, annuler
// ----------------------------------------------------------------------
/**
 * L'entrée de bibliothèque du jeu, créée au besoin (« en cours », PC,
 * « hors boutique »). Une création se note dans l'historique : c'est elle
 * qu'on annule pour retirer le jeu de la bibliothèque.
 */
export async function ensureEntry(userId, game, gameId, status = "playing", logIt = true) {
  const existing = await UserGame.findOne({ user: userId, gameId });
  if (existing) return existing;
  const entry = await UserGame.create({
    user: userId,
    gameId,
    name: game.name || game.rawName || "Jeu",
    cover: game.cover || null,
    status,
    platform: "PC (Microsoft Windows)",
    store: "unofficial",
    steamAppId: game.appid || null,
  });
  await CompanionGame.updateOne({ _id: game._id }, { $set: { entryCreated: true } });
  game.entryCreated = true;
  if (logIt) {
    await CompanionEvent.create({
      user: userId,
      game: game._id,
      type: "library",
      status: "applied",
      appliedGameId: gameId,
      appliedAt: new Date(),
    });
  }
  return entry;
}

// Réécrit les succès `local` d'un jeu à partir de l'ensemble débloqué.
async function writeLocal(userId, game, gameId, got) {
  const filter = { user: userId, gameId, platform: "local" };
  if (!got.size) {
    await GameAchievements.deleteOne(filter);
    return;
  }
  const schema = game.appid ? await getAchievementSchema(game.appid, got).catch(() => null) : null;
  const achievements = schema
    ? schema.achievements
    : [...got].map(([apiName, unlockedAt]) => ({ apiName, name: apiName, unlocked: true, unlockedAt }));
  await GameAchievements.updateOne(
    filter,
    {
      $set: {
        platformAppId: game.appid ? String(game.appid) : null,
        gameName: game.name || game.rawName || "",
        gameCover: game.cover || null,
        total: achievements.length,
        unlocked: achievements.filter((a) => a.unlocked).length,
        achievements,
      },
    },
    { upsert: true }
  );
}

async function unlockedMap(userId, gameId) {
  const doc = await GameAchievements.findOne({ user: userId, gameId, platform: "local" })
    .select("achievements.apiName achievements.unlocked achievements.unlockedAt")
    .lean();
  const got = new Map();
  for (const a of doc?.achievements || []) if (a.unlocked) got.set(a.apiName, a.unlockedAt || null);
  return got;
}

async function applyAchievements(userId, game, gameId, list) {
  const got = await unlockedMap(userId, gameId);
  for (const a of list) if (!got.has(a.apiName)) got.set(a.apiName, a.at || new Date());
  await writeLocal(userId, game, gameId, got);
  await ensureEntry(userId, game, gameId);
}

async function undoAchievements(userId, game, gameId, list) {
  const got = await unlockedMap(userId, gameId);
  for (const a of list) got.delete(a.apiName);
  await writeLocal(userId, game, gameId, got);
}

async function applyPlaytime(userId, game, gameId, seconds) {
  const entry = await ensureEntry(userId, game, gameId);
  const hours = Math.round(((entry.playtimeHours || 0) + seconds / 3600) * 100) / 100;
  await UserGame.updateOne(
    { _id: entry._id },
    { $set: { playtimeHours: hours, ...(entry.status === "wishlist" ? { status: "playing" } : {}) } }
  );
}

async function undoPlaytime(userId, gameId, seconds) {
  const entry = await UserGame.findOne({ user: userId, gameId });
  if (!entry) return;
  const hours = Math.max(0, Math.round(((entry.playtimeHours || 0) - seconds / 3600) * 100) / 100);
  await UserGame.updateOne({ _id: entry._id }, { $set: { playtimeHours: hours } });
}

/** Applique un envoi (en attente, annulé ou refusé) au jeu validé. */
export async function applyEvent(userId, game, ev, opts = {}) {
  if (!game.gameId) throw Object.assign(new Error("Choisis d'abord le jeu correspondant."), { status: 400 });
  if (ev.status === "applied") return ev;
  const gameId = game.gameId;
  if (ev.type === "achievements") await applyAchievements(userId, game, gameId, ev.achievements);
  else if (ev.type === "playtime") await applyPlaytime(userId, game, gameId, ev.seconds);
  else if (ev.type === "library") await ensureEntry(userId, game, gameId, opts.status || "playing", false);
  ev.status = "applied";
  ev.appliedGameId = gameId;
  ev.appliedAt = new Date();
  await ev.save();
  return ev;
}

/**
 * Défait un envoi appliqué. Retirer le jeu de la bibliothèque (type
 * `library`) défait aussi tout ce qui avait été appliqué au jeu.
 */
export async function undoEvent(userId, game, ev) {
  if (ev.status !== "applied") return ev;
  const gameId = ev.appliedGameId || game.gameId;
  if (ev.type === "achievements") await undoAchievements(userId, game, gameId, ev.achievements);
  else if (ev.type === "playtime") await undoPlaytime(userId, gameId, ev.seconds);
  else if (ev.type === "library") {
    const others = await CompanionEvent.find({
      game: game._id,
      status: "applied",
      type: { $ne: "library" },
      appliedGameId: gameId,
    });
    for (const o of others) await undoEvent(userId, game, o);
    await UserGame.deleteOne({ user: userId, gameId, store: "unofficial" });
    await CompanionGame.updateOne({ _id: game._id }, { $set: { entryCreated: false } });
    game.entryCreated = false;
  }
  ev.status = "undone";
  await ev.save();
  return ev;
}

// ----------------------------------------------------------------------
//  Avant ce système : les envois déjà appliqués deviennent de l'historique
// ----------------------------------------------------------------------
// Le compagnon 1.0/1.1 écrivait directement dans le profil. Ses succès et
// heures déjà là reçoivent leur jeu (validé) et leurs lignes d'historique,
// pour être vérifiables et annulables comme le reste.
export async function backfill(userId) {
  const docs = await GameAchievements.find({ user: userId, platform: "local" }).lean();
  for (const d of docs) {
    const appid = Number(d.platformAppId) || null;
    const key = keyOf(appid, d.gameName);
    if (!key || (await CompanionGame.exists({ user: userId, key }))) continue;
    const entry = await UserGame.findOne({ user: userId, gameId: d.gameId }).lean();
    // Posée par le compagnon = « hors boutique » AVEC un appid (une entrée
    // « hors boutique » créée à la main n'en a pas, et n'est jamais retirée).
    const created = entry?.store === "unofficial" && !!entry.steamAppId;
    const unlocked = (d.achievements || []).filter((a) => a.unlocked);
    let game;
    try {
      game = await CompanionGame.create({
        user: userId,
        key,
        appid,
        rawName: d.gameName || "",
        state: "approved",
        gameId: d.gameId,
        name: d.gameName,
        cover: d.gameCover || null,
        matchTried: true,
        seen: unlocked.map((a) => a.apiName),
        entryCreated: created,
      });
    } catch {
      continue; // créé entre-temps par une requête parallèle
    }
    const at = entry?.createdAt || d.createdAt || new Date();
    if (created) {
      await CompanionEvent.create({
        user: userId, game: game._id, type: "library", status: "applied",
        appliedGameId: d.gameId, appliedAt: at, from: at, to: at,
      });
    }
    if (unlocked.length) {
      const times = unlocked.map((a) => a.unlockedAt).filter(Boolean).map((t) => new Date(t).getTime());
      await CompanionEvent.create({
        user: userId, game: game._id, type: "achievements", status: "applied",
        achievements: unlocked.map((a) => ({ apiName: a.apiName, name: a.name, icon: a.icon, at: a.unlockedAt })),
        appliedGameId: d.gameId, appliedAt: at,
        from: times.length ? new Date(Math.min(...times)) : at,
        to: times.length ? new Date(Math.max(...times)) : at,
      });
    }
    if (created && entry.playtimeHours > 0) {
      await CompanionEvent.create({
        user: userId, game: game._id, type: "playtime", status: "applied",
        seconds: Math.round(entry.playtimeHours * 3600),
        appliedGameId: d.gameId, appliedAt: at, from: at, to: entry.updatedAt || at,
      });
    }
  }

  // Les jeux qui n'avaient que du temps de jeu (pas de succès).
  const entries = await UserGame.find({ user: userId, store: "unofficial", steamAppId: { $ne: null } }).lean();
  for (const e of entries) {
    const key = keyOf(e.steamAppId, e.name);
    if (!key || (await CompanionGame.exists({ user: userId, key }))) continue;
    let game;
    try {
      game = await CompanionGame.create({
        user: userId, key, appid: e.steamAppId, rawName: e.name, state: "approved",
        gameId: e.gameId, name: e.name, cover: e.cover || null, matchTried: true, entryCreated: true,
      });
    } catch {
      continue;
    }
    const at = e.createdAt || new Date();
    await CompanionEvent.create({
      user: userId, game: game._id, type: "library", status: "applied",
      appliedGameId: e.gameId, appliedAt: at, from: at, to: at,
    });
    if (e.playtimeHours > 0) {
      await CompanionEvent.create({
        user: userId, game: game._id, type: "playtime", status: "applied",
        seconds: Math.round(e.playtimeHours * 3600),
        appliedGameId: e.gameId, appliedAt: at, from: at, to: e.updatedAt || at,
      });
    }
  }
}
