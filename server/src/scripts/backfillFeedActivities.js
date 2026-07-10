/**
 * Backfill du journal Activity pour le nouveau fil (NON destructif).
 * À lancer une fois : `npm run backfill:feed` depuis /server.
 *
 * Le fil d'accueil ne lit plus UserGame.updatedAt (qui faisait remonter un jeu
 * « terminé » à chaque modification de note/OST/heures) mais le journal
 * Activity. Ce script crée une activité `game_update` par entrée de
 * bibliothèque existante (datée de son updatedAt — meilleure approximation
 * disponible) et une `list_create` par liste publique, pour que le fil ne
 * reparte pas vide. Les entrées déjà journalisées sont ignorées (relançable).
 */
import "dotenv/config";
import mongoose from "mongoose";
import UserGame from "../models/UserGame.js";
import List from "../models/List.js";
import Activity from "../models/Activity.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connecté à MongoDB.");

  // --- Entrées de bibliothèque → game_update ---
  const entries = await UserGame.find({}).lean();
  let created = 0;
  for (const e of entries) {
    const exists = await Activity.exists({
      actor: e.user,
      type: "game_update",
      game: e.gameId,
    });
    if (exists) continue;

    const changes = [{ kind: "status", to: e.status }];
    if (e.rating != null) changes.push({ kind: "rating", value: e.rating });
    const hasReview = !!(
      (e.review || "").trim() ||
      (e.pros || []).length ||
      (e.cons || []).length ||
      (e.reviewMedia || []).length
    );
    if (hasReview) changes.push({ kind: "review" });
    if (e.favorite) changes.push({ kind: "favorite" });
    if (e.favoriteOst?.name)
      changes.push({
        kind: "ost",
        name: e.favoriteOst.name,
        artist: e.favoriteOst.artist || "",
        artwork: e.favoriteOst.artwork || null,
      });

    // On force les dates via insertOne (create écraserait createdAt).
    await Activity.collection.insertOne({
      actor: e.user,
      type: "game_update",
      target: null,
      list: null,
      comment: null,
      game: e.gameId,
      gameName: String(e.name || "").slice(0, 160),
      gameCover: e.cover || null,
      snippet: "",
      meta: { changes },
      createdAt: e.updatedAt || e.createdAt || new Date(),
      updatedAt: e.updatedAt || e.createdAt || new Date(),
    });
    created++;
  }
  console.log(`game_update : ${created} activités créées (${entries.length} entrées).`);

  // --- Listes publiques → list_create ---
  const lists = await List.find({ visibility: "public" }).select("user createdAt").lean();
  let lc = 0;
  for (const l of lists) {
    const exists = await Activity.exists({
      actor: l.user,
      type: "list_create",
      list: l._id,
    });
    if (exists) continue;
    await Activity.collection.insertOne({
      actor: l.user,
      type: "list_create",
      target: null,
      list: l._id,
      comment: null,
      game: null,
      gameName: "",
      gameCover: null,
      snippet: "",
      meta: null,
      createdAt: l.createdAt || new Date(),
      updatedAt: l.createdAt || new Date(),
    });
    lc++;
  }
  console.log(`list_create : ${lc} activités créées (${lists.length} listes publiques).`);

  await mongoose.disconnect();
  console.log("Terminé.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
