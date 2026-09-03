import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import User from "./models/User.js";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/games.js";
import gameMediaRoutes from "./routes/gameMedia.js";
import libraryRoutes from "./routes/library.js";
import listRoutes from "./routes/lists.js";
import userRoutes from "./routes/users.js";
import notificationRoutes from "./routes/notifications.js";
import recommendationRoutes from "./routes/recommendations.js";
import ostRoutes from "./routes/ost.js";
import audioRoutes from "./routes/audio.js";
import repostRoutes from "./routes/reposts.js";
import videoRoutes from "./routes/videos.js";
import feedRoutes from "./routes/feed.js";
import freeGamesRoutes from "./routes/freeGames.js";
import blindtestRoutes from "./routes/blindtest.js";
import blindtestVersusRoutes from "./routes/blindtestVersus.js";
import pixelRoutes from "./routes/pixel.js";
import pixelVersusRoutes from "./routes/pixelVersus.js";
import geoRoutes from "./routes/geo.js";
import geoVersusRoutes from "./routes/geoVersus.js";
import quizRoutes from "./routes/quiz.js";
import quizVersusRoutes from "./routes/quizVersus.js";
import quizAdminRoutes from "./routes/quizAdmin.js";
import motRoutes from "./routes/mot.js";
import perroquetRoutes from "./routes/perroquet.js";
import perroquetVersusRoutes from "./routes/perroquetVersus.js";
import perroquetSoundRoutes from "./routes/perroquetSounds.js";
import perroquetAdminRoutes from "./routes/perroquetAdmin.js";
import imposteurRoutes from "./routes/imposteur.js";
import presenceRoutes from "./routes/presence.js";
import gbaStreamRoutes from "./routes/gbaStream.js";
import listenRoutes from "./routes/listen.js";
import arcadeRoutes from "./routes/arcade.js";
import steamRoutes from "./routes/steam.js";
import psnRoutes from "./routes/psn.js";
import patchnoteRoutes from "./routes/patchnotes.js";
import adminRoutes from "./routes/admin.js";
import companyRoutes from "./routes/companies.js";
import platformRoutes from "./routes/platforms.js";
import shareRoutes from "./routes/share.js";
import clientErrorRoutes from "./routes/clientErrors.js";
import patchesRoutes from "./routes/patches.js";
import downloadRoutes from "./routes/downloads.js";
import trackerRoutes, { startTrackerAutoSync } from "./routes/trackers.js";
import missionRoutes from "./routes/missions.js";
import chatRoutes from "./routes/chat.js";
import callRoutes from "./routes/calls.js";
import ringtoneRoutes from "./routes/ringtones.js";
import iceRoutes from "./routes/ice.js";
import collectionRoutes from "./routes/collection.js";
import watchPartyRoutes from "./routes/watchparty.js";
import settingsRoutes from "./routes/settings.js";
import discordRoutes from "./routes/discord.js";
import { ensureBotUser } from "./lib/bot.js";
import { startDiscordBot } from "./lib/discordBot.js";
import { requireFeature } from "./lib/features.js";
import { optionalAuth } from "./middleware/auth.js";
import { avatarPrivacy } from "./middleware/avatarPrivacy.js";
import { auditLog, logEvent } from "./lib/audit.js";
import { authLimiter, gamesLimiter } from "./middleware/rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Derrière le reverse-proxy Caddy : fait confiance à X-Forwarded-Proto/Host
// pour que req.protocol vaille "https" et que les URLs d'uploads soient
// construites en https://myplaylog.cc/... (et pas http://localhost).
//
// ⚠️ LE CHIFFRE EST LE NOMBRE DE PROXYS DEVANT NOUS, ET CE N'EST PAS UN DÉTAIL
// DE STYLE. Avec `true`, express croit le premier X-Forwarded-For venu : on
// peut alors s'inventer une IP à chaque requête et traverser les limites de
// débit sans les voir (middleware/rateLimit.js). Avec `1`, seul le dernier
// relais — Caddy — est cru, et l'IP obtenue est la vraie. Si un jour tu mets un
// Cloudflare (ou un autre proxy) devant Caddy, passe à 2.
app.set("trust proxy", 1);

app.use(
  cors({
    // Liste d'origines autorisées, séparées par des virgules (localhost + IP
    // du PC sur le réseau local pour tester depuis le téléphone).
    origin: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((s) => s.trim()),
  })
);
// Limite relevée : le worker PSN maison renvoie l'import complet (jeux +
// trophées de tout un compte) en un seul POST, ce qui dépasse les 100 ko par défaut.
app.use(express.json({ limit: "25mb" }));

// Fichiers uploadés (covers custom, images de curseurs, médias…).
// `immutable` + 30 jours : chaque nom de fichier porte un horodatage et un
// aléa, un même chemin ne change donc JAMAIS de contenu. Sans ça, express
// n'envoie qu'un ETag et le navigateur revalide à chaque affichage — ce qui
// devenait un déluge de 304 avec les curseurs animés (une image par frame,
// plusieurs fois par seconde).
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"), {
    maxAge: "30d",
    immutable: true,
  })
);

// Journal du serveur (onglet « Logs » du panel admin). Posé ICI, avant toutes
// les routes : il n'écrit rien à l'aller, il pose un écouteur sur la fin de la
// réponse — moment où l'on connaît enfin l'auteur, le statut et la durée
// (cf. lib/audit.js).
app.use(auditLog);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "myplaylog", time: new Date().toISOString() });
});

// Monté AVANT le filtre d'avatars : login/register répondent sans être
// authentifiés (pas de req.userId), et le filtre prendrait alors la photo du
// compte qui se connecte pour celle d'un tiers à masquer.
app.use("/api/auth", authLimiter, authRoutes);

// Retire les photos de profil masquées (comptes privés ayant coché « cacher ma
// photo ») de toutes les réponses JSON qui suivent, quel que soit l'endpoint.
app.use(avatarPrivacy);
// Le seul endroit qui consomme le quota IGDB partagé : c'est celui qu'on
// protège en priorité (cf. middleware/rateLimit.js).
app.use("/api/games", gamesLimiter, gameRoutes);
app.use("/api/game-media", gameMediaRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/lists", listRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/ost", ostRoutes);
app.use("/api/audio", audioRoutes);
app.use("/api/reposts", repostRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/free-games", freeGamesRoutes);
// Même précaution que pour /api/geo/versus : monté AVANT le routeur solo.
app.use("/api/blindtest/versus", blindtestVersusRoutes);
app.use("/api/blindtest", blindtestRoutes);
// Le versus AVANT le solo : /api/pixel/:id/results happerait sinon
// /api/pixel/versus/... (même piège que /api/blindtest/versus).
app.use("/api/pixel/versus", pixelVersusRoutes);
app.use("/api/pixel", pixelRoutes);
// AVANT /api/geo, et ce n'est pas cosmétique : le routeur solo porte un
// `GET /:id/results` qui happerait les chemins à deux segments. Monter le
// versus d'abord lève toute ambiguïté.
app.use("/api/geo/versus", geoVersusRoutes);
app.use("/api/geo", geoRoutes);
// Même piège une quatrième fois : /api/quiz porte un `GET /:id/results` qui
// avalerait /api/quiz/versus/<code>. Le versus passe devant.
app.use("/api/quiz/versus", quizVersusRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/mot", motRoutes);
// Le piège une cinquième fois : /api/perroquet porte un `GET /:id/results` qui
// avalerait /api/perroquet/versus/<code> — et `DELETE /:id` avalerait de même
// /api/perroquet/sounds/<id>. Les deux sous-routeurs passent devant.
app.use("/api/perroquet/versus", perroquetVersusRoutes);
app.use("/api/perroquet/sounds", perroquetSoundRoutes);
app.use("/api/perroquet", perroquetRoutes);
// L'Imposteur n'a pas de mode solo : un seul routeur, donc aucun ordre à
// respecter ici. Le piège des cinq autres jeux se rejoue en revanche À
// L'INTÉRIEUR du routeur, où `GET /leaderboard` doit passer avant `GET /:code`.
app.use("/api/imposteur", imposteurRoutes);
app.use("/api/presence", presenceRoutes);
// Diffuser sa partie GBA : signalisation WebRTC + la manette qu'on passe.
app.use("/api/gba-stream", gbaStreamRoutes);
// Écouter à plusieurs : l'hôte pose des repères de lecture, les autres suivent.
// Aucun audio ne transite ici (voir lib/listenRooms.js), d'où l'absence de
// drapeau de section — c'est le mini-lecteur, qui existe partout.
app.use("/api/listen", listenRoutes);
app.use("/api/arcade", arcadeRoutes);
app.use("/api/steam", steamRoutes);
// Liaison du compte Discord (OAuth2 « identify ») : c'est elle qui permettra
// au bot de reconnaître un joueur du site depuis un serveur Discord.
app.use("/api/discord", discordRoutes);
app.use("/api/psn", psnRoutes);
app.use("/api/patchnotes", patchnoteRoutes);
// La relecture de la banque du quiz, avant le routeur d'admin général : ce
// dernier porte des chemins à un segment qui happeraient /api/admin/quiz.
app.use("/api/admin/quiz", quizAdminRoutes);
// La banque de sons du Perroquet, même raison d'ordre : le routeur d'admin
// général porte des chemins à un segment qui happeraient /api/admin/perroquet.
app.use("/api/admin/perroquet", perroquetAdminRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/platforms", platformRoutes);
app.use("/api/patches", patchesRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/trackers", trackerRoutes);
app.use("/api/missions", missionRoutes);
// Réglages de l'app : les drapeaux qui allument ou éteignent des sections.
app.use("/api/settings", settingsRoutes);
// Collection : séries / films / animés liés au jeu vidéo (l'étagère). Toute la
// section est derrière son drapeau — éteinte, elle n'existe que pour l'admin.
//
// `optionalAuth` EN PREMIER, et ce n'est pas décoratif : le drapeau doit savoir
// QUI demande pour laisser passer l'admin, or `requireAuth` ne s'exécute qu'à
// l'intérieur du routeur, donc bien après ce point. Sans cette ligne, personne
// n'est identifié ici et l'admin se prend son propre 404.
app.use(
  "/api/collection",
  optionalAuth,
  requireFeature("collection"),
  collectionRoutes
);
// Les salles de projection à plusieurs (watchparty). Même drapeau que la
// Collection — c'est une façon de la regarder — mais le barrage est POSÉ DANS le
// routeur, après son `requireAuth` : il faut être identifié pour que l'admin
// passe quand la section est éteinte (voir routes/watchparty.js).
app.use("/api/watchparty", watchPartyRoutes);
// Messagerie (DM + groupes). Contient le flux temps réel SSE /api/chat/stream.
app.use("/api/chat", chatRoutes);
// Les appels vocaux de la messagerie. À part de /api/chat, dont le routeur
// porte des chemins à deux segments qui happeraient les nôtres.
app.use("/api/calls", callRoutes);
app.use("/api/ringtones", ringtoneRoutes);
// Les serveurs de rendez-vous des appels, avec des identifiants de relais
// éphémères : ils ne peuvent pas vivre dans le client (cf. routes/ice.js).
app.use("/api/ice", iceRoutes);
// Remontée des crashs du front (voir routes/clientErrors.js).
app.use("/api/client-errors", clientErrorRoutes);

// Aperçus de partage (Open Graph). Caddy ne route ici que les robots sociaux
// (WhatsApp, Facebook, X, Discord…) ; les vraies personnes reçoivent la SPA.
app.use("/", shareRoutes);

const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

// Bootstrap du super-admin : si aucun compte n'a le rôle isSuperAdmin en base
// (première migration, ou base neuve), on le pose sur le compte ADMIN_EMAIL.
// Ensuite la base fait foi — le rôle peut être transféré depuis le panel Admin.
async function ensureSuperAdmin() {
  try {
    const existing = await User.findOne({ isSuperAdmin: true }).select("_id").lean();
    if (existing) return;
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (!email) {
      console.warn("⚠️  Aucun super-admin en base et ADMIN_EMAIL non défini.");
      return;
    }
    const u = await User.findOne({ email }).select("_id email");
    if (!u) {
      console.warn(`⚠️  ADMIN_EMAIL=${email} introuvable en base — super-admin non bootstrappé.`);
      return;
    }
    await User.updateOne({ _id: u._id }, { $set: { isSuperAdmin: true, isAdmin: true } });
    console.log(`👑 Super-admin bootstrappé depuis ADMIN_EMAIL : ${u.email}`);
  } catch (err) {
    console.error("ensureSuperAdmin error:", err.message);
  }
}

// Migration douce multi-comptes de tracking (smurfs) : l'ancien index unique
// { user, provider } empêcherait un second compte par jeu — on le supprime, et
// on pose slot=0 (compte principal) sur les documents existants pour que les
// requêtes { slot: 0 } les retrouvent. Idempotent, best-effort.
async function migrateTrackerSlots() {
  try {
    const { default: GameTracker } = await import("./models/GameTracker.js");
    const { default: TrackerMatch } = await import("./models/TrackerMatch.js");
    const { default: RankChange } = await import("./models/RankChange.js");
    await GameTracker.collection.dropIndex("user_1_provider_1").catch(() => {});
    await GameTracker.updateMany({ slot: { $exists: false } }, { $set: { slot: 0 } });
    await TrackerMatch.updateMany({ slot: { $exists: false } }, { $set: { slot: 0 } });
    await RankChange.updateMany({ slot: { $exists: false } }, { $set: { slot: 0 } });
  } catch (err) {
    console.error("migrateTrackerSlots error:", err.message);
  }
}

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connecté à MongoDB");
    await ensureSuperAdmin();
    // Le compte du bot, créé au premier démarrage : sans lui, ouvrir l'accès à
    // quelqu'un depuis le panel n'aurait personne à qui faire écrire.
    await ensureBotUser().catch((err) => console.error("ensureBotUser:", err.message));
    // Le bot sur Discord : sans jeton, la fonction ne fait rien et le site
    // tourne exactement pareil. Sans await — une Gateway lente n'a aucune
    // raison de retarder l'ouverture du port HTTP.
    startDiscordBot().catch((err) => console.error("startDiscordBot:", err.message));
    await migrateTrackerSlots();
    // Synchro automatique des comptes de tracking (League of Legends).
    startTrackerAutoSync();
    const server = app.listen(PORT, () => {
      console.log(`🚀 API MyPlayLog sur http://localhost:${PORT}`);
      // Une ligne dans le journal : un redémarrage explique souvent, à lui
      // seul, un trou d'une minute dans les logs de la nuit.
      logEvent({
        kind: "system",
        label: "Serveur démarré",
        meta: { port: PORT, node: process.version, pid: process.pid },
      });
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `❌ Le port ${PORT} est déjà utilisé. Un autre serveur tourne peut-être déjà.\n` +
            `   Ferme-le, ou change PORT dans server/.env.`
        );
        process.exit(1);
      }
      throw err;
    });
  } catch (err) {
    console.error("❌ Impossible de se connecter à MongoDB:", err.message);
    process.exit(1);
  }
}

start();
