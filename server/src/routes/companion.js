// ======================================================================
//  Le compagnon PC : succès et temps de jeu des jeux hors boutique
// ======================================================================
//
// Le compagnon (companion/ à la racine du dépôt) est une petite application
// de la barre des tâches Windows. Il lit les fichiers où les émulateurs de
// succès (Goldberg, CODEX, RUNE, OnlineFix…) notent ce qui a été débloqué, et
// compte le temps passé dans les jeux lancés hors de Steam. Il remonte le
// tout ici, rangé par appid Steam — c'est la clé qu'utilisent ces émulateurs,
// et celle qui nous donne la fiche IGDB et la liste des succès du jeu.
//
// ⚠️ DÉCLARATIF, ET ASSUMÉ COMME TEL. Rien ne prouve qu'un fichier local n'a
// pas été retouché : ces succès vivent sur leur propre plateforme (`local`),
// s'affichent « PC · hors boutique », et restent hors des classements.
//
// Relier un PC : l'app demande un code à 6 chiffres (POST /code), le joueur
// le tape dans le compagnon (POST /pair), qui reçoit SON jeton — limité à ces
// routes, révocable depuis l'app (cf. models/CompanionDevice).

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";

import CompanionDevice from "../models/CompanionDevice.js";
import GameAchievements from "../models/GameAchievements.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import { requireAuth } from "../middleware/auth.js";
import { getAchievementSchema, matchAppsToIgdb } from "../lib/steam.js";
import { createTtlCache } from "../lib/ttlCache.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXE = path.resolve(__dirname, "../../../companion/dist/MyPlayLogCompagnon.exe");

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

// GET /api/companion/devices — depuis l'app : les PC reliés.
router.get("/devices", requireAuth, async (req, res) => {
  const devices = await CompanionDevice.find({ user: req.userId })
    .sort({ lastSeenAt: -1 })
    .select("name lastSeenAt createdAt")
    .lean();
  res.json({
    devices: devices.map((d) => ({
      id: String(d._id),
      name: d.name,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    })),
    download: fs.existsSync(EXE),
  });
});

// DELETE /api/companion/devices/:id — depuis l'app : délier un PC.
router.delete("/devices/:id", requireAuth, async (req, res) => {
  await CompanionDevice.deleteOne({ _id: req.params.id, user: req.userId }).catch(() => null);
  res.json({ ok: true });
});

// GET /api/companion/download — le compagnon lui-même.
router.get("/download", (req, res) => {
  if (!fs.existsSync(EXE)) return res.status(404).json({ error: "Compagnon indisponible." });
  res.download(EXE, "MyPlayLogCompagnon.exe");
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

// appid Steam → jeu IGDB. Un jour de cache : ça ne bouge pas.
const apps = createTtlCache({ name: "companion:apps", max: 3000, ttl: 24 * 60 * 60 * 1000 });
async function gameOfApp(appid) {
  const hit = apps.get(appid);
  if (hit !== undefined) return hit;
  const map = await matchAppsToIgdb([appid]);
  const g = map.get(appid) || null;
  apps.set(appid, g);
  return g;
}

// Le jeu entre dans la bibliothèque au premier signe de vie : « en cours »,
// sur PC, « hors boutique ». Un jeu déjà là garde tout ce qu'on y a mis.
async function ensureEntry(userId, g, appid) {
  const existing = await UserGame.findOne({ user: userId, gameId: g.gameId });
  if (existing) return existing;
  return UserGame.create({
    user: userId,
    gameId: g.gameId,
    name: g.name,
    cover: g.cover,
    status: "playing",
    platform: "PC (Microsoft Windows)",
    store: "unofficial",
    steamAppId: appid,
  });
}

// GET /api/companion/me — à qui ce PC est relié.
router.get("/me", companionAuth, async (req, res) => {
  const user = await User.findById(req.userId).select("username avatar").lean();
  res.json({ username: user?.username || "", avatar: user?.avatar || null, device: req.device.name });
});

// POST /api/companion/achievements — { appid, unlocked: [{ name, at }] }
// `name` est l'apiName Steam, `at` un horodatage Unix (ou rien).
router.post("/achievements", companionAuth, async (req, res) => {
  try {
    const appid = Number(req.body?.appid);
    if (!appid) return res.status(400).json({ error: "appid manquant." });
    const g = await gameOfApp(appid);
    if (!g) return res.json({ matched: false });

    // L'union de ce qu'on savait et de ce qui arrive : un succès débloqué ne
    // se reperd jamais (un fichier remis à zéro ne doit rien effacer).
    const prev = await GameAchievements.findOne({ user: req.userId, gameId: g.gameId, platform: "local" })
      .select("achievements.apiName achievements.unlocked achievements.unlockedAt")
      .lean();
    const got = new Map();
    for (const a of prev?.achievements || []) if (a.unlocked) got.set(a.apiName, a.unlockedAt || null);
    const before = new Set(got.keys());
    for (const a of (Array.isArray(req.body?.unlocked) ? req.body.unlocked : []).slice(0, 3000)) {
      const name = String(a?.name || "").trim().slice(0, 200);
      if (!name || got.has(name)) continue;
      const at = Number(a?.at);
      got.set(name, at > 946684800 ? new Date(at * 1000) : new Date());
    }

    const schema = await getAchievementSchema(appid, got).catch(() => null);
    const achievements = schema
      ? schema.achievements
      : [...got].map(([apiName, unlockedAt]) => ({ apiName, name: apiName, unlocked: true, unlockedAt }));
    const unlocked = achievements.filter((a) => a.unlocked).length;
    await GameAchievements.updateOne(
      { user: req.userId, gameId: g.gameId, platform: "local" },
      {
        $set: {
          platformAppId: String(appid),
          gameName: g.name,
          gameCover: g.cover,
          total: achievements.length,
          unlocked,
          achievements,
        },
      },
      { upsert: true }
    );
    await ensureEntry(req.userId, g, appid);

    res.json({
      matched: true,
      gameId: g.gameId,
      name: g.name,
      total: achievements.length,
      unlocked,
      newly: achievements
        .filter((a) => a.unlocked && !before.has(a.apiName))
        .map((a) => ({ apiName: a.apiName, name: a.name, icon: a.icon || null })),
    });
  } catch (err) {
    console.error("companion achievements error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi des succès." });
  }
});

// POST /api/companion/playtime — { appid, seconds, id }
// Un morceau de session. `id` (unique, choisi par le compagnon) rend l'envoi
// rejouable sans compter deux fois.
router.post("/playtime", companionAuth, async (req, res) => {
  try {
    const appid = Number(req.body?.appid);
    const seconds = Math.min(Math.max(0, Number(req.body?.seconds) || 0), 12 * 3600);
    const id = String(req.body?.id || "").slice(0, 64);
    if (!appid) return res.status(400).json({ error: "appid manquant." });
    if (seconds < 30) return res.json({ ok: true, skipped: true });
    if (id && req.device.recentIds.includes(id)) return res.json({ ok: true, duplicate: true });

    const g = await gameOfApp(appid);
    if (!g) return res.json({ matched: false });
    const entry = await ensureEntry(req.userId, g, appid);
    const hours = Math.round(((entry.playtimeHours || 0) + seconds / 3600) * 100) / 100;
    await UserGame.updateOne(
      { _id: entry._id },
      { $set: { playtimeHours: hours, ...(entry.status === "wishlist" ? { status: "playing" } : {}) } }
    );
    if (id) {
      await CompanionDevice.updateOne(
        { _id: req.device._id },
        { $push: { recentIds: { $each: [id], $slice: -300 } } }
      );
    }
    res.json({ matched: true, gameId: g.gameId, name: g.name, hours });
  } catch (err) {
    console.error("companion playtime error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi du temps de jeu." });
  }
});

export default router;
