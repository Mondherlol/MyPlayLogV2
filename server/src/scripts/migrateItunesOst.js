/**
 * Transition des anciennes OST iTunes vers YouTube (NON destructif).
 * À lancer une fois : `npm run migrate:ost-youtube` depuis /server.
 *
 * Pour chaque favoriteOst basée iTunes (extrait `preview`, sans `youtube`), on
 * s'assure que l'OST YouTube du jeu est scrapée, puis on cherche la piste
 * YouTube dont le titre correspond le mieux au favori. Si on trouve un bon
 * match, on remplace le favori par la version YouTube (lecture complète).
 * Sinon on NE TOUCHE À RIEN (l'ancien favori iTunes est conservé).
 */
import "dotenv/config";
import mongoose from "mongoose";
import UserGame from "../models/UserGame.js";
import CustomOst from "../models/CustomOst.js";
import { ensureScraped } from "../lib/ostScrape.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

// Seuil de similarité pour accepter un remplacement (0..1).
const MATCH_THRESHOLD = 0.5;

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Similarité de titres : Jaccard sur les mots + bonus d'inclusion.
function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const uni = new Set([...ta, ...tb]).size;
  let j = uni ? inter / uni : 0;
  if (a.includes(b) || b.includes(a)) j = Math.max(j, 0.8);
  return j;
}

function bestMatch(name, tracks) {
  let best = null;
  let bestScore = 0;
  for (const t of tracks) {
    const s = similarity(name, t.name);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? { track: best, score: bestScore } : null;
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connecté à MongoDB");

  // Favoris iTunes = un extrait preview, pas de flag youtube.
  const docs = await UserGame.find({
    "favoriteOst.preview": { $nin: [null, ""] },
    $or: [{ "favoriteOst.youtube": { $exists: false } }, { "favoriteOst.youtube": false }],
  }).select("gameId name favoriteOst");
  console.log(`🎵 Favoris iTunes à transitionner : ${docs.length}`);

  const cache = new Map(); // gameId -> tracks YouTube (CustomOst)
  let migrated = 0;
  let unmatched = 0;

  for (const doc of docs) {
    const gameId = doc.gameId;
    const favName = doc.favoriteOst?.name || "";

    // OST YouTube du jeu (scrape si nécessaire, puis mise en cache).
    let tracks = cache.get(gameId);
    if (!tracks) {
      let list = await CustomOst.find({ gameId });
      if (!list.length) {
        await ensureScraped(gameId, doc.name).catch(() => {});
        list = await CustomOst.find({ gameId });
      }
      tracks = list;
      cache.set(gameId, tracks);
    }

    const match = bestMatch(favName, tracks);
    if (!match) {
      unmatched++;
      continue;
    }

    const t = match.track;
    doc.favoriteOst = {
      name: t.name,
      artist: t.artist || doc.favoriteOst.artist || null,
      preview: null, // on abandonne l'extrait iTunes
      artwork: t.artwork || doc.favoriteOst.artwork || null,
      youtube: true,
      url: t.url,
    };
    await doc.save({ validateModifiedOnly: true });
    migrated++;
    console.log(
      `  ✓ [${gameId}] "${favName}" → "${t.name}" (score ${match.score.toFixed(2)})`
    );
  }

  console.log(
    `\n✅ Terminé : ${migrated} transitionnés, ${unmatched} sans correspondance (conservés en l'état).`
  );
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Échec de la migration :", err.message);
  process.exit(1);
});
