// ======================================================================
//  Le compagnon PC : succès et temps de jeu des jeux hors boutique
// ======================================================================
//
// Le compagnon (companion/ à la racine du dépôt) est une petite application
// de la barre des tâches Windows. Il repère les jeux du PC (dossiers des
// émulateurs de succès, dossiers de jeux comme D:\Games), lit les succès que
// notent ces émulateurs (Goldberg, CODEX, RUNE, OnlineFix…) et compte le temps
// passé dans les jeux lancés hors de Steam.
//
// ⚠️ RIEN N'ATTEINT LE PROFIL SANS LE JOUEUR. Chaque envoi est rangé en
// attente (lib/companion.js) ; le joueur valide sur le site — le jeu reconnu
// (corrigeable), puis ses succès et ses heures — et peut tout annuler après
// coup depuis l'historique. En mode automatique (User.companionAuto), les jeux
// DÉJÀ validés reçoivent la suite directement ; un jeu nouveau attend toujours.
//
// ⚠️ DÉCLARATIF, ET ASSUMÉ COMME TEL. Rien ne prouve qu'un fichier local n'a
// pas été retouché : ces succès vivent sur leur propre plateforme (`local`),
// s'affichent « PC · hors boutique », et restent hors des classements.
//
// Relier un PC : l'app demande un code à 6 chiffres (POST /code), le joueur
// le tape dans le compagnon (POST /pair), qui reçoit SON jeton — limité à ces
// routes, révocable depuis l'app (cf. models/CompanionDevice).

import express from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";

import CompanionDevice from "../models/CompanionDevice.js";
import CompanionEvent from "../models/CompanionEvent.js";
import CompanionGame from "../models/CompanionGame.js";
import GameAchievements from "../models/GameAchievements.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import {
  applyEvent,
  autoOf,
  backfill,
  ensureEntry,
  gameOfApp,
  recordAchievements,
  recordPlaytime,
  undoEvent,
  upsertGame,
} from "../lib/companion.js";

const router = express.Router();

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ----------------------------------------------------------------------
//  Relier un PC
// ----------------------------------------------------------------------
// Les codes vivent dix minutes, en mémoire : un redémarrage du serveur en
// perd, et c'est sans conséquence — on en redemande un.
const CODE_TTL = 10 * 60 * 1000;
const codes = new Map(); // code → { user, exp }

function purgeCodes() {
  const now = Date.now();
  for (const [c, v] of codes) if (v.exp < now) codes.delete(c);
}

// Six chiffres, c'est un million de possibilités : on borne les essais.
const pairLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Trop d'essais. Réessaie dans quelques minutes." },
});

// POST /api/companion/code — depuis l'app : un code à taper dans le compagnon.
router.post("/code", requireAuth, (req, res) => {
  purgeCodes();
  for (const [c, v] of codes) if (v.user === String(req.userId)) codes.delete(c);
  let code;
  do {
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  } while (codes.has(code));
  const exp = Date.now() + CODE_TTL;
  codes.set(code, { user: String(req.userId), exp });
  res.json({ code, expiresAt: new Date(exp) });
});

// POST /api/companion/pair — depuis le compagnon : { code, name } → jeton.
router.post("/pair", pairLimiter, async (req, res) => {
  try {
    purgeCodes();
    const code = String(req.body?.code || "").replace(/\D/g, "");
    const hit = codes.get(code);
    if (!hit) return res.status(400).json({ error: "Code invalide ou expiré." });
    codes.delete(code);
    const token = crypto.randomBytes(32).toString("hex");
    const name = String(req.body?.name || "PC").trim().slice(0, 80) || "PC";
    await CompanionDevice.create({ user: hit.user, tokenHash: sha(token), name, lastSeenAt: new Date() });
    const user = await User.findById(hit.user).select("username avatar").lean();
    res.json({ token, username: user?.username || "", avatar: user?.avatar || null });
  } catch (err) {
    console.error("companion pair error:", err.message);
    res.status(500).json({ error: "Impossible de relier ce PC." });
  }
});

/** Combien de jeux attendent le joueur (jeu à valider ou envois en attente). */
async function pendingCount(userId) {
  const [games, withEvents] = await Promise.all([
    CompanionGame.find({ user: userId, state: "pending" }).distinct("_id"),
    CompanionEvent.find({ user: userId, status: "pending" }).distinct("game"),
  ]);
  return new Set([...games, ...withEvents].map(String)).size;
}

// GET /api/companion/devices — depuis l'app : les PC reliés (+ ce qui attend).
router.get("/devices", requireAuth, async (req, res) => {
  const [devices, pending] = await Promise.all([
    CompanionDevice.find({ user: req.userId }).sort({ lastSeenAt: -1 }).select("name lastSeenAt createdAt").lean(),
    pendingCount(req.userId).catch(() => 0),
  ]);
  res.json({
    devices: devices.map((d) => ({
      id: String(d._id),
      name: d.name,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    })),
    pending,
  });
});

// DELETE /api/companion/devices/:id — depuis l'app : délier un PC.
router.delete("/devices/:id", requireAuth, async (req, res) => {
  await CompanionDevice.deleteOne({ _id: req.params.id, user: req.userId }).catch(() => null);
  res.json({ ok: true });
});

// Le compagnon lui-même se télécharge sur le SITE
// (https://myplaylog.cc/downloads/MyPlayLogCompagnon.exe) : le conteneur de
// l'API est construit à partir de ./server seul et ne voit pas companion/.

// ----------------------------------------------------------------------
//  Valider, annuler — depuis le site (et l'app)
// ----------------------------------------------------------------------
function mapGame(g) {
  return {
    id: String(g._id),
    key: g.key,
    appid: g.appid,
    rawName: g.rawName,
    folder: g.folder,
    emulator: g.emulator,
    state: g.state,
    gameId: g.gameId,
    name: g.name,
    cover: g.cover,
    lastSeenAt: g.lastSeenAt,
    lastPlayedAt: g.lastPlayedAt,
    createdAt: g.createdAt,
  };
}

function mapEvent(e, g) {
  return {
    id: String(e._id),
    type: e.type,
    status: e.status,
    seconds: e.seconds || 0,
    achievements: (e.achievements || []).map((a) => ({ apiName: a.apiName, name: a.name, icon: a.icon, at: a.at })),
    from: e.from,
    to: e.to,
    appliedAt: e.appliedAt,
    game: g
      ? { id: String(g._id), name: g.name || g.rawName, cover: g.cover, gameId: e.appliedGameId || g.gameId, state: g.state }
      : null,
  };
}

// GET /api/companion/review — tout ce que le compagnon a vu, pour la page
// « Compagnon PC » du site : à valider, historique, suivis, écartés.
router.get("/review", requireAuth, async (req, res) => {
  try {
    await backfill(req.userId).catch((err) => console.error("companion backfill error:", err.message));
    const [games, pending, history, user, totals] = await Promise.all([
      CompanionGame.find({ user: req.userId }).sort({ lastSeenAt: -1 }).lean(),
      CompanionEvent.find({ user: req.userId, status: "pending" }).sort({ to: -1 }).lean(),
      CompanionEvent.find({ user: req.userId, status: { $ne: "pending" } }).sort({ to: -1 }).limit(200).lean(),
      User.findById(req.userId).select("companionAuto").lean(),
      CompanionEvent.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(String(req.userId)), status: "applied" } },
        {
          $group: {
            _id: "$game",
            seconds: { $sum: "$seconds" },
            achievements: { $sum: { $size: "$achievements" } },
          },
        },
      ]),
    ]);
    const byId = new Map(games.map((g) => [String(g._id), g]));
    const pendingBy = new Map();
    for (const e of pending) {
      const k = String(e.game);
      if (!pendingBy.has(k)) pendingBy.set(k, []);
      pendingBy.get(k).push(e);
    }
    const totalBy = new Map(totals.map((t) => [String(t._id), t]));

    const review = games
      .filter((g) => g.state === "pending" || (g.state === "approved" && pendingBy.has(String(g._id))))
      .map((g) => {
        const evs = pendingBy.get(String(g._id)) || [];
        return {
          ...mapGame(g),
          pending: {
            events: evs.map((e) => mapEvent(e, g)),
            seconds: evs.reduce((s, e) => s + (e.seconds || 0), 0),
            achievements: evs.flatMap((e) => e.achievements || []).length,
          },
        };
      })
      // Ce qui a du contenu (heures, succès) d'abord, puis le reste.
      .sort((a, b) => (b.pending.seconds + b.pending.achievements > 0) - (a.pending.seconds + a.pending.achievements > 0));

    res.json({
      auto: !!user?.companionAuto,
      review,
      history: history.map((e) => mapEvent(e, byId.get(String(e.game)))),
      tracked: games
        .filter((g) => g.state === "approved")
        .map((g) => ({
          ...mapGame(g),
          seconds: totalBy.get(String(g._id))?.seconds || 0,
          achievements: totalBy.get(String(g._id))?.achievements || 0,
        })),
      ignored: games.filter((g) => g.state === "ignored").map(mapGame),
      pendingCount: review.length,
    });
  } catch (err) {
    console.error("companion review error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement." });
  }
});

async function ownGame(req, res) {
  const game = await CompanionGame.findOne({ _id: req.params.id, user: req.userId }).catch(() => null);
  if (!game) res.status(404).json({ error: "Jeu introuvable." });
  return game;
}

const STATUSES = ["playing", "finished", "paused", "dropped", "endless", "wishlist"];

// POST /api/companion/games/:id/validate — { gameId?, name?, cover?, status? }
// Confirme (ou corrige) le jeu, l'ajoute à la bibliothèque, applique ce qui
// attendait. Corriger un jeu DÉJÀ validé défait tout sur l'ancien et le
// refait sur le nouveau.
router.post("/games/:id/validate", requireAuth, async (req, res) => {
  try {
    const game = await ownGame(req, res);
    if (!game) return;
    const b = req.body || {};
    const newId = Number(b.gameId) || game.gameId;
    if (!newId) return res.status(400).json({ error: "Choisis d'abord le jeu correspondant." });

    let redoIds = [];
    if (game.state === "approved" && game.gameId && newId !== game.gameId) {
      const applied = await CompanionEvent.find({ game: game._id, status: "applied" });
      const lib = applied.find((e) => e.type === "library");
      if (lib) await undoEvent(req.userId, game, lib); // défait aussi le reste
      for (const e of applied) if (e.type !== "library") await undoEvent(req.userId, game, e);
      redoIds = applied.filter((e) => e.type !== "library").map((e) => e._id);
    }
    if (Number(b.gameId)) {
      game.gameId = newId;
      if (b.name) game.name = String(b.name).slice(0, 200);
      game.cover = b.cover ?? game.cover;
    }
    game.state = "approved";
    await game.save();

    await ensureEntry(req.userId, game, game.gameId, STATUSES.includes(b.status) ? b.status : "playing");
    const todo = await CompanionEvent.find({
      $or: [{ game: game._id, status: "pending" }, { _id: { $in: redoIds } }],
    }).sort({ from: 1 });
    for (const e of todo) await applyEvent(req.userId, game, e);
    res.json({ ok: true, applied: todo.length });
  } catch (err) {
    console.error("companion validate error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la validation." });
  }
});

// POST /api/companion/games/:id/ignore — « pas un jeu » / « ne plus suivre » :
// ce qui attendait est refusé, le compagnon cesse de le compter.
router.post("/games/:id/ignore", requireAuth, async (req, res) => {
  const game = await ownGame(req, res);
  if (!game) return;
  game.state = "ignored";
  await game.save();
  await CompanionEvent.updateMany({ game: game._id, status: "pending" }, { $set: { status: "rejected" } });
  res.json({ ok: true });
});

// POST /api/companion/games/:id/reject — refuse ce qui attend pour un jeu
// validé, sans l'écarter (la suite continuera d'arriver).
router.post("/games/:id/reject", requireAuth, async (req, res) => {
  const game = await ownGame(req, res);
  if (!game) return;
  await CompanionEvent.updateMany({ game: game._id, status: "pending" }, { $set: { status: "rejected" } });
  res.json({ ok: true });
});

// POST /api/companion/games/:id/restore — un jeu écarté revient « à valider ».
router.post("/games/:id/restore", requireAuth, async (req, res) => {
  const game = await ownGame(req, res);
  if (!game) return;
  game.state = "pending";
  await game.save();
  res.json({ ok: true });
});

// POST /api/companion/games/:id/remove — tout annuler pour ce jeu : ce qui
// avait été appliqué est retiré (bibliothèque comprise, si c'est le
// compagnon qui l'y avait mis), et il est écarté.
router.post("/games/:id/remove", requireAuth, async (req, res) => {
  try {
    const game = await ownGame(req, res);
    if (!game) return;
    const applied = await CompanionEvent.find({ game: game._id, status: "applied" });
    const lib = applied.find((e) => e.type === "library");
    if (lib) await undoEvent(req.userId, game, lib);
    for (const e of applied) if (e.type !== "library") await undoEvent(req.userId, game, e);
    game.state = "ignored";
    await game.save();
    await CompanionEvent.updateMany({ game: game._id, status: "pending" }, { $set: { status: "rejected" } });
    res.json({ ok: true });
  } catch (err) {
    console.error("companion remove error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'annulation." });
  }
});

async function ownEvent(req, res) {
  const ev = await CompanionEvent.findOne({ _id: req.params.id, user: req.userId }).catch(() => null);
  const game = ev && (await CompanionGame.findOne({ _id: ev.game, user: req.userId }));
  if (!ev || !game) {
    res.status(404).json({ error: "Envoi introuvable." });
    return [null, null];
  }
  return [ev, game];
}

// POST /api/companion/events/:id/undo — annule un envoi appliqué.
router.post("/events/:id/undo", requireAuth, async (req, res) => {
  try {
    const [ev, game] = await ownEvent(req, res);
    if (!ev) return;
    await undoEvent(req.userId, game, ev);
    res.json({ ok: true });
  } catch (err) {
    console.error("companion undo error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'annulation." });
  }
});

// POST /api/companion/events/:id/apply — applique un envoi en attente,
// annulé ou refusé (le jeu doit être validé).
router.post("/events/:id/apply", requireAuth, async (req, res) => {
  try {
    const [ev, game] = await ownEvent(req, res);
    if (!ev) return;
    if (game.state !== "approved") return res.status(400).json({ error: "Valide d'abord le jeu." });
    await applyEvent(req.userId, game, ev);
    res.json({ ok: true });
  } catch (err) {
    console.error("companion apply error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur." });
  }
});

// POST /api/companion/events/:id/reject — refuse un envoi en attente.
router.post("/events/:id/reject", requireAuth, async (req, res) => {
  const [ev] = await ownEvent(req, res);
  if (!ev) return;
  if (ev.status === "pending") {
    ev.status = "rejected";
    await ev.save();
  }
  res.json({ ok: true });
});

// PUT /api/companion/settings — { auto } : les jeux validés reçoivent-ils la
// suite directement ?
router.put("/settings", requireAuth, async (req, res) => {
  const auto = !!req.body?.auto;
  await User.updateOne({ _id: req.userId }, { $set: { companionAuto: auto } });
  res.json({ ok: true, auto });
});

// ----------------------------------------------------------------------
//  Les routes du compagnon
// ----------------------------------------------------------------------
async function companionAuth(req, res, next) {
  try {
    const m = String(req.headers.authorization || "").match(/^Companion\s+([a-f0-9]{64})$/i);
    if (!m) return res.status(401).json({ error: "Ce PC n'est pas relié.", unlinked: true });
    const device = await CompanionDevice.findOne({ tokenHash: sha(m[1].toLowerCase()) });
    if (!device) return res.status(401).json({ error: "Ce PC n'est plus relié.", unlinked: true });
    req.device = device;
    req.userId = String(device.user);
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 5 * 60 * 1000) {
      CompanionDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    }
    next();
  } catch (err) {
    res.status(500).json({ error: "Erreur d'authentification." });
  }
}

// POST /api/companion/unlink — le compagnon se délie lui-même.
router.post("/unlink", companionAuth, async (req, res) => {
  await CompanionDevice.deleteOne({ _id: req.device._id }).catch(() => null);
  res.json({ ok: true });
});

// GET /api/companion/app/:appid — le jeu IGDB derrière un appid (compagnon 1.1).
router.get("/app/:appid", companionAuth, async (req, res) => {
  try {
    const g = await gameOfApp(Number(req.params.appid));
    res.json(g ? { matched: true, gameId: g.gameId, name: g.name, cover: g.cover || null } : { matched: false });
  } catch (err) {
    res.json({ matched: false });
  }
});

// GET /api/companion/me — à qui ce PC est relié.
router.get("/me", companionAuth, async (req, res) => {
  const user = await User.findById(req.userId).select("username avatar").lean();
  res.json({ username: user?.username || "", avatar: user?.avatar || null, device: req.device.name });
});

function compact(g) {
  return {
    key: g.key,
    appid: g.appid,
    state: g.state,
    gameId: g.gameId,
    name: g.name || g.rawName || null,
    cover: g.cover || null,
    folder: g.folder || null,
  };
}

async function gamesPayload(userId) {
  const [games, pending] = await Promise.all([
    CompanionGame.find({ user: userId }).select("key appid state gameId name rawName cover folder").lean(),
    pendingCount(userId),
  ]);
  return { games: games.map(compact), pending };
}

// POST /api/companion/games — { games: [{ appid?, name, folder?, emulator? }] }
// Les jeux que le compagnon a trouvés sur le PC. Un jeu jamais vu arrive « à
// valider », avec le jeu IGDB qu'on lui propose. Rend l'état de tous les jeux
// (le compagnon cesse de compter ceux qu'on a écartés).
router.post("/games", companionAuth, async (req, res) => {
  try {
    const list = (Array.isArray(req.body?.games) ? req.body.games : []).slice(0, 300);
    // Quatre à la fois : un premier passage peut en rapprocher des dizaines d'IGDB.
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const info = list[i++];
        await upsertGame(req.userId, req.device._id, info || {}).catch((err) =>
          console.error("companion game error:", err.message)
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    res.json(await gamesPayload(req.userId));
  } catch (err) {
    console.error("companion games error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi des jeux." });
  }
});

// GET /api/companion/games — l'état des jeux (validés, écartés, à valider).
router.get("/games", companionAuth, async (req, res) => {
  res.json(await gamesPayload(req.userId));
});

// GET /api/companion/recent — les derniers succès hors boutique du compte
// (tous PC confondus), appliqués ou en attente, pour la fenêtre du compagnon.
router.get("/recent", companionAuth, async (req, res) => {
  try {
    const [docs, waiting, pending] = await Promise.all([
      GameAchievements.find({ user: req.userId, platform: "local" })
        .select("gameId gameName gameCover platformAppId unlocked achievements.apiName achievements.name achievements.icon achievements.unlocked achievements.unlockedAt")
        .lean(),
      CompanionEvent.find({ user: req.userId, type: "achievements", status: "pending" }).populate("game", "name rawName cover appid gameId").lean(),
      pendingCount(req.userId),
    ]);
    const items = [];
    let total = 0;
    for (const d of docs) {
      total += d.unlocked || 0;
      for (const a of d.achievements || []) {
        if (!a.unlocked) continue;
        items.push({
          appid: d.platformAppId,
          apiName: a.apiName,
          name: a.name || a.apiName,
          icon: a.icon || null,
          game: d.gameName,
          gameId: d.gameId,
          cover: d.gameCover || null,
          at: a.unlockedAt ? Math.floor(new Date(a.unlockedAt).getTime() / 1000) : 0,
        });
      }
    }
    for (const e of waiting) {
      for (const a of e.achievements || []) {
        items.push({
          appid: e.game?.appid ? String(e.game.appid) : null,
          apiName: a.apiName,
          name: a.name || a.apiName,
          icon: a.icon || null,
          game: e.game?.name || e.game?.rawName || "",
          gameId: e.game?.gameId || null,
          cover: e.game?.cover || null,
          at: a.at ? Math.floor(new Date(a.at).getTime() / 1000) : 0,
          pending: true,
        });
      }
    }
    items.sort((a, b) => b.at - a.at);
    res.json({ items: items.slice(0, 20), total, pending });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la lecture des succès." });
  }
});

// POST /api/companion/achievements — { appid, unlocked: [{ name, at }], name?, folder?, emulator? }
// `name` (dans unlocked) est l'apiName Steam, `at` un horodatage Unix (ou rien).
router.post("/achievements", companionAuth, async (req, res) => {
  try {
    const appid = Number(req.body?.appid);
    if (!appid) return res.status(400).json({ error: "appid manquant." });
    const game = await upsertGame(req.userId, req.device._id, {
      appid,
      name: req.body?.name,
      folder: req.body?.folder,
      emulator: req.body?.emulator,
    });
    const auto = await autoOf(req.userId);
    const list = (Array.isArray(req.body?.unlocked) ? req.body.unlocked : []).slice(0, 3000);
    const { event, fresh } = await recordAchievements(req.userId, game, list, auto);
    res.json({
      matched: !!game.gameId,
      stored: true,
      state: game.state,
      pending: !!event && event.status === "pending",
      gameId: game.gameId,
      name: game.name || game.rawName || null,
      cover: game.cover || null,
      newly: fresh.map((a) => ({ apiName: a.apiName, name: a.name, icon: a.icon })),
    });
  } catch (err) {
    console.error("companion achievements error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi des succès." });
  }
});

// POST /api/companion/playtime — { appid?, name?, folder?, seconds, id }
// Un morceau de session. `id` (unique, choisi par le compagnon) rend l'envoi
// rejouable sans compter deux fois. Un jeu sans appid (émulateur Ubisoft,
// jeu DRM-free…) vient avec le nom de son dossier.
router.post("/playtime", companionAuth, async (req, res) => {
  try {
    const appid = Number(req.body?.appid) || null;
    const seconds = Math.min(Math.max(0, Number(req.body?.seconds) || 0), 12 * 3600);
    const id = String(req.body?.id || "").slice(0, 64);
    if (!appid && !req.body?.name) return res.status(400).json({ error: "Jeu manquant." });
    if (seconds < 30) return res.json({ ok: true, skipped: true });
    if (id && req.device.recentIds.includes(id)) return res.json({ ok: true, duplicate: true });

    const game = await upsertGame(req.userId, req.device._id, {
      appid,
      name: req.body?.name,
      folder: req.body?.folder,
    });
    if (!game) return res.status(400).json({ error: "Jeu manquant." });
    const ev = await recordPlaytime(req.userId, game, seconds, id, await autoOf(req.userId));
    if (id) {
      await CompanionDevice.updateOne(
        { _id: req.device._id },
        { $push: { recentIds: { $each: [id], $slice: -300 } } }
      );
    }
    res.json({
      matched: !!game.gameId,
      state: game.state,
      pending: !!ev && ev.status === "pending",
      gameId: game.gameId,
      name: game.name || game.rawName || null,
      cover: game.cover || null,
    });
  } catch (err) {
    console.error("companion playtime error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi du temps de jeu." });
  }
});

export default router;
