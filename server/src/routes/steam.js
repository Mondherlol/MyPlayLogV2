import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import GameAchievements from "../models/GameAchievements.js";
import PendingImport from "../models/PendingImport.js";
import PlatformSync from "../models/PlatformSync.js";
import Notification from "../models/Notification.js";
import { requireAuth } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import { triggerMissionCheck } from "../lib/missions.js";
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
import { fetchUserReviews } from "../lib/steamReviews.js";

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

// Le rappel demandé par l'application mobile. Un schéma d'URL n'est réservé à
// personne : on n'accepte QUE le nôtre, jamais une adresse web — sans quoi
// cette route servirait de tremplin pour renvoyer un visiteur n'importe où.
function safeRedirect(value) {
  const rd = String(value || "").trim();
  return /^myplaylog:\/\/[a-z0-9\-\/]*$/i.test(rd) ? rd : null;
}

// --- Statut de la connexion Steam ---
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam avatar");
    const s = user?.steam;
    if (!s?.steamId) {
      return res.json({ configured: isConfigured(), connected: false, steam: null });
    }

    // Le récap en attente et le compte des synchros passées : l'écran des
    // réglages en a besoin en même temps que le reste.
    const [pending, applied, ignoredCount] = await Promise.all([
      PlatformSync.findOne({ user: req.userId, platform: "steam", state: "pending" }),
      PlatformSync.countDocuments({ user: req.userId, platform: "steam", state: "applied" }),
      PendingImport.countDocuments({ user: req.userId, platform: "steam", state: "ignored" }),
    ]);

    res.json({
      configured: isConfigured(),
      connected: true,
      steam: {
        personaName: s.personaName || null,
        avatar: s.avatar || null,
        profileUrl: s.profileUrl || null,
        connectedAt: s.connectedAt || null,
        lastSyncAt: s.lastSyncAt || null,
      },
      // La photo Steam vaut-elle d'être proposée ? Inutile de le demander si
      // c'est déjà celle du compte.
      avatarDiffers: !!s.avatar && user.avatar !== s.avatar,
      pendingSync: pending ? mapSync(pending) : null,
      syncCount: applied,
      ignoredCount,
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
    // L'application mobile n'a pas de fenêtre à refermer : elle ouvre un onglet
    // de navigateur et attend qu'on la rappelle sur son propre schéma d'URL.
    // On transporte donc ce rappel jusqu'au retour OpenID (cf. /return).
    const rd = safeRedirect(req.query.redirect);
    const returnTo =
      `${base}/api/steam/return?token=${encodeURIComponent(token)}` +
      (rd ? `&rd=${encodeURIComponent(rd)}` : "");
    res.redirect(buildLoginUrl(returnTo, base));
  } catch (err) {
    console.error("steam login error:", err.message);
    res.status(500).send(closerPage(false, "Erreur serveur."));
  }
});

// --- Retour OpenID : on vérifie la réponse Steam, on rattache le SteamID64 au
//     compte identifié par le token, et on stocke un instantané du profil. ---
router.get("/return", async (req, res) => {
  // Mobile : au lieu de la page qui se referme, on renvoie l'onglet vers
  // l'application, qui saura si la liaison a pris.
  const rd = safeRedirect(req.query.rd);
  const finish = (ok, error) => {
    if (rd) {
      const q = ok ? "ok=1" : `error=${encodeURIComponent(error || "failed")}`;
      return res.redirect(`${rd}?${q}`);
    }
    return res.send(closerPage(ok, error));
  };
  try {
    let userId = null;
    try {
      userId = jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET).sub;
    } catch {
      return finish(false, "Session invalide.");
    }

    const steamId = await verifyOpenId(req.query);
    if (!steamId) return finish(false, "Vérification Steam échouée.");

    const user = await User.findById(userId);
    if (!user) return finish(false, "Utilisateur introuvable.");

    // Empêche de lier un compte Steam déjà rattaché à un autre utilisateur.
    const clash = await User.findOne({
      "steam.steamId": steamId,
      _id: { $ne: user._id },
    }).select("_id");
    if (clash)
      return finish(false, "Ce compte Steam est déjà lié ailleurs.");

    const summary = await getPlayerSummary(steamId).catch(() => null);
    user.steam = {
      steamId,
      personaName: summary?.personaName || null,
      avatar: summary?.avatar || null,
      profileUrl: summary?.profileUrl || `https://steamcommunity.com/profiles/${steamId}`,
      connectedAt: new Date(),
    };
    await user.save();
    triggerMissionCheck(user._id); // mission « Tout est relié »
    finish(true);
  } catch (err) {
    console.error("steam return error:", err.message);
    finish(false, "Erreur serveur.");
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
    triggerMissionCheck(req.userId); // mission « Tout est relié »
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

    // Délier, c'est tout oublier : le récap en attente, l'historique des
    // synchros et la liste des jeux écartés partent avec le compte. Les
    // garder ferait resurgir des choix d'un compte qu'on ne relie plus.
    await PlatformSync.deleteMany({ user: req.userId, platform: "steam" });
    await PendingImport.deleteMany({ user: req.userId, platform: "steam" });
    await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });

    user.steam = {
      steamId: null,
      personaName: null,
      avatar: null,
      profileUrl: null,
      connectedAt: null,
      lastSyncAt: null,
    };
    await user.save();
    res.json({ connected: false, removedGames: removed });
  } catch (err) {
    console.error("steam unlink error:", err.message);
    res.status(500).json({ error: "Erreur lors de la déliaison." });
  }
});

// ----------------------------------------------------------------------
//  LE SCAN : la bibliothèque Steam, rapprochée du catalogue et rangée
// ----------------------------------------------------------------------
// Partagé par l'aperçu du site (POST /preview) et par la synchro de
// l'application (POST /sync) : une seule lecture de Steam, une seule façon de
// deviner les statuts. `skip` = les appid que l'utilisateur a écartés pour de
// bon (cf. la liste des ignorés).
async function scanLibrary(userId, steamId, { skip } = {}) {
  const owned = await getOwnedGames(steamId);
  if (owned === null) {
    const err = new Error(
      "Impossible de lire ta bibliothèque Steam. Passe ton profil (et les détails des jeux) en public, puis réessaie."
    );
    err.status = 422;
    throw err;
  }
  if (!owned.length) return { games: [], unmatched: [], counts: emptyCounts(), ignored: 0 };

  // Les jeux écartés pour de bon ne repassent jamais par le scan : ils ne sont
  // pas « décochés », ils n'existent plus pour la synchro.
  const skipSet = skip instanceof Set ? skip : new Set(skip || []);
  const kept = owned.filter((g) => !skipSet.has(Number(g.appid)));
  const ignored = owned.length - kept.length;

  const matchMap = await matchAppsToIgdb(kept.map((g) => g.appid));

  // État actuel de la bibliothèque MyPlayLog (statut + heures) par gameId.
  const libRows = await UserGame.find({ user: userId }).select(
    "gameId status playtimeHours"
  );
  const libMap = new Map(libRows.map((e) => [e.gameId, e]));

  const games = [];
  const unmatched = [];
  for (const g of kept) {
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

  return { games, unmatched, counts: countBy(games, unmatched), ignored };
}

// --- Aperçu de l'import (site) : ne touche à rien, montre ce qu'on a trouvé. ---
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam");
    const steamId = user?.steam?.steamId;
    if (!steamId) return res.status(400).json({ error: "Aucun compte Steam lié." });
    const { games, unmatched, counts } = await scanLibrary(req.userId, steamId, {
      skip: await ignoredAppIds(req.userId),
    });
    res.json({ games, unmatched, counts });
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

// ----------------------------------------------------------------------
//  L'ÉCRITURE : appliquer des choix déjà validés
// ----------------------------------------------------------------------
// La SEULE fonction de ce fichier qui touche à la bibliothèque. Elle ne décide
// de rien — elle exécute une liste que l'utilisateur a validée, qu'elle vienne
// de la modale du site (POST /import) ou du récap de l'application
// (POST /sync/apply).
const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

async function applyItems(userId, steamId, items) {
  let added = 0;
  let updated = 0;
  let hoursUpdated = 0;

  for (const it of items) {
    const gameId = Number(it.gameId);
    if (!gameId || !it.name) continue;
    const status = STATUSES.includes(it.status) ? it.status : "wishlist";
    const hours =
      it.playtimeHours != null && Number.isFinite(Number(it.playtimeHours))
        ? Number(it.playtimeHours)
        : null;

    const existing = await UserGame.findOne({ user: userId, gameId });
    if (!existing) {
      await UserGame.create({
        user: userId,
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
        if (hours !== existing.playtimeHours) hoursUpdated++;
      }
      // Un statut explicitement choisi dans le récap s'applique aussi aux jeux
      // déjà présents : c'est tout l'intérêt de pouvoir le changer là.
      if (it.setStatus && STATUSES.includes(it.status)) set.status = it.status;
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
        { user: userId, gameId: Number(it.gameId), platform: "steam" },
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

  return { added, updated, hoursUpdated, achievements };
}

// --- Import effectif (site) : applique les sélections validées par l'utilisateur. ---
router.post("/import", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("steam");
    const steamId = user?.steam?.steamId;
    if (!steamId) return res.status(400).json({ error: "Aucun compte Steam lié." });

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ added: 0, updated: 0, achievements: 0 });

    const { added, updated, achievements } = await applyItems(req.userId, steamId, items);
    user.steam.lastSyncAt = new Date();
    await user.save();
    res.json({ added, updated, achievements });
  } catch (err) {
    console.error("steam import error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'import." });
  }
});

// ======================================================================
//  LA SYNCHRO EN ATTENTE — on scanne, l'utilisateur valide, puis on écrit
// ======================================================================
//
// ⚠️ UNE SYNCHRO NE TOUCHE À RIEN AVANT D'ÊTRE VALIDÉE. Le scan dépose un
// RÉCAP (PlatformSync à l'état « pending ») qui attend dans les réglages, aussi
// longtemps qu'il le faut : on peut le rouvrir, changer un statut, décocher
// un jeu, fermer l'app, revenir le lendemain. Rien n'entre dans la
// bibliothèque tant que /sync/apply n'a pas été appelé.
//
// Un jeu ÉCARTÉ (croix) n'est pas un jeu décoché : il va dans la liste des
// ignorés (PendingImport, platform « steam ») et ne sera plus jamais proposé,
// jusqu'à ce que l'utilisateur le repêche.

// La clé d'un titre Steam dans la liste des ignorés.
const keyOf = (appid) => `app:${Number(appid)}`;
const appIdOf = (titleKey) => Number(String(titleKey || "").replace(/^app:/, "")) || null;

async function ignoredAppIds(userId) {
  const rows = await PendingImport.find({
    user: userId,
    platform: "steam",
    state: "ignored",
  }).select("titleKey");
  return new Set(rows.map((r) => appIdOf(r.titleKey)).filter(Boolean));
}

// Ce que l'application reçoit d'une synchro. `full` ajoute les jeux — c'est
// plusieurs centaines de lignes, on ne les envoie que pour le récap ouvert.
function mapSync(sync, { full = false } = {}) {
  const items = sync.items || [];
  const base = {
    id: String(sync._id),
    state: sync.state,
    kind: sync.kind,
    counts: sync.counts,
    result: sync.result,
    total: items.length,
    selected: items.filter((i) => i.include).length,
    createdAt: sync.createdAt,
    appliedAt: sync.appliedAt,
  };
  return full ? { ...base, items, unmatched: sync.unmatched || [] } : base;
}

// Le récap en attente, s'il y en a un.
const pendingSyncOf = (userId) =>
  PlatformSync.findOne({ user: userId, platform: "steam", state: "pending" });

async function steamIdOf(userId) {
  const user = await User.findById(userId).select("steam");
  const steamId = user?.steam?.steamId;
  if (!steamId) {
    const err = new Error("Aucun compte Steam lié.");
    err.status = 400;
    throw err;
  }
  return { user, steamId };
}

// --- Lancer un scan : produit (ou remplace) le récap en attente. ---
router.post("/sync", requireAuth, async (req, res) => {
  try {
    const { steamId } = await steamIdOf(req.userId);

    const { games, unmatched, counts, ignored } = await scanLibrary(req.userId, steamId, {
      skip: await ignoredAppIds(req.userId),
    });

    // Les jeux « synced » (présents des deux côtés, jamais lancés) n'ont rien à
    // dire : on les compte, on ne les fait pas défiler.
    // ⚠️ LA FORME EST CELLE DU RÉCAP, PAS CELLE DE STEAM. Le scan parle
    // « steamName / steamIcon » parce que la modale du site le lit ainsi ; le
    // récap, lui, est commun à PlayStation et à Steam, d'où la traduction ici.
    const items = games
      .filter((g) => g.category !== "synced")
      .map((g) => {
        const better = g.playtimeHours > (g.currentHours || 0);
        return {
          key: String(g.appid),
          appid: g.appid,
          sourceName: g.steamName,
          icon: g.steamIcon,
          playtimeMinutes: g.playtimeMinutes,
          playtimeHours: g.playtimeHours,
          gameId: g.gameId,
          name: g.name,
          cover: g.cover,
          endless: g.endless,
          inLibrary: g.inLibrary,
          currentStatus: g.currentStatus,
          currentHours: g.currentHours,
          category: g.category,
          suggestedStatus: g.suggestedStatus,
          canImportAchievements: g.canImportAchievements,
          // Un jeu déjà présent n'est coché que s'il y a QUELQUE CHOSE à en
          // faire : des heures en plus, ou des succès à récupérer.
          include: g.category === "update" ? better || g.canImportAchievements : true,
          status: g.suggestedStatus,
          hours: g.playtimeHours,
          updateHours: g.category === "update" ? better : true,
          importAchievements: g.canImportAchievements,
        };
      });

    const appliedBefore = await PlatformSync.countDocuments({
      user: req.userId,
      platform: "steam",
      state: "applied",
    });

    // Un seul récap à la fois : relancer un scan remplace le brouillon
    // précédent (rien ne s'était produit) sans toucher à l'historique.
    await PlatformSync.deleteMany({ user: req.userId, platform: "steam", state: "pending" });

    const sync = await PlatformSync.create({
      user: req.userId,
      state: "pending",
      platform: "steam",
      kind: appliedBefore ? "refresh" : "first",
      items,
      unmatched: unmatched.map((u) => ({
        key: String(u.appid),
        name: u.name,
        icon: u.icon,
        playtimeMinutes: u.playtimeMinutes,
      })),
      counts: { ...counts, ignored },
    });

    // Une seule notification non lue à la fois : on remplace la précédente.
    if (items.length) {
      await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
      await Notification.create({
        user: req.userId,
        type: "import_pending",
        actor: null,
        snippet: `${items.length} jeu${items.length > 1 ? "x" : ""} Steam à valider`,
      }).catch(() => {});
    }

    res.json({ sync: mapSync(sync, { full: true }) });
  } catch (err) {
    console.error("steam sync error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la synchro." });
  }
});

// --- Le récap en attente (rouvert depuis les réglages). ---
router.get("/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingSyncOf(req.userId);
    res.json({ sync: sync ? mapSync(sync, { full: true }) : null });
  } catch (err) {
    console.error("steam sync get error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Modifier le récap : cocher, changer un statut, corriger des heures. ---
router.patch("/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingSyncOf(req.userId);
    if (!sync) return res.status(404).json({ error: "Aucune synchro en attente." });

    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const byKey = new Map(sync.items.map((it, i) => [String(it.key), i]));

    for (const c of changes) {
      const idx = byKey.get(String(c.key));
      if (idx == null) continue;
      const it = sync.items[idx];
      if (c.include !== undefined) it.include = !!c.include;
      if (c.status !== undefined && STATUSES.includes(c.status)) it.status = c.status;
      if (c.updateHours !== undefined) it.updateHours = !!c.updateHours;
      if (c.importAchievements !== undefined)
        it.importAchievements = !!c.importAchievements && it.canImportAchievements;
      if (c.hours !== undefined) {
        const h = Number(c.hours);
        it.hours = c.hours === null || !Number.isFinite(h) || h < 0 ? null : h;
      }
    }

    // Tout cocher / tout décocher d'une catégorie, en un seul aller-retour.
    const bulk = req.body?.bulk;
    if (bulk && typeof bulk.include === "boolean") {
      for (const it of sync.items) {
        if (!bulk.category || it.category === bulk.category) it.include = bulk.include;
      }
    }

    sync.markModified("items");
    await sync.save();
    res.json({ sync: mapSync(sync, { full: true }) });
  } catch (err) {
    console.error("steam sync patch error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Valider : c'est ICI, et nulle part ailleurs, que la bibliothèque bouge. ---
router.post("/sync/apply", requireAuth, async (req, res) => {
  try {
    const { user, steamId } = await steamIdOf(req.userId);
    const sync = await pendingSyncOf(req.userId);
    if (!sync) return res.status(404).json({ error: "Aucune synchro en attente." });

    const chosen = sync.items.filter((it) => it.include);
    const payload = chosen.map((it) => ({
      appid: it.appid,
      gameId: it.gameId,
      name: it.name,
      cover: it.cover,
      status: it.category === "wishlist" ? "wishlist" : it.status,
      playtimeHours: it.hours != null ? it.hours : it.playtimeHours,
      updateHours: !!it.updateHours,
      // Le statut choisi s'applique aussi à un jeu déjà présent (le joueur a pu
      // le passer de « en pause » à « terminé » depuis le récap).
      setStatus: it.category === "update" && it.status !== it.currentStatus,
      importAchievements: !!it.importAchievements && it.canImportAchievements,
    }));

    const result = await applyItems(req.userId, steamId, payload);

    sync.state = "applied";
    sync.appliedAt = new Date();
    sync.result = { ...result, skipped: sync.items.length - chosen.length };
    await sync.save();

    user.steam.lastSyncAt = sync.appliedAt;
    await user.save();

    await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
    triggerMissionCheck(req.userId);

    res.json({ sync: mapSync(sync), result: sync.result });
  } catch (err) {
    console.error("steam sync apply error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la validation." });
  }
});

// --- Annuler le récap : il part à l'historique, marqué « annulée ». ---
router.delete("/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingSyncOf(req.userId);
    if (!sync) return res.json({ ok: true });
    sync.state = "cancelled";
    // Une synchro annulée n'a rien à dire de ses jeux : on rend la place.
    sync.items = [];
    sync.unmatched = [];
    await sync.save();
    await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
    res.json({ ok: true });
  } catch (err) {
    console.error("steam sync cancel error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Écarter un jeu pour de bon (et le retirer du récap en cours). ---
router.post("/ignored/:appid", requireAuth, async (req, res) => {
  try {
    const appid = Number(req.params.appid);
    if (!appid) return res.status(400).json({ error: "Jeu inconnu." });

    const sync = await pendingSyncOf(req.userId);
    const item = sync?.items.find((it) => Number(it.appid) === appid);
    const fromUnmatched = sync?.unmatched.find((u) => Number(u.key) === appid);

    await PendingImport.updateOne(
      { user: req.userId, platform: "steam", titleKey: keyOf(appid) },
      {
        $set: {
          state: "ignored",
          // `psnName` porte ici le nom Steam : le modèle est partagé avec
          // l'import PlayStation, et un champ de plus par plateforme ne
          // vaudrait pas la duplication.
          psnName: item?.sourceName || fromUnmatched?.name || null,
          icon: item?.icon || fromUnmatched?.icon || null,
          gameId: item?.gameId ?? null,
          name: item?.name ?? null,
          cover: item?.cover ?? null,
          playtimeHours: item?.playtimeHours ?? null,
        },
      },
      { upsert: true }
    );

    if (sync) {
      sync.items = sync.items.filter((it) => Number(it.appid) !== appid);
      sync.unmatched = sync.unmatched.filter((u) => Number(u.key) !== appid);
      sync.counts.ignored = (sync.counts.ignored || 0) + 1;
      await sync.save();
    }

    res.json({ ok: true, sync: sync ? mapSync(sync, { full: true }) : null });
  } catch (err) {
    console.error("steam ignore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- La liste des écartés, et le droit de changer d'avis. ---
router.get("/ignored", requireAuth, async (req, res) => {
  try {
    const rows = await PendingImport.find({
      user: req.userId,
      platform: "steam",
      state: "ignored",
    }).sort({ updatedAt: -1 });
    res.json({
      ignored: rows.map((r) => ({
        id: String(r._id),
        // `key` est le mot commun aux deux plateformes (l'écran est partagé) ;
        // `appid` reste pour ce qui, côté Steam, en a vraiment besoin.
        key: String(appIdOf(r.titleKey) || ""),
        appid: appIdOf(r.titleKey),
        sourceName: r.psnName || null,
        icon: r.icon || null,
        gameId: r.gameId || null,
        name: r.name || r.psnName || null,
        cover: r.cover || null,
        playtimeHours: r.playtimeHours ?? null,
      })),
    });
  } catch (err) {
    console.error("steam ignored error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Repêcher un jeu écarté : il repassera à la prochaine synchro.
router.delete("/ignored/:appid", requireAuth, async (req, res) => {
  try {
    await PendingImport.deleteOne({
      user: req.userId,
      platform: "steam",
      titleKey: keyOf(req.params.appid),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("steam unignore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- L'historique des synchros. ---
router.get("/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await PlatformSync.find({
      user: req.userId,
      platform: "steam",
      state: { $in: ["applied", "cancelled"] },
    })
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ history: rows.map((r) => mapSync(r)) });
  } catch (err) {
    console.error("steam history error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Adopter la photo de profil Steam (garder la sienne = ne rien appeler). ---
router.post("/avatar", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const avatar = user?.steam?.avatar;
    if (!avatar) return res.status(400).json({ error: "Aucune photo Steam." });
    user.avatar = avatar;
    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    console.error("steam avatar error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  LES AVIS STEAM — proposés, jamais publiés d'office
// ======================================================================
// Lus sur le profil public (cf. lib/steamReviews.js). On les montre tels
// quels : l'utilisateur choisit lesquels deviennent des avis MyPlayLog.

router.get("/reviews", requireAuth, async (req, res) => {
  try {
    const { steamId } = await steamIdOf(req.userId);
    const raw = await fetchUserReviews(steamId);
    if (!raw.length) return res.json({ reviews: [] });

    const matchMap = await matchAppsToIgdb(raw.map((r) => r.appid));
    const gameIds = raw.map((r) => matchMap.get(r.appid)?.gameId).filter(Boolean);
    const rows = await UserGame.find({ user: req.userId, gameId: { $in: gameIds } }).select(
      "gameId review rating status"
    );
    const libMap = new Map(rows.map((r) => [r.gameId, r]));

    const reviews = [];
    for (const r of raw) {
      const m = matchMap.get(r.appid);
      if (!m) continue; // un avis sans fiche chez nous n'irait nulle part
      const existing = libMap.get(m.gameId);
      reviews.push({
        appid: r.appid,
        gameId: m.gameId,
        name: m.name,
        cover: m.cover,
        steamName: r.gameName,
        recommended: r.recommended,
        hours: r.hours,
        text: r.text,
        postedAt: r.postedAt,
        inLibrary: !!existing,
        currentStatus: existing?.status || null,
        // Un avis déjà écrit ici ne se remplace pas sans le dire.
        hasReview: !!(existing?.review || "").trim(),
        currentRating: existing?.rating ?? null,
      });
    }
    res.json({ reviews });
  } catch (err) {
    console.error("steam reviews error:", err.message);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Erreur lors de la lecture des avis." });
  }
});

// Reprendre les avis cochés. Un jeu absent de la bibliothèque y entre au
// passage : on ne peut pas avoir un avis sur un jeu qu'on n'a pas.
router.post("/reviews/import", requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ imported: 0, skipped: 0 });

    let imported = 0;
    let skipped = 0;

    for (const it of items) {
      const gameId = Number(it.gameId);
      const text = String(it.text || "").trim();
      if (!gameId || !text) {
        skipped++;
        continue;
      }
      const rating =
        it.rating != null && Number.isFinite(Number(it.rating))
          ? Math.max(0, Math.min(100, Number(it.rating)))
          : null;
      const when = it.postedAt ? new Date(it.postedAt) : new Date();
      const reviewedAt = Number.isNaN(when.getTime()) ? new Date() : when;

      const existing = await UserGame.findOne({ user: req.userId, gameId });
      if (existing) {
        // On n'écrase un avis existant que si l'utilisateur l'a demandé.
        if ((existing.review || "").trim() && !it.overwrite) {
          skipped++;
          continue;
        }
        const set = { review: text, reviewedAt };
        if (rating != null) set.rating = rating;
        await UserGame.updateOne({ _id: existing._id }, { $set: set });
      } else {
        const hours = Number(it.hours);
        await UserGame.create({
          user: req.userId,
          gameId,
          name: it.name || "Jeu",
          cover: it.cover || null,
          // Même règle que l'import : beaucoup d'heures → terminé, sinon en pause.
          status: Number.isFinite(hours) && hours >= FINISHED_HOURS ? "finished" : "paused",
          playtimeHours: Number.isFinite(hours) ? hours : null,
          steamAppId: Number(it.appid) || null,
          steamImported: true,
          review: text,
          reviewedAt,
          ...(rating != null ? { rating } : {}),
        });
        warmGameMeta(gameId);
      }
      imported++;
    }

    res.json({ imported, skipped });
  } catch (err) {
    console.error("steam reviews import error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'import des avis." });
  }
});

export default router;
