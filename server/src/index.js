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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
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
