import express from "express";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";
import GameAchievements from "../models/GameAchievements.js";
import PendingImport from "../models/PendingImport.js";
import Notification from "../models/Notification.js";
import PsnSyncRequest from "../models/PsnSyncRequest.js";
import PsnScan from "../models/PsnScan.js";
import PlatformSync from "../models/PlatformSync.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { warmGameMeta } from "../lib/gameMeta.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { hasChanged, isQuiet, lastSnapshot, needsLook } from "../lib/syncDiff.js";
import { open as openSecret, seal } from "../lib/secretBox.js";
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
  // Statut explicitement retouché dans le récap (le joueur a fait passer un
  // jeu d'« en pause » à « terminé ») : il s'applique aussi aux jeux déjà là.
  // Sans `setStatus`, on n'y touche pas — les autres chemins d'import n'ont
  // jamais eu à le faire.
  if (it.setStatus && STATUSES.includes(it.status)) set.status = it.status;
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
      // Relié À SON COMPTE (le joueur s'est connecté) ou simple lecture d'un
      // profil public par le compte de service : ce n'est pas la même chose,
      // et l'interface doit pouvoir le dire (le temps de jeu, par exemple, ne
      // se lit que sur son propre compte).
      self: !!psn?.npsso,
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
    triggerMissionCheck(req.userId); // mission « Tout est relié »

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
      // Récap en attente et historique des synchros du téléphone : ils
      // parlaient d'un compte qu'on ne relie plus.
      PlatformSync.deleteMany({ user: req.userId, platform: "psn" }),
    ]);

    // Délier, c'est aussi rendre son secret : on n'en garde rien.
    user.psn = {
      accountId: null,
      onlineId: null,
      avatar: null,
      connectedAt: null,
      lastSyncAt: null,
      npsso: null,
    };
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
  return buildScan(userId, played, titles);
}

/**
 * Le scan proprement dit — et il NE PARLE À PERSONNE.
 *
 * Il reçoit l'historique joué et la liste de trophées, d'où qu'ils viennent :
 * du compte de service (ci-dessus), du worker maison, ou du TÉLÉPHONE du joueur
 * quand c'est lui qui s'est connecté chez Sony. Une seule fusion, un seul
 * rapprochement IGDB, une seule façon de deviner statut et console — sinon les
 * trois chemins finiraient par proposer trois choses différentes.
 */
async function buildScan(userId, played, titles) {
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
    // ⚠️ JAMAIS LANCÉ = ni une minute de jeu, ni un seul trophée. Ces jeux-là
    // (achetés, offerts par le PS Plus, téléchargés puis oubliés) partaient en
    // « En pause », alors que le récap les affichait « jamais lancé ». Même
    // règle que Steam : ils vont dans « À jouer ». Les deux signaux comptent,
    // parce que la PS3 et la Vita ne remontent aucun temps de jeu : un jeu PS3
    // à 40 % de trophées a bien été joué, même à zéro minute.
    const launched = g.playMinutes > 0 || progress > 0;

    let category;
    let suggestedStatus;
    if (inLibrary) {
      category = "update";
      suggestedStatus = existing.status;
    } else if (!launched) {
      category = "wishlist";
      suggestedStatus = "wishlist";
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
      // Une liste à 0 % d'un jeu jamais lancé n'apprend rien : comme Steam, on
      // ne propose les trophées que d'un jeu auquel on a joué.
      canImportTrophies: !!g.npCommunicationId && g.definedTrophies > 0 && launched,
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

// Notifie le super-admin (rôle en base) d'un évènement. Repli sur ADMIN_EMAIL
// tant qu'aucun super-admin n'a été bootstrappé.
async function notifyAdmin(type, snippet) {
  let admin = await User.findOne({ isSuperAdmin: true }).select("_id");
  if (!admin) {
    const email = (process.env.ADMIN_EMAIL || "").trim();
    if (!email) return;
    admin = await User.findOne({
      email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).select("_id");
  }
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

// ======================================================================
//  SE CONNECTER AVEC SON COMPTE PLAYSTATION (site)
// ======================================================================
//
// ⚠️ POURQUOI UN NPSSO COLLÉ, ET PAS UN BOUTON « Se connecter ». Dans un
// navigateur, rien d'autre n'est possible : Sony ne redirige qu'AU SCHÉMA de
// son application mobile (illisible depuis une page web, origine différente),
// et son API n'autorise aucun appel navigateur (pas d'en-tête CORS). Le seul
// pont praticable est celui que Sony affiche lui-même, sur son propre domaine,
// à un joueur DÉJÀ connecté : `/api/v1/ssocookie`. On ne voit donc jamais son
// mot de passe — il s'authentifie chez eux, et nous confie la clé qui en sort.
//
// ⚠️ ET LE SERVEUR NE S'EN SERT PAS LUI-MÊME. Son IP est bloquée par Sony : il
// scelle ce secret (cf. lib/secretBox) et le transmet au worker maison, seul à
// pouvoir parler à PlayStation. C'est aussi ce qui rend le compte de service —
// et donc l'admin dans la boucle — inutile pour ce joueur-là.
router.post("/session", requireAuth, async (req, res) => {
  try {
    // On accepte ce que le joueur a sous la main : la valeur nue, ou le JSON
    // entier affiché par Sony ({"npsso":"…"}), qu'on ne va pas lui faire
    // découper à la main.
    const raw = String(req.body?.npsso || "").trim();
    const found = raw.match(/[A-Za-z0-9_-]{40,128}/);
    const npsso = found ? found[0] : null;
    if (!npsso)
      return res.status(400).json({
        error: "Ce n'est pas un jeton NPSSO. Copie la valeur affichée par Sony.",
      });

    const user = await User.findById(req.userId).select("psn username");
    user.psn = { ...(user.psn?.toObject?.() || user.psn || {}), npsso: seal(npsso) };
    await user.save();

    // Une seule demande active à la fois : recoller un jeton ne fait pas la
    // queue, ça remet la demande en attente avec le nouveau secret.
    let reqDoc = await PsnSyncRequest.findOne({
      user: req.userId,
      status: { $in: ["pending", "processing"] },
    });
    if (reqDoc) {
      reqDoc.mode = "self";
      reqDoc.status = "pending";
      reqDoc.error = null;
      await reqDoc.save();
    } else {
      reqDoc = await PsnSyncRequest.create({ user: req.userId, mode: "self" });
    }
    notifyAdmin(
      "psn_request",
      `${user.username} s'est connecté à PlayStation (synchro à traiter)`
    ).catch(() => {});

    res.json({ ok: true, status: reqDoc.status });
  } catch (err) {
    console.error("psn session error:", err.message);
    res.status(500).json({ error: "Erreur lors de la connexion PlayStation." });
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

// --- Admin : effacer une demande de synchro (panel Admin). ---
router.delete("/requests/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id))
      return res.status(404).json({ error: "Demande introuvable." });
    const r = await PsnSyncRequest.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ error: "Demande introuvable." });
    res.json({ ok: true });
  } catch (err) {
    console.error("psn request delete error:", err.message);
    res.status(500).json({ error: "Erreur lors de la suppression." });
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
        mode: job.mode || "service",
        psnId: job.psnId || null,
        accountId: user?.psn?.accountId || null,
        username: user?.username || null,
        // Le secret du joueur ne sort d'ici que pour le worker, sur un canal
        // déjà protégé par le secret partagé — et seulement s'il s'est
        // connecté lui-même.
        npsso: job.mode === "self" ? openSecret(user?.psn?.npsso) : null,
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
      // ⚠️ ON COMPLÈTE, ON NE REMPLACE PAS. Réécrire le sous-document entier
      // effaçait le secret du joueur et la date de dernière synchro — donc la
      // connexion qu'il venait d'établir.
      user.psn = {
        ...(user.psn?.toObject?.() || user.psn || {}),
        accountId: body.account.accountId,
        onlineId: body.account.onlineId || job.psnId || user.psn?.onlineId || null,
        avatar: body.account.avatar || user.psn?.avatar || null,
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

// ======================================================================
//  PLAYSTATION DEPUIS LE TÉLÉPHONE — le compte du joueur, pas le nôtre
// ======================================================================
//
// ⚠️ LE MODÈLE CHANGE ICI, ET C'EST TOUT L'INTÉRÊT. Le reste de ce fichier
// lit les profils PUBLICS avec le compte de service de l'admin, depuis une IP
// résidentielle empruntée à un worker maison — parce que Sony bloque le VPS et
// parce qu'un compte de service ne voit que ce qui est public. Deux contraintes
// dont personne ne veut : il faut un admin dans la boucle, et un profil ouvert.
//
// Le téléphone, lui, n'a aucun de ces problèmes. Le joueur se connecte À SON
// compte PlayStation dans une vraie page Sony, l'app en ressort un jeton qui
// est LE SIEN, et c'est le téléphone — IP résidentielle, comme l'app officielle
// — qui lit sa bibliothèque. Le serveur ne parle jamais à Sony sur ce chemin :
// il reçoit une moisson déjà faite, la rapproche du catalogue, et la range dans
// un récap à valider. Aucun admin, aucun profil public exigé, aucun jeton à
// recopier à la main.
//
// COROLLAIRE DE SÉCURITÉ : ce qui arrive ici vient du client, donc de
// n'importe qui. On ne lui fait confiance sur rien — les volumes sont plafonnés,
// les champs recopiés un par un — et de toute façon un joueur ne peut abîmer
// que sa propre bibliothèque.

const MAX_TITLES = 1200; // au-delà, ce n'est plus une bibliothèque
const MAX_TROPHIES_PER_GAME = 600;

// La clé d'un titre PlayStation dans la liste des ignorés : son nom simplifié,
// le même que celui qui sert à fusionner les versions PS4/PS5 d'un jeu.
const psnKey = (name) => simplifyName(name);

async function psnIgnoredKeys(userId) {
  const rows = await PendingImport.find({
    user: userId,
    platform: "psn",
    state: "ignored",
  }).select("titleKey");
  return new Set(rows.map((r) => r.titleKey).filter(Boolean));
}

// Ce que l'application reçoit d'une synchro (même forme que côté Steam : c'est
// ce qui permet à l'app de n'avoir qu'un seul écran de récap).
function mapPsnSync(sync, { full = false } = {}) {
  const items = sync.items || [];
  const base = {
    id: String(sync._id),
    platform: sync.platform,
    state: sync.state,
    kind: sync.kind,
    counts: sync.counts,
    result: sync.result,
    // Ce qui demande un regard ; les mises à jour inchangées se comptent à part.
    total: items.filter(needsLook).length,
    upToDate: items.filter((i) => !i.ignored && !needsLook(i)).length,
    selected: items.filter((i) => i.include).length,
    createdAt: sync.createdAt,
    appliedAt: sync.appliedAt,
  };
  return full ? { ...base, items, unmatched: sync.unmatched || [] } : base;
}

const pendingPsnSync = (userId) =>
  PlatformSync.findOne({ user: userId, platform: "psn", state: "pending" });

// --- L'état de la liaison, tel que l'écran des réglages le lit d'un coup. ---
router.get("/mobile/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn avatar");
    const psn = user?.psn;
    if (!psn?.accountId) return res.json({ connected: false, psn: null });

    const [pending, applied, ignoredCount] = await Promise.all([
      pendingPsnSync(req.userId),
      PlatformSync.countDocuments({ user: req.userId, platform: "psn", state: "applied" }),
      PendingImport.countDocuments({ user: req.userId, platform: "psn", state: "ignored" }),
    ]);

    res.json({
      connected: true,
      psn: {
        onlineId: psn.onlineId || null,
        avatar: psn.avatar || null,
        connectedAt: psn.connectedAt || null,
        lastSyncAt: psn.lastSyncAt || null,
      },
      avatarDiffers: !!psn.avatar && user.avatar !== psn.avatar,
      // Une synchro sans rien de neuf n'attend rien de personne (cf. isQuiet).
      pendingSync: pending && !isQuiet(pending) ? mapPsnSync(pending) : null,
      syncCount: applied,
      ignoredCount,
    });
  } catch (err) {
    console.error("psn mobile status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Liaison : le téléphone s'est connecté chez Sony et nous dit QUI il est. ---
//
// Le serveur ne peut pas vérifier ce profil (il ne parle pas à Sony sur ce
// chemin), et il n'en a pas besoin : le jeton qui a servi à le lire ne quitte
// jamais le téléphone, et se tromper de compte ne pénalise que soi-même. On
// vérifie en revanche qu'un autre membre ne l'a pas déjà rattaché.
router.post("/mobile/link", requireAuth, async (req, res) => {
  try {
    const accountId = String(req.body?.accountId || "").trim();
    const onlineId = String(req.body?.onlineId || "").trim();
    if (!accountId || !onlineId)
      return res.status(400).json({ error: "Profil PlayStation incomplet." });

    const clash = await User.findOne({
      "psn.accountId": accountId,
      _id: { $ne: req.userId },
    }).select("_id");
    if (clash)
      return res.status(409).json({ error: "Ce compte PlayStation est déjà lié à un autre profil." });

    const user = await User.findById(req.userId);
    user.psn = {
      ...(user.psn?.toObject?.() || user.psn || {}),
      accountId,
      onlineId,
      avatar: req.body?.avatar ? String(req.body.avatar) : null,
      connectedAt: new Date(),
    };
    await user.save();
    triggerMissionCheck(req.userId); // mission « Tout est relié »

    res.json({
      connected: true,
      psn: {
        onlineId: user.psn.onlineId,
        avatar: user.psn.avatar,
        connectedAt: user.psn.connectedAt,
        lastSyncAt: user.psn.lastSyncAt || null,
      },
    });
  } catch (err) {
    console.error("psn mobile link error:", err.message);
    res.status(500).json({ error: "Erreur lors de la liaison." });
  }
});

// --- La moisson du téléphone entre ici et ressort en récap à valider. ---
router.post("/mobile/sync", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!user?.psn?.accountId)
      return res.status(400).json({ error: "Aucun compte PlayStation lié." });

    // Recopie champ par champ : rien de ce qui arrive du client n'est utilisé
    // tel quel, et les volumes sont plafonnés.
    const played = (Array.isArray(req.body?.played) ? req.body.played : [])
      .slice(0, MAX_TITLES)
      .map((p) => ({
        name: String(p?.name || ""),
        icon: p?.icon ? String(p.icon) : null,
        category: p?.category ? String(p.category) : null,
        playMinutes: Math.max(0, Math.round(Number(p?.playMinutes) || 0)),
        lastPlayed: p?.lastPlayed || null,
      }))
      .filter((p) => p.name);

    const titles = (Array.isArray(req.body?.titles) ? req.body.titles : [])
      .slice(0, MAX_TITLES)
      .map((t) => ({
        npCommunicationId: t?.npCommunicationId ? String(t.npCommunicationId) : null,
        npServiceName: t?.npServiceName ? String(t.npServiceName) : null,
        trophyTitleName: String(t?.trophyTitleName || ""),
        trophyTitleIconUrl: t?.trophyTitleIconUrl ? String(t.trophyTitleIconUrl) : null,
        trophyTitlePlatform: t?.trophyTitlePlatform ? String(t.trophyTitlePlatform) : null,
        definedTrophies: {
          bronze: Number(t?.definedTrophies?.bronze) || 0,
          silver: Number(t?.definedTrophies?.silver) || 0,
          gold: Number(t?.definedTrophies?.gold) || 0,
          platinum: Number(t?.definedTrophies?.platinum) || 0,
        },
        progress: t?.progress == null ? null : Number(t.progress),
        lastUpdatedDateTime: t?.lastUpdatedDateTime || null,
      }))
      .filter((t) => t.trophyTitleName);

    if (!played.length && !titles.length)
      return res.status(422).json({
        error:
          "Ta bibliothèque PlayStation est revenue vide. Reconnecte ton compte, puis réessaie.",
      });

    const { games, unmatched } = await buildScan(req.userId, played, titles);

    // Les jeux écartés pour de bon ne repassent pas : ils ne sont pas
    // « décochés », ils n'existent plus pour la synchro.
    const skip = await psnIgnoredKeys(req.userId);
    const kept = games.filter((g) => !skip.has(g.titleKey));
    const keptUnmatched = unmatched.filter((g) => !skip.has(g.titleKey));
    const ignored = games.length + unmatched.length - kept.length - keptUnmatched.length;

    // Ce que PlayStation disait à la dernière synchro validée (cf. lib/syncDiff).
    const snapshot = await lastSnapshot(req.userId, "psn");

    const items = kept.map((g) => {
      const better = g.playtimeHours > (g.currentHours || 0);
      const changed =
        g.category !== "update" ||
        hasChanged(snapshot, g.titleKey, {
          playtimeMinutes: g.playMinutes,
          trophyProgress: g.trophyProgress,
        });
      return {
        key: g.titleKey,
        sourceName: g.psnName,
        icon: g.icon,
        playtimeMinutes: g.playMinutes,
        playtimeHours: g.playtimeHours,
        lastPlayed: g.lastPlayed,
        gameId: g.gameId,
        name: g.name,
        cover: g.cover,
        endless: g.endless,
        inLibrary: g.inLibrary,
        currentStatus: g.currentStatus,
        currentHours: g.currentHours,
        category: g.category,
        suggestedStatus: g.suggestedStatus,
        canImportAchievements: g.canImportTrophies,
        npCommunicationId: g.npCommunicationId,
        npServiceName: g.npServiceName,
        trophyProgress: g.trophyProgress,
        definedTrophies: g.definedTrophies,
        hasPlatinum: g.hasPlatinum,
        consoles: g.consoles,
        suggestedConsole: g.suggestedConsole,
        changed,
        // Déjà en bibliothèque : coché seulement s'il a bougé depuis la
        // dernière synchro — sinon le téléphone irait rechercher les trophées
        // de toute la bibliothèque pour rien.
        include: g.category === "update" ? changed && (better || g.canImportTrophies) : true,
        status: g.suggestedStatus,
        console: g.suggestedConsole,
        hours: g.playtimeHours,
        updateHours: g.category === "update" ? better : true,
        importAchievements: g.canImportTrophies,
      };
    });

    const counts = { wishlist: 0, played: 0, update: 0, synced: 0, unmatched: keptUnmatched.length, ignored };
    for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;

    const appliedBefore = await PlatformSync.countDocuments({
      user: req.userId,
      platform: "psn",
      state: "applied",
    });
    // Un seul récap à la fois : relancer un scan remplace le brouillon
    // précédent (rien ne s'était produit) sans toucher à l'historique.
    await PlatformSync.deleteMany({ user: req.userId, platform: "psn", state: "pending" });

    const sync = await PlatformSync.create({
      user: req.userId,
      platform: "psn",
      state: "pending",
      kind: appliedBefore ? "refresh" : "first",
      items,
      unmatched: keptUnmatched.map((u) => ({
        key: u.titleKey,
        name: u.psnName || u.name,
        icon: u.icon,
        playtimeMinutes: u.playMinutes || 0,
        npCommunicationId: u.npCommunicationId || null,
        npServiceName: u.npServiceName || null,
      })),
      counts,
    });

    // Rien de neuf, rien à annoncer : les jeux inchangés ne valent pas un ping.
    const fresh = items.filter(needsLook).length;
    if (fresh) {
      await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
      await Notification.create({
        user: req.userId,
        type: "import_pending",
        actor: null,
        snippet: `${fresh} jeu${fresh > 1 ? "x" : ""} PlayStation à valider`,
      }).catch(() => {});
    }

    res.json({ sync: mapPsnSync(sync, { full: true }) });
  } catch (err) {
    console.error("psn mobile sync error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la synchro." });
  }
});

// --- Le récap en attente (rouvert depuis les réglages). ---
router.get("/mobile/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingPsnSync(req.userId);
    res.json({ sync: sync ? mapPsnSync(sync, { full: true }) : null });
  } catch (err) {
    console.error("psn sync get error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Modifier le récap : cocher, statut, console, heures. ---
router.patch("/mobile/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingPsnSync(req.userId);
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
      // Une autre jaquette, choisie depuis le récap : c'est elle que prendra
      // le jeu en entrant en bibliothèque. Une adresse web, rien d'autre.
      if (c.cover !== undefined) {
        const url = typeof c.cover === "string" ? c.cover.trim() : "";
        if (/^https?:\/\//i.test(url) && url.length < 2048) it.cover = url;
      }
      // La console doit rester une de celles où le jeu est SORTI : on ne range
      // pas un jeu PS3 sur une PS5 parce qu'un client l'a demandé.
      if (c.console !== undefined && (it.consoles || []).some((x) => x.name === c.console))
        it.console = c.console;
      if (c.hours !== undefined) {
        const h = Number(c.hours);
        it.hours = c.hours === null || !Number.isFinite(h) || h < 0 ? null : h;
      }
    }

    const bulk = req.body?.bulk;
    if (bulk && typeof bulk.include === "boolean") {
      for (const it of sync.items) {
        if (!bulk.category || it.category === bulk.category) it.include = bulk.include;
      }
    }

    sync.markModified("items");
    await sync.save();
    res.json({ sync: mapPsnSync(sync, { full: true }) });
  } catch (err) {
    console.error("psn sync patch error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Valider : c'est ICI, et nulle part ailleurs, que la bibliothèque bouge. ---
//
// Les trophées arrivent AVEC la validation, récupérés par le téléphone pour les
// seuls jeux cochés : le serveur ne peut pas les chercher lui-même, et les
// prendre tous d'avance coûterait des centaines d'appels pour rien.
router.post("/mobile/sync/apply", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("psn");
    if (!user?.psn?.accountId)
      return res.status(400).json({ error: "Aucun compte PlayStation lié." });

    const sync = await pendingPsnSync(req.userId);
    if (!sync) return res.status(404).json({ error: "Aucune synchro en attente." });

    // Trophées envoyés par le téléphone, rangés par clé de jeu.
    const trophyMap = new Map();
    for (const t of Array.isArray(req.body?.trophies) ? req.body.trophies : []) {
      const list = (Array.isArray(t?.list) ? t.list : []).slice(0, MAX_TROPHIES_PER_GAME);
      if (!t?.key || !list.length) continue;
      trophyMap.set(String(t.key), {
        total: Number(t.total) || list.length,
        unlocked: Number(t.unlocked) || list.filter((x) => x?.unlocked).length,
        list: list.map((x) => ({
          apiName: String(x?.apiName || ""),
          name: String(x?.name || ""),
          description: x?.description ? String(x.description) : "",
          icon: x?.icon ? String(x.icon) : null,
          hidden: !!x?.hidden,
          unlocked: !!x?.unlocked,
          unlockedAt: x?.unlockedAt ? new Date(x.unlockedAt) : null,
          rarity: x?.rarity == null ? null : Number(x.rarity),
          tier: x?.tier ? String(x.tier) : null,
        })),
      });
    }

    const chosen = sync.items.filter((it) => it.include);
    let added = 0;
    let updated = 0;
    let hoursUpdated = 0;
    let achievements = 0;

    for (const it of chosen) {
      const before = it.currentHours;
      const result = await upsertUserGame(req.userId, {
        gameId: it.gameId,
        name: it.name,
        cover: it.cover,
        platform: it.console || it.suggestedConsole,
        status: it.status,
        playtimeHours: it.hours != null ? it.hours : it.playtimeHours,
        updateHours: it.category === "update" ? !!it.updateHours : true,
        setStatus: it.category === "update" && it.status !== it.currentStatus,
        npCommunicationId: it.npCommunicationId,
      });
      if (result === "added") added++;
      else {
        updated++;
        if (it.updateHours && it.hours != null && it.hours !== before) hoursUpdated++;
      }

      // Même règle que côté Steam : les trophées suivent le jeu coché.
      const trophies = it.canImportAchievements ? trophyMap.get(String(it.key)) : null;
      if (trophies) {
        await GameAchievements.updateOne(
          { user: req.userId, gameId: Number(it.gameId), platform: "psn" },
          {
            $set: {
              platformAppId: String(it.npCommunicationId || ""),
              gameName: it.name,
              gameCover: it.cover || null,
              total: trophies.total,
              unlocked: trophies.unlocked,
              achievements: trophies.list,
            },
          },
          { upsert: true }
        );
        achievements++;
      }
    }

    sync.state = "applied";
    sync.appliedAt = new Date();
    sync.result = { added, updated, hoursUpdated, achievements, skipped: sync.items.length - chosen.length };
    await sync.save();

    user.psn.lastSyncAt = sync.appliedAt;
    await user.save();

    await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
    triggerMissionCheck(req.userId);

    res.json({ sync: mapPsnSync(sync), result: sync.result });
  } catch (err) {
    console.error("psn sync apply error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "Erreur lors de la validation." });
  }
});

// --- Annuler le récap : il part à l'historique, marqué « annulée ». ---
router.delete("/mobile/sync", requireAuth, async (req, res) => {
  try {
    const sync = await pendingPsnSync(req.userId);
    if (!sync) return res.json({ ok: true });
    // Rien de neuf : on la referme sans trace (cf. isQuiet).
    if (isQuiet(sync)) {
      await sync.deleteOne();
      return res.json({ ok: true, closed: true });
    }
    sync.state = "cancelled";
    sync.items = [];
    sync.unmatched = [];
    await sync.save();
    await Notification.deleteMany({ user: req.userId, type: "import_pending", read: false });
    res.json({ ok: true });
  } catch (err) {
    console.error("psn sync cancel error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Écarter un jeu pour de bon (et le retirer du récap en cours). ---
//
// La clé est un nom simplifié (lettres et chiffres uniquement, cf.
// simplifyName) : elle passe sans risque dans une adresse.
router.post("/mobile/ignored/:key", requireAuth, async (req, res) => {
  try {
    const key = psnKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Jeu inconnu." });

    const sync = await pendingPsnSync(req.userId);
    const item = sync?.items.find((it) => it.key === key);
    const fromUnmatched = sync?.unmatched.find((u) => u.key === key);

    await PendingImport.updateOne(
      { user: req.userId, platform: "psn", titleKey: key },
      {
        $set: {
          state: "ignored",
          psnName: item?.sourceName || fromUnmatched?.name || null,
          icon: item?.icon || fromUnmatched?.icon || null,
          gameId: item?.gameId ?? null,
          name: item?.name ?? null,
          cover: item?.cover ?? null,
          playtimeHours: item?.playtimeHours ?? null,
          npCommunicationId: item?.npCommunicationId ?? null,
        },
      },
      { upsert: true }
    );

    if (sync) {
      // On marque le jeu au lieu de le retirer : écarter doit rester réversible
      // sans relancer toute une synchro (même règle que côté Steam).
      const hit = sync.items.find((it) => it.key === key);
      if (hit) {
        hit.ignored = true;
        hit.include = false;
        sync.markModified("items");
      }
      sync.unmatched = sync.unmatched.filter((u) => u.key !== key);
      sync.counts.ignored = (sync.counts.ignored || 0) + 1;
      await sync.save();
    }

    res.json({ ok: true, sync: sync ? mapPsnSync(sync, { full: true }) : null });
  } catch (err) {
    console.error("psn ignore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- La liste des écartés, et le droit de changer d'avis. ---
router.get("/mobile/ignored", requireAuth, async (req, res) => {
  try {
    const rows = await PendingImport.find({
      user: req.userId,
      platform: "psn",
      state: "ignored",
    }).sort({ updatedAt: -1 });
    res.json({
      ignored: rows.map((r) => ({
        id: String(r._id),
        key: r.titleKey,
        sourceName: r.psnName || null,
        icon: r.icon || null,
        gameId: r.gameId || null,
        name: r.name || r.psnName || null,
        cover: r.cover || null,
        playtimeHours: r.playtimeHours ?? null,
      })),
    });
  } catch (err) {
    console.error("psn ignored error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

router.delete("/mobile/ignored/:key", requireAuth, async (req, res) => {
  try {
    const key = psnKey(req.params.key);
    await PendingImport.deleteOne({ user: req.userId, platform: "psn", titleKey: key });
    // Le récap en cours, s'il portait ce jeu, le remet dans la liste.
    const sync = await pendingPsnSync(req.userId);
    const hit = sync?.items.find((it) => it.key === key);
    if (hit) {
      hit.ignored = false;
      hit.include = true;
      sync.markModified("items");
      sync.counts.ignored = Math.max(0, (sync.counts.ignored || 0) - 1);
      await sync.save();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("psn unignore error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Relier à la main un titre non reconnu. ---
//
// Le rapprochement PlayStation se fait par NOM : une édition régionale, un
// sous-titre en trop, et le jeu tombe dans les « non reconnus ». L'utilisateur,
// lui, sait de quel jeu il s'agit — il le désigne, on le range (et on garde
// l'identifiant de trophées, pour qu'il n'entre pas les mains vides).
router.post("/mobile/sync/match", requireAuth, async (req, res) => {
  try {
    const sync = await pendingPsnSync(req.userId);
    if (!sync) return res.status(404).json({ error: "Aucune synchro en attente." });

    const key = psnKey(req.body?.key);
    const gameId = Number(req.body?.gameId);
    const name = String(req.body?.name || "").trim();
    if (!key || !gameId || !name)
      return res.status(400).json({ error: "Jeu à relier incomplet." });

    // ⚠️ RELIER, OU CORRIGER. Un titre non reconnu se relie ; un titre MAL
    // reconnu (le rapprochement par nom a pris le mauvais jeu) se corrige de
    // la même façon : on le reprend tel que Sony le décrit, trophées compris.
    let u;
    const idx = sync.unmatched.findIndex((x) => x.key === key);
    if (idx !== -1) {
      [u] = sync.unmatched.splice(idx, 1);
      sync.counts.unmatched = Math.max(0, (sync.counts.unmatched || 0) - 1);
    } else {
      const at = sync.items.findIndex((x) => x.key === key);
      if (at === -1) return res.status(404).json({ error: "Titre introuvable." });
      const [old] = sync.items.splice(at, 1);
      sync.counts[old.category] = Math.max(0, (sync.counts[old.category] || 0) - 1);
      u = {
        key,
        name: old.sourceName,
        icon: old.icon,
        playtimeMinutes: old.playtimeMinutes,
        npCommunicationId: old.npCommunicationId,
        npServiceName: old.npServiceName,
      };
    }

    const existing = await UserGame.findOne({ user: req.userId, gameId }).select(
      "status playtimeHours"
    );
    const hours = Math.round(((u.playtimeMinutes || 0) / 60) * 10) / 10;
    const category = existing ? "update" : "played";
    const suggestedStatus = existing
      ? existing.status
      : hours >= FINISHED_HOURS
      ? "finished"
      : "paused";

    sync.items.push({
      key,
      sourceName: u.name,
      icon: u.icon,
      playtimeMinutes: u.playtimeMinutes || 0,
      playtimeHours: hours,
      gameId,
      name,
      cover: req.body?.cover || null,
      inLibrary: !!existing,
      currentStatus: existing?.status || null,
      currentHours: existing?.playtimeHours ?? null,
      category,
      suggestedStatus,
      canImportAchievements: !!u.npCommunicationId,
      npCommunicationId: u.npCommunicationId || null,
      npServiceName: u.npServiceName || null,
      include: true,
      status: suggestedStatus,
      hours,
      updateHours: category === "update",
      importAchievements: !!u.npCommunicationId,
    });
    sync.counts[category] = (sync.counts[category] || 0) + 1;
    sync.markModified("items");
    await sync.save();

    res.json({ sync: mapPsnSync(sync, { full: true }) });
  } catch (err) {
    console.error("psn match error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- L'historique des synchros. ---
router.get("/mobile/history", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await PlatformSync.find({
      user: req.userId,
      platform: "psn",
      state: { $in: ["applied", "cancelled"] },
    })
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ history: rows.map((r) => mapPsnSync(r)) });
  } catch (err) {
    console.error("psn history error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// --- Adopter l'avatar PlayStation (garder le sien = ne rien appeler). ---
router.post("/mobile/avatar", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const avatar = user?.psn?.avatar;
    if (!avatar) return res.status(400).json({ error: "Aucune photo PlayStation." });
    user.avatar = avatar;
    await user.save();
    res.json({ user: user.toPublic() });
  } catch (err) {
    console.error("psn avatar error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
