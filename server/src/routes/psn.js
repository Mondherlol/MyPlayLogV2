import express from "express";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import GameAchievements from "../models/GameAchievements.js";
import PendingImport from "../models/PendingImport.js";
import Notification from "../models/Notification.js";
import PsnSyncRequest from "../models/PsnSyncRequest.js";
import PsnScan from "../models/PsnScan.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import {
  isConfigured,
  getServiceAccessToken,
  resolveOnlineId,
  checkTrophiesPublic,
  fetchPlayedGames,
  fetchUserTitles,
  fetchTitleTrophies,
  matchNamesToIgdb,
  simplifyName,
  sumTrophies,
  detectPsnConsole,
} from "../lib/psn.js";

const router = express.Router();

// Au-delà de ce temps de jeu, un jeu « lancé » mais absent de la bibliothèque
// est suggéré comme « Terminé » plutôt qu'« En pause » (aligné sur l'import Steam).
const FINISHED_HOURS = 30;

const STATUSES = ["wishlist", "playing", "finished", "paused", "dropped", "endless"];

// Petit pool de concurrence pour les appels PSN (trophées) : évite de marteler
// l'API tout en gardant l'import réactif.
async function pool(items, size, worker) {
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

const isLinked = (psn) => !!psn?.accountId;

// Crée ou met à jour une entrée de bibliothèque à partir d'un item d'import/synchro
// PSN. Renvoie "added" | "updated". Pose `psnPlaytimeHours` (repère qui permet à
// la synchro de savoir si l'utilisateur a modifié les heures à la main).
async function upsertUserGame(userId, it) {
  const gameId = Number(it.gameId);
  const status = STATUSES.includes(it.status) ? it.status : "paused";
  const hours =
    it.playtimeHours != null && Number.isFinite(Number(it.playtimeHours))
      ? Number(it.playtimeHours)
      : null;
  const platform = typeof it.platform === "string" && it.platform ? it.platform : null;

  const existing = await UserGame.findOne({ user: userId, gameId });
  if (!existing) {
    await UserGame.create({
      user: userId,
      gameId,
      name: it.name,
      cover: it.cover || null,
      status,
      platform,
      playtimeHours: status === "wishlist" ? null : hours,
      psnPlaytimeHours: hours,
      psnCommunicationId: it.npCommunicationId || null,
      psnImported: true,
    });
    warmGameMeta(gameId); // pré-chauffe les métadonnées (stats), non bloquant
    return "added";
  }
  const set = {
    psnCommunicationId: it.npCommunicationId || existing.psnCommunicationId || null,
  };
  // Console : on la renseigne si le jeu n'en avait pas encore (sans écraser
  // un choix existant de l'utilisateur).
  if (platform && !existing.platform) set.platform = platform;
  // Maj des heures si demandé : on honore la valeur validée (éditable) et on
  // aligne le repère de synchro dessus.
  if (it.updateHours && hours != null && hours >= 0) {
    set.playtimeHours = hours;
    set.psnPlaytimeHours = hours;
  }
  await UserGame.updateOne({ _id: existing._id }, { $set: set });
  return "updated";
}

// Calcule la mise à jour du temps de jeu d'un UserGame lors d'une synchro, en
// respectant une éventuelle saisie manuelle. Renvoie un patch { playtimeHours?,
// psnPlaytimeHours } ou null si rien à faire. Le temps PSN ne faisant que croître,
// on ne réduit jamais la valeur affichée.
function nextPlaytime(ug, newH) {
  if (newH == null) return null;
  const cur = ug.playtimeHours;
  const tracker = ug.psnPlaytimeHours;
  // « Par défaut » = jamais retouché à la main (playtime aligné sur le repère, ou
  // aucune valeur / repère — cas des jeux importés avant le suivi).
  const isDefault = cur == null || tracker == null || cur === tracker;
  if (!isDefault) {
    // Saisie manuelle : on garde la valeur de l'utilisateur, on suit juste PSN
    // en interne pour les prochains calculs.
    return newH !== tracker ? { psnPlaytimeHours: newH } : null;
  }
  const val = cur == null ? newH : Math.max(cur, newH);
  const patch = {};
  if (val !== cur) patch.playtimeHours = val;
  if (newH !== tracker) patch.psnPlaytimeHours = newH;
  return Object.keys(patch).length ? patch : null;
}

// Récupère et enregistre les trophées d'un titre PSN (GameAchievements upsert).
// Renvoie true si des trophées ont été enregistrés. Best-effort (ne throw pas).
async function syncTitleTrophies(userId, accountId, accessToken, it) {
  try {
    const trophies = await fetchTitleTrophies(
      accessToken,
      it.npCommunicationId,
      it.npServiceName,
      accountId
    );
    if (!trophies?.length) return false;
    const mapped = trophies.map((t) => ({
      apiName: String(t.id),
      name: t.name,
      description: t.detail,
      icon: t.icon,
      hidden: t.hidden,
      unlocked: t.earned,
      unlockedAt: t.earnedAt ? new Date(t.earnedAt) : null,
      rarity: t.percent,
      tier: t.type,
    }));
    await GameAchievements.updateOne(
      { user: userId, gameId: Number(it.gameId), platform: "psn" },
      {
        $set: {
          platformAppId: String(it.npCommunicationId),
          gameName: it.name,
          gameCover: it.cover || null,
          total: mapped.length,
          unlocked: mapped.filter((a) => a.unlocked).length,
          achievements: mapped,
        },
      },
      { upsert: true }
    );
    return true;
  } catch {
    return false;
  }
}

// Persiste des titres « ignorés » (croix à l'import) pour ne plus les reproposer.
async function persistIgnored(userId, list) {
  for (const it of list) {
    const titleKey = it.titleKey || simplifyName(it.psnName || it.name);
    if (!titleKey) continue;
    await PendingImport.updateOne(
      { user: userId, platform: "psn", titleKey },
      { $set: { state: "ignored", psnName: it.psnName || it.name || null, icon: it.icon || null } },
      { upsert: true }
    );
  }
}

// Forme d'affichage d'un jeu en attente / ignoré pour l'UI Paramètres.
function mapPending(p) {
  return {
    id: String(p._id),
    psnName: p.psnName,
    icon: p.icon,
    playtimeHours: p.playtimeHours,
    definedTrophies: p.definedTrophies,
    trophyProgress: p.trophyProgress,
    hasPlatinum: p.hasPlatinum,
    canImportTrophies: p.canImportTrophies,
    gameId: p.gameId,
    name: p.name,
    cover: p.cover,
    consoles: p.consoles || [],
    suggestedConsole: p.suggestedConsole,
    suggestedStatus: p.suggestedStatus,
  };
}

// --- Statut de la connexion PSN ---
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    const psn = user?.psn;
    const linked = isLinked(psn);
    const pending = linked
      ? await PendingImport.countDocuments({
          user: req.userId,
          platform: "psn",
          state: "pending",
        })
      : 0;
    // Demande de synchro en cours de traitement par le worker maison.
    const activeReq = await PsnSyncRequest.findOne({
      user: req.userId,
      status: { $in: ["pending", "processing"] },
    }).select("status createdAt");
    // Scan prêt (récupéré par le worker) → alimente « Importer mes jeux (N) ».
    const scan = linked
      ? await PsnScan.findOne({ user: req.userId }).select("gamesCount unmatchedCount scannedAt")
      : null;
    res.json({
      configured: isConfigured(),
      connected: linked,
      pending,
      request: activeReq ? { status: activeReq.status, createdAt: activeReq.createdAt } : null,
      scan: scan
        ? {
            games: scan.gamesCount || 0,
            unmatched: scan.unmatchedCount || 0,
            total: (scan.gamesCount || 0) + (scan.unmatchedCount || 0),
            scannedAt: scan.scannedAt,
          }
        : null,
      psn: linked
        ? {
            onlineId: psn.onlineId || null,
            avatar: psn.avatar || null,
            connectedAt: psn.connectedAt || null,
            lastSyncAt: psn.lastSyncAt || null,
          }
        : null,
    });
  } catch (err) {
    console.error("psn status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liaison via PSN ID : le serveur (compte de service) résout l'identifiant
//     en accountId et vérifie que les trophées sont publics. ---
router.post("/connect", requireAuth, async (req, res) => {
  try {
    if (!isConfigured())
      return res.status(503).json({ error: "PSN n'est pas configuré côté serveur." });

    const psnId = String(req.body?.psnId || "").trim();
    if (!psnId) return res.status(400).json({ error: "PSN ID manquant." });

    const accessToken = await getServiceAccessToken();
    // On distingue « profil réellement introuvable » (résultat vide) d'un
    // « échec de l'API PlayStation » (auth/token/IP du serveur). Avant, un
    // .catch(() => null) écrasait les deux en « introuvable », ce qui masquait
    // les problèmes côté VPS (Sony bloque parfois les IP de datacenter).
    let resolved;
    try {
      resolved = await resolveOnlineId(accessToken, psnId);
    } catch (e) {
      const detail = e?.response?.status || e?.status || "";
      console.error("psn resolveOnlineId error:", psnId, detail, e?.message);
      return res.status(502).json({
        error:
          "La recherche PlayStation a échoué côté serveur (API Sony injoignable ou bloquée). Réessaie dans un instant.",
      });
    }
    if (!resolved)
      return res.status(404).json({
        error: "Profil PSN introuvable. Vérifie l'orthographe de ton PSN ID.",
      });

    // Empêche de lier un compte PSN déjà rattaché à un autre utilisateur.
    const clash = await User.findOne({
      "psn.accountId": resolved.accountId,
      _id: { $ne: req.userId },
    }).select("_id");
    if (clash)
      return res.status(409).json({ error: "Ce compte PSN est déjà lié à un autre profil." });

    const isPublic = await checkTrophiesPublic(accessToken, resolved.accountId);
    if (!isPublic)
      return res.status(422).json({
        error:
          "Tes trophées ne sont pas publics. Passe ton profil PlayStation (et tes trophées) en public, puis réessaie.",
      });

    const user = await User.findById(req.userId);
    user.psn = {
      accountId: resolved.accountId,
      onlineId: resolved.onlineId,
      avatar: resolved.avatar,
      connectedAt: new Date(),
    };
    await user.save();

    res.json({
      connected: true,
      psn: {
        onlineId: resolved.onlineId,
        avatar: resolved.avatar,
        connectedAt: user.psn.connectedAt,
      },
    });
  } catch (err) {
    console.error("psn connect error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la liaison PSN." });
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
      const r = await UserGame.deleteMany({ user: req.userId, psnImported: true });
      removed = r.deletedCount || 0;
    } else {
      await UserGame.updateMany(
        { user: req.userId, psnImported: true },
        { $set: { psnImported: false } }
      );
    }
    // Les trophées PSN n'ont plus de source : on les retire toujours.
    await GameAchievements.deleteMany({ user: req.userId, platform: "psn" });
    // Nettoyage complet : cache de scan, jeux « à valider »/ignorés, demandes en
    // cours et notifs d'import — pour repartir de zéro.
    await Promise.all([
      PsnScan.deleteOne({ user: req.userId }),
      PendingImport.deleteMany({ user: req.userId, platform: "psn" }),
      PsnSyncRequest.deleteMany({
        user: req.userId,
        status: { $in: ["pending", "processing"] },
      }),
      Notification.deleteMany({ user: req.userId, type: "psn_ready" }),
    ]);

    user.psn = { accountId: null, onlineId: null, avatar: null, connectedAt: null };
    await user.save();
    res.json({ connected: false, removedGames: removed });
  } catch (err) {
    console.error("psn unlink error:", err.message);
    res.status(500).json({ error: "Erreur lors de la déliaison." });
  }
});

function emptyCounts() {
  return { played: 0, update: 0, unmatched: 0 };
}

// Scanne la bibliothèque PSN d'un compte : jeux joués (temps de jeu) + titres à
// trophées, fusionnés par nom, matchés sur IGDB, catégorisés (played / update)
// ou renvoyés en « à reconnaître ». Chaque entrée porte un `titleKey` stable.
// Partagé par l'aperçu d'import et la synchro.
async function scanPsn(userId, accountId, accessToken) {
  const [played, titles] = await Promise.all([
    fetchPlayedGames(accessToken, accountId).catch((e) => {
      console.error("psn scan: fetchPlayedGames failed:", e.message);
      return [];
    }),
    fetchUserTitles(accessToken, accountId).catch((e) => {
      console.error("psn scan: fetchUserTitles failed:", e.message);
      return [];
    }),
  ]);

  // Diagnostic : répartition par plateforme (voir si Sony renvoie bien les PS4/PS3
  // et pas seulement les PS5) et volumes des deux sources.
  const platBreakdown = {};
  for (const t of titles) {
    const p = t.trophyTitlePlatform || "?";
    platBreakdown[p] = (platBreakdown[p] || 0) + 1;
  }
  console.log(`psn scan: played=${played.length} titles=${titles.length}`, platBreakdown);

  // Fusion par nom simplifié : le temps de jeu vient de l'historique joué, la
  // progression + l'identifiant de trophées viennent de la liste de trophées.
  const merged = new Map();
  for (const p of played) {
    const key = simplifyName(p.name);
    if (!key) continue;
    const cur = merged.get(key);
    if (cur) {
      // Un même jeu peut exister sous plusieurs titleId (versions PS4/PS5,
      // éditions régionales), chacun avec sa propre durée. On CUMULE le temps
      // de jeu au lieu d'écraser (sinon on ne garde que la dernière version,
      // d'où des « 42 min » alors qu'on a beaucoup plus sur une autre version),
      // et on garde l'activité la plus récente + une icône.
      cur.playMinutes += p.playMinutes;
      if (new Date(p.lastPlayed || 0) > new Date(cur.lastPlayed || 0))
        cur.lastPlayed = p.lastPlayed;
      if (!cur.icon) cur.icon = p.icon;
    } else {
      merged.set(key, {
        name: p.name,
        icon: p.icon,
        playMinutes: p.playMinutes,
        lastPlayed: p.lastPlayed,
        npCommunicationId: null,
        npServiceName: null,
        trophyProgress: null,
        definedTrophies: 0,
        hasPlatinum: false,
        // Signaux de console pour deviner la plateforme par défaut à l'import.
        playedCategory: p.category || null,
        trophyPlatform: null,
      });
    }
  }
  for (const t of titles) {
    const key = simplifyName(t.trophyTitleName);
    if (!key) continue;
    const defined = sumTrophies(t.definedTrophies);
    const cur = merged.get(key);
    if (cur) {
      cur.npCommunicationId = t.npCommunicationId;
      cur.npServiceName = t.npServiceName;
      cur.trophyProgress = t.progress;
      cur.definedTrophies = defined;
      cur.hasPlatinum = (t.definedTrophies?.platinum || 0) > 0;
      if (!cur.icon) cur.icon = t.trophyTitleIconUrl || null;
      if (!cur.lastPlayed) cur.lastPlayed = t.lastUpdatedDateTime || null;
      if (!cur.trophyPlatform) cur.trophyPlatform = t.trophyTitlePlatform || null;
    } else {
      merged.set(key, {
        name: t.trophyTitleName,
        icon: t.trophyTitleIconUrl || null,
        playMinutes: 0,
        lastPlayed: t.lastUpdatedDateTime || null,
        npCommunicationId: t.npCommunicationId,
        npServiceName: t.npServiceName,
        trophyProgress: t.progress,
        definedTrophies: defined,
        hasPlatinum: (t.definedTrophies?.platinum || 0) > 0,
        playedCategory: null,
        trophyPlatform: t.trophyTitlePlatform || null,
      });
    }
  }

  const list = [...merged.values()];
  if (!list.length) return { games: [], unmatched: [] };

  const matchMap = await matchNamesToIgdb(list.map((g) => g.name));

  // État actuel de la bibliothèque MyPlayLog (statut + heures) par gameId.
  const libRows = await UserGame.find({ user: userId }).select(
    "gameId status playtimeHours"
  );
  const libMap = new Map(libRows.map((e) => [e.gameId, e]));

  const games = [];
  const unmatched = [];
  let idx = 0;
  let uIdx = 0;
  // Construit une entrée « à reconnaître » à partir d'un jeu PSN fusionné : on
  // garde toutes ses infos (temps, trophées) pour que l'utilisateur puisse le
  // lier à un jeu à la main et l'importer quand même.
  const pushUnmatched = (g) => {
    unmatched.push({
      id: `u${uIdx++}`,
      titleKey: simplifyName(g.name),
      name: g.name,
      psnName: g.name,
      icon: g.icon,
      playMinutes: g.playMinutes,
      playtimeHours: Math.round((g.playMinutes / 60) * 10) / 10,
      lastPlayed: g.lastPlayed,
      npCommunicationId: g.npCommunicationId,
      npServiceName: g.npServiceName,
      trophyProgress: g.trophyProgress,
      definedTrophies: g.definedTrophies,
      hasPlatinum: g.hasPlatinum,
      canImportTrophies: !!g.npCommunicationId && g.definedTrophies > 0,
    });
  };

  for (const g of list) {
    const hours = Math.round((g.playMinutes / 60) * 10) / 10;
    const m = matchMap.get(simplifyName(g.name));
    if (!m) {
      pushUnmatched(g);
      continue;
    }
    // Un jeu matché mais absent de PS3/PS4/PS5 = mapping quasi sûrement faux
    // (un jeu joué sur PSN est forcément sorti sur une de ces consoles) → on
    // le renvoie vers « à reconnaître » plutôt que de l'importer de travers.
    const consoles = m.consoles || [];
    if (consoles.length === 0) {
      pushUnmatched(g);
      continue;
    }
    // Console proposée par défaut : celle détectée depuis PSN si le jeu est
    // bien sorti dessus, sinon la plus récente disponible.
    const detected = detectPsnConsole(g.playedCategory, g.trophyPlatform);
    const suggestedConsole =
      detected && consoles.some((c) => c.name === detected)
        ? detected
        : consoles[0].name;

    const existing = libMap.get(m.gameId);
    const inLibrary = !!existing;
    const progress = g.trophyProgress ?? 0;

    let category;
    let suggestedStatus;
    if (inLibrary) {
      category = "update";
      suggestedStatus = existing.status;
    } else {
      category = "played";
      suggestedStatus = m.endless
        ? "endless"
        : progress >= 100 || hours >= FINISHED_HOURS
        ? "finished"
        : "paused";
    }

    games.push({
      id: String(idx++),
      titleKey: simplifyName(g.name),
      gameId: m.gameId,
      name: m.name,
      cover: m.cover,
      endless: m.endless,
      psnName: g.name,
      icon: g.icon,
      playMinutes: g.playMinutes,
      playtimeHours: hours,
      lastPlayed: g.lastPlayed,
      npCommunicationId: g.npCommunicationId,
      npServiceName: g.npServiceName,
      trophyProgress: g.trophyProgress,
      definedTrophies: g.definedTrophies,
      hasPlatinum: g.hasPlatinum,
      canImportTrophies: !!g.npCommunicationId && g.definedTrophies > 0,
      inLibrary,
      currentStatus: existing?.status || null,
      currentHours: existing?.playtimeHours ?? null,
      // Consoles PS où le jeu est sorti + celle suggérée (auto-détectée).
      consoles,
      suggestedConsole,
      category,
      suggestedStatus,
    });
  }

  console.log(
    `psn scan: matched=${games.length} unmatched=${unmatched.length}`,
    unmatched.length ? unmatched.map((u) => u.name) : ""
  );

  // Ordre : activité la plus récente d'abord.
  games.sort((a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0));
  return { games, unmatched };
}

// --- Aperçu de l'import : jeux joués + titres à trophées, matchés et catégorisés. ---
router.post("/preview", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!isLinked(user?.psn))
      return res.status(400).json({ error: "Aucun compte PSN lié." });

    const scan = await PsnScan.findOne({ user: req.userId }).lean();

    // Pas encore de scan (le worker maison ne l'a pas encore traité) : on tente
    // un scan en direct (marche en local ; bloqué depuis le VPS).
    if (!scan) {
      try {
        const accessToken = await getServiceAccessToken();
        const { games, unmatched } = await scanPsn(req.userId, user.psn.accountId, accessToken);
        const counts = emptyCounts();
        for (const g of games) counts[g.category] = (counts[g.category] || 0) + 1;
        counts.unmatched = unmatched.length;
        return res.json({ games, unmatched, counts });
      } catch {
        return res.json({ games: [], unmatched: [], counts: emptyCounts() });
      }
    }

    // Scan en cache (worker) : on recalcule l'état « déjà en biblio » au moment
    // présent + on retire les titres ignorés, puis on renvoie la forme attendue
    // par la modale (id, category, currentStatus/currentHours).
    const libRows = await UserGame.find({ user: req.userId }).select(
      "gameId status playtimeHours"
    );
    const libMap = new Map(libRows.map((e) => [e.gameId, e]));
    const ignoredRows = await PendingImport.find({
      user: req.userId,
      platform: "psn",
      state: "ignored",
    }).select("titleKey");
    const ignoredSet = new Set(ignoredRows.map((r) => r.titleKey));

    // Les trophées complets restent en base (utilisés à l'import) : on ne les
    // renvoie PAS au navigateur (ce serait plusieurs Mo inutiles).
    const light = ({ trophies, ...rest }) => rest;

    const counts = emptyCounts();
    const games = [];
    let idx = 0;
    for (const g of scan.games || []) {
      if (ignoredSet.has(g.titleKey)) continue;
      const existing = libMap.get(Number(g.gameId));
      const inLibrary = !!existing;
      const category = inLibrary ? "update" : "played";
      counts[category] = (counts[category] || 0) + 1;
      games.push({
        ...light(g),
        id: String(idx++),
        inLibrary,
        category,
        currentStatus: existing?.status || null,
        currentHours: existing?.playtimeHours ?? null,
        suggestedStatus: inLibrary ? existing.status : g.suggestedStatus,
      });
    }
    const unmatched = [];
    let uIdx = 0;
    for (const g of scan.unmatched || []) {
      if (ignoredSet.has(g.titleKey)) continue;
      unmatched.push({ ...light(g), id: `u${uIdx++}` });
    }
    counts.unmatched = unmatched.length;

    res.json({ games, unmatched, counts });
  } catch (err) {
    console.error("psn preview error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de l'aperçu." });
  }
});

// --- Import effectif : applique les sélections validées par l'utilisateur. ---
router.post("/import", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!isLinked(user?.psn))
      return res.status(400).json({ error: "Aucun compte PSN lié." });
    const accountId = user.psn.accountId;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const ignored = Array.isArray(req.body?.ignored) ? req.body.ignored : [];
    if (!items.length && !ignored.length)
      return res.json({ added: 0, updated: 0, achievements: 0 });

    let added = 0;
    let updated = 0;

    for (const it of items) {
      if (!Number(it.gameId) || !it.name) continue;
      const r = await upsertUserGame(req.userId, it);
      if (r === "added") added++;
      else updated++;
    }

    // Titres écartés à la main (croix) : on les mémorise pour ne plus les proposer.
    if (ignored.length) await persistIgnored(req.userId, ignored);

    // Jeux importés : on les retire des « en attente de validation » s'ils y étaient.
    const importedKeys = items
      .map((it) => it.titleKey || simplifyName(it.psnName || it.name))
      .filter(Boolean);
    if (importedKeys.length)
      await PendingImport.deleteMany({
        user: req.userId,
        platform: "psn",
        titleKey: { $in: importedKeys },
        state: "pending",
      });

    // Trophées : uniquement les jeux cochés « importer les trophées ». On utilise
    // les trophées PRÉ-RÉCUPÉRÉS par le worker (cache PsnScan) → aucun appel PSN
    // depuis le VPS. Repli live (dev) si le cache est absent.
    const trophyItems = items.filter(
      (it) => it.importTrophies && it.npCommunicationId && Number(it.gameId)
    );
    let achievements = 0;
    if (trophyItems.length) {
      const scan = await PsnScan.findOne({ user: req.userId }).lean();
      const trophyByNp = new Map();
      for (const g of [...(scan?.games || []), ...(scan?.unmatched || [])]) {
        if (g.npCommunicationId && Array.isArray(g.trophies) && g.trophies.length) {
          trophyByNp.set(String(g.npCommunicationId), g);
        }
      }
      let liveToken = null;
      for (const it of trophyItems) {
        const stored = trophyByNp.get(String(it.npCommunicationId));
        if (stored) {
          await writeStoredAchievements(req.userId, {
            gameId: it.gameId,
            name: it.name,
            cover: it.cover,
            npCommunicationId: it.npCommunicationId,
            trophies: stored.trophies,
            trophyTotal: stored.trophyTotal,
            trophyUnlocked: stored.trophyUnlocked,
          });
          achievements++;
        } else {
          // Repli dev/localhost : récupération en direct depuis PSN.
          try {
            if (!liveToken) liveToken = await getServiceAccessToken();
            if (await syncTitleTrophies(req.userId, accountId, liveToken, it)) achievements++;
          } catch {
            /* best-effort */
          }
        }
      }
    }

    res.json({ added, updated, achievements });
  } catch (err) {
    console.error("psn import error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de l'import." });
  }
});

// --- Synchro (bouton) : maj temps de jeu + trophées des jeux DÉJÀ en biblio,
//     et détection des NOUVEAUX jeux → « en attente de validation » + notif. ---
router.post("/sync", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!isLinked(user?.psn))
      return res.status(400).json({ error: "Aucun compte PSN lié." });
    const accountId = user.psn.accountId;
    const accessToken = await getServiceAccessToken();

    const { games, unmatched } = await scanPsn(req.userId, accountId, accessToken);

    // 1) Jeux déjà en bibliothèque : maj du temps de jeu (sauf saisie manuelle).
    const updateGames = games.filter((g) => g.category === "update");
    const ugRows = await UserGame.find({
      user: req.userId,
      gameId: { $in: updateGames.map((g) => g.gameId) },
    });
    const ugMap = new Map(ugRows.map((u) => [u.gameId, u]));

    let hoursUpdated = 0;
    for (const g of updateGames) {
      const ug = ugMap.get(g.gameId);
      if (!ug) continue;
      const patch = nextPlaytime(ug, g.playtimeHours);
      if (patch) {
        await UserGame.updateOne({ _id: ug._id }, { $set: patch });
        if (patch.playtimeHours != null) hoursUpdated++;
      }
    }

    // 2) Trophées : on ne refetch que si la progression a bougé (économe en appels).
    const trophyCandidates = updateGames.filter((g) => g.canImportTrophies);
    const achRows = await GameAchievements.find({
      user: req.userId,
      platform: "psn",
      gameId: { $in: trophyCandidates.map((g) => g.gameId) },
    }).select("gameId total unlocked");
    const achMap = new Map(achRows.map((a) => [a.gameId, a]));
    const toRefresh = trophyCandidates.filter((g) => {
      const a = achMap.get(g.gameId);
      if (!a) return true; // aucun trophée enregistré encore
      const storedPct = a.total ? Math.round((a.unlocked / a.total) * 100) : 0;
      return storedPct !== Math.round(g.trophyProgress ?? 0);
    });
    let trophiesUpdated = 0;
    await pool(toRefresh, 3, async (g) => {
      const ok = await syncTitleTrophies(req.userId, accountId, accessToken, {
        gameId: g.gameId,
        name: g.name,
        cover: g.cover,
        npCommunicationId: g.npCommunicationId,
        npServiceName: g.npServiceName,
      });
      if (ok) trophiesUpdated++;
    });

    // 3) Nouveaux jeux (joués hors biblio + non reconnus) → en attente, sauf ignorés.
    const ignoredRows = await PendingImport.find({
      user: req.userId,
      platform: "psn",
      state: "ignored",
    }).select("titleKey");
    const ignoredKeys = new Set(ignoredRows.map((r) => r.titleKey));

    const candidates = [...games.filter((g) => g.category === "played"), ...unmatched];
    let newlyPending = 0;
    for (const g of candidates) {
      const titleKey = g.titleKey;
      if (!titleKey || ignoredKeys.has(titleKey)) continue;
      const doc = {
        psnName: g.psnName,
        icon: g.icon || null,
        playtimeHours: g.playtimeHours ?? null,
        npCommunicationId: g.npCommunicationId || null,
        npServiceName: g.npServiceName || null,
        definedTrophies: g.definedTrophies || 0,
        trophyProgress: g.trophyProgress ?? null,
        hasPlatinum: !!g.hasPlatinum,
        canImportTrophies: !!g.canImportTrophies,
        gameId: g.gameId ?? null,
        name: g.name ?? null,
        cover: g.cover ?? null,
        consoles: g.consoles || [],
        suggestedConsole: g.suggestedConsole ?? null,
        suggestedStatus: g.suggestedStatus || "paused",
      };
      const existing = await PendingImport.findOne({
        user: req.userId,
        platform: "psn",
        titleKey,
      });
      if (existing) {
        await PendingImport.updateOne({ _id: existing._id }, { $set: doc });
      } else {
        await PendingImport.create({ user: req.userId, platform: "psn", titleKey, state: "pending", ...doc });
        newlyPending++;
      }
    }

    // 4) Notif système (une seule non lue à la fois) si de nouveaux jeux à valider.
    const pending = await PendingImport.countDocuments({
      user: req.userId,
      platform: "psn",
      state: "pending",
    });
    if (newlyPending > 0) {
      await Notification.deleteMany({
        user: req.userId,
        type: "import_pending",
        read: false,
      });
      await Notification.create({
        user: req.userId,
        type: "import_pending",
        actor: null,
        snippet: `${pending} jeu${pending > 1 ? "x" : ""} PlayStation à valider`,
      }).catch(() => {});
    }

    user.psn.lastSyncAt = new Date();
    await user.save();

    res.json({
      hoursUpdated,
      trophiesUpdated,
      newlyPending,
      pending,
      lastSyncAt: user.psn.lastSyncAt,
    });
  } catch (err) {
    console.error("psn sync error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la synchro." });
  }
});

// --- Jeux en attente de validation + jeux ignorés (pour l'UI Paramètres). ---
router.get("/pending", requireAuth, async (req, res) => {
  try {
    const rows = await PendingImport.find({ user: req.userId, platform: "psn" }).sort({
      createdAt: -1,
    });
    res.json({
      pending: rows.filter((r) => r.state === "pending").map(mapPending),
      ignored: rows.filter((r) => r.state === "ignored").map(mapPending),
    });
  } catch (err) {
    console.error("psn pending error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Valide un jeu en attente (ou ignoré) → l'ajoute à la bibliothèque.
router.post("/pending/:id/validate", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!isLinked(user?.psn))
      return res.status(400).json({ error: "Aucun compte PSN lié." });
    const accountId = user.psn.accountId;

    const pend = await PendingImport.findOne({ _id: req.params.id, user: req.userId });
    if (!pend) return res.status(404).json({ error: "Jeu introuvable." });

    const b = req.body || {};
    const gameId = Number(b.gameId || pend.gameId);
    if (!gameId)
      return res.status(400).json({ error: "Choisis d'abord le jeu correspondant." });

    const it = {
      gameId,
      name: b.name || pend.name,
      cover: b.cover ?? pend.cover,
      platform: b.platform ?? pend.suggestedConsole,
      status: b.status || pend.suggestedStatus,
      playtimeHours: pend.playtimeHours,
      updateHours: true, // nouveau jeu : on pose les heures
      npCommunicationId: pend.npCommunicationId,
      npServiceName: pend.npServiceName,
    };
    const result = await upsertUserGame(req.userId, it);

    if (b.importTrophies !== false && pend.canImportTrophies && pend.npCommunicationId) {
      if (Array.isArray(pend.trophies) && pend.trophies.length) {
        // Trophées pré-récupérés par le worker maison → écriture sans appel PSN.
        await GameAchievements.updateOne(
          { user: req.userId, gameId, platform: "psn" },
          {
            $set: {
              platformAppId: String(pend.npCommunicationId),
              gameName: it.name,
              gameCover: it.cover || null,
              total: pend.trophyTotal || pend.trophies.length,
              unlocked: pend.trophyUnlocked ?? pend.trophies.filter((t) => t.unlocked).length,
              achievements: pend.trophies,
            },
          },
          { upsert: true }
        );
      } else {
        // Repli (dev/localhost) : récupération en direct depuis PSN.
        const accessToken = await getServiceAccessToken();
        await syncTitleTrophies(req.userId, accountId, accessToken, it);
      }
    }

    await PendingImport.deleteOne({ _id: pend._id });
    res.json({ ok: true, added: result === "added" });
  } catch (err) {
    console.error("psn validate error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la validation." });
  }
});

// Ignore un jeu en attente (ne le repropose plus).
router.post("/pending/:id/ignore", requireAuth, async (req, res) => {
  try {
    const r = await PendingImport.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: { state: "ignored" } }
    );
    if (!r) return res.status(404).json({ error: "Jeu introuvable." });
    res.json({ ok: true });
  } catch (err) {
    console.error("psn ignore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Remet un jeu ignoré dans les « en attente ».
router.post("/pending/:id/restore", requireAuth, async (req, res) => {
  try {
    const r = await PendingImport.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: { state: "pending" } }
    );
    if (!r) return res.status(404).json({ error: "Jeu introuvable." });
    res.json({ ok: true });
  } catch (err) {
    console.error("psn restore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  WORKER MAISON — traite les demandes de synchro PSN depuis une IP
//  résidentielle (le VPS est bloqué par Akamai). Le VPS ne parle jamais à
//  PSN : il file les demandes au worker (server/tools/psn-worker.mjs) qui
//  renvoie le résultat, ingéré ici. Auth par secret partagé PSN_WORKER_SECRET.
// ======================================================================

function requireWorker(req, res, next) {
  const secret = (process.env.PSN_WORKER_SECRET || "").trim();
  if (!secret)
    return res.status(503).json({ error: "Worker PSN non configuré (PSN_WORKER_SECRET)." });
  if ((req.get("x-psn-worker-secret") || "") !== secret)
    return res.status(401).json({ error: "Secret worker invalide." });
  next();
}

// Notifie le compte admin (ADMIN_EMAIL) d'un évènement.
async function notifyAdmin(type, snippet) {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  if (!email) return;
  const admin = await User.findOne({
    email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  }).select("_id");
  if (admin)
    await Notification.create({ user: admin._id, type, actor: null, snippet }).catch(() => {});
}

// Écrit les trophées d'un jeu (depuis des trophées PRÉ-RÉCUPÉRÉS, aucun appel PSN).
async function writeStoredAchievements(userId, g) {
  if (!Array.isArray(g.trophies) || !g.trophies.length || !g.gameId) return false;
  await GameAchievements.updateOne(
    { user: userId, gameId: Number(g.gameId), platform: "psn" },
    {
      $set: {
        platformAppId: String(g.npCommunicationId || ""),
        gameName: g.name,
        gameCover: g.cover || null,
        total: g.trophyTotal || g.trophies.length,
        unlocked: g.trophyUnlocked ?? g.trophies.filter((t) => t.unlocked).length,
        achievements: g.trophies,
      },
    },
    { upsert: true }
  );
  return true;
}

// --- Utilisateur : demande une synchro PSN (traitée par le worker maison). ---
router.post("/request", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn username");
    const psnId = String(req.body?.psnId || "").trim();
    const linked = isLinked(user?.psn);
    if (!linked && !psnId) return res.status(400).json({ error: "Entre ton PSN ID." });

    // Une seule demande active par utilisateur.
    let reqDoc = await PsnSyncRequest.findOne({
      user: req.userId,
      status: { $in: ["pending", "processing"] },
    });
    if (!reqDoc) {
      reqDoc = await PsnSyncRequest.create({
        user: req.userId,
        psnId: linked ? null : psnId,
      });
      await notifyAdmin(
        "psn_request",
        `${user.username} a demandé une synchro PlayStation${linked ? "" : ` (${psnId})`}`
      );
    }
    res.json({ status: reqDoc.status });
  } catch (err) {
    console.error("psn request error:", err.message);
    res.status(500).json({ error: "Erreur lors de la demande." });
  }
});

// --- Admin : liste des demandes de synchro (panel Admin). ---
router.get("/requests", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await PsnSyncRequest.find({})
      .sort({ createdAt: -1 })
      .limit(40)
      .populate("user", "username avatar");
    res.json({
      requests: rows.map((r) => ({
        id: String(r._id),
        username: r.user?.username || "?",
        avatar: r.user?.avatar || null,
        psnId: r.psnId || null,
        status: r.status,
        error: r.error || null,
        summary: r.summary || null,
        createdAt: r.createdAt,
        processedAt: r.processedAt || null,
      })),
      active: rows.filter((r) => r.status === "pending" || r.status === "processing").length,
    });
  } catch (err) {
    console.error("psn requests error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Worker : réclame la prochaine demande à traiter (→ processing). ---
router.get("/worker/jobs", requireWorker, async (req, res) => {
  try {
    // Reprend aussi les demandes coincées en « processing » depuis > 10 min
    // (worker planté en cours de route).
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const job = await PsnSyncRequest.findOneAndUpdate(
      { $or: [{ status: "pending" }, { status: "processing", updatedAt: { $lt: staleBefore } }] },
      { $set: { status: "processing" } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!job) return res.json({ job: null });
    const user = await User.findById(job.user).select("psn username");
    res.json({
      job: {
        id: String(job._id),
        psnId: job.psnId || null,
        accountId: user?.psn?.accountId || null,
        username: user?.username || null,
      },
    });
  } catch (err) {
    console.error("psn worker jobs error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Worker : renvoie le résultat d'une demande → ingestion en base. ---
router.post("/worker/jobs/:id/result", requireWorker, async (req, res) => {
  try {
    const job = await PsnSyncRequest.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Demande introuvable." });
    const user = await User.findById(job.user).select("psn username");
    if (!user) {
      job.status = "error";
      job.error = "Utilisateur supprimé.";
      await job.save();
      return res.status(404).json({ error: "Utilisateur introuvable." });
    }

    const body = req.body || {};
    // Liaison du compte (première demande) : le worker a résolu le PSN ID.
    if (body.account?.accountId) {
      user.psn = {
        accountId: body.account.accountId,
        onlineId: body.account.onlineId || job.psnId || user.psn?.onlineId || null,
        avatar: body.account.avatar || null,
        connectedAt: user.psn?.connectedAt || new Date(),
      };
    }
    if (!isLinked(user.psn)) {
      job.status = "error";
      job.error = "Compte PSN non résolu (profil introuvable ou privé ?).";
      await job.save();
      return res.status(400).json({ error: job.error });
    }

    const games = Array.isArray(body.games) ? body.games : [];
    const unmatched = Array.isArray(body.unmatched) ? body.unmatched : [];

    // On NE touche PAS à la bibliothèque : on met le scan en cache. L'utilisateur
    // choisira quoi importer via la modale « Importer mes jeux ».
    await PsnScan.updateOne(
      { user: user._id },
      {
        $set: {
          games,
          unmatched,
          gamesCount: games.length,
          unmatchedCount: unmatched.length,
          scannedAt: new Date(),
        },
      },
      { upsert: true }
    );

    await user.save();

    // Notif user : son import est prêt (à valider dans les Paramètres).
    const detected = games.length + unmatched.length;
    await Notification.deleteMany({ user: user._id, type: "psn_ready", read: false });
    await Notification.create({
      user: user._id,
      type: "psn_ready",
      actor: null,
      snippet: `Ton import PlayStation est prêt : ${detected} jeu${
        detected > 1 ? "x" : ""
      } détecté${detected > 1 ? "s" : ""} — à valider`,
    }).catch(() => {});

    job.status = "done";
    job.error = null;
    job.processedAt = new Date();
    job.summary = { games: games.length, trophies: 0, pending: unmatched.length };
    await job.save();

    res.json({ ok: true, games: games.length, unmatched: unmatched.length });
  } catch (err) {
    console.error("psn worker result error:", err.message);
    res.status(500).json({ error: err.message || "Erreur d'ingestion." });
  }
});

// --- Worker : signale un échec de traitement d'une demande. ---
router.post("/worker/jobs/:id/error", requireWorker, async (req, res) => {
  try {
    const job = await PsnSyncRequest.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Demande introuvable." });
    job.status = "error";
    job.error = String(req.body?.error || "Erreur inconnue").slice(0, 500);
    job.processedAt = new Date();
    await job.save();
    await notifyAdmin("psn_request", `Échec synchro PSN : ${job.error}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("psn worker error report:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
