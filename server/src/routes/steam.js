import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import GameAchievements from "../models/GameAchievements.js";
import { requireAuth } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import {
  isConfigured,
  buildLoginUrl,
  verifyOpenId,
  resolveSteamId,
  getPlayerSummary,
  getOwnedGames,
  getGameAchievements,
  matchAppsToIgdb,
} from "../lib/steam.js";

const router = express.Router();

// Au-delà de ce temps de jeu, un jeu « lancé » mais absent de la bibliothèque
// est suggéré comme « Terminé » plutôt que « En pause » (cf. décision produit :
// multi → sans fin ; sinon en pause, sauf si beaucoup d'heures → terminé).
const FINISHED_HOURS = 30;

const hoursOf = (min) => Math.round((min / 60) * 10) / 10;

// Petit pool de concurrence pour les appels Steam (succès) : évite de marteler
// l'API tout en gardant l'import réactif.
async function pool(items, size, worker) {
  const results = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

// Petite page servie dans la pop-up OpenID : prévient l'app parente puis se ferme.
function closerPage(ok, error) {
  const payload = JSON.stringify({ type: "mpl-steam", ok, error: error || null });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Steam</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0c0d11;color:#f2f3f6;font-family:system-ui,Arial,sans-serif;text-align:center}
.box{max-width:340px;padding:28px}.dot{width:44px;height:44px;border-radius:50%;margin:0 auto 16px;
background:${ok ? "#1b9d55" : "#c0392b"};display:flex;align-items:center;justify-content:center;font-size:24px}
</style></head><body><div class="box"><div class="dot">${ok ? "✓" : "!"}</div>
<h2 style="margin:.2em 0">${ok ? "Compte Steam lié" : "Échec de la liaison"}</h2>
<p style="color:#9a9dab">${ok ? "Tu peux fermer cette fenêtre." : (error || "Réessaie depuis les paramètres.")}</p></div>
<script>try{window.opener&&window.opener.postMessage(${payload},"*");}catch(e){}
setTimeout(function(){window.close();},${ok ? 800 : 2500});</script></body></html>`;
}

// --- Statut de la connexion Steam ---
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam");
    const s = user?.steam;
    res.json({
      configured: isConfigured(),
      connected: !!s?.steamId,
      steam: s?.steamId
        ? {
            personaName: s.personaName || null,
            avatar: s.avatar || null,
            profileUrl: s.profileUrl || null,
            connectedAt: s.connectedAt || null,
          }
        : null,
    });
  } catch (err) {
    console.error("steam status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Lancement de « Sign in through Steam » : redirige vers Steam. Le token
//     JWT (transmis en query) identifie l'utilisateur au retour. ---
router.get("/login", (req, res) => {
  try {
    if (!isConfigured())
      return res.status(503).send(closerPage(false, "Steam non configuré côté serveur."));
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send(closerPage(false, "Session manquante."));
    try {
      jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).send(closerPage(false, "Session invalide."));
    }
    const base = `${req.protocol}://${req.get("host")}`;
    const returnTo = `${base}/api/steam/return?token=${encodeURIComponent(token)}`;
    res.redirect(buildLoginUrl(returnTo, base));
  } catch (err) {
    console.error("steam login error:", err.message);
    res.status(500).send(closerPage(false, "Erreur serveur."));
  }
});

// --- Retour OpenID : on vérifie la réponse Steam, on rattache le SteamID64 au
//     compte identifié par le token, et on stocke un instantané du profil. ---
router.get("/return", async (req, res) => {
  try {
    let userId = null;
    try {
      userId = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET).sub;
    } catch {
      return res.status(401).send(closerPage(false, "Session invalide."));
    }

    const steamId = await verifyOpenId(req.query);
    if (!steamId) return res.status(400).send(closerPage(false, "Vérification Steam échouée."));

    const user = await User.findById(userId);
    if (!user) return res.status(404).send(closerPage(false, "Utilisateur introuvable."));

    // Empêche de lier un compte Steam déjà rattaché à un autre utilisateur.
    const clash = await User.findOne({
      "steam.steamId": steamId,
      _id: { $ne: user._id },
    }).select("_id");
    if (clash)
      return res.status(409).send(closerPage(false, "Ce compte Steam est déjà lié ailleurs."));

    const summary = await getPlayerSummary(steamId).catch(() => null);
    user.steam = {
      steamId,
      personaName: summary?.personaName || null,
      avatar: summary?.avatar || null,
      profileUrl: summary?.profileUrl || `https://steamcommunity.com/profiles/${steamId}`,
      connectedAt: new Date(),
    };
    await user.save();
    res.send(closerPage(true));
  } catch (err) {
    console.error("steam return error:", err.message);
    res.status(500).send(closerPage(false, "Erreur serveur."));
  }
});

// --- Repli manuel : lier via une URL de profil / SteamID64 collé. ---
router.post("/link-manual", requireAuth, async (req, res) => {
  try {
    if (!isConfigured()) return res.status(503).json({ error: "Steam non configuré." });
    const steamId = await resolveSteamId(req.body?.input);
    if (!steamId)
      return res.status(400).json({ error: "Profil Steam introuvable. Vérifie l'URL / l'ID." });
    const clash = await User.findOne({
      "steam.steamId": steamId,
      _id: { $ne: req.userId },
    }).select("_id");
    if (clash) return res.status(409).json({ error: "Ce compte Steam est déjà lié ailleurs." });

    const summary = await getPlayerSummary(steamId).catch(() => null);
    const user = await User.findById(req.userId);
    user.steam = {
      steamId,
      personaName: summary?.personaName || null,
      avatar: summary?.avatar || null,
      profileUrl: summary?.profileUrl || `https://steamcommunity.com/profiles/${steamId}`,
      connectedAt: new Date(),
    };
    await user.save();
    res.json({ connected: true, steam: user.toPublic().steam });
  } catch (err) {
    console.error("steam link-manual error:", err.message);
    res.status(500).json({ error: "Erreur lors de la liaison." });
  }
});

// --- Déliaison : optionnellement retirer les jeux ajoutés par l'import. ---
router.delete("/", requireAuth, async (req, res) => {
  try {
    const removeGames = req.query.removeGames === "true" || req.body?.removeGames === true;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    let removed = 0;
    if (removeGames) {
      // Uniquement les entrées CRÉÉES par l'import (jamais celles qui préexistaient).
      const r = await UserGame.deleteMany({ user: req.userId, steamImported: true });
      removed = r.deletedCount || 0;
    } else {
      // On garde les jeux mais on retire la marque « importé » (déliaison propre).
      await UserGame.updateMany(
        { user: req.userId, steamImported: true },
        { $set: { steamImported: false } }
      );
    }
    // Les succès Steam n'ont plus de source : on les retire toujours.
    await GameAchievements.deleteMany({ user: req.userId, platform: "steam" });

    user.steam = {
      steamId: null,
      personaName: null,
      avatar: null,
      profileUrl: null,
      connectedAt: null,
    };
    await user.save();
    res.json({ connected: false, removedGames: removed });
  } catch (err) {
    console.error("steam unlink error:", err.message);
    res.status(500).json({ error: "Erreur lors de la déliaison." });
  }
});

// --- Aperçu de l'import : bibliothèque Steam matchée sur IGDB, catégorisée. ---
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam");
    const steamId = user?.steam?.steamId;
    if (!steamId) return res.status(400).json({ error: "Aucun compte Steam lié." });

    const owned = await getOwnedGames(steamId);
    if (owned === null)
      return res.status(422).json({
        error:
          "Impossible de lire ta bibliothèque Steam. Passe ton profil (et les détails des jeux) en public, puis réessaie.",
      });
    if (!owned.length) return res.json({ games: [], unmatched: [], counts: emptyCounts() });

    const matchMap = await matchAppsToIgdb(owned.map((g) => g.appid));

    // État actuel de la bibliothèque MyPlayLog (statut + heures) par gameId.
    const libRows = await UserGame.find({ user: req.userId }).select(
      "gameId status playtimeHours"
    );
    const libMap = new Map(libRows.map((e) => [e.gameId, e]));

    const games = [];
    const unmatched = [];
    for (const g of owned) {
      const m = matchMap.get(g.appid);
      if (!m) {
        unmatched.push({
          appid: g.appid,
          name: g.name,
          playtimeMinutes: g.playtimeMinutes,
          icon: g.icon,
        });
        continue;
      }
      const played = g.playtimeMinutes > 0;
      const hours = hoursOf(g.playtimeMinutes);
      const existing = libMap.get(m.gameId);
      const inLibrary = !!existing;

      let category;
      let suggestedStatus;
      if (!played) {
        category = inLibrary ? "synced" : "wishlist";
        suggestedStatus = "wishlist";
      } else if (!inLibrary) {
        category = "played";
        suggestedStatus = m.endless
          ? "endless"
          : hours >= FINISHED_HOURS
          ? "finished"
          : "paused";
      } else {
        // Déjà en librairie ET joué : étape « update » (on y importe les succès
        // et on propose la maj d'heures quand Steam en sait plus).
        category = "update";
        suggestedStatus = existing.status;
      }

      games.push({
        appid: g.appid,
        steamName: g.name,
        steamIcon: g.icon,
        playtimeMinutes: g.playtimeMinutes,
        playtimeHours: hours,
        gameId: m.gameId,
        name: m.name,
        cover: m.cover,
        endless: m.endless,
        inLibrary,
        currentStatus: existing?.status || null,
        currentHours: existing?.playtimeHours ?? null,
        category,
        suggestedStatus,
        canImportAchievements: played,
      });
    }

    res.json({ games, unmatched, counts: countBy(games, unmatched) });
  } catch (err) {
    console.error("steam preview error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de l'aperçu." });
  }
});

function emptyCounts() {
  return { wishlist: 0, played: 0, update: 0, synced: 0, unmatched: 0 };
}
function countBy(games, unmatched) {
  const c = emptyCounts();
  for (const g of games) c[g.category] = (c[g.category] || 0) + 1;
  c.unmatched = unmatched.length;
  return c;
}

// --- Import effectif : applique les sélections validées par l'utilisateur. ---
router.post("/import", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam");
    const steamId = user?.steam?.steamId;
    if (!steamId) return res.status(400).json({ error: "Aucun compte Steam lié." });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ added: 0, updated: 0, achievements: 0 });

    const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];
    let added = 0;
    let updated = 0;

    for (const it of items) {
      const gameId = Number(it.gameId);
      if (!gameId || !it.name) continue;
      const status = STATUSES.includes(it.status) ? it.status : "wishlist";
      const hours =
        it.playtimeHours != null && Number.isFinite(Number(it.playtimeHours))
          ? Number(it.playtimeHours)
          : null;

      const existing = await UserGame.findOne({ user: req.userId, gameId });
      if (!existing) {
        await UserGame.create({
          user: req.userId,
          gameId,
          name: it.name,
          cover: it.cover || null,
          status,
          playtimeHours: status === "wishlist" ? null : hours,
          steamAppId: Number(it.appid) || null,
          steamImported: true,
        });
        added++;
        warmGameMeta(gameId); // pré-chauffe les métadonnées (stats), non bloquant
      } else {
        const set = { steamAppId: Number(it.appid) || existing.steamAppId || null };
        // Maj des heures si demandé : on honore la valeur validée par
        // l'utilisateur (éventuellement éditée à la main), y compris à la baisse.
        if (it.updateHours && hours != null && hours >= 0) {
          set.playtimeHours = hours;
        }
        await UserGame.updateOne({ _id: existing._id }, { $set: set });
        updated++;
      }
    }

    // Succès : uniquement les jeux cochés « importer les succès » (jeux lancés).
    const achItems = items.filter(
      (it) => it.importAchievements && it.appid && Number(it.gameId)
    );
    let achievements = 0;
    await pool(achItems, 3, async (it) => {
      try {
        const data = await getGameAchievements(steamId, it.appid);
        if (!data) return;
        await GameAchievements.updateOne(
          { user: req.userId, gameId: Number(it.gameId), platform: "steam" },
          {
            $set: {
              platformAppId: String(it.appid),
              gameName: it.name,
              gameCover: it.cover || null,
              total: data.total,
              unlocked: data.unlocked,
              achievements: data.achievements,
            },
          },
          { upsert: true }
        );
        achievements++;
      } catch (e) {
        /* best-effort : un jeu qui échoue ne bloque pas l'import */
      }
    });

    res.json({ added, updated, achievements });
  } catch (err) {
    console.error("steam import error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

export default router;
