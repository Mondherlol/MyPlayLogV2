import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/games.js";
import libraryRoutes from "./routes/library.js";
import listRoutes from "./routes/lists.js";
import userRoutes from "./routes/users.js";
import notificationRoutes from "./routes/notifications.js";
import recommendationRoutes from "./routes/recommendations.js";
import ostRoutes from "./routes/ost.js";
import repostRoutes from "./routes/reposts.js";
import videoRoutes from "./routes/videos.js";
import feedRoutes from "./routes/feed.js";
import patchnoteRoutes from "./routes/patchnotes.js";
import adminRoutes from "./routes/admin.js";
import companyRoutes from "./routes/companies.js";
import platformRoutes from "./routes/platforms.js";
import shareRoutes from "./routes/share.js";
import clientErrorRoutes from "./routes/clientErrors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Derrière le reverse-proxy Caddy : fait confiance à X-Forwarded-Proto/Host
// pour que req.protocol vaille "https" et que les URLs d'uploads soient
// construites en https://myplaylog.cc/... (et pas http://localhost).
app.set("trust proxy", true);

app.use(
  cors({
    // Liste d'origines autorisées, séparées par des virgules (localhost + IP
    // du PC sur le réseau local pour tester depuis le téléphone).
    origin: (process.env.CLIENT_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((s) => s.trim()),
  })
);
app.use(express.json());

// Fichiers uploadés (covers custom)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "myplaylog", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/lists", listRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/ost", ostRoutes);
app.use("/api/reposts", repostRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/patchnotes", patchnoteRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/platforms", platformRoutes);
// Remontée des crashs du front (voir routes/clientErrors.js).
app.use("/api/client-errors", clientErrorRoutes);

// Aperçus de partage (Open Graph). Caddy ne route ici que les robots sociaux
// (WhatsApp, Facebook, X, Discord…) ; les vraies personnes reçoivent la SPA.
app.use("/", shareRoutes);

const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connecté à MongoDB");
    const server = app.listen(PORT, () => {
      console.log(`🚀 API MyPlayLog sur http://localhost:${PORT}`);
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
